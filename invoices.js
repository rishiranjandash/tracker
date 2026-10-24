/**
 * INVOICES tab (supervisors and admins). Loaded after app.js and upload.js, and uses their globals.
 *
 * Sending an invoice never depends on the screen staying open: the form and the compressed pictures are saved on the phone first
 * (the "outbox"), then each picture is uploaded in small pieces, and only when every picture is confirmed on the server is the invoice created.
 * Anything that fails to go is kept and retried by itself (when the signal is back, when the app is opened, every minute), and shown in the
 * "Waiting to send" list with a Retry button.
 */

const INV_PDF_MAX = 3 * 1024 * 1024;   // 3 MB: the most that goes up in the 60 pieces the server accepts
const INV_TARGETS = { targets: [[1600, 0.8], [1600, 0.7], [1280, 0.65], [1024, 0.6]], maxBytes: 450 * 1024 };   // bigger than the other photos: text must stay readable
let invOutbox = [], invRunning = false, invTimer = null, invLoaded = false;

// ---------- outbox (kept on the phone until the server has the invoice) ----------
function invMine() { return invOutbox.filter(function (x) { return me && x.email === me.email; }); }
function invSave(it) { return LocalStore.put(it).catch(function () { /* storage full or blocked: it still sends during this visit */ }); }

function invoiceOutboxStart() {
  if (invLoaded) { invPump(); return; }
  LocalStore.all().then(function (all) {
    invLoaded = true;
    invOutbox = all.filter(function (x) { return x && x.key; });
    invOutbox.forEach(function (x) { if (x.state === 'SENDING') x.state = 'PENDING'; });   // the app was closed while it was sending: carry on
    invPaintChip(); invPump();
  }).catch(function () { invLoaded = true; });
}
window.addEventListener('online', function () { if (me) invPump(); });
document.addEventListener('visibilitychange', function () { if (!document.hidden && me) invPump(); });
setInterval(function () { if (me && !document.hidden) invPump(); }, 60000);

function invWhen() {
  const next = invMine().filter(function (x) { return x.state === 'RETRY'; }).map(function (x) { return x.nextAt; }).sort()[0];
  clearTimeout(invTimer);
  if (next) invTimer = setTimeout(invPump, Math.max(1000, next - Date.now()));
}

async function invPump() {
  if (invRunning || !me || !invLoaded) return;
  invRunning = true;
  try {
    for (;;) {
      const it = invMine().find(function (x) { return x.state === 'PENDING' || (x.state === 'RETRY' && x.nextAt <= Date.now()); });
      if (!it) break;
      await invProcess(it);
    }
  } finally { invRunning = false; invPaint(); invWhen(); }
}

async function invProcess(it) {
  it.state = 'SENDING'; it.error = ''; invPaint();
  try {
    for (let i = 0; i < it.photos.length; i++) {
      const p = it.photos[i];
      if (p.fileId) continue;
      it.note = 'Sending file ' + (i + 1) + ' of ' + it.photos.length; p.progress = ''; invPaint();
      p.fileId = await uploadChunked('invoice', (it.fields.category || 'invoice').replace(/[^A-Za-z0-9]/g, ''), p.b64, { uploadId: p.id, mime: p.mime || 'image/jpeg', onProgress: function (d, t) { p.progress = d + ' of ' + t; invPaint(); } });
      await invSave(it);
    }
    it.note = 'Saving the invoice…'; invPaint();
    await callBackend('submitInvoice', Object.assign({}, it.fields, { clientKey: it.key, photoIds: it.photos.map(function (p) { return p.fileId; }) }));
    invOutbox = invOutbox.filter(function (x) { return x !== it; });
    await LocalStore.del(it.key).catch(function () {});
    toast('Invoice submitted'); if (tab === 'invoices') go('invoices', true);
    return;   // done: it is gone from the phone, nothing more to save
  } catch (e) {
    const msg = (e && e.message) || 'Could not send';
    if (e && e.code === 'AUTH') { it.state = 'PENDING'; invSave(it); return; }                         // signed out: carries on after the next sign-in
    if (/did not reach the server/.test(msg)) it.photos.forEach(function (p) { p.fileId = ''; });          // the server lost a picture: send them again
    const refusal = (e && e.fromServer) || (e && !/Could not reach|No answer|Unreadable|network|fetch|failed|timed out|abort|signal|offline|taking too long/i.test(msg) && !/did not reach/.test(msg));
    it.tries = (it.tries || 0) + 1;
    if (refusal && !/did not reach/.test(msg)) { it.state = 'FAILED'; it.error = msg; toast('An invoice could not be sent: ' + msg, true); }
    else if (it.tries >= 12) { it.state = 'FAILED'; it.error = 'Could not send after many tries. ' + msg; }
    else { it.state = 'RETRY'; it.error = msg; it.nextAt = Date.now() + Math.min(300000, 5000 * Math.pow(2, Math.min(it.tries, 6))); }
  }
  await invSave(it);
}

