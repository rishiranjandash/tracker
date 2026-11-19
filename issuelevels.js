/**
 * ISSUE LEVELS, TURNAROUND TIME AND THE NESTED DROP-DOWNS (screens). Loaded after repairs.js and uses its globals.
 *
 *   Level 1 Supervisor > 2 Admin (remote) > 3 Office > 4 Tech team. The supervisor has Resolve and "Can't fix, ask the admin"; the admin has Under review (remote), Resolve and the rest.
 *   Resolving always asks what was done (area, then exactly what). Reporting asks what exactly is wrong. Receiving a faulty device asks its state and what was not working.
 *   The issue report (Reports tab) shows how many were solved at each level, how long they took, and the expected production disruption.
 */

// ---------- small helpers ----------
const LEVEL_NAMES = { 1: 'Supervisor', 2: 'Admin (remote)', 3: 'Office', 4: 'Tech team' };
function fmtHours(h) {
  h = Number(h) || 0;
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return (Math.round(h * 10) / 10) + ' h';
  return (Math.round(h / 24 * 10) / 10) + ' days';
}
function optionsHtml(list, placeholder, selected) {
  return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') + list.map(function (v) { return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
}

/** The lines under an issue: its level, how long it has taken, what exactly was wrong and what was done, and the supervisor's buttons. l = a line of an issue card. */
function issueLevelHtml(l) {
  const m = l.metrics; let h = '';
  if (!m) return h;
  const closed = !l.open;
  if (closed) h += '<div class="small" style="margin-top:4px">' + pill(m.resolvedLevel ? 'Resolved at level ' + m.resolvedLevel + ' · ' + (m.resolvedLevelName || LEVEL_NAMES[m.resolvedLevel]) : 'Resolved', 'ok') + ' <b>Total ' + fmtHours(m.tatHours) + '</b>' + (m.resolvedBy ? ' · by ' + esc(m.resolvedBy) : '') + '</div>';
  else h += '<div class="small" style="margin-top:4px">' + pill('Level ' + m.level + ' of 4 · ' + (m.levelName || LEVEL_NAMES[m.level]), m.level >= 3 ? 'warn' : 'info') + ' <b>Open ' + fmtHours(m.tatHours) + '</b></div>';
  const parts = [1, 2, 3, 4].filter(function (n) { return m.levelHours && m.levelHours[n] > 0; }).map(function (n) { return 'L' + n + ' ' + fmtHours(m.levelHours[n]); });
  if (parts.length > 1 || (closed && parts.length)) h += '<div class="small muted">Time at each level: ' + parts.join(' · ') + '</div>';
  if (m.covered) h += '<div class="small muted">Covered after ' + fmtHours(m.coverHours) + (m.coverBy === 'REPLACEMENT' ? ' by a replacement' + (l.replacement ? ' (' + esc(l.replacement) + ')' : '') : ' when it was fixed') + '</div>';
  if (m.disruptionHours > 0 || (m.covered && m.shortHours > 0)) h += '<div class="small muted">' + (m.covered ? 'Production disruption' : 'Expected production disruption so far') + ': <b>' + fmtHours(m.disruptionHours) + '</b> (property short of devices for ' + fmtHours(m.shortHours) + ')</div>';
  if (l.detail) h += '<div class="small muted">What is wrong: ' + esc(l.type) + ' › ' + esc(l.detail) + '</div>';
  if (l.officeState || l.officeFound) h += '<div class="small muted">At the Office: ' + esc([l.officeState, l.officeFound && 'not working: ' + l.officeFound].filter(Boolean).join(' · ')) + '</div>';
  if (l.techState || l.techFound) h += '<div class="small muted">At the product team: ' + esc([l.techState, l.techFound && 'not working: ' + l.techFound].filter(Boolean).join(' · ')) + '</div>';
  if (l.actionArea) h += '<div class="small muted">What was done: ' + esc(l.actionArea) + (l.actionDetail ? ' › ' + esc(l.actionDetail) : '') + '</div>';
  if (l.open && me.role === 'SUPERVISOR') {
    const ids = esc((l.ids || [l.issueId]).join(','));
    h += '<div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">' +
      (l.canResolve ? '<button class="btn small" data-resolve="' + ids + '" data-rcat="' + esc(l.category || '') + '" data-rasset="' + esc(l.assetId || '') + '">Resolve</button>' : '') +
      (l.canAskHelp ? '<button class="btn secondary small" data-help="' + ids + '" data-rasset="' + esc(l.assetId || '') + '">Can\'t fix: ask the admin</button>' : '') + '</div>';
  }
  return h;
}

