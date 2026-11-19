/**
 * THE REPAIR JOURNEY (Issues tab, Transfers tab and the Tech desk). Loaded after app.js and uses its globals.
 *
 *   At site > On the way to office > At office > (Under review) > On the way to product team > With product team > Coming back > Back from product team > Resolved
 *
 * Every step that needs a note opens a small window (askNote); every button is built by flowButtons so the Issues tab, the received-transfer card and the
 * Tech desk offer exactly the same next steps.
 */

const STAGE_CLASS = { SITE: '', REMOTE: 'info', TO_OFFICE: 'info', OFFICE: 'info', REVIEW: 'info', TO_TECH: 'info', TECH: 'info', BACK_WAY: 'info', BACK: 'warn', DONE: 'ok' };
function stagePill(stage, label) { return pill(label || stage, STAGE_CLASS[stage] || ''); }

/** "Day 2 here", or "Stuck 4 days" once it has waited long enough (a device that was reported but not sent goes amber after a day). */
function agingPill(x) {
  if (!x || x.stage === 'DONE' || typeof x.days !== 'number') return '';
  const lim = x.stage === 'SITE' ? 1 : 3, red = x.stage === 'SITE' ? 3 : 5;
  if (x.days < lim) return pill(x.days === 0 ? 'Since today' : 'Day ' + x.days + ' here', '');
  return pill((x.stage === 'SITE' ? 'Not sent for ' : 'Stuck ') + x.days + ' days', x.days >= red ? 'bad' : 'warn');
}

