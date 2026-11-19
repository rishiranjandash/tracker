/**
 * PENALTIES (the Penalties tab) and the dashboard buttons that ask supervisors to do something by a time. Loaded after app.js and uses its globals.
 *
 *   Admin:       Dashboard "Props amount sent today" button per property > supervisors are asked > no invoice in time = a proposed penalty
 *                Penalties tab: confirm (maybe with another amount) or waive; raise one by hand; decide a dispute.
 *   Supervisor:  Home banner with the countdown; Penalties tab with their own list; Dispute a confirmed penalty.
 */

const PEN_STATUS = { PROPOSED: ['To review', 'warn'], CONFIRMED: ['Confirmed', 'bad'], WAIVED: ['Waived', 'ok'], DISPUTED: ['Disputed', 'info'] };
const PEN_LEVEL = { AUTO: 'Automatic', SEMI: 'Admin confirms', MANUAL: 'Raised by an admin' };
let penMonth = '', penFilter = '', penSup = '';

function penMoney(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }

/** The Penalties tab is only shown while penalties are switched on (the server tells us in the home answer). */
function syncPenaltyTab() {
  const off = me && me.penaltiesOn === false;
  document.querySelectorAll('#tabs [data-tab="penalties"]').forEach(function (b) { b.style.display = off ? 'none' : ''; });
}

// ---------- supervisor Home: the countdown, and what is already confirmed this month ----------
function penaltyHomeBanners(h) {
  let html = '';
  (h.locationActions || []).forEach(function (a) {
    const late = a.minutesLeft <= 0;
    const checkin = a.refType === 'CHECKIN';
    html += '<div class="banner ' + (late ? 'bad' : 'warn') + '"><div class="grow"><b>' + esc(a.label) + '</b><div class="small">' + (a.auto ? 'Your phone shows you are at ' + esc(a.locationName) + '. ' : esc(a.by) + ' asked for it at ' + esc(a.locationName) + '. ') +
      (late ? 'The time is up: send it now, it will be noted as late.' : 'Send the invoice within <b>' + a.minutesLeft + ' min</b> (by ' + esc(fmt(a.dueAt)) + ').') + '</div></div>' +
      '<div class="row" style="margin:-4px 0 10px"><button class="btn" data-go="invoiceNew" data-penprops="1" data-penref="' + esc(a.refType || 'PROPS') + '">' + (checkin ? 'Send the check-in invoice' : 'Send the props invoice') + '</button></div>';
  });
  if (h.penaltiesOn && h.penaltyCount) html += '<div class="banner info"><div class="grow"><b>' + h.penaltyCount + (h.penaltyCount > 1 ? ' penalties' : ' penalty') + ' this month</b><div class="small">See what each one is for, and tell us if you disagree.</div></div><button class="btn secondary" data-go="penalties">Open Penalties</button></div>';
  return html;
}

// ---------- admin Dashboard: the button on each property ----------
function locActionOf(h, locationId) {
  const l = (h.locationActions || []).filter(function (a) { return a.locationId === locationId && a.type === 'PROPS_SENT'; });
  return l.length ? l.sort(function (x, y) { return x.at < y.at ? 1 : -1; })[0] : null;
}
function locActionCell(p, h) {
  const a = locActionOf(h, p.locationId), admin = me.role === 'ADMIN';
  if (a && a.status === 'OPEN') {
    return '<div class="small"><b>' + esc(a.short) + ': waiting</b> · ' + (a.minutesLeft > 0 ? a.minutesLeft + ' min left' : 'time is up') + '</div>' + (admin ? '<button class="linkBtn" data-locact-cancel="' + esc(a.id) + '">Cancel</button>' : '');
  }
  const note = a ? (a.status === 'DONE' ? pill('Invoice received', 'ok') : a.status === 'MISSED' ? pill('Missed', 'bad') : '') : '';
  return note + (admin ? '<div><button class="btn secondary small" data-locact="' + esc(p.locationId) + '" data-locname="' + esc(p.name || p.locationId) + '" data-locsups="' + esc((p.supervisors || []).join(' and ')) + '"' + (p.supervisors && p.supervisors.length ? '' : ' disabled title="No supervisor is here today"') + '>Props amount sent today</button></div>' : '');
}

document.addEventListener('click', function (e) {
  const b = e.target.closest('[data-locact],[data-locact-cancel]');
  if (!b) return;
  e.stopPropagation(); e.preventDefault();       // the row itself opens the property: this button must not
  if (b.dataset.locactCancel) {
    return busy(b, function () { return fastCall('cancelLocationAction', { actionId: b.dataset.locactCancel }, { label: 'Cancelling' }).then(function () { toast('Cancelled'); go('dash', true); }); });
  }
  if (!confirm('Ask ' + (b.dataset.locsups || 'the supervisor') + ' at ' + b.dataset.locname + ' to send today\'s props invoice within the hour?\nIf no invoice arrives in time, a penalty is proposed for you to confirm.')) return;
  busy(b, function () { return fastCall('createLocationAction', { locationId: b.dataset.locact, type: 'PROPS_SENT' }, { locationName: b.dataset.locname, label: 'The props request' }).then(function (r) { toast(r.minutes ? 'Asked. They have ' + r.minutes + ' minutes.' : 'Asked. The countdown starts now.'); go('dash', true); }); });
}, true);

