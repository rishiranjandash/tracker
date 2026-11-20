/**
 * SPEED, even on a bad connection. Loaded after app.js; uses its globals.
 *
 *  1. The last copy of each screen is kept on this device (per signed-in person), so the app opens and every tab draws at once from that copy,
 *     and is quietly refreshed behind it. Nothing says "Loading…" if there is a copy to show.
 *  2. The buttons used all day (confirm receipt, send, cancel, Item reached, assign, take back, still with them, issue status, report an issue)
 *     update the screen FIRST and are sent in the background. They wait in an outbox that is kept on this device, are re-sent by themselves when
 *     the signal comes back, and are never saved twice (every send carries a key the server remembers for transfers; the other actions are safe to repeat).
 *     If the server refuses one, the screen goes back to the truth and says why.
 *  3. The screens people open next are loaded in the background (see prefetch in app.js).
 */

// ===================== who the saved copies belong to =====================

function persistOk() { return !window.MOCK_BACKEND || !!window.FAST_FORCE_PERSIST; }     // the demo and the test page keep everything in memory only
function tokenOwner() { return window.MOCK_BACKEND ? 'mock:' + (window.MOCK_EMAIL || '') : (sessionToken ? String(sessionToken).slice(-24) : ''); }
function nowIst() { return new Date(Date.now() + 19800000).toISOString().slice(0, 19) + '+05:30'; }
function addMin(iso, m) { return new Date(Date.parse(iso) + m * 60000 + 19800000).toISOString().slice(0, 19) + '+05:30'; }

// ===================== 1. screens survive a reload =====================

const MEMO_KEY = 'at_memo_v1_';
const MEMO_SAVE = { home: 1, transfers: 1, team: 1, issues: 1, flags: 1, invoices: 1, penalties: 1, stays: 1, supervisorList: 1, techDesk: 1, picker: 1, officeStock: 1, officeBatches: 1 };
let memoSaveTimer = null;

function memoSaveSoon() { if (!persistOk()) return; clearTimeout(memoSaveTimer); memoSaveTimer = setTimeout(memoSaveNow, 1500); }
/** One saved copy per person AND role, so switching "Acting as" can open the other role's own copy at once (and never shows one role's screens as the other's). */
function memoKeyFor(owner, role) { return MEMO_KEY + owner + '|' + role; }
function memoSaveNow() {
  const owner = tokenOwner();
  if (!owner || !me || !persistOk()) return;
  const home = memo['home|{}'];
  if (!home || !home.data || home.data.role !== me.role) return;           // the copies in the memo are not this role's (a switch is under way): do not file them under it
  const entries = {}; let total = 0;
  Object.keys(memo).forEach(function (k) {
    if (!MEMO_SAVE[k.split('|')[0]]) return;
    const n = JSON.stringify(memo[k].data).length;
    if (n > 250000 || total + n > 1800000) return;                      // keep it small: a big list is simply asked for again
    total += n; entries[k] = { at: memo[k].at, data: memo[k].data };
  });
  try {
    localStorage.setItem(memoKeyFor(owner, me.role), JSON.stringify({ v: 2, savedAt: Date.now(), role: me.role, entries: entries }));
    localStorage.setItem(MEMO_KEY + owner + '|last', me.role);
  } catch (e) { try { localStorage.removeItem(memoKeyFor(owner, me.role)); } catch (e2) { /* storage blocked */ } }
}
/** Called when the app starts (or the role is switched): the copies for that role from the last visit go back into the memo (marked old, so they are refreshed behind the screen). -> { home, opts } or null. */
function fastWarmStart(wantRole) {
  const owner = tokenOwner();
  if (!owner || !persistOk()) return null;
  let role = wantRole || '';
  if (!role) { try { role = localStorage.getItem(MEMO_KEY + owner + '|last') || ''; } catch (e) { return null; } }
  if (!role) return null;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(memoKeyFor(owner, role)) || 'null'); } catch (e) { return null; }
  if (!s || s.v !== 2 || s.role !== role || !s.entries || Date.now() - s.savedAt > 7 * 86400000) return null;
  const h = s.entries['home|{}'], o = readSavedOpts();
  if (!h || !h.data || h.data.role !== role || !o || !o.data) return null;
  Object.keys(s.entries).forEach(function (k) { memo[k] = { at: 0, data: s.entries[k].data }; });
  return { home: h.data, opts: o.data };
}
/** Signing out removes this person's saved copies (a shared phone must not keep them). */
function fastSignOut() {
  const owner = tokenOwner();
  clearTimeout(memoSaveTimer);
  if (!owner) return;
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(MEMO_KEY + owner) === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
}