/** A small window with a note (and, where needed, a choice or a tracking number). o.run({ note, ref, outcome }) returns the save; the window closes when it works. */
function askNote(o) {
  openModal('<div class="row spread"><h2>' + esc(o.title) + '</h2><button class="linkBtn" data-close>Close</button></div>' + (o.intro ? '<p class="small muted">' + esc(o.intro) + '</p>' : '') +
    (o.select ? '<label class="f">' + esc(o.select.label) + '</label><select id="askSel">' + o.select.opts.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select>' : '') +
    '<label class="f">' + esc(o.noteLabel || 'Note') + (o.need ? '' : ' <span class="muted">(optional)</span>') + '</label><textarea id="askNote" maxlength="300" placeholder="' + esc(o.ph || '') + '"></textarea>' +
    (o.ref ? '<label class="f">Courier and tracking number <span class="muted">(optional)</span></label><input type="text" id="askRef" maxlength="60">' : '') + (o.cond && typeof conditionBlock === 'function' ? conditionBlock(o.cond, o.condType) : '') +
    '<div class="small" id="askMsg" style="color:var(--bad);margin-top:6px"></div><div class="row" style="margin-top:12px"><button class="btn" id="askOk">' + esc(o.ok) + '</button></div>', function (box) {
    box.querySelector('#askOk').addEventListener('click', function (e) {
      const note = box.querySelector('#askNote').value.trim(), msg = box.querySelector('#askMsg');
      if (o.need && !note) { msg.textContent = 'Please write a short note.'; return; }
      let cond = null;
      if (o.cond && box.querySelector('.condBox')) { cond = readCondition(box.querySelector('.condBox')); if (!cond.ok) { msg.textContent = cond.msg; return; } }
      busy(e.target, function () {
        return o.run({ note: note, ref: o.ref ? box.querySelector('#askRef').value.trim() : '', outcome: o.select ? box.querySelector('#askSel').value : '', cond: cond || {} })
          .then(function () { closeModal(); }).catch(function (err) { msg.textContent = (err && err.message) || 'Could not save.'; });
      });
    });
    if (o.cond && typeof wireCondition === 'function') wireCondition(box);
    setTimeout(function () { const n = box.querySelector('#askNote'); if (n) n.focus(); }, 50);
  });
}

/**
 * The next steps for one faulty device, for whoever is looking (x = { issueId, assetId, stage, handoverId }).
 * Admin: decide at the office, hand over to the product team, or mark it back themselves. Tech team: confirm receipt, deposit it back.
 */
function flowButtons(x) {
  const A = me.role === 'ADMIN', T = me.role === 'TECH', b = [];
  const btn = function (f, label, primary) {
    return '<button class="btn' + (primary ? '' : ' secondary') + ' small" data-flow="' + f + '" data-fissue="' + esc(x.issueId) + '" data-fhandover="' + esc(x.handoverId || '') + '" data-fasset="' + esc(x.assetId) + '" data-fcat="' + esc(x.category || 'DEVICE') + '" data-ftype="' + esc(x.type || '') + '">' + label + '</button>';
  };
  if (A) {
    if (x.stage === 'SITE') { b.push(btn('remote', 'Under review (remote)')); b.push(btn('resolve', 'Resolve')); }
    if (x.stage === 'REMOTE') { b.push(btn('resolve', 'Resolve', true)); b.push(btn('asksend', 'Ask them to send it to the Office')); }
    if (x.stage === 'TO_OFFICE') b.push('<button class="btn small" data-go="transfers">Confirm receipt in Transfers</button>');
    if (x.stage === 'OFFICE') { b.push(btn('review', 'Under review')); b.push(btn('resolve', 'Resolve')); b.push(btn('keep', 'Keep in Office')); b.push(btn('totech', 'Send to product team', true)); }
    if (x.stage === 'REVIEW') { b.push(btn('resolve', 'Resolve')); b.push(btn('totech', 'Send to product team', true)); }
    if (x.stage === 'TO_TECH' || x.stage === 'TECH') b.push(btn('techback', 'Mark back from product team'));
    if (x.stage === 'BACK_WAY') { b.push(btn('recvback', 'Confirm receipt', true)); b.push(btn('techback', 'Mark back myself')); }
    if (x.stage === 'BACK') b.push(btn('resolve', 'Resolve', true));
  }
  if (T) {
    if (x.stage === 'TO_TECH') b.push(btn('techconfirm', 'Confirm receipt', true));
    if (x.stage === 'TECH') b.push(btn('deposit', 'Deposit back after repair', true));
  }
  return b.length ? '<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">' + b.join('') + '</div>' : '';
}

/** Show or hide the story of an issue (loaded the first time). */
function toggleStory(issueId) {
  const box = document.getElementById('story_' + issueId); if (!box) return;
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (box.dataset.loaded) return;
  box.innerHTML = '<div class="small muted">Loading…</div>';
  callBackend('issueStory', { issueId: issueId }).then(function (r) {
    box.dataset.loaded = '1';
    box.innerHTML = r.story.length ? '<ul class="timeline">' + r.story.map(function (e) {
      return '<li><b>' + esc(e.text) + '</b> · ' + fmt(e.at) + '<div class="small muted">' + (e.by ? 'by ' + esc(e.by) : '') + (e.note ? (e.by ? ' · ' : '') + esc(e.note) : '') + '</div></li>';
    }).join('') + '</ul>' : '<div class="small muted">No steps recorded yet.</div>';
  }).catch(function (e) { box.innerHTML = '<div class="small muted">Could not load the story. ' + esc((e && e.message) || '') + '</div>'; });
}

function storyToggle(issueId) {
  return '<div style="margin-top:6px"><button class="linkBtn" data-story="' + esc(issueId) + '">Show the story</button></div><div id="story_' + esc(issueId) + '" class="hidden"></div>';
}

document.addEventListener('click', function (e) {
  const s = e.target.closest('[data-story]');
  if (s) { e.preventDefault(); const open = !document.getElementById('story_' + s.dataset.story).classList.contains('hidden'); toggleStory(s.dataset.story); s.textContent = open ? 'Show the story' : 'Hide the story'; return; }
  const t = e.target.closest('[data-flow]'); if (!t) return;
  const f = t.dataset.flow, issue = t.dataset.fissue, handover = t.dataset.fhandover, asset = t.dataset.fasset, cat = t.dataset.fcat || 'DEVICE';
  const done = function (msg) { return function () { toast(msg); go(tab, true); }; };
  if (f === 'remote') return askNote({ title: 'Under review (remote): ' + asset, intro: 'You look at it remotely while it stays with the supervisor. If it cannot be solved, ask them to send it to the Office.', noteLabel: 'What are you trying?', ph: 'e.g. Asked them to clear the storage', ok: 'Start remote review',
    run: function (v) { return fastCall('updateIssues', { issueIds: [issue], status: 'UNDER_REVIEW', resolution: v.note }, { label: 'Remote review' }).then(done('Remote review started for ' + asset)); } });
  if (f === 'asksend') return askNote({ title: 'Ask for ' + asset + ' to be sent in', intro: 'The supervisor is told to send it to the Office with a transfer.', noteLabel: 'Note', ph: 'e.g. Could not fix it remotely', ok: 'Ask them',
    run: function (v) { return fastCall('askSendToOffice', { issueId: issue, note: v.note }, { label: 'The request' }).then(done('The supervisor is asked to send it')); } });
  if (f === 'review') return askNote({ title: 'Under review: ' + asset, intro: 'Check the device at the office.', noteLabel: 'What did you find?', ph: 'e.g. Reads on one laptop only', ok: 'Mark under review',
    run: function (v) { return fastCall('updateIssues', { issueIds: [issue], status: 'UNDER_REVIEW', resolution: v.note }, { label: 'Under review' }).then(done('Marked under review')); } });
  if (f === 'keep') return askNote({ title: 'Keep in Office: ' + asset, intro: 'The device stays in the Office and leaves the Transfers tab. It is followed in Issues as under review until you resolve it or send it to the product team.', noteLabel: 'Note', ph: 'e.g. Kept as a spare, fix later', ok: 'Keep in Office',
    run: function (v) { return fastCall('updateIssues', { issueIds: [issue], status: 'UNDER_REVIEW', resolution: 'Kept in the Office' + (v.note ? ': ' + v.note : '') }, { label: 'Keep in Office' }).then(done(asset + ' kept in the Office, followed in Issues')); } });
  if (f === 'resolve') return askResolve({ issueIds: [issue], asset: asset, cat: cat, title: 'Resolve: ' + asset });
  if (f === 'totech') return askNote({ title: 'Send to product team: ' + asset, intro: 'The product team is told. The device stays with the Office on paper until you mark it back.', noteLabel: 'Note for the product team', ph: 'What to check', need: true, ref: true, ok: 'Send to product team',
    run: function (v) { return fastCall('sendToTech', { issueId: issue, note: v.note, ref: v.ref }, { label: 'Sending to the product team' }).then(done('Sent to the product team')); } });
  if (f === 'techback') return askNote({ title: 'Mark back from product team: ' + asset, intro: 'Use this when you have the device back and the product team did not confirm receipt or deposit it. The story will say the office marked it.', noteLabel: 'Note', ph: 'e.g. Came back by courier', ok: 'Mark back',
    run: function (v) { return fastCall('markBackFromTech', { issueId: issue, note: v.note }, { label: 'Marking back' }).then(done('Marked back from the product team')); } });
  if (f === 'recvback') return askNote({ title: 'Confirm receipt: ' + asset, intro: 'The product team sent this device back to the Office.', noteLabel: 'Note', ph: 'e.g. Checked, looks fine', ok: 'Confirm receipt',
    run: function (v) { return fastCall('receiveFromTech', { handoverId: handover, note: v.note }, { label: 'Confirming receipt' }).then(done('Receipt confirmed')); } });
  if (f === 'techconfirm') return askNote({ title: 'Confirm receipt: ' + asset, intro: 'The device reached the product team. Say what state it is in and what was not working.', noteLabel: 'Note', ph: 'e.g. Package in good shape', ok: 'Confirm receipt', cond: cat, condType: t.dataset.ftype || '',
    run: function (v) { return fastCall('techConfirm', { handoverId: handover, note: v.note, state: v.cond.state, type: v.cond.type, detail: v.cond.detail }, { label: 'Confirming receipt' }).then(done('Receipt confirmed')); } });
  if (f === 'deposit') return askNote({ title: 'Deposit back after repair: ' + asset, intro: 'Sends the device back to the Office. The admin confirms receipt.', select: { label: 'Outcome', opts: ['Repaired', 'Part replaced', 'Not repairable'] }, noteLabel: 'What was done', ph: 'e.g. Battery replaced', need: true, ok: 'Deposit back',
    run: function (v) { return fastCall('techDeposit', { issueId: issue, outcome: v.outcome, note: v.note }, { label: 'Depositing back' }).then(done('Deposited. Waiting for the office to confirm')); } });
});

// ---------- the Tech desk ----------
VIEWS.techdesk = function () {
  return swr('techDesk', {}, function (d) {
    const isTech = me.role === 'TECH';
    const sec = function (title, stages, empty) {
      const l = d.items.filter(function (x) { return stages.indexOf(x.stage) !== -1; });
      return '<h3>' + title + ' (' + l.length + ')</h3>' + (l.length ? l.map(techCard).join('') : '<div class="card"><div class="small muted">' + empty + '</div></div>');
    };
    const techCard = function (x) {
      return '<div class="card faultyCard"><div class="row spread" style="align-items:flex-start"><div class="grow"><div class="t" style="font-size:16px">' + (isTech ? esc(x.assetId) : '<a href="#" data-asset="' + esc(x.assetId) + '">' + esc(x.assetId) + '</a>') +
        ' <span class="muted" style="font-size:14px">' + esc(x.type) + '</span></div><div class="small muted">' + esc(catLabel(x.category)) + (x.subType ? ' ' + esc(x.subType) : '') + ' · reported by ' + esc(x.by) + (x.office ? ' · ' + esc(x.office) : '') + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">' + stagePill(x.stage, x.stageLabel) + agingPill(x) + '</div></div>' +
        (x.description ? '<div class="small">“' + esc(x.description) + '”</div>' : '') +
        '<div class="small" style="margin-top:6px">Sent ' + fmt(x.sentAt) + ' by ' + esc(x.sentBy) + (x.ref ? ' · ' + esc(x.ref) : '') + '</div>' + (x.sentNote ? '<div class="small">Note: ' + esc(x.sentNote) + '</div>' : '') +
        flowButtons({ issueId: x.issueId, assetId: x.assetId, category: x.category, stage: x.stage, handoverId: x.handoverId, type: x.type }) +
        storyToggle(x.issueId) + '</div>';
    };
    const back = d.returned.length ? '<h3>Recently returned (' + d.returned.length + ')</h3>' + d.returned.slice(0, 10).map(function (h) {
      return '<div class="card"><div class="row spread"><div><b>' + esc(h.assetId) + '</b> <span class="small muted">' + esc(h.note) + '</span><div class="small muted">Back at the Office ' + fmt(h.confirmedAt) + (h.override ? ' · marked by the office' : '') + '</div></div>' + pill('returned', 'ok') + '</div></div>';
    }).join('') : '';
    $('view').innerHTML = '<div class="stickyHead flat"><h2 style="margin:0">' + (isTech ? 'Tech desk' : 'Tech team') + '</h2></div>' +
      '<p class="small muted">' + (isTech ? 'Confirm what reaches you, and deposit devices back after repair.' : 'Where each device is with the product team. They confirm receipt and deposit devices back; you can mark one back yourself if they forget.') + '</p>' +
      sec('On the way to the product team', ['TO_TECH'], 'Nothing on the way.') + sec('With the product team', ['TECH'], 'Nothing being repaired.') + sec('Deposited, on the way back to the Office', ['BACK_WAY'], 'Nothing coming back.') + back;
  });
};