function invPaintChip() {
  let el = $('invStatus');
  const list = invMine();
  if (!list.length) { if (el) el.remove(); return; }
  const failed = list.filter(function (x) { return x.state === 'FAILED'; }).length, going = list.length - failed;
  if (!el) { el = document.createElement('button'); el.id = 'invStatus'; el.type = 'button'; el.className = 'photoStatus inv'; el.addEventListener('click', function () { go('invoices'); }); document.body.appendChild(el); }
  el.classList.toggle('bad', !!failed);
  el.textContent = failed ? (failed + (failed > 1 ? ' invoices' : ' invoice') + ' not sent · tap to open') : ((going > 1 ? going + ' invoices' : 'Invoice') + ' waiting to send · tap to open');
}
function invPaint() {
  invPaintChip();
  const host = $('invOutbox');
  if (host) host.innerHTML = invOutboxHtml();
}

function invOutboxHtml() {
  const list = invMine();
  if (!list.length) return '';
  return '<h3>Waiting to send</h3>' + list.map(function (it) {
    const f = it.fields, n = it.photos.length, up = it.photos.filter(function (p) { return p.fileId; }).length;
    const status = it.state === 'SENDING' ? '<div class="small">' + esc(it.note || 'Sending…') + (it.photos.find(function (p) { return !p.fileId && p.progress; }) ? ' (' + esc(it.photos.find(function (p) { return !p.fileId && p.progress; }).progress) + ' parts)' : '') + '</div>'
      : it.state === 'RETRY' ? '<div class="small muted">No signal or the server is busy. It will be sent again by itself. ' + esc(it.error || '') + '</div>'
      : it.state === 'FAILED' ? '<div class="small" style="color:var(--bad)">Could not be sent: ' + esc(it.error || '') + '</div>'
      : '<div class="small muted">Saved on your phone. It will be sent in a moment.</div>';
    return '<div class="card"><div class="row spread"><div><b>' + esc(f.refType === 'PROPS' ? 'Props bought' : (f.category || invForLabel(f.refType || ''))) + '</b> · ' + invMoney(f.amount) + '<div class="small muted">' + (f.brand ? esc(f.brand) + ' · ' : '') + esc(f.movementDate) + ' · ' + n + (n > 1 ? ' pictures' : ' picture') + ' (' + up + ' uploaded)</div></div>' +
      pill(it.state === 'SENDING' ? 'sending' : it.state === 'FAILED' ? 'not sent' : 'waiting', it.state === 'FAILED' ? 'bad' : 'info') + '</div>' + status +
      '<div class="row" style="margin-top:8px">' + (it.state === 'SENDING' ? '' : '<button class="btn small" data-inv-retry="' + esc(it.key) + '">' + (it.state === 'FAILED' ? 'Try again' : 'Send now') + '</button><button class="btn secondary small" data-inv-del="' + esc(it.key) + '">Delete</button>') + '</div></div>';
  }).join('');
}