// ===================== 2. the outbox =====================

const OB_KEY = 'at_outbox_v1';
let outbox = [], obRunning = false, obTimer = null;
if (persistOk()) { try { outbox = JSON.parse(localStorage.getItem(OB_KEY) || '[]') || []; } catch (e) { outbox = []; } }
function obSave() { if (!persistOk()) return; try { localStorage.setItem(OB_KEY, JSON.stringify(outbox)); } catch (e) { /* storage blocked: it still goes during this visit */ } }
function obMine() { const o = tokenOwner(); return outbox.filter(function (x) { return x.owner === o; }); }

/** What an action is allowed to answer when it was already done by the first, lost try (so a repeat counts as success). */
const OB_ALREADY = { receiveTransfer: /already/i, cancelTransfer: /only transfers still in transit/i, markReached: /already marked/i, updateIssue: /already/i, updateIssues: /already/i,
  officeStep: /not at that step|already/i, sendToTech: /already/i, techConfirm: /already|not at that step|not on the way/i, techDeposit: /already|not with the product team/i, receiveFromTech: /already|not on the way|not coming back/i,
  markBackFromTech: /already|not on the product-team side/i, resolveShort: /no open short/i, resolveFlag: /no open flag/i, ackProvisional: /not provisional/i, retireProvisional: /not provisional|not a placeholder/i,
  bulkFlags: /already/i, reviewInvoice: /already/i, cancelInvoiceRequest: /not open|not found|already/i, decidePenalty: /already/i, disputePenalty: /only a confirmed/i, cancelLocationAction: /not waiting/i, askAdminHelp: /already/i, askSendToOffice: /not with a supervisor/i, createLocationAction: /already waiting/i, raiseManualPenalty: /already exists/i };

/**
 * Does an action: the screen is updated now (FAST_PATCH below), the answer to the caller comes back at once, and the real send happens in the
 * background. opts: { label, total, minutes, ... } (what the patch needs besides the payload). Returns a promise of the answer the screen needs.
 */
function fastCall(action, payload, opts) {
  opts = opts || {};
  if (!tokenOwner()) return callBackend(action, payload);                // not signed in: nothing to queue
  const key = 'ck' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  let local = {};
  try { const r = (FAST_PATCH[action] || function () { return {}; })(payload || {}, opts); if (r !== undefined) local = r; } catch (e) { /* the screen is corrected by the real answer */ }
  memoEpoch++;                                                           // an answer that was already on its way is older than this change: not trusted
  outbox.push({ id: key, owner: tokenOwner(), action: action, payload: Object.assign({}, payload || {}, { clientKey: key }), at: Date.now(), tries: 0, label: opts.label || action });
  obSave(); memoSaveSoon(); obPaint();
  setTimeout(obDrain, 0);
  return Promise.resolve(local);
}

function obDone(it, data, failedMsg) {
  outbox = outbox.filter(function (x) { return x !== it; }); obSave();
  if (failedMsg) { toast((it.label || 'A change') + ' could not be saved: ' + failedMsg, true); }
  else if (it.action === 'reportIssues' && data && data.duplicates && data.duplicates.length) toast(data.duplicates.length + ' already reported, skipped.', true);
  if (!obMine().length) {                                                // everything is saved: show the server's own version, quietly
    memoDirty();
    if (tab && !userIsBusy() && me) go(tab, true);
  }
  obPaint();
}
function obDrain() {
  clearTimeout(obTimer);
  if (obRunning) return;
  const it = obMine()[0];
  if (!it) { obPaint(); return; }
  obRunning = true;
  Promise.resolve().then(function () { return rawCall(it.action, it.payload); }).then(function (data) {
    obRunning = false; obDone(it, data); obDrain();
  }, function (e) {
    obRunning = false;
    if (e && e.code === 'AUTH') { signOut(); return; }                    // the queue stays; it goes after the next sign-in
    const busy = e && !e.code && /^Server error:/i.test(e.message || '') && /lock|timed out|timeout|too many|try again|temporar|busy|service/i.test(e.message || '');   // the server was overloaded, not unwilling
    if ((e && e.network) || busy) {                                      // no signal (or no answer, or a busy server): keep it and try again, a little later each time
      it.tries++; obSave(); obPaint();
      obTimer = setTimeout(obDrain, Math.min(60000, 3000 * Math.pow(2, Math.min(it.tries, 5))));
      return;
    }
    const msg = (e && e.message) || 'The server refused it.';
    if (OB_ALREADY[it.action] && OB_ALREADY[it.action].test(msg)) obDone(it, null);   // it had already gone through
    else obDone(it, null, msg);
    obDrain();
  });
}
window.addEventListener('online', function () { obDrain(); });
document.addEventListener('visibilitychange', function () { if (!document.hidden) obDrain(); });