// ---------- nested drop-downs ----------
/** "What was done": the area, then exactly what (when the area has choices). Returns the HTML; wireAction connects it; readAction reads it. */
function actionFieldsHtml(cat) {
  const tree = (OPTS.actions || {})[cat] || [];
  if (!tree.length) return '';
  return '<label class="f">What was done to fix it</label><select class="actArea"><option value="">Choose…</option>' + tree.map(function (t) { return '<option>' + esc(t.value) + '</option>'; }).join('') + '</select><div class="actDetailHost"></div>';
}
function wireAction(box, cat) {
  const tree = (OPTS.actions || {})[cat] || [], area = box.querySelector('.actArea'); if (!area) return;
  area.addEventListener('change', function () {
    const t = tree.find(function (x) { return x.value === area.value; }), host = box.querySelector('.actDetailHost');
    host.innerHTML = t && t.children.length ? '<label class="f">Exactly what was done</label><select class="actDetail"><option value="">Choose…</option>' + optionsHtml(t.children) + '</select>' : '';
  });
}
/** -> { ok, area, detail, msg } */
function readAction(box, cat) {
  const tree = (OPTS.actions || {})[cat] || [];
  if (!tree.length) return { ok: true, area: '', detail: '' };
  const area = box.querySelector('.actArea').value, dsel = box.querySelector('.actDetail'), detail = dsel ? dsel.value : '';
  if (!area) return { ok: false, msg: 'Pick what was done from the list.' };
  if (dsel && !detail) return { ok: false, msg: 'Pick exactly what was done.' };
  return { ok: true, area: area, detail: detail };
}

/** Resolve one or several issues: what was done (nested lists) and an optional note. o: { issueIds, asset, cat, title } */
function askResolve(o) {
  openModal('<div class="row spread"><h2>' + esc(o.title || 'Resolve: ' + o.asset) + '</h2><button class="linkBtn" data-close>Close</button></div>' +
    '<p class="small muted">Say what was done. The time it took and the level that solved it are recorded.</p>' + actionFieldsHtml(o.cat) +
    '<label class="f">Note <span class="muted">(optional)</span></label><textarea id="resNote" maxlength="300" placeholder="Anything else worth knowing"></textarea>' +
    '<div class="small" id="resMsg" style="color:var(--bad);margin-top:6px"></div><div class="row" style="margin-top:12px"><button class="btn" id="resOk">Resolve</button></div>', function (box) {
    wireAction(box, o.cat);
    box.querySelector('#resOk').addEventListener('click', function (e) {
      const a = readAction(box, o.cat), msg = box.querySelector('#resMsg');
      if (!a.ok) { msg.textContent = a.msg; return; }
      busy(e.target, function () {
        return fastCall('updateIssues', { issueIds: o.issueIds, status: 'RESOLVED', resolution: box.querySelector('#resNote').value.trim(), actionArea: a.area, actionDetail: a.detail }, { label: 'Resolving ' + (o.asset || '') })
          .then(function () { closeModal(); toast((o.asset || 'The issue') + ' resolved'); go(tab, true); }).catch(function (err) { msg.textContent = (err && err.message) || 'Could not save.'; });
      });
    });
  });
}

/** "State of the device when received" and "what was not working": used when a faulty device is received (Office, product team). */
function conditionBlock(cat, defType) {
  const states = (OPTS.states || {})[cat] || [], types = (OPTS.issueTypes || {})[cat] || [];
  if (!states.length && !types.length) return '';
  return '<div class="condBox" data-cat="' + esc(cat) + '">' +
    (states.length ? '<label class="f">State of the device when received</label><select class="cState"><option value="">Choose…</option>' + optionsHtml(states) + '</select>' : '') +
    (types.length ? '<label class="f">What was not working</label><select class="cType"><option value="">Choose…</option>' + optionsHtml(types.map(function (t) { return t.value; }), '', defType) + '</select><div class="cDetailHost"></div>' : '') + '</div>';
}
function wireCondition(root) {
  root.querySelectorAll('.condBox').forEach(function (box) {
    const cat = box.dataset.cat, type = box.querySelector('.cType'); if (!type) return;
    const fill = function () {
      const list = ((OPTS.issueDetails || {})[cat] || {})[type.value] || [], host = box.querySelector('.cDetailHost');
      host.innerHTML = list.length ? '<label class="f">Exactly what</label><select class="cDetail"><option value="">Choose…</option>' + optionsHtml(list) + '</select>' : '';
    };
    type.addEventListener('change', fill); fill();
  });
}
/** -> { ok, state, type, detail, msg } */
function readCondition(box) {
  const s = box.querySelector('.cState'), t = box.querySelector('.cType'), d = box.querySelector('.cDetail');
  if (s && !s.value) return { ok: false, msg: 'Say what state the device is in.' };
  if (t && !t.value) return { ok: false, msg: 'Say what was not working.' };
  if (d && !d.value) return { ok: false, msg: 'Say exactly what was not working.' };
  return { ok: true, state: s ? s.value : '', type: t ? t.value : '', detail: d ? d.value : '' };
}