document.addEventListener('click', function (e) {
  const b = e.target.closest('[data-penprops]');
  if (b) { e.stopPropagation(); e.preventDefault(); go('invoiceNew', false, { refType: b.dataset.penref || 'PROPS' }); }
}, true);

// ---------- Transfers: the admin says "Item reached" (a dialog first: it starts the supervisor's clock) ----------
document.addEventListener('click', function (e) {
  const b = e.target.closest('[data-reached]');
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const id = b.dataset.reached, who = b.dataset.reachto || 'the supervisor', mins = Number(b.dataset.reachmin) || 0;
  openModal('<div class="row spread"><h2>Has it really reached?</h2><button class="linkBtn" data-close>Close</button></div>' +
    '<div class="banner warn"><div class="grow"><b>Only press Yes if ' + esc(who) + ' has actually received the package you sent.</b><div class="small">' +
    (mins ? esc(who) + ' will be asked to confirm receipt in the app within <b>' + mins + ' minutes</b>. If they do not, a penalty is proposed against them. Do not press it just to hurry someone.' : esc(who) + ' will be asked to confirm receipt now.') + '</div></div></div>' +
    '<div class="small" id="reachMsg" style="color:var(--bad);margin-top:6px"></div>' +
    '<div class="row" style="margin-top:12px;gap:8px"><button class="btn" id="reachYes">Yes, it has reached them</button><button class="btn secondary" data-close>Not yet</button></div>', function (box) {
    box.querySelector('#reachYes').addEventListener('click', function (ev) {
      busy(ev.target, function () {
        return fastCall('markReached', { transferId: id }, { minutes: mins, label: 'Item reached' }).then(function () { closeModal(); toast('Marked as reached. ' + who + ' is asked to confirm.'); go('transfers', true); })
          .catch(function (err) { box.querySelector('#reachMsg').textContent = (err && err.message) || 'Could not save.'; });
      });
    });
  });
}, true);

// ---------- the Penalties tab ----------
function penaltyCard(p, canAct, mine) {
  const st = PEN_STATUS[p.status] || [p.status, ''];
  const waiting = p.status === 'PROPOSED' || p.status === 'DISPUTED';
  return '<div class="card' + (p.status === 'PROPOSED' || p.status === 'DISPUTED' ? ' faultyCard' : '') + '"><div class="row spread" style="align-items:flex-start"><div class="grow"><div class="t" style="font-size:16px">' + esc(p.label) + '</div>' +
    '<div class="small muted">' + (mine ? '' : '<b>' + esc(p.supervisor) + '</b> · ') + esc(fmt(p.at)) + ' · ' + esc(PEN_LEVEL[p.level] || p.level) + '</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">' + pill(st[0], st[1]) + (p.warning ? pill('Warning only', 'info') : pill(penMoney(p.amount), p.status === 'WAIVED' ? '' : 'bad')) + '</div></div>' +
    (p.reason ? '<div class="small" style="margin-top:6px">' + esc(p.reason) + '</div>' : '') +
    (p.disputeNote ? '<div class="banner info" style="margin-top:8px"><div class="grow small"><b>' + (mine ? 'You disagree' : esc(p.supervisor) + ' disagrees') + ':</b> ' + esc(p.disputeNote) + '</div></div>' : '') +
    (p.decidedBy && p.status !== 'PROPOSED' ? '<div class="small muted" style="margin-top:6px">' + (p.status === 'WAIVED' ? 'Waived' : 'Decided') + ' by ' + esc(p.decidedBy) + ' · ' + esc(fmt(p.decidedAt)) + (p.decisionNote ? ' · ' + esc(p.decisionNote) : '') + '</div>' : '') +
    (canAct && waiting ? '<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap"><button class="btn small" data-pen="confirm" data-pid="' + esc(p.id) + '" data-pamt="' + p.amount + '">Confirm</button><button class="btn secondary small" data-pen="amount" data-pid="' + esc(p.id) + '" data-pamt="' + p.amount + '">Change the amount</button><button class="btn secondary small" data-pen="waive" data-pid="' + esc(p.id) + '">Waive</button></div>' : '') +
    (mine && p.status === 'CONFIRMED' && !p.warning ? '<div class="row" style="margin-top:8px"><button class="btn secondary small" data-pen="dispute" data-pid="' + esc(p.id) + '">I disagree</button></div>' : '') + '</div>';
}