/** A small note while changes are waiting for a signal. */
function obPaint() {
  let el = $('obChip');
  const mine = obMine(), waiting = mine.filter(function (x) { return x.tries > 0; }).length;
  if (!waiting) { if (el) el.classList.add('hidden'); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'obChip'; el.className = 'obChip hidden';
    el.addEventListener('click', function () { obDrain(); toast('Trying again…'); });
    document.body.appendChild(el);
  }
  el.innerHTML = '<b>' + mine.length + ' change' + (mine.length > 1 ? 's' : '') + ' waiting for a signal</b> <span class="small">Saved on this phone. Tap to try again now.</span>';
  el.classList.remove('hidden');
}

// ===================== the instant answers (what the screen shows before the server has answered) =====================

const FAST_PATCH = {};
function fastEach(action, fn) { Object.keys(memo).forEach(function (k) { if (k.split('|')[0] === action) { try { fn(memo[k].data, k); } catch (e) { /* corrected by the real answer */ } } }); }
function fastTransfer(id, fn) { fastEach('transfers', function (list) { const i = list.findIndex(function (t) { return t.id === id; }); if (i >= 0) fn(list[i], i, list); }); }

FAST_PATCH.receiveTransfer = function (p, o) {
  const got = {}; (p.receivedIds || []).forEach(function (id) { got[id] = true; });
  fastTransfer(p.transferId, function (t, i, list) {
    let short = 0;
    t.items.forEach(function (x) { if (x.status !== 'IN_TRANSIT') return; if (got[x.assetId]) x.status = 'RECEIVED'; else { x.status = 'SHORT'; short++; } });
    t.status = short ? 'PARTIAL' : 'RECEIVED'; t.receivedBy = me ? me.name : ''; t.receivedAt = nowIst(); t.canReceive = false; t.canReach = false;
    if (me && me.role !== 'SUPERVISOR' && !short && !t.items.some(function (x) { return x.faulty; })) list.splice(i, 1);   // an admin's list only keeps what still needs a decision
  });
  const n = (p.receivedIds || []).length;
  return { received: n, short: Math.max(0, (o.total || n) - n) };
};
FAST_PATCH.cancelTransfer = function (p) { fastTransfer(p.transferId, function (t, i, list) { list.splice(i, 1); }); return {}; };
FAST_PATCH.markReached = function (p, o) {
  fastTransfer(p.transferId, function (t) {
    const now = nowIst(), m = o.minutes || 0;
    t.reachedAt = now; t.reachedBy = me ? me.name : ''; t.canReach = false; t.receipt = { minutes: m, due: m ? addMin(now, m) : '', left: m };
  });
  return {};
};
FAST_PATCH.createTransfer = function (p, o) {
  const now = nowIst(), items = [];
  let cat = {}; fastEach('picker', function (list) { list.forEach(function (a) { cat[a.id] = a.c; }); });
  (p.assetIds || []).forEach(function (id) { items.push({ assetId: id, category: cat[id] || 'DEVICE', status: 'IN_TRANSIT' }); });
  fastEach('transfers', function (list) {
    list.unshift({ id: 'SENDING-' + Date.now().toString(36), pending: true, createdAt: now, status: 'IN_TRANSIT', from: me ? me.name : '', fromLocation: '', fromType: me && me.role === 'ADMIN' ? 'ADMIN' : 'SUPERVISOR', fromId: '', to: o.toName || '', toType: p.toType, toId: p.toId || '',
      sentBy: me ? me.name : '', receivedBy: '', receivedAt: '', note: p.note || '', photoFileId: '', photoState: '', items: items, invoices: [], faulty: 0, atOffice: false, totalItems: items.length, canReceive: false, canReach: false });
  });
  const sent = {}; (p.assetIds || []).forEach(function (id) { sent[id] = true; });
  fastOffice(function (b) { b.items = b.items.filter(function (i) { return !sent[i.id]; }); });                    // sent back from the Office: it leaves the Office list
  fastEach('picker', function (list) { list.forEach(function (a) { if (sent[a.id]) { a.st = 'IN_TRANSIT'; } }); });   // they can no longer be picked for another send
  return { transferId: '', itemCount: items.length };
};