function invMoney(v) { const n = Number(String(v === undefined || v === null ? '' : v).replace(/[,\s]/g, '')) || 0; return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
function invStatusPill(s) { return s === 'APPROVED' ? pill('approved', 'ok') : s === 'REJECTED' ? pill('sent back', 'bad') : pill('waiting for review', 'info'); }
function invForLabel(t) { return t === 'TRANSFER' ? 'Transfers' : t === 'CHECKIN' ? 'Check-ins' : t === 'PROPS' ? 'Props bought' : 'Not tied to anything'; }
function invToday() { return new Date(Date.now() + 19800000).toISOString().slice(0, 10); }
function invDaysAgo(n) { return new Date(Date.now() + 19800000 - n * 86400000).toISOString().slice(0, 10); }

// ---------- the Invoices tab ----------
function invoiceCard(i, canReview) {
  const pics = i.photos.map(function (id, k) { return '<button class="btn secondary small" data-photo="' + esc(id) + '">File ' + (k + 1) + '</button>'; }).join('');
  return '<div class="card"><div class="row spread" style="align-items:flex-start"><div><b>' + invMoney(i.amount) + '</b>' + (i.category ? ' · ' + esc(i.category) : '') +
    '<div class="small muted">' + (i.brand ? esc(i.brand) + ' · ' : '') + (i.refType === 'PROPS' ? 'bought ' : 'moved ') + esc(i.movementDate) + (i.refText ? ' · ' + esc(i.refText) : '') + '</div>' +
    (canReview ? '<div class="small">' + esc(i.by) + (i.office ? ' · ' + esc(i.office) : '') + '</div>' : '') +
    ((i.invoiceNo || i.trackingNo) ? '<div class="small muted">' + (i.invoiceNo ? 'Invoice ' + esc(i.invoiceNo) : '') + (i.invoiceNo && i.trackingNo ? ' · ' : '') + (i.trackingNo ? 'Tracking ' + esc(i.trackingNo) : '') + '</div>' : '') +
    (i.note ? '<div class="small">' + esc(i.note) + '</div>' : '') + '</div>' + invStatusPill(i.status) + '</div>' +
    (i.status === 'REJECTED' && i.reviewNote ? '<div class="banner bad" style="margin-top:8px"><div class="grow small"><b>Sent back:</b> ' + esc(i.reviewNote) + '</div></div>' : '') +
    (i.status === 'APPROVED' && i.reviewNote ? '<div class="small muted">' + esc(i.reviewNote) + '</div>' : '') +
    '<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">' + pics +
    (canReview && i.status === 'SUBMITTED' ? '<button class="btn small" data-inv-approve="' + esc(i.id) + '">Approve</button><button class="btn secondary small" data-inv-reject="' + esc(i.id) + '">Send back</button>' : '') + '</div>' +
    '<div class="small muted" style="margin-top:6px">Submitted ' + fmt(i.at) + (i.reviewedBy ? ' · reviewed by ' + esc(i.reviewedBy) : '') + '</div></div>';
}

function requestCard(r, isAdmin) {
  const tr = r.transfer;
  return '<div class="card flag ' + (r.overdue ? 'HIGH' : 'MEDIUM') + '"><div class="row spread" style="align-items:flex-start"><div><b>' + (isAdmin ? esc(r.to) + ' · ' : '') + (r.refType === 'PROPS' ? 'Props invoices' : 'Invoice of ' + esc(r.refText || r.transferId || 'a transfer')) + '</b>' +
    (tr ? '<div class="small muted">' + esc(tr.from) + ' → ' + esc(tr.to) + ' · sent ' + fmt(tr.createdAt) + (tr.items ? ' · ' + esc(tr.items) + ' item(s)' : '') + '</div>' : '') +
    (r.note ? '<div class="small">' + esc(r.note) + '</div>' : '') + '<div class="small muted">Asked by ' + esc(r.by) + (r.dueDate ? ' · due ' + esc(r.dueDate) : '') + '</div></div>' +
    (r.overdue ? pill('overdue', 'bad') : pill('requested', 'warn')) + '</div><div class="row" style="margin-top:8px">' +
    (isAdmin ? '<button class="btn secondary small" data-inv-cancelreq="' + esc(r.id) + '">Cancel request</button>' : '<button class="btn small" data-inv-send="' + esc(r.id) + '" data-rt="' + esc(r.refType) + '" data-rid="' + esc(r.refId) + '">Send this invoice</button>') + '</div></div>';
}

let invFilter = { status: '', category: '', brand: '', supervisorId: '', refType: '', from: '', to: '' };

VIEWS.invoices = function () {
  const isAdmin = me.role === 'ADMIN' || me.role === 'OPS';
  const payload = isAdmin ? Object.assign({}, invFilter) : {};
  const people = isAdmin ? cachedCall('supervisorList', {}, 300000).catch(function () { return []; }) : Promise.resolve([]);
  return people.then(function (sl) {
    return swr('invoices', payload, function (d) {
      const o = d.options;
      const opt = function (list, cur, label) { return '<option value="">' + label + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); };
      let html = '<div class="stickyHead flat"><div class="row spread"><h2 style="margin:0">Invoices</h2><div class="row">' +
        (d.canRequest ? '<button class="btn secondary small" id="invAsk">Request invoices</button>' : '') + '<button class="btn" id="invNew">New invoice</button></div></div></div>' +
        '<div id="invOutbox">' + invOutboxHtml() + '</div>';
      if (d.requests.length) html += '<h3>' + (isAdmin ? 'Waiting for the supervisor' : 'Asked for by an admin') + ' (' + d.requests.length + ')</h3>' + d.requests.map(function (r) { return requestCard(r, isAdmin); }).join('');
      if (isAdmin) {
        html += '<div class="tiles"><div class="tile"><div class="n">' + d.totals.count + '</div><div class="l">Invoices</div></div><div class="tile"><div class="n">' + invMoney(d.totals.amount) + '</div><div class="l">Total amount</div></div>' +
          '<div class="tile ' + (d.totals.toReview ? 'warn' : '') + '"><div class="n">' + d.totals.toReview + '</div><div class="l">To review</div></div></div>' +
          '<div class="card"><b>Summary by what it is for</b>' + d.byType.map(function (b) { return '<button class="item linkBtn" data-inv-for="' + esc(b.type || 'NONE') + '" style="width:100%;text-align:left"><div class="grow">' + invForLabel(b.type) + '<div class="small muted">' + b.count + (b.count === 1 ? ' invoice' : ' invoices') + (b.toReview ? ' · ' + b.toReview + ' to review' : '') + '</div></div><b>' + invMoney(b.amount) + '</b></button>'; }).join('') + '</div>' +
          '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><select id="ifStatus" style="width:auto">' + opt(['SUBMITTED', 'APPROVED', 'REJECTED'], invFilter.status, 'Any status') + '</select>' +
          '<select id="ifFor" style="width:auto">' + [['', 'Transfers, check-ins, props…'], ['TRANSFER', 'Transfers'], ['CHECKIN', 'Check-ins'], ['PROPS', 'Props bought']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === invFilter.refType ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
          (o.showCategory ? '<select id="ifCat" style="width:auto">' + opt(o.categories, invFilter.category, 'Any category') + '</select>' : '') + '<select id="ifBrand" style="width:auto">' + opt(o.brands, invFilter.brand, 'Any logistic brand') + '</select>' +
          '<select id="ifSup" style="width:auto"><option value="">Any supervisor</option>' + sl.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === invFilter.supervisorId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
          '<label class="small muted">Moved from<input type="date" id="ifFrom" value="' + esc(invFilter.from) + '"></label><label class="small muted">to<input type="date" id="ifTo" value="' + esc(invFilter.to) + '"></label>' +
          '<button class="btn secondary small" id="ifClear">Clear</button><button class="btn secondary small" data-report="invoices">Download CSV</button></div></div>';
      }
      html += '<h3>' + (isAdmin ? 'Invoices' : 'My invoices') + '</h3>' + (d.invoices.length ? d.invoices.map(function (i) { return invoiceCard(i, d.canReview); }).join('') + (d.more ? '<p class="small muted">Showing the latest 200. Narrow the filters to see others.</p>' : '')
        : '<div class="card">' + emptyState(isAdmin ? 'No invoices match.' : 'You have not sent any invoices yet.') + '</div>');
      $('view').innerHTML = html;
      const reload = function () { invFilter = { status: $('ifStatus').value, category: $('ifCat') ? $('ifCat').value : '', brand: $('ifBrand').value, supervisorId: $('ifSup').value, refType: $('ifFor').value, from: $('ifFrom').value, to: $('ifTo').value }; go('invoices', true); };
      ['ifStatus', 'ifFor', 'ifCat', 'ifBrand', 'ifSup', 'ifFrom', 'ifTo'].forEach(function (id) { const e = $(id); if (e) e.addEventListener('change', reload); });
      if ($('ifClear')) $('ifClear').addEventListener('click', function () { invFilter = { status: '', category: '', brand: '', supervisorId: '', refType: '', from: '', to: '' }; go('invoices', true); });
      $('invNew').addEventListener('click', function () { pending($('invNew')); go('invoiceNew'); });
      if ($('invAsk')) $('invAsk').addEventListener('click', openInvoiceRequest);
    });
  });
};

// ---------- the new invoice form ----------
VIEWS.invoiceNew = function (arg) {
  arg = arg || {};
  $('view').innerHTML = '<div class="empty">Loading…</div>';
  const optsP = OPTS && OPTS.invoice ? Promise.resolve(OPTS.invoice) : fetchOpts().then(function (o) { OPTS = o; return o.invoice; });
  return Promise.all([optsP, callBackend('transfers').catch(function () { return []; }), callBackend('transferHistory', { from: new Date(Date.now() - 60 * 86400000).toISOString() }).catch(function () { return { transfers: [] }; }), callBackend('invoiceCheckins').catch(function () { return []; })]).then(function (r) {
    const o = r[0] || { categories: [], brands: [], maxPhotos: 3 }, seen = {}, trs = [];
    r[1].concat(r[2].transfers || []).forEach(function (t) { if (!seen[t.id]) { seen[t.id] = true; trs.push(t); } });
    trs.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    const cks = r[3] || [];
    if (arg.transferId && !arg.refType) { arg.refType = 'TRANSFER'; arg.refId = arg.transferId; }
    const photos = [];   // { id, file, url, state: 'preparing'|'ready'|'error', b64, promise }
    const sel = function (id, list, ph) { return '<select id="' + id + '"><option value="">' + ph + '</option>' + list.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select>'; };
    $('view').innerHTML = '<div class="card"><div class="row spread"><h2>New invoice</h2><button class="linkBtn" data-go="invoices">Back</button></div>' +
      (arg.requestId ? '<div class="banner warn"><div class="grow small"><b>Requested by an admin:</b> ' + (arg.refType === 'PROPS' ? 'props invoice' : 'invoice of ' + esc(arg.refText || arg.refId || 'a transfer')) + '.</div></div>' : '') +
      '<label class="f">What is this invoice for?</label><select id="ivFor"><option value="TRANSFER">A transfer</option><option value="CHECKIN">A check-in</option><option value="PROPS">Props bought</option><option value="">Something else</option></select>' +
      '<div id="ivRefBox"></div>' +
      (o.showCategory ? '<div id="ivCatBox"><label class="f">Category</label>' + sel('ivCat', o.categories, 'Choose…') + '</div>' : '<div id="ivCatBox" hidden></div>') +
      '<label class="f">Amount (₹)</label><input type="text" id="ivAmount" inputmode="decimal" placeholder="e.g. 1250.50">' +
      '<label class="f" id="ivBrandL">Logistic brand</label><select id="ivBrand"></select>' +
      '<label class="f" id="ivDateL">Date of the movement</label><input type="date" id="ivDate" max="' + invToday() + '" value="' + esc(arg.movementDate || '') + '">' +
      '<label class="f">Invoice number <span class="muted">(optional)</span></label><input type="text" id="ivNo" maxlength="60">' +
      '<label class="f">Tracking / AWB number <span class="muted">(optional)</span></label><input type="text" id="ivTrack" maxlength="60">' +
      '<label class="f" id="ivNoteL">Note <span class="muted">(optional)</span></label><textarea id="ivNote" maxlength="500"></textarea>' +
      '<label class="f">Invoice: pictures or a PDF (up to ' + o.maxPhotos + ' files)</label><div id="ivPics" class="row" style="gap:8px;flex-wrap:wrap"></div>' +
      '<div style="margin-top:8px"><button type="button" class="btn secondary small" id="ivAddWrap">Add a picture</button> <button type="button" class="btn secondary small" id="ivAddPdf">Add a PDF</button><input type="file" accept="image/*" id="ivFile" style="display:none"><input type="file" accept="application/pdf,.pdf" id="ivPdf" style="display:none"></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn" id="ivSubmit">Submit invoice</button></div><div class="small" id="ivMsg" style="margin-top:8px"></div>' +
      '<p class="small muted">The invoice is saved on your phone first, so it still goes through if the signal drops or you close the app.</p></div>';
    const msg = function (t, bad) { const e = $('ivMsg'); e.textContent = t; e.style.color = bad ? 'var(--bad)' : ''; };
    const paintPics = function () {
      $('ivPics').innerHTML = photos.map(function (p) {
        return '<div style="position:relative">' + (p.mime === 'application/pdf'
          ? '<div style="width:90px;height:90px;border-radius:8px;border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bad-bg);color:var(--bad);font-weight:700">PDF<span class="small muted" style="font-weight:400;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name || '') + '</span></div>'
          : '<img src="' + esc(p.url) + '" alt="Picture" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line)' + (p.state === 'preparing' ? ';opacity:.5' : '') + '">') +
          '<button type="button" class="linkBtn" data-ivrm="' + esc(p.id) + '" style="position:absolute;top:-6px;right:-6px;background:var(--bg);border-radius:50%;width:24px;height:24px">×</button>' +
          (p.state === 'preparing' ? '<div class="small muted">Preparing…</div>' : p.state === 'error' ? '<div class="small" style="color:var(--bad)">Not usable</div>' : '') + '</div>';
      }).join('');
      $('ivAddWrap').style.display = photos.length >= o.maxPhotos ? 'none' : 'inline-block';
      $('ivPics').querySelectorAll('[data-ivrm]').forEach(function (b) { b.addEventListener('click', function () { const k = photos.findIndex(function (p) { return p.id === b.dataset.ivrm; }); if (k >= 0) { if (photos[k].url) URL.revokeObjectURL(photos[k].url); photos.splice(k, 1); paintPics(); } }); });
    };
    const refList = { TRANSFER: trs.map(function (t) { return [t.id, t.id + ' · ' + t.from + ' → ' + t.to + ' · ' + fmt(t.createdAt)]; }),
      CHECKIN: cks.map(function (c) { return [c.id, (me.role === 'SUPERVISOR' ? '' : c.supervisor + ' · ') + c.place + ' · ' + fmt(c.at) + (c.status === 'DONE' ? '' : ' (' + c.status.toLowerCase() + ')')]; }) };
    const syncFor = function (keepRef) {
      const k = $('ivFor').value, list = refList[k];
      $('ivRefBox').innerHTML = list ? '<label class="f">' + (k === 'CHECKIN' ? 'Which check-in' : 'Which transfer') + '</label><select id="ivRef"><option value="">Choose…</option>' + list.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (keepRef && x[0] === arg.refId ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>' + (list.length ? '' : '<div class="small muted">' + (k === 'CHECKIN' ? 'No check-ins in the last 90 days.' : 'No transfers found.') + '</div>') : '';
      $('ivCatBox').style.display = k === 'PROPS' ? 'none' : '';
      const bl = (o.brandsBy && o.brandsBy[k || 'TRANSFER']) || o.brands || [], opt = !!k && k !== 'TRANSFER';
      $('ivBrand').innerHTML = '<option value="">' + (opt ? 'None' : 'Choose…') + '</option>' + bl.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
      $('ivBrandL').innerHTML = 'Logistic brand' + (opt ? ' <span class="muted">(optional)</span>' : '');
      $('ivDateL').textContent = k === 'PROPS' ? 'Date of the purchase' : k === 'CHECKIN' ? 'Date of the check-in trip' : 'Date of the movement';
      $('ivNoteL').innerHTML = k === 'PROPS' ? 'What was bought' : 'Note <span class="muted">(optional)</span>';
    };
    $('ivFor').value = ['TRANSFER', 'CHECKIN', 'PROPS'].indexOf(arg.refType) !== -1 ? arg.refType : (arg.refType === '' && arg.requestId ? '' : 'TRANSFER');
    $('ivFor').addEventListener('change', function () { syncFor(false); });
    syncFor(true);
    $('ivAddWrap').addEventListener('click', function () { $('ivFile').click(); });
    $('ivAddPdf').addEventListener('click', function () { $('ivPdf').click(); });
    $('ivPdf').addEventListener('change', function () {
      const f = $('ivPdf').files[0]; $('ivPdf').value = '';
      if (!f || photos.length >= o.maxPhotos) return;
      if (!/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name)) return msg('Choose a PDF file.', true);
      if (f.size > INV_PDF_MAX) return msg('That PDF is too big (' + (f.size / 1048576).toFixed(1) + ' MB). The most is 3 MB: save it smaller or send a picture of it.', true);
      msg('');
      const p = { id: upId('ph'), file: f, url: '', mime: 'application/pdf', name: f.name, state: 'preparing', b64: '' };
      p.promise = new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { p.b64 = String(fr.result).split(',')[1] || ''; p.state = p.b64 ? 'ready' : 'error'; paintPics(); res(); }; fr.onerror = function () { p.state = 'error'; paintPics(); rej(); }; fr.readAsDataURL(f); });
      p.promise.catch(function () {});
      photos.push(p); paintPics();
    });
    $('ivFile').addEventListener('change', function () {
      const f = $('ivFile').files[0]; $('ivFile').value = '';
      if (!f || photos.length >= o.maxPhotos) return;
      const p = { id: upId('ph'), file: f, url: URL.createObjectURL(f), state: 'preparing', b64: '' };
      p.promise = compressPhoto(f, INV_TARGETS).then(function (c) { p.b64 = c.b64; p.state = 'ready'; paintPics(); }, function () { p.state = 'error'; paintPics(); });
      photos.push(p); paintPics();
    });
    $('ivSubmit').addEventListener('click', function (e) {
      busy(e.target, async function () {
        const fields = { category: $('ivCat') ? $('ivCat').value : '', amount: $('ivAmount').value.trim(), brand: $('ivBrand').value, movementDate: $('ivDate').value, refType: $('ivFor').value, refId: $('ivRef') ? $('ivRef').value : '', requestId: arg.requestId || '',
          invoiceNo: $('ivNo').value.trim(), trackingNo: $('ivTrack').value.trim(), note: $('ivNote').value.trim() };
        if (fields.refType === 'PROPS') fields.category = 'Props bought';
        if (fields.refType && fields.refType !== 'PROPS' && !fields.refId) return msg('Choose the ' + (fields.refType === 'CHECKIN' ? 'check-in' : 'transfer') + ', or pick "Something else".', true);
        if (fields.refType === 'PROPS' && !fields.note) return msg('Say what was bought, in the note.', true);
        if (o.showCategory && !fields.category) return msg('Choose the category.', true);
        const amt = Number(fields.amount.replace(/[,\s]/g, ''));
        if (!(amt > 0)) return msg('Enter the invoice amount.', true);
        if (!fields.brand && fields.refType !== 'PROPS' && fields.refType !== 'CHECKIN') return msg('Choose the logistic brand.', true);
        if (!fields.movementDate) return msg('Choose the date.', true);
        if (fields.movementDate > invToday()) return msg('The date of the movement cannot be in the future.', true);
        if (!photos.length) return msg('Add at least one picture or PDF of the invoice.', true);
        msg('Getting the files ready…');
        await Promise.all(photos.map(function (p) { return p.promise; }));
        if (photos.some(function (p) { return p.state !== 'ready'; })) return msg('One of the files could not be used. Remove it and add it again.', true);
        const item = { key: upId('inv'), email: me.email, createdAt: Date.now(), fields: fields, photos: photos.map(function (p) { return { id: upId('up'), b64: p.b64, mime: p.mime || 'image/jpeg', fileId: '' }; }), state: 'PENDING', error: '', tries: 0, nextAt: 0 };
        await LocalStore.put(item).catch(function () { /* memory only: it sends during this visit */ });
        invOutbox.push(item); invLoaded = true;
        photos.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
        toast('Saved on your phone. Sending…'); go('invoices');
        invPump();
      });
    });
    paintPics();
  });
};

