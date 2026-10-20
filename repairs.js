/**
 * THE REPAIR JOURNEY (Issues tab, Transfers tab and the Tech desk). Loaded after app.js and uses its globals.
 *
 *   At site > On the way to office > At office > (Under review) > On the way to product team > With product team > Coming back > Back from product team > Resolved
 *
 * Every step that needs a note opens a small window (askNote); every button is built by flowButtons so the Issues tab, the received-transfer card and the
 * Tech desk offer exactly the same next steps.
 */

const STAGE_CLASS = { SITE: '', TO_OFFICE: 'info', OFFICE: 'info', REVIEW: 'info', TO_TECH: 'info', TECH: 'info', BACK_WAY: 'info', BACK: 'warn', DONE: 'ok' };
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
    (o.ref ? '<label class="f">Courier and tracking number <span class="muted">(optional)</span></label><input type="text" id="askRef" maxlength="60">' : '') +
    '<div class="small" id="askMsg" style="color:var(--bad);margin-top:6px"></div><div class="row" style="margin-top:12px"><button class="btn" id="askOk">' + esc(o.ok) + '</button></div>', function (box) {
    box.querySelector('#askOk').addEventListener('click', function (e) {
      const note = box.querySelector('#askNote').value.trim(), msg = box.querySelector('#askMsg');
      if (o.need && !note) { msg.textContent = 'Please write a short note.'; return; }
      busy(e.target, function () {
        return o.run({ note: note, ref: o.ref ? box.querySelector('#askRef').value.trim() : '', outcome: o.select ? box.querySelector('#askSel').value : '' })
          .then(function () { closeModal(); }).catch(function (err) { msg.textContent = (err && err.message) || 'Could not save.'; });
      });
    });
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
    return '<button class="btn' + (primary ? '' : ' secondary') + ' small" data-flow="' + f + '" data-fissue="' + esc(x.issueId) + '" data-fhandover="' + esc(x.handoverId || '') + '" data-fasset="' + esc(x.assetId) + '">' + label + '</button>';
  };
  if (A) {
    if (x.stage === 'TO_OFFICE') b.push('<button class="btn small" data-go="transfers">Confirm receipt in Transfers</button>');
    if (x.stage === 'OFFICE') { b.push(btn('review', 'Under review')); b.push(btn('resolve', 'Resolve')); b.push(btn('totech', 'Send to product team', true)); }
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
  const f = t.dataset.flow, issue = t.dataset.fissue, handover = t.dataset.fhandover, asset = t.dataset.fasset;
  const done = function (msg) { return function () { toast(msg); go(tab, true); }; };
  if (f === 'review') return askNote({ title: 'Under review: ' + asset, intro: 'Check the device at the office.', noteLabel: 'What did you find?', ph: 'e.g. Reads on one laptop only', ok: 'Mark under review',
    run: function (v) { return callBackend('updateIssues', { issueIds: [issue], status: 'UNDER_REVIEW', resolution: v.note }).then(done('Marked under review')); } });
  if (f === 'resolve') return askNote({ title: 'Resolve: ' + asset, intro: 'Once resolved, a device that came in through the Office comes back to the Office list to send back or keep.', noteLabel: 'How was it resolved?', ph: 'e.g. Tested, works fine', ok: 'Resolve',
    run: function (v) { return callBackend('updateIssues', { issueIds: [issue], status: 'RESOLVED', resolution: v.note }).then(done(asset + ' resolved')); } });
  if (f === 'totech') return askNote({ title: 'Send to product team: ' + asset, intro: 'The product team is told. The device stays with the Office on paper until you mark it back.', noteLabel: 'Note for the product team', ph: 'What to check', need: true, ref: true, ok: 'Send to product team',
    run: function (v) { return callBackend('sendToTech', { issueId: issue, note: v.note, ref: v.ref }).then(done('Sent to the product team')); } });
  if (f === 'techback') return askNote({ title: 'Mark back from product team: ' + asset, intro: 'Use this when you have the device back and the product team did not confirm receipt or deposit it. The story will say the office marked it.', noteLabel: 'Note', ph: 'e.g. Came back by courier', ok: 'Mark back',
    run: function (v) { return callBackend('markBackFromTech', { issueId: issue, note: v.note }).then(done('Marked back from the product team')); } });
  if (f === 'recvback') return askNote({ title: 'Confirm receipt: ' + asset, intro: 'The product team sent this device back to the Office.', noteLabel: 'Note', ph: 'e.g. Checked, looks fine', ok: 'Confirm receipt',
    run: function (v) { return callBackend('receiveFromTech', { handoverId: handover, note: v.note }).then(done('Receipt confirmed')); } });
  if (f === 'techconfirm') return askNote({ title: 'Confirm receipt: ' + asset, intro: 'The device reached the product team.', noteLabel: 'Note', ph: 'e.g. Package in good shape', ok: 'Confirm receipt',
    run: function (v) { return callBackend('techConfirm', { handoverId: handover, note: v.note }).then(done('Receipt confirmed')); } });
  if (f === 'deposit') return askNote({ title: 'Deposit back after repair: ' + asset, intro: 'Sends the device back to the Office. The admin confirms receipt.', select: { label: 'Outcome', opts: ['Repaired', 'Part replaced', 'Not repairable'] }, noteLabel: 'What was done', ph: 'e.g. Battery replaced', need: true, ok: 'Deposit back',
    run: function (v) { return callBackend('techDeposit', { issueId: issue, outcome: v.outcome, note: v.note }).then(done('Deposited. Waiting for the office to confirm')); } });
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
        flowButtons({ issueId: x.issueId, assetId: x.assetId, stage: x.stage, handoverId: x.handoverId }) +
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