FAST_PATCH.assignMany = function (p) {
  const now = nowIst(), out = { assigned: 0, changed: 0, unchanged: 0, removed: 0 };
  fastEach('team', function (t) {
    const info = {}; (t.assignable || []).forEach(function (a) { info[a.id] = a; });
    const holder = {}; t.workers.forEach(function (w) { w.items.forEach(function (i) { holder[i.assetId] = w; }); });
    (p.remove || []).forEach(function (id) { const w = holder[id]; if (w) { w.items = w.items.filter(function (i) { return i.assetId !== id; }); out.removed++; } if (info[id]) info[id].assignedTo = ''; });
    (p.pairs || []).forEach(function (pr) {
      const w = t.workers.find(function (x) { return x.workerId === pr.workerId; }); if (!w) return;
      const cur = holder[pr.assetId];
      if (cur === w) { out.unchanged++; return; }
      if (cur) { cur.items = cur.items.filter(function (i) { return i.assetId !== pr.assetId; }); out.changed++; } else out.assigned++;
      const a = info[pr.assetId] || {};
      w.items.push({ assetId: pr.assetId, category: a.category || '', subType: a.subType || '', since: now, confirmedAt: now, expiresAt: '', dueConfirm: false });
      if (a.id) a.assignedTo = w.name;
    });
  });
  return out;
};
FAST_PATCH.deassign = function (p) {
  const ids = {}; (p.assetIds || []).forEach(function (id) { ids[id] = true; });
  fastEach('team', function (t) { t.workers.forEach(function (w) { w.items = w.items.filter(function (i) { return !ids[i.assetId]; }); }); (t.assignable || []).forEach(function (a) { if (ids[a.id]) a.assignedTo = ''; }); });
  return {};
};
FAST_PATCH.confirmAssignments = function (p) {
  const ids = {}, all = !(p.assetIds && p.assetIds.length); (p.assetIds || []).forEach(function (id) { ids[id] = true; });
  let n = 0;
  fastEach('team', function (t) { t.workers.forEach(function (w) { w.items.forEach(function (i) { if (all || ids[i.assetId]) { i.dueConfirm = false; i.confirmedAt = nowIst(); n++; } }); }); });
  return { confirmed: n };
};

function fastIssues(ids, status, resolution, p) {
  const set = {}; ids.forEach(function (id) { set[id] = true; });
  fastEach('issues', function (list, key) {
    const openOnly = key.indexOf('"openOnly":true') !== -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i]; if (!set[x.id]) continue;
      x.status = status; if (resolution) x.resolution = resolution;
      if (status === 'RESOLVED' || status === 'REPLACED') {
        const m = x.metrics || (x.metrics = {});
        x.stage = 'DONE'; x.stageLabel = 'Resolved'; x.canSend = false; x.canResolve = false; x.canAskHelp = false;
        m.resolvedLevel = m.level || 1; m.resolvedLevelName = m.levelName || ''; m.resolvedBy = me ? me.name : '';
        if (p && p.actionArea) { x.actionArea = p.actionArea; x.actionDetail = p.actionDetail || ''; }
        if (openOnly) list.splice(i, 1);
      } else if (status === 'UNDER_REVIEW') {
        x.stage = x.stage === 'SITE' ? 'REMOTE' : (x.stage === 'REMOTE' ? 'REMOTE' : 'REVIEW'); x.stageLabel = STAGE_TEXT[x.stage] || x.stage;   // under review at the property is the admin's remote review
        if (x.metrics && x.stage === 'REMOTE') { x.metrics.level = 2; x.metrics.levelName = 'Admin (remote)'; }
        x.canAskHelp = false;
      }
    }
  });
}
FAST_PATCH.updateIssue = function (p) { fastIssues([p.issueId], p.status, p.resolution, p); return {}; };
FAST_PATCH.updateIssues = function (p) { fastIssues(p.issueIds || [], p.status, p.resolution, p); return { updated: (p.issueIds || []).length }; };
FAST_PATCH.askAdminHelp = function (p) {
  const ids = {}; (p.issueIds || []).forEach(function (id) { ids[id] = true; });
  fastEach('issues', function (list) { list.forEach(function (x) { if (ids[x.id]) { x.stage = 'REMOTE'; x.stageLabel = STAGE_TEXT.REMOTE; x.canAskHelp = false; x.helpAskedAt = nowIst(); if (x.metrics) { x.metrics.level = 2; x.metrics.levelName = 'Admin (remote)'; } } }); });
  return { asked: (p.issueIds || []).length };
};
FAST_PATCH.askSendToOffice = function () { return {}; };
FAST_PATCH.reportIssues = function (p) { return { count: (p.assetIds || []).length, issueIds: [], duplicates: [], batchId: '' }; };   // the issue list and the device status follow from the server's answer a moment later