// ---------- the supervisor's buttons on an issue ----------
document.addEventListener('click', function (e) {
  const r = e.target.closest('[data-resolve]'), h = e.target.closest('[data-help]');
  if (r) { e.stopPropagation(); e.preventDefault(); return askResolve({ issueIds: r.dataset.resolve.split(','), asset: r.dataset.rasset, cat: r.dataset.rcat || 'DEVICE' }); }
  if (h) {
    e.stopPropagation(); e.preventDefault();
    const ids = h.dataset.help.split(','), asset = h.dataset.rasset;
    askNote({ title: 'Can\'t fix ' + asset + '?', intro: 'The admins are told and try to solve it remotely. The device stays with you meanwhile.', noteLabel: 'What did you try?', ph: 'e.g. Restarted it, still will not charge', ok: 'Ask the admin',
      run: function (v) { return fastCall('askAdminHelp', { issueIds: ids, note: v.note }, { label: 'Your request for help' }).then(function () { toast('The admin is asked to help with ' + asset); go(tab, true); }); } });
  }
}, true);

// ---------- dispatching a replacement ----------
let replIssues = [];
function paintReplacement(sup) {
  const host = $('replHost'); if (!host) return;
  const toSup = sup && $('toSup') && !/^OFFICE/.test($('toSup').value) && $('toSup').value;
  if (!toSup) { host.innerHTML = ''; return; }
  cachedStale('issues', { openOnly: true }, 60000).then(function (list) {
    replIssues = (list || []).filter(function (i) { return i.status !== 'RESOLVED' && i.status !== 'REPLACED' && i.metrics && !i.metrics.covered; });
    const here = replIssues.filter(function (i) { return sup.location && String(sup.location).indexOf(i.location) !== -1; }), rest = replIssues.filter(function (i) { return here.indexOf(i) === -1; });
    const row = function (i) { return '<label class="item" style="cursor:pointer"><input type="checkbox" data-repl="' + esc(i.id) + '" style="width:20px;height:20px"><div class="grow"><b>' + esc(i.assetId) + '</b> <span class="muted">' + esc(i.type) + ' · ' + esc(i.location) + ' · open ' + fmtHours(i.metrics.tatHours) + '</span></div></label>'; };
    host.innerHTML = replIssues.length ? '<details class="card" style="margin:8px 0 0"><summary><b>Is this a replacement?</b> <span class="small muted">Tick the faulty device(s) it covers for</span></summary><div class="small muted" style="margin:6px 0">When ' + esc(sup.name || 'the supervisor') + ' confirms receipt, the shortage counts as covered.</div>' +
      here.map(row).join('') + (here.length && rest.length ? '<div class="small muted" style="margin-top:6px">Other properties</div>' : '') + rest.map(row).join('') + '</details>' : '';
  }).catch(function () { host.innerHTML = ''; });
}
function readReplacement() { return Array.from(document.querySelectorAll('[data-repl]:checked')).map(function (c) { return c.dataset.repl; }); }