// ---------- admin: request invoices for transfers ----------
function openInvoiceRequest() {
  openModal('<div class="row spread"><h2>Request invoices</h2><button class="linkBtn" data-close>Close</button></div>' +
    '<label class="f">What for?</label><select id="irKind"><option value="TRANSFER">Transfers</option><option value="CHECKIN">Check-ins</option><option value="PROPS">Props bought</option></select>' +
    '<p class="small muted" id="irHelp" style="margin:6px 0"></p>' +
    '<input type="text" id="irSearch" placeholder="Search…"><div id="irList" class="small muted" style="margin:8px 0">Loading…</div>' +
    '<label class="f" id="irNoteL">Note <span class="muted">(optional)</span></label><input type="text" id="irNote" maxlength="300" placeholder="e.g. for the October accounts">' +
    '<label class="f">Due date <span class="muted">(optional, otherwise a few days from now)</span></label><input type="date" id="irDue" min="' + invToday() + '">' +
    '<div class="row" style="margin-top:12px"><button class="btn" id="irGo">Ask for the invoices</button><span class="small muted" id="irCount" style="margin-left:8px"></span></div><div class="small" id="irMsg" style="margin-top:8px"></div>', function (box) {
    const chosen = {}; const lists = {}; let kind = 'TRANSFER';
    const count = function () { const n = Object.keys(chosen).filter(function (k) { return chosen[k]; }).length; box.querySelector('#irCount').textContent = n ? n + ' selected' : ''; };
    const paint = function () {
      const q = box.querySelector('#irSearch').value.trim().toLowerCase();
      const rows = (lists[kind] || []).filter(function (x) { return !q || x.search.toLowerCase().indexOf(q) !== -1; }).slice(0, 60);
      box.querySelector('#irList').innerHTML = lists[kind] ? (rows.length ? rows.map(function (x) {
        return '<label class="item" style="cursor:pointer"><input type="checkbox" data-irt="' + esc(x.id) + '"' + (chosen[x.id] ? ' checked' : '') + ' style="width:20px;height:20px"><div class="grow"><b>' + esc(x.title) + '</b><div class="small muted">' + esc(x.sub) + '</div></div></label>';
      }).join('') + ((lists[kind].length > 60) ? '<div class="small muted">Showing 60: search to narrow.</div>' : '') : 'Nothing found.') : 'Loading…';
      box.querySelectorAll('[data-irt]').forEach(function (c) { c.addEventListener('change', function () { chosen[c.dataset.irt] = c.checked; count(); }); });
    };
    const load = {
      TRANSFER: function () {
        return Promise.all([callBackend('transfers'), callBackend('transferHistory', { from: new Date(Date.now() - 120 * 86400000).toISOString() })]).then(function (r) {
          const seen = {}, all = [];
          r[0].concat(r[1].transfers || []).forEach(function (t) { if (!seen[t.id] && (t.fromType === 'SUPERVISOR' || t.toType === 'SUPERVISOR')) { seen[t.id] = true; all.push(t); } });
          all.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
          return all.map(function (t) { return { id: t.id, title: t.id + ' · ' + t.from + ' → ' + t.to, sub: fmt(t.createdAt) + ' · ' + t.status.toLowerCase().replace('_', ' ') + ' · ' + t.items.length + ' item(s)' + ((t.invoices || []).length ? ' · invoice attached' : ''), search: t.id + ' ' + t.from + ' ' + t.to + ' ' + t.sentBy + ' ' + t.status + ' ' + fmt(t.createdAt) }; });
        });
      },
      CHECKIN: function () {
        return callBackend('invoiceCheckins').then(function (l) { return l.map(function (c) { return { id: c.id, title: c.supervisor + ' · ' + c.place, sub: fmt(c.at) + ' · ' + c.status.toLowerCase(), search: c.supervisor + ' ' + c.place + ' ' + fmt(c.at) }; }); });
      },
      PROPS: function () {
        return cachedCall('supervisorList', {}, 300000).then(function (l) { return l.map(function (s) { return { id: s.id, title: s.name, sub: 'Ask for their props invoices', search: s.name }; }); });
      }
    };
    const help = { TRANSFER: 'Pick the transfers (past or present) you need an invoice for. The supervisor on each transfer is asked.', CHECKIN: 'Pick the check-ins you need an invoice for. The supervisor who did each one is asked.', PROPS: 'Pick the supervisors who bought props. Say what the invoices are for in the note.' };
    const show = function () {
      box.querySelector('#irHelp').textContent = help[kind];
      box.querySelector('#irNoteL').innerHTML = kind === 'PROPS' ? 'What for' : 'Note <span class="muted">(optional)</span>';
      Object.keys(chosen).forEach(function (k) { delete chosen[k]; }); count(); box.querySelector('#irSearch').value = '';
      if (lists[kind]) return paint();
      paint(); load[kind]().then(function (l) { lists[kind] = l; if (kind === this) paint(); }.bind(kind)).catch(function (e) { box.querySelector('#irList').textContent = 'Could not load the list. ' + (e && e.message || ''); });
    };
    box.querySelector('#irKind').addEventListener('change', function () { kind = box.querySelector('#irKind').value; show(); });
    box.querySelector('#irSearch').addEventListener('input', paint);
    show();
    box.querySelector('#irGo').addEventListener('click', function (e) {
      const ids = Object.keys(chosen).filter(function (k) { return chosen[k]; });
      const msg = box.querySelector('#irMsg');
      if (!ids.length) { msg.textContent = 'Tick at least one.'; msg.style.color = 'var(--bad)'; return; }
      busy(e.target, function () {
        const payload = { refType: kind, note: box.querySelector('#irNote').value, dueDate: box.querySelector('#irDue').value };
        if (kind === 'PROPS') payload.supervisorIds = ids; else payload.refIds = ids;
        return callBackend('requestInvoices', payload).then(function (r) {
          closeModal(); toast(r.created + ' request(s) sent' + (r.skipped.length ? ' · ' + r.skipped.length + ' skipped (' + r.skipped.slice(0, 2).map(function (s) { return s.transferId + ': ' + s.reason; }).join('; ') + (r.skipped.length > 2 ? '…' : '') + ')' : ''));
          go('invoices', true);
        }).catch(function (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; });
      });
    });
  });
}