// ---- the Office list ----
function fastOffice(fn) {
  fastEach('officeBatches', function (d) { d.batches.forEach(fn); d.batches = d.batches.filter(function (b) { return b.items.length; }); });
}
FAST_PATCH.officeStep = function (p) {
  const ids = {}; (p.assetIds || []).forEach(function (id) { ids[id] = true; });
  const now = nowIst(), order = ['RECEIVED', 'UPLOADING', 'UPLOADED'];
  fastOffice(function (b) {
    b.items = b.items.filter(function (i) {
      if (!ids[i.id]) return true;
      if (p.step === 'KEEP') return false;                                   // kept in the Office: it leaves this list
      if (p.step === 'START') { i.stage = 'UPLOADING'; i.stageAt = now; }
      else if (p.step === 'DONE') { i.stage = 'UPLOADED'; i.stageAt = now; }
      else if (p.step === 'UNDO') { i.stage = order[Math.max(0, order.indexOf(i.stage) - 1)]; i.stageAt = now; }
      return true;
    });
  });
  return {};
};

// ---- the product-team journey (what the Issues tab and the Tech desk show) ----
const STAGE_TEXT = { REMOTE: 'Remote review (admin)', REVIEW: 'Under review', DONE: 'Resolved', TO_TECH: 'On the way to product team', TECH: 'With product team', BACK_WAY: 'On the way back to the Office', BACK: 'Back from product team' };
function fastStage(match, stage) {                                           // match(row) -> true; moves the issue (and its Tech desk card) to a stage
  const issueIds = {};
  fastEach('techDesk', function (d) {
    for (let i = d.items.length - 1; i >= 0; i--) {
      const x = d.items[i]; if (!match(x)) continue;
      issueIds[x.issueId] = true; x.stage = stage; x.stageLabel = STAGE_TEXT[stage] || stage;
      if (stage === 'BACK' || stage === 'DONE') d.items.splice(i, 1);          // it has left the product team
    }
  });
  fastEach('issues', function (list) { list.forEach(function (x) { if (match(x) || issueIds[x.id]) { x.stage = stage; x.stageLabel = STAGE_TEXT[stage] || stage; } }); });
}
FAST_PATCH.sendToTech = function (p) { fastStage(function (x) { return (x.issueId || x.id) === p.issueId; }, 'TO_TECH'); return {}; };
FAST_PATCH.techConfirm = function (p) { fastStage(function (x) { return x.handoverId && x.handoverId === p.handoverId; }, 'TECH'); return {}; };
FAST_PATCH.techDeposit = function (p) { fastStage(function (x) { return (x.issueId || x.id) === p.issueId; }, 'BACK_WAY'); return {}; };
FAST_PATCH.receiveFromTech = function (p) { fastStage(function (x) { return x.handoverId && x.handoverId === p.handoverId; }, 'BACK'); return {}; };
FAST_PATCH.markBackFromTech = function (p) { fastStage(function (x) { return (x.issueId || x.id) === p.issueId; }, 'BACK'); return {}; };

// ---- Needs attention ----
function fastFlags(ids) {
  const set = {}; ids.forEach(function (id) { set[id] = true; });
  fastEach('flags', function (list) { for (let i = list.length - 1; i >= 0; i--) { if (set[list[i].id]) list.splice(i, 1); } });
}
FAST_PATCH.resolveShort = function (p) { fastFlags([p.flagId]); return {}; };
FAST_PATCH.resolveFlag = function (p) { fastFlags([p.flagId]); return {}; };
FAST_PATCH.bulkFlags = function (p) { fastFlags(p.flagIds || []); return { done: (p.flagIds || []).length, skipped: 0 }; };
function fastFlagsOfAsset(assetId) { fastEach('flags', function (list) { for (let i = list.length - 1; i >= 0; i--) { if (list[i].assetId === assetId && list[i].type === 'PROVISIONAL_ASSET') list.splice(i, 1); } }); }
FAST_PATCH.ackProvisional = function (p) { fastFlagsOfAsset(p.assetId); return {}; };
FAST_PATCH.retireProvisional = function (p) { fastFlagsOfAsset(p.assetId); return {}; };