// ---------- the issue report (Reports tab) ----------
let irFrom = '', irTo = '', irStatus = '';
const IR_COLUMNS = ['Issue', 'Asset', 'Property', 'Reported', 'Type', 'Exactly', 'Reported by', 'Status', 'Resolved at level', 'Resolved by', 'Resolved at', 'Done (area)', 'Done (exactly)', 'Total TAT (h)', 'Level 1 (h)', 'Level 2 (h)', 'Level 3 (h)', 'Level 4 (h)', 'Covered by', 'Cover time (h)', 'Short of devices (h)', 'Disruption (h)', 'Replacement', 'State at Office', 'Not working at Office', 'State at product team', 'Not working at product team'];
function issueReportRows(rows) {
  return rows.map(function (r) { return [r.id, r.assetId, r.location, r.at, r.type, r.detail, r.reportedBy, r.status, r.resolvedLevelName || '', r.resolvedBy, r.resolvedAt, r.actionArea, r.actionDetail, r.tatHours, r.l1, r.l2, r.l3, r.l4, r.coverBy, r.coverHours, r.shortHours, r.disruptionHours, r.replacement, r.officeState, r.officeFound, r.techState, r.techFound]; });
}
function loadIssueReport() {
  const host = $('issueRep'); if (!host) return;
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10), back = new Date(Date.now() + 19800000 - 29 * 86400000).toISOString().slice(0, 10);
  if (!irFrom) irFrom = back; if (!irTo) irTo = today;
  host.innerHTML = '<div class="card"><h2>Issues: levels, time taken and disruption</h2><div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">' +
    '<label class="grow small muted" style="min-width:130px">From<input type="date" id="irFrom" value="' + esc(irFrom) + '"></label><label class="grow small muted" style="min-width:130px">To<input type="date" id="irTo" value="' + esc(irTo) + '"></label>' +
    '<label class="grow small muted" style="min-width:120px">Show<select id="irStatus"><option value="">All</option><option value="CLOSED"' + (irStatus === 'CLOSED' ? ' selected' : '') + '>Resolved</option><option value="OPEN"' + (irStatus === 'OPEN' ? ' selected' : '') + '>Still open</option></select></label></div>' +
    '<div id="irBody" class="small muted" style="margin-top:10px">Loading…</div></div>';
  const go2 = function () { irFrom = $('irFrom').value; irTo = $('irTo').value; irStatus = $('irStatus').value; loadIssueReport(); };
  ['irFrom', 'irTo', 'irStatus'].forEach(function (id) { $(id).addEventListener('change', go2); });
  callBackend('issueReport', { from: irFrom, to: irTo, status: irStatus }).then(function (r) {
    const tile = function (n, l) { return '<div class="tile"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    let html = '<div class="tiles">' + tile(r.total, 'Issues') + tile(r.open, 'Still open') + tile(fmtHours(r.avgTatHours), 'Average total time') + tile(fmtHours(r.avgCoverHours), 'Average time to cover') + tile(fmtHours(r.disruptionHours), 'Expected disruption') + '</div>';
    html += '<h3>Solved at each level</h3>' + r.byLevel.map(function (b) {
      return '<div class="item"><div class="grow"><b>Level ' + b.level + ' · ' + esc(b.name) + '</b><div class="small muted">average total time ' + fmtHours(b.avgTatHours) + '</div></div><div><b>' + b.resolved + '</b> <span class="small muted">(' + b.share + '%)</span></div></div>';
    }).join('') + (r.unrecordedLevel ? '<div class="small muted">' + r.unrecordedLevel + ' older resolved issue(s) have no level recorded.</div>' : '');
    if (r.faults.length) html += '<h3>Most common faults</h3>' + r.faults.slice(0, 8).map(function (f) { return '<div class="item"><div class="grow">' + esc(f.fault) + '</div><div><b>' + f.count + '</b>' + (f.disruptionHours ? ' <span class="small muted">' + fmtHours(f.disruptionHours) + ' disruption</span>' : '') + '</div></div>'; }).join('');
    html += '<div class="row" style="margin-top:10px"><button class="btn secondary" id="irCsv"' + (r.rows.length ? '' : ' disabled') + '>Download CSV (' + r.rows.length + (r.more ? '+' : '') + ')</button></div>';
    $('irBody').innerHTML = html; $('irBody').classList.remove('muted');
    const b = $('irCsv'); if (b) b.addEventListener('click', function () { downloadCsv('issue-levels', { columns: IR_COLUMNS, rows: issueReportRows(r.rows) }); });
  }).catch(function (e) { $('irBody').textContent = (e && e.message) || 'Could not load the report.'; });
}
(function () {
  const base = VIEWS.reports;
  VIEWS.reports = function () { base(); if (me && (me.role === 'ADMIN' || me.role === 'OPS')) { const h = document.createElement('div'); h.id = 'issueRep'; $('view').insertBefore(h, $('view').firstChild); loadIssueReport(); } };
})();