VIEWS.penalties = function () {
  const admin = me.role === 'ADMIN' || me.role === 'OPS', mine = me.role === 'SUPERVISOR';
  return swr('penalties', { month: penMonth, status: penFilter, supervisorId: penSup }, function (d) {
    penMonth = d.month;
    const tile = function (n, l, cls, f) { return '<div class="tile ' + (cls || '') + '" ' + (f !== undefined ? 'data-penfilter="' + f + '"' : 'style="cursor:default"') + '><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    const filters = [['', 'This month'], ['PROPOSED', 'To review'], ['DISPUTED', 'Disputed'], ['CONFIRMED', 'Confirmed'], ['WAIVED', 'Waived']];
    let html = '<div class="stickyHead flat"><div class="row spread"><h2 style="margin:0">' + (mine ? 'My penalties' : 'Penalties') + '</h2>' + (me.role === 'ADMIN' && d.enabled ? '<button class="btn" id="penRaise">Raise a penalty</button>' : '') + '</div></div>';
    if (!d.enabled) html += '<div class="banner warn"><div class="grow"><b>Penalties are switched off</b><div class="small">' + (mine ? 'Nothing is being raised.' : 'The manager switches them on in Manage > Settings (PENALTIES_ENABLED = Y). Nothing is raised until then.') + '</div></div></div>';
    html += '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"><label class="small muted">Month <select id="penMonth">' + d.months.map(function (m) { return '<option' + (m === d.month ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></label></div>';
    html += '<div class="tiles">' +
      (mine ? tile(penMoney(d.totals.amount), 'To pay this month', d.totals.amount ? 'bad' : '') + tile(d.totals.warnings, 'Warnings', '') + tile(d.totals.disputed, 'You disagreed with', '')
        : tile(d.totals.proposed, 'To review', d.totals.proposed ? 'warn' : '', 'PROPOSED') + tile(d.totals.disputed, 'Disputed', d.totals.disputed ? 'warn' : '', 'DISPUTED') + tile(penMoney(d.totals.amount), 'Confirmed this month', d.totals.amount ? 'bad' : '', 'CONFIRMED') + tile(d.totals.warnings, 'Warnings', '', '')) + '</div>';
    if (!mine) {
      html += '<div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0">' + filters.map(function (f) { return '<button class="chip' + (penFilter === f[0] ? ' on' : '') + '" data-penfilter="' + f[0] + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>';
      html += '<h3>By supervisor, ' + esc(d.month) + '</h3>' + (d.supervisors.length ? '<div class="card"><div class="tablewrap"><table><thead><tr><th>Supervisor</th><th class="num">Confirmed</th><th class="num">Warnings</th><th class="num">To review</th><th class="num">Amount</th></tr></thead><tbody>' +
        d.supervisors.map(function (s) { return '<tr class="clickrow" data-pensup="' + esc(penSup === s.id ? '' : s.id) + '"><td><b>' + esc(s.name) + '</b>' + (penSup === s.id ? ' <span class="small" style="color:var(--brand)">(showing only this one, tap to clear)</span>' : '') + '</td><td class="num">' + s.confirmed + '</td><td class="num">' + s.warnings + '</td><td class="num">' + (s.proposed + s.disputed) + '</td><td class="num"><b>' + penMoney(s.amount) + '</b></td></tr>'; }).join('') +
        '</tbody></table></div></div>' : '<div class="card"><div class="small muted">No penalties this month.</div></div>');
    }
    html += '<h3>' + (penFilter ? esc((PEN_STATUS[penFilter] || [penFilter])[0]) : 'This month and anything waiting') + ' (' + d.penalties.length + ')</h3>' +
      (d.penalties.length ? d.penalties.map(function (p) { return penaltyCard(p, d.canAct, mine); }).join('') : '<div class="card"><div class="small muted">' + (mine ? 'You have no penalties. Keep it up.' : 'Nothing here.') + '</div></div>');
    if (!mine) {
      html += '<details class="helpSec"><summary>How penalties are raised</summary><div class="helpBody"><div class="tablewrap"><table><thead><tr><th>Rule</th><th>How</th><th class="num">Amount</th><th>First time</th></tr></thead><tbody>' +
        d.rules.map(function (r) { return '<tr><td>' + esc(r.label) + (r.active ? '' : ' <span class="small muted">(off)</span>') + '</td><td>' + esc(PEN_LEVEL[r.level] || r.level) + '</td><td class="num">' + penMoney(r.amount) + '</td><td>' + (r.firstWarning ? 'Warning only' : 'Counts') + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="small muted">Automatic: counts at once. Admin confirms: nothing counts until you confirm or waive it. The manager changes amounts and levels in Manage > Penalty rules.</p></div></details>';
    }
    $('view').innerHTML = html;
    const m = $('penMonth'); if (m) m.addEventListener('change', function () { penMonth = m.value; go('penalties'); });
    const r = $('penRaise'); if (r) r.addEventListener('click', penRaiseModal);
  });
};

document.addEventListener('click', function (e) {
  const f = e.target.closest('[data-penfilter]');
  if (f && tab === 'penalties') { e.stopPropagation(); penFilter = f.dataset.penfilter; return go('penalties'); }
  const s = e.target.closest('[data-pensup]');
  if (s && tab === 'penalties') { e.stopPropagation(); penSup = s.dataset.pensup; return go('penalties'); }
  const b = e.target.closest('[data-pen]');
  if (!b) return;
  e.stopPropagation();
  const id = b.dataset.pid, amt = b.dataset.pamt, kind = b.dataset.pen;
  const done = function (msg) { return function () { toast(msg); go('penalties', true); }; };
  if (kind === 'confirm') return busy(b, function () { return fastCall('decidePenalty', { penaltyId: id, decision: 'CONFIRM' }, { label: 'Confirming the penalty' }).then(done('Confirmed. The supervisor is told.')); });
  if (kind === 'waive') return askNote({ title: 'Waive this penalty', intro: 'It will not count. The supervisor is told, with your reason.', noteLabel: 'Why is it waived?', ph: 'e.g. The courier was late, not the supervisor', need: true, ok: 'Waive',
    run: function (v) { return fastCall('decidePenalty', { penaltyId: id, decision: 'WAIVE', note: v.note }, { label: 'Waiving the penalty' }).then(done('Waived')); } });
  if (kind === 'amount') return penAmountModal(id, amt, done);
  if (kind === 'dispute') return askNote({ title: 'I disagree', intro: 'An admin reads this and decides. Say what happened.', noteLabel: 'Why do you disagree?', ph: 'e.g. The invoice was sent, the picture did not upload', need: true, ok: 'Send',
    run: function (v) { return fastCall('disputePenalty', { penaltyId: id, note: v.note }, { label: 'Your objection' }).then(done('Sent. An admin will look at it.')); } });
}, true);

function penAmountModal(id, amt, done) {
  openModal('<div class="row spread"><h2>Confirm with another amount</h2><button class="linkBtn" data-close>Close</button></div><p class="small muted">The supervisor sees this amount and your note.</p>' +
    '<label class="f">Amount (₹)</label><input type="number" id="penAmt" min="0" value="' + esc(amt) + '"><label class="f">Why is it different?</label><textarea id="penNote" maxlength="300"></textarea>' +
    '<div class="small" id="penMsg" style="color:var(--bad);margin-top:6px"></div><div class="row" style="margin-top:12px"><button class="btn" id="penOk">Confirm</button></div>', function (box) {
    box.querySelector('#penOk').addEventListener('click', function (e) {
      busy(e.target, function () {
        return fastCall('decidePenalty', { penaltyId: id, decision: 'CONFIRM', amount: box.querySelector('#penAmt').value, note: box.querySelector('#penNote').value.trim() }, { label: 'Confirming the penalty' })
          .then(function () { closeModal(); done('Confirmed with the new amount')(); }).catch(function (err) { box.querySelector('#penMsg').textContent = (err && err.message) || 'Could not save.'; });
      });
    });
  });
}

function penRaiseModal() {
  callBackend('supervisorList', {}).then(function (sups) {
    openModal('<div class="row spread"><h2>Raise a penalty</h2><button class="linkBtn" data-close>Close</button></div><p class="small muted">It counts at once and the supervisor is told.</p>' +
      '<label class="f">Supervisor</label><select id="penWho">' + sups.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + (s.location && s.location !== '-' ? ' · ' + esc(s.location) : '') + '</option>'; }).join('') + '</select>' +
      '<label class="f">Amount (₹)</label><input type="number" id="penAmt" min="1"><label class="f">What is it for?</label><textarea id="penNote" maxlength="300"></textarea>' +
      '<div class="small" id="penMsg" style="color:var(--bad);margin-top:6px"></div><div class="row" style="margin-top:12px"><button class="btn" id="penOk">Raise the penalty</button></div>', function (box) {
      box.querySelector('#penOk').addEventListener('click', function (e) {
        busy(e.target, function () {
          return fastCall('raiseManualPenalty', { supervisorId: box.querySelector('#penWho').value, amount: box.querySelector('#penAmt').value, reason: box.querySelector('#penNote').value.trim() }, { label: 'The penalty' })
            .then(function () { closeModal(); toast('Raised'); go('penalties', true); }).catch(function (err) { box.querySelector('#penMsg').textContent = (err && err.message) || 'Could not save.'; });
        });
      });
    });
  }).catch(toastError);
}