// ---------- clicks ----------
document.addEventListener('click', function (e) {
  const t = e.target.closest('[data-inv-approve],[data-inv-reject],[data-inv-cancelreq],[data-inv-send],[data-inv-attach],[data-inv-for],[data-inv-retry],[data-inv-del]');
  if (!t) return;
  const d = t.dataset;
  if (d.invRetry) { const it = invOutbox.find(function (x) { return x.key === d.invRetry; }); if (it) { it.state = 'PENDING'; it.tries = 0; it.error = ''; invSave(it); invPaint(); invPump(); } return; }
  if (d.invDel) {
    if (!confirm('Delete this invoice from your phone? It has not been sent.')) return;
    invOutbox = invOutbox.filter(function (x) { return x.key !== d.invDel; }); LocalStore.del(d.invDel).catch(function () {}); invPaint(); return;
  }
  if (d.invSend) { return go('invoiceNew', false, { requestId: d.invSend, refType: d.rt, refId: d.rid }); }
  if (d.invAttach) { return go('invoiceNew', false, { refType: 'TRANSFER', refId: d.invAttach }); }
  if (d.invFor) { invFilter.refType = d.invFor === 'NONE' ? '' : d.invFor; return go('invoices', true); }
  if (d.invApprove) {
    return busy(t, function () { return callBackend('reviewInvoice', { invoiceId: d.invApprove, decision: 'APPROVE' }).then(function () { toast('Approved'); go(tab, true); }); });
  }
  if (d.invCancelreq) {
    return busy(t, function () { return callBackend('cancelInvoiceRequest', { requestId: d.invCancelreq }).then(function () { toast('Request cancelled'); go('invoices', true); }); });
  }
  if (d.invReject) {
    openModal('<div class="row spread"><h2>Send the invoice back</h2><button class="linkBtn" data-close>Close</button></div><p class="small muted">Say what is wrong. They are asked to send a better one.</p>' +
      '<textarea id="rjNote" maxlength="300" placeholder="e.g. the amount is not readable"></textarea><div class="row" style="margin-top:12px"><button class="btn" id="rjGo">Send back</button></div><div class="small" id="rjMsg" style="margin-top:8px"></div>', function (box) {
      box.querySelector('#rjGo').addEventListener('click', function (ev) {
        const note = box.querySelector('#rjNote').value.trim();
        if (!note) { box.querySelector('#rjMsg').textContent = 'Say what is wrong.'; box.querySelector('#rjMsg').style.color = 'var(--bad)'; return; }
        busy(ev.target, function () { return callBackend('reviewInvoice', { invoiceId: d.invReject, decision: 'REJECT', note: note }).then(function () { closeModal(); toast('Sent back'); go('invoices', true); }).catch(function (err) { box.querySelector('#rjMsg').textContent = err.message; box.querySelector('#rjMsg').style.color = 'var(--bad)'; }); });
      });
    });
  }
});