// ---- Invoices ----
FAST_PATCH.reviewInvoice = function (p) {
  fastEach('invoices', function (d) {
    const x = d.invoices.find(function (i) { return i.id === p.invoiceId; }); if (!x) return;
    if (x.status === 'SUBMITTED' && d.totals) d.totals.toReview = Math.max(0, d.totals.toReview - 1);
    x.status = p.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'; x.reviewedBy = me ? me.name : ''; x.reviewedAt = nowIst(); x.reviewNote = p.note || '';
  });
  return {};
};
FAST_PATCH.cancelInvoiceRequest = function (p) { fastEach('invoices', function (d) { d.requests = d.requests.filter(function (r) { return r.id !== p.requestId; }); }); return {}; };
FAST_PATCH.requestInvoices = function (p) { return { created: (p.refIds || p.supervisorIds || []).length, skipped: [] }; };   // the requests appear in the list a moment later, from the server

// ---- Penalties and the dashboard buttons ----
FAST_PATCH.decidePenalty = function (p) {
  fastEach('penalties', function (d) {
    const x = d.penalties.find(function (i) { return i.id === p.penaltyId; }); if (!x) return;
    if (x.status === 'PROPOSED' && d.totals) d.totals.proposed = Math.max(0, d.totals.proposed - 1);
    if (x.status === 'DISPUTED' && d.totals) d.totals.disputed = Math.max(0, d.totals.disputed - 1);
    x.status = p.decision === 'WAIVE' ? 'WAIVED' : 'CONFIRMED'; x.decidedBy = me ? me.name : ''; x.decidedAt = nowIst(); x.decisionNote = p.note || '';
    if (p.decision !== 'WAIVE' && p.amount !== undefined && String(p.amount) !== '') x.amount = Number(p.amount) || 0;
    if (x.status === 'CONFIRMED' && !x.warning && d.totals) d.totals.amount += x.amount;
  });
  return {};
};
FAST_PATCH.raiseManualPenalty = function () { return { id: '' }; };
FAST_PATCH.disputePenalty = function (p) { fastEach('penalties', function (d) { const x = d.penalties.find(function (i) { return i.id === p.penaltyId; }); if (x) { x.status = 'DISPUTED'; x.disputeNote = p.note || ''; x.disputedAt = nowIst(); } }); return {}; };
FAST_PATCH.createLocationAction = function (p, o) {
  fastEach('home', function (h) {
    if (!h.locationActions) h.locationActions = [];
    h.locationActions.push({ id: 'NEW-' + Date.now().toString(36), at: nowIst(), locationId: p.locationId, locationName: o.locationName || '', type: p.type || 'PROPS_SENT', label: 'Props amount sent for today', short: 'Props', status: 'OPEN', minutesLeft: 60, dueAt: addMin(nowIst(), 60), by: me ? me.name : '', auto: false, refType: 'PROPS' });
  });
  return { minutes: 0 };
};
FAST_PATCH.cancelLocationAction = function (p) { fastEach('home', function (h) { h.locationActions = (h.locationActions || []).filter(function (a) { return a.id !== p.actionId; }); }); return {}; };

// ===================== a copy first, the refresh behind it =====================

/** A list for a form (the asset picker, the supervisors): the copy we have is used at once, and refreshed behind it when it is older than maxAgeMs. */
function cachedStale(action, payload, maxAgeMs) {
  const hit = memo[memoKey(action, payload)];
  if (hit) {
    if (Date.now() - hit.at > maxAgeMs && !obMine().length) callBackend(action, payload).catch(function () { /* the copy will do */ });
    return Promise.resolve(hit.data);
  }
  return callBackend(action, payload);
}

setInterval(function () { if (me && !document.hidden && typeof prefetch === 'function') prefetch(); }, 5 * 60000);    // every few minutes: whatever is older than ten minutes is refreshed behind the screen
