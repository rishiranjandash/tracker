/**
 * Asset Tracker - frontend. Vanilla JS, no build step (GitHub Pages friendly).
 * Talks to Code.gs over JSONP (see apps-script/Code.gs for why). Photo upload is
 * the one POST (hidden form + postMessage).
 *
 * Test hooks (used by test/index.html only): window.MOCK_BACKEND(action, payload),
 * window.MOCK_UPLOAD(file), window.MOCK_EMAIL.
 */
'use strict';

// Dropdowns and timings come from the Options / Config sheets (action "options"), loaded after sign-in.
let OPTS = {
  issueTypes: { DEVICE: [], SD_CARD: [] }, subTypes: { DEVICE: [], SD_CARD: [] },
  ui: { pollSeconds: 45, pickerMax: 50, officeName: 'Office', confirmEveryHours: 4, recentHours: 24, assignBy: '10:00' }
};

let activeRole = ''; // which of their roles this person is acting as (remembered on this device)
try { activeRole = localStorage.getItem('at_role') || ''; } catch (e) { /* storage blocked: default role is used */ }
let idToken = null;
let me = null;          // home payload for the current user
let tab = null;
let pollTimer = null;
let supCache = null;

const $ = function (id) { return document.getElementById(id); };
function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
function pill(text, cls) { return '<span class="pill ' + (cls || '') + '">' + esc(text) + '</span>'; }
function catLabel(c) { return c === 'SD_CARD' ? 'SD card' : 'Device'; }

// ===================== TRANSPORT =====================

function callBackend(action, payload) {
  if (window.MOCK_BACKEND) {
    return Promise.resolve(window.MOCK_BACKEND(action, Object.assign({ asRole: activeRole }, payload || {}))).then(handleResult);
  }
  return new Promise(function (resolve, reject) {
    const cb = '__at_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;
    function cleanup() { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); }
    window[cb] = function (res) { if (done) return; done = true; cleanup(); resolve(res); };
    script.onerror = function () { if (done) return; done = true; cleanup(); reject(new Error('Could not reach the server. Check your connection.')); };
    const data = Object.assign({ googleIdToken: idToken, asRole: activeRole }, payload || {});
    script.src = CONFIG.APPS_SCRIPT_URL + '?action=' + encodeURIComponent(action) + '&callback=' + encodeURIComponent(cb) +
      '&data=' + encodeURIComponent(JSON.stringify(data)) + '&_=' + Date.now();
    document.body.appendChild(script);
  }).then(handleResult);
}

function handleResult(res) {
  if (res && res.ok) return res.data;
  if (res && res.code === 'AUTH') { signOut(); throw new Error('Session expired - please sign in again.'); }
  const err = new Error(res && res.error ? res.error : 'Something went wrong.');
  err.code = res && res.code;
  throw err;
}

// ===================== PHOTOS =====================

function resizeToBase64(file) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      const max = 1280, scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = function () { reject(new Error('That file is not a readable image.')); };
    img.src = url;
  });
}

function uploadPhoto(kind, refLabel, file) {
  if (window.MOCK_UPLOAD) return Promise.resolve(window.MOCK_UPLOAD(file));
  return resizeToBase64(file).then(function (b64) {
    return new Promise(function (resolve, reject) {
      const reqId = 'u' + Date.now() + Math.random().toString(36).slice(2);
      const iframe = document.createElement('iframe');
      iframe.name = 'up_' + reqId; iframe.style.display = 'none';
      const form = document.createElement('form');
      form.method = 'POST'; form.action = CONFIG.APPS_SCRIPT_URL; form.target = iframe.name; form.style.display = 'none';
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = 'payload';
      inp.value = JSON.stringify({ googleIdToken: idToken, kind: kind, refLabel: refLabel, mime: 'image/jpeg', base64: b64, requestId: reqId });
      form.appendChild(inp);
      let timer;
      function finish() { clearTimeout(timer); window.removeEventListener('message', onMsg); iframe.remove(); form.remove(); }
      function onMsg(e) {
        const m = e.data && e.data.assetTrackerUpload;
        if (!m || m.requestId !== reqId) return;
        if (!/googleusercontent\.com$/.test(new URL(e.origin).hostname)) return;
        finish();
        if (m.result && m.result.ok) resolve(m.result.data.fileId); else reject(new Error((m.result && m.result.error) || 'Photo upload failed.'));
      }
      window.addEventListener('message', onMsg);
      timer = setTimeout(function () { finish(); reject(new Error('Photo upload timed out. Try again on a better connection.')); }, 60000);
      document.body.appendChild(iframe); document.body.appendChild(form); form.submit();
    });
  });
}

function viewPhoto(fileId) {
  callBackend('photoGet', { fileId: fileId }).then(function (p) {
    openModal('<div class="row spread"><h2>Photo</h2><button class="linkBtn" data-close>Close</button></div><img class="photoThumb" alt="Attached photo" src="data:' + esc(p.mime) + ';base64,' + p.base64 + '">');
  }).catch(toastError);
}

function photoField(host, label) {
  host.innerHTML = '<label class="f">' + esc(label || 'Photo (optional)') + '</label><input type="file" accept="image/*" capture="environment" id="photoInput"><div class="small muted" id="photoName"></div>';
  const input = host.querySelector('input');
  return { file: function () { return input.files && input.files[0] ? input.files[0] : null; } };
}

// ===================== UI HELPERS =====================

function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg;
  $('toastHost').appendChild(el);
  setTimeout(function () { el.remove(); }, bad ? 6000 : 3000);
}
function toastError(e) { toast(e && e.message ? e.message : String(e), true); }

function openModal(html, onMount) {
  const host = $('modalHost');
  host.innerHTML = '<div class="modal"><div class="box">' + html + '</div></div>';
  host.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
  if (onMount) onMount(host.querySelector('.box'));
}
function closeModal() { $('modalHost').innerHTML = ''; }
function modalOpen() { return !!$('modalHost').firstChild; }

function busy(btn, fn) {
  btn.disabled = true;
  const old = btn.textContent;
  return Promise.resolve().then(fn).catch(toastError).then(function () { btn.disabled = false; btn.textContent = old; });
}

function emptyState(text) { return '<div class="empty">' + esc(text) + '</div>'; }

// Fixed bar at the bottom for actions on a multi-selection. Built once per view; barShow toggles it.
let barHandlers = {};
function barSet(html, handlers) {
  let el = $('actionBar');
  if (!el) { el = document.createElement('div'); el.id = 'actionBar'; el.className = 'actionbar hidden'; document.body.appendChild(el); }
  el.innerHTML = html; barHandlers = handlers || {};
  return el;
}
function barShow(on) { const el = $('actionBar'); if (el) el.classList.toggle('hidden', !on); }
function barClear() { const el = $('actionBar'); if (el) { el.innerHTML = ''; el.classList.add('hidden'); } barHandlers = {}; }

// ===================== PICKER (type to search, tick to select) =====================

/**
 * items: [{id, label, sub, badge, disabled}]. multi: tick several; otherwise single choice.
 * Renders at most 50 matches at a time so 1000+ assets stay fast on a phone.
 */
function createPicker(host, opts) {
  const selected = new Set(opts.selected || []);
  let items = opts.items;
  const searchHtml = '<input type="text" placeholder="' + esc(opts.placeholder || 'Type to search…') + '" autocomplete="off">';
  // opts.searchHost lets the caller pin the search box somewhere else (e.g. a sticky header).
  host.innerHTML = '<div class="picker">' + (opts.searchHost ? '' : '<div class="head">' + searchHtml + '</div>') + '<div class="list"></div></div><div class="chips"></div>';
  if (opts.searchHost) opts.searchHost.innerHTML = searchHtml;
  const input = (opts.searchHost || host).querySelector('input'), list = host.querySelector('.list'), chips = host.querySelector('.chips');

  function paint() {
    const q = input.value.trim().toLowerCase();
    const matches = items.filter(function (i) { return !q || (i.id + ' ' + i.label + ' ' + (i.sub || '')).toLowerCase().indexOf(q) !== -1; });
    const max = OPTS.ui.pickerMax || 50;
    list.innerHTML = matches.slice(0, max).map(function (i) {
      return '<label class="opt"' + (i.disabled ? ' style="opacity:.5"' : '') + '><input type="' + (opts.multi ? 'checkbox' : 'radio') + '" name="pick" value="' + esc(i.id) + '"' +
        (selected.has(i.id) ? ' checked' : '') + (i.disabled ? ' disabled' : '') + '><span class="grow"><b>' + esc(i.id) + '</b> ' + esc(i.label) +
        '<div class="small muted">' + esc(i.sub || '') + '</div></span>' + (i.badge || '') + '</label>';
    }).join('') + (matches.length > max ? '<div class="small muted" style="padding:8px">Showing ' + max + ' of ' + matches.length + ' - keep typing to narrow down.</div>' : '') +
      (!matches.length ? '<div class="small muted" style="padding:10px">No match. Use "Other" below if it is not in the list.</div>' : '');
    chips.innerHTML = opts.multi && selected.size
      ? Array.from(selected).map(function (id) { return '<span class="chip">' + esc(id) + ' ✕</span>'; }).join('') + ' <span class="small muted">' + selected.size + ' selected</span>'
      : '';
  }
  list.addEventListener('change', function (e) {
    const v = e.target.value;
    if (opts.multi) { if (e.target.checked) selected.add(v); else selected.delete(v); } else { selected.clear(); selected.add(v); }
    paint(); if (opts.onChange) opts.onChange(Array.from(selected));
  });
  chips.addEventListener('click', function (e) {
    const t = e.target.closest('.chip'); if (!t) return;
    selected.delete(t.textContent.replace(' ✕', '').trim()); paint(); if (opts.onChange) opts.onChange(Array.from(selected));
  });
  input.addEventListener('input', paint);
  paint();
  return {
    selected: function () { return Array.from(selected); },
    setItems: function (n) { items = n; paint(); },
    selectAll: function (ids) { ids.forEach(function (i) { selected.add(i); }); paint(); if (opts.onChange) opts.onChange(Array.from(selected)); },
    clear: function () { selected.clear(); paint(); }
  };
}

function assetPickerItems(list, mineOnly) {
  return list.filter(function (a) { return !mineOnly || a.mine; }).map(function (a) {
    const off = a.st !== 'AVAILABLE';
    return {
      id: a.id, label: (a.c === 'SD_CARD' ? 'SD card ' : '') + (a.t || ''), sub: a.h + ' · ' + a.loc,
      disabled: off, badge: off ? pill(a.st === 'SHORT' ? 'short' : 'in transit', 'warn') : ''
    };
  });
}

/** "Other" assets: not in the master list. Recorded provisional, flagged for an admin, never blocks movement. */
let otherSeq = 0;
function othersField(host) {
  const rows = [];
  host.innerHTML = '<h3>Not in the list?</h3><div id="othersRows"></div><button class="btn secondary small" type="button" id="addOther">+ Add an "Other" asset</button>';
  const wrap = host.querySelector('#othersRows');
  function addRow() {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = '<div class="fieldRow"><div><label class="f">Type</label><select><option value="DEVICE">Device</option><option value="SD_CARD">SD card</option></select></div>' +
      '<div><label class="f">Kind / model</label><input type="text" placeholder="e.g. Wristcam, 64GB" list="kinds_' + (++otherSeq) + '"><datalist id="kinds_' + otherSeq + '"></datalist></div></div>' +
      '<label class="f">What is it? (ID on it, where found…)</label><input type="text" class="desc"><div style="margin-top:8px"><button class="linkBtn" type="button">Remove</button></div>';
    div.querySelector('button').addEventListener('click', function () { rows.splice(rows.indexOf(div), 1); div.remove(); });
    const cat = div.querySelector('select'), dl = div.querySelector('datalist');
    const fillKinds = function () { dl.innerHTML = (OPTS.subTypes[cat.value] || []).map(function (k) { return '<option value="' + esc(k) + '">'; }).join(''); };
    cat.addEventListener('change', fillKinds); fillKinds();
    wrap.appendChild(div); rows.push(div);
  }
  host.querySelector('#addOther').addEventListener('click', addRow);
  return {
    values: function () {
      return rows.map(function (r) {
        return { category: r.querySelector('select').value, subType: r.querySelectorAll('input')[0].value, description: r.querySelector('.desc').value };
      });
    }
  };
}

// ===================== AUTH =====================

function initAuth() {
  if (window.MOCK_EMAIL !== undefined) { startSession(); return; }
  const wait = setInterval(function () {
    if (!window.google || !google.accounts || !google.accounts.id) return;
    clearInterval(wait);
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: function (r) { idToken = r.credential; startSession(); }
    });
    google.accounts.id.renderButton($('googleSignInButton'), { theme: 'outline', size: 'large' });
  }, 100);
}

function startSession() {
  $('signInError').textContent = '';
  callBackend('home').then(function (h) {
    me = h;
    return callBackend('options').then(function (o) { OPTS = o; return h; });
  }).then(function (h) {
    $('signedOut').classList.add('hidden');
    $('tabs').classList.remove('hidden'); $('view').classList.remove('hidden');
    $('bellBtn').classList.remove('hidden'); $('signOutBtn').classList.remove('hidden');
    activeRole = h.role; // the server may have fallen back from a stale remembered role
    // Only remember the choice for people who actually have a choice, so a single-role user on a shared device does not overwrite it.
    if (h.roles.length > 1) { try { localStorage.setItem('at_role', activeRole); } catch (e) { /* ignore */ } }
    $('userLabel').textContent = h.name + (h.roles.length > 1 ? '' : ' · ' + h.role.toLowerCase());
    const rs = $('roleSwitch');
    if (h.roles.length > 1) {
      rs.innerHTML = h.roles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === h.role ? ' selected' : '') + '>Acting as: ' + esc(r.charAt(0) + r.slice(1).toLowerCase()) + '</option>'; }).join('');
      rs.classList.remove('hidden');
    } else rs.classList.add('hidden');
    buildTabs(); setTopbarVar();
    go(me.role === 'SUPERVISOR' ? 'home' : 'dash');
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, (OPTS.ui.pollSeconds || CONFIG.POLL_SECONDS || 45) * 1000);
    updateBadge();
  }).catch(function (e) {
    $('signInError').textContent = e.message;
  });
}

function signOut() {
  idToken = null; me = null; clearInterval(pollTimer);
  $('signedOut').classList.remove('hidden');
  ['tabs', 'view', 'bellBtn', 'signOutBtn'].forEach(function (i) { $(i).classList.add('hidden'); });
  $('userLabel').textContent = ''; $('roleSwitch').classList.add('hidden');
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  if (window.onMockSignOut) window.onMockSignOut();
}

function updateBadge() {
  const b = $('bellBadge');
  if (me && me.unread > 0) { b.textContent = me.unread; b.classList.remove('hidden'); } else b.classList.add('hidden');
}

function poll() {
  if (!me || document.hidden) return;
  callBackend('home').then(function (h) {
    me = h; updateBadge();
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) !== -1;
    if (!modalOpen() && !typing && ['home', 'dash', 'transfers'].indexOf(tab) !== -1) go(tab, true);
  }).catch(function () { /* transient */ });
}

// ===================== NAV =====================

const TABS = {
  SUPERVISOR: [['home', 'Home'], ['team', 'Assign'], ['transfers', 'Transfers'], ['issue', 'Report issue'], ['search', 'Search']],
  ADMIN: [['dash', 'Dashboard'], ['transfers', 'Transfers'], ['flags', 'Needs attention'], ['issues', 'Issues'], ['assets', 'Assets'], ['sups', 'Supervisors'], ['search', 'Search'], ['reports', 'Reports']],
  OPS: [['dash', 'Dashboard'], ['flags', 'Needs attention'], ['issues', 'Issues'], ['search', 'Search'], ['reports', 'Reports']]
};
const PARENT_TAB = { newTransfer: 'transfers', checkin: 'home', alerts: null };

function buildTabs() {
  $('tabs').innerHTML = TABS[me.role].map(function (t) { return '<button data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('');
}

function go(t, keepScroll, arg) {
  if (tab === 'team' && teamDirty && t !== 'team' && !confirm('You have unsaved assignment changes. Leave without saving?')) return;
  teamDirty = false;
  setTopbarVar(); // the bar is taller once signed in (user label, alerts)
  tab = t; barClear();
  const hl = PARENT_TAB[t] !== undefined ? PARENT_TAB[t] : t;
  $('tabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === hl); });
  if (!keepScroll) window.scrollTo(0, 0);
  const v = VIEWS[t];
  Promise.resolve(v(arg)).catch(function (e) { $('view').innerHTML = '<div class="card"><div class="muted">' + esc(e.message) + '</div></div>'; });
}

function refreshHome() { return callBackend('home').then(function (h) { me = h; updateBadge(); return h; }); }

// ===================== VIEWS =====================

const VIEWS = {};

// ---- Supervisor home ----
let homeSel = new Set();

VIEWS.home = function () {
  return refreshHome().then(function (h) {
    const devs = h.assets.filter(function (a) { return a.category === 'DEVICE'; });
    const sds = h.assets.filter(function (a) { return a.category === 'SD_CARD'; });
    const existing = {}; h.assets.forEach(function (a) { existing[a.id] = true; });
    homeSel.forEach(function (id) { if (!existing[id]) homeSel.delete(id); });
    let html = '';
    if (h.checkin) {
      html += '<div class="banner ' + (h.checkin.overdue ? 'bad' : 'warn') + '"><div class="grow"><b>' + (h.checkin.overdue ? 'Check-in overdue' : 'Check-in needed') +
        '</b><div class="small">You moved to ' + esc(h.checkin.location) + '. List the assets you hold so we can match them to our records. You can keep working meanwhile.</div></div>' +
        '<button class="btn" data-act="checkin">Check in now</button></div>';
    }
    if (h.team && (h.team.dueConfirm || h.team.assignAlert)) {
      html += '<div class="banner warn"><div class="grow"><b>Assignments need attention</b><div class="small">' +
        (h.team.assignAlert ? h.team.unassignedDevices + ' device(s) not assigned to anyone yet. ' : '') +
        (h.team.dueConfirm ? h.team.dueConfirm + ' assignment(s) not confirmed for ' + OPTS.ui.confirmEveryHours + '+ hours.' : '') + '</div></div><button class="btn" data-go="team">Open Assign</button></div>';
    }
    html += '<div class="card"><div class="row spread"><div><div class="muted small">You are at</div><h2 style="font-size:20px;margin:0">' + esc(h.locationName) + '</h2></div>' +
      '<div class="row"><button class="btn" data-act="send">Send assets</button><button class="btn secondary" data-act="issue">Report issue</button></div></div>' +
      '<div class="row" style="margin-top:10px">' + pill(devs.length + ' devices here', 'info') + pill(sds.length + ' SD cards here', 'info') +
      (devs.some(function (a) { return a.status !== 'WORKING'; }) ? pill('faulty devices', 'bad') : '') + '</div></div>';
    html += '<div class="card"><h2 style="margin:0">Assets at this property</h2>' +
      '<p class="small muted" style="margin:6px 0">Tap a device for its actions. Tick several to report an issue, send or assign them together.</p>' +
      '<div class="stickyHead"><div class="row"><input type="text" id="assetFilter" placeholder="Filter by ID, type or holder…" class="grow"><button class="linkBtn" id="selShown">Select all shown</button><button class="linkBtn" id="selNone">Clear</button></div></div>' +
      '<div id="assetList"></div></div>';
    $('view').innerHTML = html;

    const visible = function () {
      const q = $('assetFilter').value.trim().toLowerCase();
      return h.assets.filter(function (a) { return (!q || (a.id + ' ' + a.subType + ' ' + a.holder + ' ' + a.category + ' ' + a.assignedTo).toLowerCase().indexOf(q) !== -1); });
    };
    const updateBar = function () {
      $('barCount') && ($('barCount').textContent = homeSel.size + ' selected');
      barShow(homeSel.size > 0);
    };
    const paintList = function () {
      const m = visible();
      $('assetList').innerHTML = m.length ? m.slice(0, 200).map(function (a) {
        return '<div class="item"><label class="selbox"><input type="checkbox" data-sel="' + esc(a.id) + '"' + (homeSel.has(a.id) ? ' checked' : '') + '></label>' +
          '<div class="grow" data-menu="' + esc(a.id) + '" style="cursor:pointer"><div class="t">' + esc(a.id) + ' <span class="muted">' + esc(catLabel(a.category)) + ' ' + esc(a.subType) + '</span></div>' +
          '<div class="small muted">' + esc(a.holder) + (a.assignedTo ? ' · with ' + esc(a.assignedTo) : '') + '</div></div>' +
          (a.provisional ? pill('awaiting admin', 'prov') : '') + (a.status !== 'WORKING' ? pill(a.status.toLowerCase(), 'bad') : '') + (a.state !== 'AVAILABLE' ? pill(a.state.toLowerCase().replace('_', ' '), 'warn') : '') + '</div>';
      }).join('') : emptyState(h.assets.length ? 'No match.' : 'No assets recorded at this property.');
    };
    barSet('<span id="barCount" class="grow"></span><button class="btn small" data-bar="issue">Report issue</button><button class="btn small" data-bar="send">Send</button>' +
      '<button class="btn small" data-bar="assign">Assign</button><button class="btn secondary small" data-bar="clear">Clear</button>', {
      issue: function () { go('issue', false, Array.from(homeSel)); },
      send: function () { go('newTransfer', false, Array.from(homeSel)); },
      assign: function () { go('team', false, Array.from(homeSel)); },
      clear: function () { homeSel.clear(); paintList(); updateBar(); }
    });
    $('assetFilter').addEventListener('input', paintList);
    $('assetList').addEventListener('change', function (e) {
      const id = e.target.dataset.sel; if (!id) return;
      if (e.target.checked) homeSel.add(id); else homeSel.delete(id);
      updateBar();
    });
    $('assetList').addEventListener('click', function (e) {
      const m = e.target.closest('[data-menu]'); if (m) openAssetMenu(m.dataset.menu);
    });
    $('selShown').addEventListener('click', function () { visible().forEach(function (a) { homeSel.add(a.id); }); paintList(); updateBar(); });
    $('selNone').addEventListener('click', function () { homeSel.clear(); paintList(); updateBar(); });
    paintList(); updateBar();
  });
};

/** Tap a device: everything the supervisor can do with it, in one place. */
function openAssetMenu(id) {
  const a = me.assets.find(function (x) { return x.id === id; });
  if (!a) return;
  const free = a.state === 'AVAILABLE';
  const canAssign = free && a.status === 'WORKING';
  openModal('<div class="row spread"><h2>' + esc(a.id) + ' <span class="muted" style="font-size:14px">' + esc(catLabel(a.category)) + ' ' + esc(a.subType) + '</span></h2><button class="linkBtn" data-close>Close</button></div>' +
    '<div class="row">' + pill(a.status.toLowerCase(), a.status === 'WORKING' ? 'ok' : 'bad') + (a.state !== 'AVAILABLE' ? pill(a.state.toLowerCase().replace('_', ' '), 'warn') : '') + (a.provisional ? pill('awaiting admin', 'prov') : '') + '</div>' +
    '<p class="small muted">' + esc(a.holder) + (a.assignedTo ? ' · using it today: ' + esc(a.assignedTo) : '') + '</p>' +
    '<div class="menu"><button class="btn" data-m="issue">Report an issue</button>' +
    '<button class="btn secondary" data-m="send"' + (free ? '' : ' disabled') + '>Send / put in transit</button>' +
    '<button class="btn secondary" data-m="assign"' + (canAssign ? '' : ' disabled') + '>Assign to a worker</button>' +
    '<button class="btn secondary" data-m="history">View full history</button>' +
    '<button class="linkBtn" data-m="leave"' + (free ? '' : ' disabled') + '>Leave at this property with no holder</button></div>' +
    (free ? '' : '<p class="small muted">It is ' + esc(a.state.toLowerCase().replace('_', ' ')) + ', so it cannot be sent or assigned right now.</p>'), function (box) {
    box.querySelectorAll('[data-m]').forEach(function (b) {
      b.addEventListener('click', function () {
        const m = b.dataset.m;
        if (m === 'issue') { closeModal(); go('issue', false, [id]); }
        else if (m === 'send') { closeModal(); go('newTransfer', false, [id]); }
        else if (m === 'assign') { closeModal(); go('team', false, [id]); }
        else if (m === 'history') { closeModal(); go('search', false, id); }
        else if (m === 'leave') {
          if (!confirm('Leave ' + id + ' here with nobody holding it? An admin will be alerted.')) return;
          busy(b, function () { return callBackend('leaveAtProperty', { assetIds: [id] }).then(function () { closeModal(); toast(id + ' left at property - admin alerted'); go('home', true); }); });
        }
      });
    });
  });
}

// ---- Dashboard (admin / ops) ----
VIEWS.dash = function () {
  return refreshHome().then(function (h) {
    const d = h.dashboard;
    const tile = function (n, l, cls, target) { return '<div class="tile ' + (cls || '') + '" data-go="' + target + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    let html = '<div class="tiles">' +
      tile(d.inTransit, 'Assets in transit', d.inTransit ? 'warn' : '', 'transfers') +
      tile(h.flagCounts.total, 'Need attention' + (h.flagCounts.high ? ' (' + h.flagCounts.high + ' urgent)' : ''), h.flagCounts.high ? 'bad' : (h.flagCounts.total ? 'warn' : ''), 'flags') +
      tile(h.openIssues, 'Open issues', '', 'issues') +
      tile(h.provisional, 'Awaiting acknowledgement', h.provisional ? 'warn' : '', 'flags') +
      tile(h.overdueCheckins, 'Overdue check-ins', h.overdueCheckins ? 'warn' : '', 'flags') +
      tile(d.office.devices + ' / ' + d.office.sdCards, 'Office stock (devices / SD)', '', 'search') + '</div>';
    html += '<div class="card"><h2>Properties: working devices vs workforce today</h2><div class="tablewrap"><table><thead><tr><th>Property</th><th>Supervisor</th>' +
      '<th class="num">Workforce</th><th class="num">Working devices</th><th class="num">Needed</th><th>Device gap</th><th class="num">Faulty</th><th class="num">SD cards</th><th class="num">SD needed</th><th>SD gap</th></tr></thead><tbody>' +
      d.properties.map(function (p) {
        const g = function (n) { return n < 0 ? '<span class="gap-neg">Short ' + (-n) + '</span>' : n > 0 ? '<span class="gap-pos">Surplus ' + n + '</span>' : 'OK'; };
        return '<tr><td><b>' + esc(p.name) + '</b><div class="small muted">' + esc(p.locationId) + '</div></td><td>' + esc(p.supervisors.join(', ') || '-') + '</td><td class="num">' + p.workforce +
          '</td><td class="num">' + p.devicesWorking + '</td><td class="num">' + p.devicesRequired + '</td><td>' + g(p.deviceGap) + '</td><td class="num">' + p.devicesFaulty +
          '</td><td class="num">' + p.sdCards + '</td><td class="num">' + p.sdRequired + '</td><td>' + g(p.sdGap) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (d.unlocated ? '<p class="small muted">' + d.unlocated + ' asset(s) are with a supervisor whose location is not known yet, or at a property that is not in the list.</p>' : '') +
      '<p class="small muted">Workforce is today\'s attendance by Location ID. Only working devices count towards the requirement. ' + (me.role === 'ADMIN' ? '<button class="linkBtn" data-refreshcfg>Refresh settings</button> (settings are cached for a couple of minutes)' : '') + '</p></div>';
    $('view').innerHTML = html;
  });
};

// ---- Assign devices / SD cards to workers (supervisor) ----
function agoLabel(iso) {
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d';
}

let teamDirty = false; // unsaved changes on the Assign screen

/**
 * Assign screen. Two kinds of thing are handed out, so the screen is one card per worker with two slots:
 * Device and SD cards. Type an ID (or its last digits) and press Enter, or tap "+ next free".
 * Edits are held on the page and highlighted; the bottom bar saves them all in one call.
 */
VIEWS.team = function (preselect) {
  teamDirty = false;
  return callBackend('team').then(function (t) {
    const s = t.summary;
    let html = '<div class="row spread" style="margin-bottom:12px"><h2 style="margin:0">Assign · ' + esc(t.locationName) + '</h2></div>';
    if (s.assignAlert) html += '<div class="banner warn"><div class="grow"><b>' + s.unassignedDevices + ' device(s) not assigned yet</b><div class="small">Give them to today’s workers below. (Expected by ' + esc(t.assignBy) + '.)</div></div></div>';
    if (s.dueConfirm) html += '<div class="banner info"><div class="grow"><b>' + s.dueConfirm + ' assignment(s) not confirmed for ' + OPTS.ui.confirmEveryHours + '+ hours</b><div class="small">If nothing changed, one tap keeps them with the same people. They stay assigned either way until you change them, they go faulty, or they are sent.</div></div><button class="btn" data-confirmall>Still with same people</button></div>';
    html += '<div class="stickyHead flat" id="gridHead"><div class="row"><input type="text" id="wFilter" placeholder="Find a worker…" style="max-width:220px">' +
      '<button class="btn secondary small" id="clearDev">Take all devices off</button><button class="btn secondary small" id="clearSd">Take all SD cards off</button></div>' +
      '<div class="small muted" id="freeLine" style="margin-top:6px"></div></div>' +
      '<div id="preBanner"></div><div id="wkGrid" class="wkgrid"></div>' +
      '<datalist id="dl_DEVICE"></datalist><datalist id="dl_SD_CARD"></datalist>' +
      '<p class="small muted">Typing an item that is already with someone else moves it to this worker when you save. Assignments end automatically before the next shift starts.</p>';
    $('view').innerHTML = html;
    wireGrid(t, Array.isArray(preselect) ? preselect : []);
  });
};

function wireGrid(t, preselect) {
  const CATS = ['DEVICE', 'SD_CARD'];
  const target = { DEVICE: OPTS.ui.devicesPerWorker || 1, SD_CARD: OPTS.ui.sdPerWorker || 3 };
  const info = {}; t.assignable.forEach(function (a) { info[a.id] = { id: a.id, category: a.category, subType: a.subType, was: a.assignedTo }; });
  const owner = {}, cells = {}, order = [], names = {};
  t.workers.forEach(function (w) {
    names[w.userId] = w; order.push(w.userId);
    cells[w.userId] = { DEVICE: [], SD_CARD: [] };
    w.items.forEach(function (i) {
      owner[i.assetId] = w.userId;
      if (!info[i.assetId]) info[i.assetId] = { id: i.assetId, category: i.category, subType: i.subType, was: w.name };
      (cells[w.userId][i.category] = cells[w.userId][i.category] || []).push(i.assetId);
    });
  });
  const baseline = JSON.parse(JSON.stringify(cells));
  const natural = function (x, y) { return x.localeCompare(y, undefined, { numeric: true }); };
  let pre = preselect.filter(function (id) { return info[id]; });
  let focusKey = '';

  const placedBy = function (id) { for (const w of order) for (const c of CATS) if (cells[w][c].indexOf(id) !== -1) return w; return ''; };
  const freeItems = function (cat) {
    return Object.keys(info).filter(function (id) { return info[id].category === cat && !owner[id] && !placedBy(id); }).sort(natural);
  };
  const place = function (w, cat, id) {
    const from = placedBy(id);
    if (from === w) return false;
    if (from) CATS.forEach(function (c) { cells[from][c] = cells[from][c].filter(function (x) { return x !== id; }); });
    cells[w][cat].push(id); cells[w][cat].sort(natural);
    return true;
  };
  const resolve = function (txt, cat) {
    const q = String(txt || '').trim().toUpperCase();
    if (!q) return { err: '' };
    const all = Object.keys(info);
    const exact = all.find(function (id) { return id.toUpperCase() === q; });
    if (exact) return info[exact].category === cat ? { id: exact } : { err: exact + ' is ' + (info[exact].category === 'SD_CARD' ? 'an SD card' : 'a device') + ' - type it in the ' + (info[exact].category === 'SD_CARD' ? 'SD cards' : 'Device') + ' box.' };
    const m = all.filter(function (id) { return info[id].category === cat && id.toUpperCase().indexOf(q) !== -1; });
    if (m.length === 1) return { id: m[0] };
    return { err: m.length ? '"' + txt + '" matches ' + m.length + ' items - type more of the ID.' : 'No ' + (cat === 'SD_CARD' ? 'SD card' : 'device') + ' "' + txt + '" with you.' };
  };

  const diff = function () {
    const pairs = [], removed = [];
    let added = 0, moved = 0;
    order.forEach(function (w) { CATS.forEach(function (c) { cells[w][c].forEach(function (id) {
      if (owner[id] !== w) { pairs.push({ workerId: w, assetId: id }); if (owner[id]) moved++; else added++; }
    }); }); });
    Object.keys(owner).forEach(function (id) { if (!placedBy(id)) removed.push(id); });
    return { pairs: pairs, removed: removed, added: added, moved: moved };
  };

  const chip = function (w, id) {
    const i = info[id] || { subType: '', category: '' };
    const isNew = owner[id] !== w;
    return '<span class="chip' + (isNew ? ' new' : '') + '" title="' + (isNew ? (owner[id] ? 'moved here from ' + esc((names[owner[id]] || {}).name) : 'new') : 'unchanged') + '">' +
      esc(id) + ' <span class="small">' + esc(i.subType || '') + '</span>' + (isNew ? ' <span class="small">' + (owner[id] ? 'moved' : 'new') + '</span>' : '') +
      ' <a href="#" data-rm="' + esc(w + '|' + id) + '" title="Take off">✕</a></span>';
  };
  const ghost = function (w, cat) {
    return baseline[w][cat].filter(function (id) { return !placedBy(id); }).map(function (id) {
      return '<span class="chip gone">' + esc(id) + ' <span class="small">removed</span> <a href="#" data-undo="' + esc(w + '|' + id) + '">undo</a></span>';
    }).join(' ');
  };

  const slot = function (w, cat, canEdit) {
    const n = cells[w][cat].length, goal = target[cat];
    return '<div class="slot"><div class="row spread"><b>' + (cat === 'SD_CARD' ? 'SD cards' : 'Device') + '</b><span class="count ' + (n >= goal ? 'ok' : 'warn') + '">' + n + ' / ' + goal + '</span></div>' +
      '<div class="chips">' + cells[w][cat].map(function (id) { return chip(w, id); }).join(' ') + ghost(w, cat) + (n ? '' : '<span class="small muted">none</span>') + '</div>' +
      (canEdit ? '<div class="row"><input type="text" list="dl_' + cat + '" placeholder="Type ID…" data-in="' + esc(w + '|' + cat) + '" autocomplete="off" style="max-width:150px">' +
        '<button class="btn secondary small" data-next="' + esc(w + '|' + cat) + '">+ next free</button></div>' : '') + '</div>';
  };

  const paint = function () {
    const q = $('wFilter').value.trim().toLowerCase();
    const list = order.filter(function (id) { return !q || (names[id].name + ' ' + id).toLowerCase().indexOf(q) !== -1; });
    $('wkGrid').innerHTML = list.length ? list.map(function (id) {
      const w = names[id], ids = CATS.reduce(function (acc, c) { return acc.concat(baseline[id][c]); }, []).join(',');
      return '<div class="wk' + (w.present ? '' : ' absent') + '"><div class="row spread"><div><b>' + esc(w.name) + '</b> <span class="small muted">' + esc(w.shift || '') + '</span>' +
        (w.present ? '' : ' ' + pill('not marked present today', 'warn')) + '</div>' +
        (ids ? '<button class="linkBtn" data-confirmitems="' + esc(ids) + '">Still with them</button>' : '') + '</div>' +
        slot(id, 'DEVICE', w.present) + slot(id, 'SD_CARD', w.present) +
        (pre.length && w.present ? '<button class="btn small" data-give="' + esc(id) + '" style="margin-top:8px">Give the ' + pre.length + ' selected here</button>' : '') + '</div>';
    }).join('') : emptyState(t.workers.length ? 'No worker matches.' : 'No workers are marked present at your property yet today.');
    ['DEVICE', 'SD_CARD'].forEach(function (c) {
      $('dl_' + c).innerHTML = Object.keys(info).filter(function (id) { return info[id].category === c; }).sort(natural).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc((info[id].subType || '') + (info[id].was ? ' - now with ' + info[id].was : placedBy(id) ? ' - placed' : ' - free')) + '</option>';
      }).join('');
    });
    $('freeLine').textContent = 'Free with you: ' + freeItems('DEVICE').length + ' device(s), ' + freeItems('SD_CARD').length + ' SD card(s). Yellow counts mean a worker has fewer than the usual amount.';
    $('preBanner').innerHTML = pre.length ? '<div class="banner info"><div class="grow"><b>' + pre.length + ' item(s) picked on Home:</b> ' + pre.map(esc).join(', ') + '<div class="small">Tap “Give the selected here” on a worker.</div></div></div>' : '';
    const d = diff(), n = d.pairs.length + d.removed.length;
    teamDirty = n > 0;
    $('barCount') && ($('barCount').textContent = d.added + ' new · ' + d.moved + ' moved · ' + d.removed.length + ' removed');
    barShow(n > 0);
    if (focusKey) { const el = document.querySelector('[data-in="' + focusKey + '"]'); if (el) el.focus(); }
  };

  barSet('<span id="barCount" class="grow"></span><button class="btn small" data-bar="save">Save changes</button><button class="btn secondary small" data-bar="reset">Discard</button>', {
    save: function () {
      const d = diff();
      callBackend('assignMany', { pairs: d.pairs, remove: d.removed }).then(function (r) {
        teamDirty = false; homeSel.clear();
        toast(r.assigned + ' assigned' + (r.changed ? ', ' + r.changed + ' moved' : '') + (r.removed ? ', ' + r.removed + ' removed' : '') + (r.unchanged ? ', ' + r.unchanged + ' unchanged' : ''));
        go('team', true);
      }).catch(toastError);
    },
    reset: function () { teamDirty = false; go('team', true); }
  });

  const add = function (w, cat, id) {
    const from = placedBy(id) || owner[id];
    if (place(w, cat, id) && from && from !== w) toast(id + ' moved from ' + (names[from] || {}).name);
  };

  const grid = $('wkGrid');
  grid.addEventListener('keydown', function (e) {
    const el = e.target.closest('[data-in]');
    if (!el || e.key !== 'Enter') return;
    e.preventDefault();
    const p = el.dataset.in.split('|'), r = resolve(el.value, p[1]);
    if (r.err) return r.err ? toast(r.err, true) : null;
    focusKey = el.dataset.in; add(p[0], p[1], r.id); paint();
  });
  grid.addEventListener('change', function (e) {
    const el = e.target.closest('[data-in]');
    if (!el || !el.value.trim()) return;
    const p = el.dataset.in.split('|'), r = resolve(el.value, p[1]);
    if (r.err) { toast(r.err, true); return; }
    focusKey = ''; add(p[0], p[1], r.id); paint();
  });
  grid.addEventListener('click', function (e) {
    const rm = e.target.closest('[data-rm]'), un = e.target.closest('[data-undo]'), nx = e.target.closest('[data-next]'), gv = e.target.closest('[data-give]');
    if (rm) {
      e.preventDefault(); const p = rm.dataset.rm.split('|');
      CATS.forEach(function (c) { cells[p[0]][c] = cells[p[0]][c].filter(function (x) { return x !== p[1]; }); }); paint();
    } else if (un) {
      e.preventDefault(); const p = un.dataset.undo.split('|');
      add(p[0], info[p[1]].category, p[1]); paint();
    } else if (nx) {
      const p = nx.dataset.next.split('|'), free = freeItems(p[1]);
      if (!free.length) return toast('No free ' + (p[1] === 'SD_CARD' ? 'SD cards' : 'devices') + ' left.', true);
      focusKey = ''; add(p[0], p[1], free[0]); paint();
    } else if (gv) {
      pre.forEach(function (id) { add(gv.dataset.give, info[id].category, id); });
      pre = []; paint();
    }
  });
  $('wFilter').addEventListener('input', paint);
  // Staged like every other edit: nothing changes until Save, and each chip can be undone.
  const clearAll = function (cat) {
    let n = 0;
    order.forEach(function (w) { n += cells[w][cat].length; cells[w][cat] = []; });
    paint();
    toast(n ? 'Took ' + n + (cat === 'SD_CARD' ? ' SD card(s)' : ' device(s)') + ' off - press Save changes to apply' : 'None assigned.', !n);
  };
  $('clearDev').addEventListener('click', function () {
    const n = order.reduce(function (c, w) { return c + cells[w].DEVICE.length; }, 0);
    if (n && !confirm('Take all ' + n + ' device(s) off every worker? (Nothing is saved until you press Save changes.)')) return;
    clearAll('DEVICE');
  });
  $('clearSd').addEventListener('click', function () {
    const n = order.reduce(function (c, w) { return c + cells[w].SD_CARD.length; }, 0);
    if (n && !confirm('Take all ' + n + ' SD card(s) off every worker? (Nothing is saved until you press Save changes.)')) return;
    clearAll('SD_CARD');
  });
  paint();
}

// ---- Transfers ----
function canReceive(t) {
  if (me.role === 'ADMIN') return true;
  return me.role === 'SUPERVISOR' && t.toType === 'SUPERVISOR' && t.toId === me.supervisorId;
}

function transferCard(t) {
  const short = t.items.filter(function (i) { return i.status === 'SHORT'; });
  const statusPill = t.status === 'IN_TRANSIT' ? pill('In transit', 'info') : t.status === 'PARTIAL' ? pill('SHORT RECEIPT', 'bad') : t.status === 'RECEIVED' ? pill('Received', 'ok') : pill(t.status, '');
  let html = '<div class="card' + (t.status === 'PARTIAL' ? ' flag HIGH' : '') + '"><div class="row spread"><div><b>' + esc(t.id) + '</b> · ' + esc(t.from) + ' → ' + esc(t.to) +
    '<div class="small muted">' + esc(t.fromLocation) + ' · sent ' + fmt(t.createdAt) + ' by ' + esc(t.sentBy) + (t.receivedAt ? ' · received ' + fmt(t.receivedAt) + ' by ' + esc(t.receivedBy) : '') + '</div></div>' + statusPill + '</div>';
  if (short.length) {
    html += '<div class="banner bad" style="margin-top:10px"><div class="grow"><b>Not received (' + short.length + ' of ' + t.items.length + '):</b> ' + short.map(function (i) { return esc(i.assetId); }).join(', ') +
      '<div class="small">Still recorded with the sender until an admin resolves it.</div></div></div>';
  }
  html += '<div class="chips">' + t.items.map(function (i) {
    return '<span class="chip"' + (i.status === 'SHORT' ? ' style="background:var(--bad-bg);color:var(--bad)"' : i.status === 'RECEIVED' ? ' style="background:var(--ok-bg);color:var(--ok)"' : '') + '>' + esc(i.assetId) + '</span>';
  }).join('') + '</div>';
  if (t.note) html += '<div class="small">Note: ' + esc(t.note) + '</div>';
  html += '<div class="row" style="margin-top:8px">';
  if (t.status === 'IN_TRANSIT' && canReceive(t)) html += '<button class="btn small" data-receive="' + esc(t.id) + '">Confirm receipt</button>';
  if (t.status === 'IN_TRANSIT' && (me.role === 'ADMIN' || t.sentBy === me.name)) html += '<button class="btn secondary small" data-cancel="' + esc(t.id) + '">Cancel</button>';
  if (t.photoFileId) html += '<button class="btn secondary small" data-photo="' + esc(t.photoFileId) + '">View photo</button>';
  return html + '</div></div>';
}

VIEWS.transfers = function () {
  return refreshHome().then(function (h) {
    me = h;
    const list = h.transfers;
    const mineIncoming = list.filter(function (t) { return t.status === 'IN_TRANSIT' && canReceive(t); });
    const rest = list.filter(function (t) { return mineIncoming.indexOf(t) === -1; });
    let html = '<div class="stickyHead flat"><div class="row spread"><h2 style="margin:0">Transfers</h2><button class="btn" data-act="send">' +
      (me.role === 'ADMIN' ? 'Dispatch to supervisor' : 'Send assets') + '</button></div></div>';
    if (mineIncoming.length) html += '<h3>' + (me.role === 'ADMIN' ? 'In transit - waiting for you to confirm' : 'Coming to you') + '</h3>' + mineIncoming.map(transferCard).join('');
    if (rest.length) html += '<h3>' + (me.role === 'SUPERVISOR' ? 'Sent by you / recently received' : 'Other open transfers') + '</h3>' + rest.map(transferCard).join('');
    if (!list.length) html += '<div class="card">' + emptyState('Nothing in transit.') + '</div>';
    if (me.role === 'SUPERVISOR') html += '<p class="small muted">Received transfers stay visible for ' + OPTS.ui.recentHours + ' hours.</p>';
    $('view').innerHTML = html;
  });
};

function openReceive(transferId) {
  const t = me.transfers.find(function (x) { return x.id === transferId; });
  const items = t.items.filter(function (i) { return i.status === 'IN_TRANSIT'; });
  openModal('<div class="row spread"><h2>Confirm receipt · ' + esc(t.id) + '</h2><button class="linkBtn" data-close>Close</button></div>' +
    '<p class="small muted">Tick only what you physically received from ' + esc(t.from) + '. Anything left unticked is flagged as short.</p>' +
    '<div class="row recvHead"><button class="btn secondary small" id="tickAll">Tick all</button><span id="tally" class="small muted"></span></div><div id="recvList"></div>' +
    '<div class="row recvFoot"><button class="btn" id="confirmRecv">Confirm receipt</button></div>', function (box) {
    const list = box.querySelector('#recvList');
    list.innerHTML = items.map(function (i) {
      return '<label class="item" style="cursor:pointer"><input type="checkbox" value="' + esc(i.assetId) + '" style="width:20px;height:20px"><div class="grow"><b>' + esc(i.assetId) + '</b> <span class="muted">' + esc(catLabel(i.category)) + '</span></div></label>';
    }).join('');
    const tally = function () {
      const n = list.querySelectorAll('input:checked').length;
      box.querySelector('#tally').innerHTML = n + ' of ' + items.length + ' ticked' + (n < items.length ? ' · <b style="color:var(--bad)">' + (items.length - n) + ' will be flagged short</b>' : '');
      box.querySelector('#confirmRecv').textContent = n ? 'Confirm receipt' : 'Nothing arrived';
    };
    list.addEventListener('change', tally);
    box.querySelector('#tickAll').addEventListener('click', function () { list.querySelectorAll('input').forEach(function (c) { c.checked = true; }); tally(); });
    tally();
    box.querySelector('#confirmRecv').addEventListener('click', function (e) {
      const ids = Array.from(list.querySelectorAll('input:checked')).map(function (c) { return c.value; });
      if (ids.length < items.length && !confirm((items.length - ids.length) + ' item(s) will be flagged as NOT received. Continue?')) return;
      busy(e.target, function () {
        return callBackend('receiveTransfer', { transferId: t.id, receivedIds: ids, noneArrived: ids.length === 0 }).then(function (r) {
          closeModal(); toast(r.short ? r.received + ' received, ' + r.short + ' flagged short' : 'All ' + r.received + ' received'); go('transfers', true);
        });
      });
    });
  });
}

// ---- New transfer / dispatch ----
VIEWS.newTransfer = function (preselect) {
  const isAdmin = me.role === 'ADMIN';
  $('view').innerHTML = '<div class="card"><div class="row spread"><h2>' + (isAdmin ? 'Dispatch to a supervisor' : 'Send assets') + '</h2><button class="linkBtn" data-go="transfers">Back</button></div>' +
    '<div class="stickyHead">' + (isAdmin ? '<label class="f">Supervisor receiving</label><select id="toSup"><option value="">Choose…</option></select>'
      : '<label class="f">Send to</label><select id="toSup"><option value="OFFICE">' + esc(OPTS.ui.officeName) + '</option></select>') +
    '<label class="f">Assets (type to search, tick to add)</label><div id="sendSearch"></div>' +
    (isAdmin ? '<label class="f" style="margin-bottom:0"><input type="checkbox" id="showAll"> Include assets the records show elsewhere (flagged for review)</label>' : '<div class="small muted">Devices and SD cards at your property are listed, yours first.</div>') + '</div>' +
    '<div id="pickHost"></div>' +
    '<div id="othersHost"></div><label class="f">Note (optional)</label><textarea id="note"></textarea><div id="photoHost"></div>' +
    '<div class="row" style="margin-top:14px"><button class="btn" id="submitTransfer">' + (isAdmin ? 'Mark as dispatched' : 'Mark as sent') + '</button></div>' +
    '<p class="small muted">Assets stay with you and show as "in transit" until the receiver confirms what arrived.</p></div>';
  const others = othersField($('othersHost')), photo = photoField($('photoHost'), 'Photo of the package / contents (optional)');
  return Promise.all([callBackend('picker'), callBackend('supervisorList')]).then(function (r) {
    const all = r[0];
    $('toSup').innerHTML += r[1].map(function (s) { return '<option value="' + esc(s.id) + '">' + (isAdmin ? '' : 'Supervisor: ') + esc(s.name) + ' (' + esc(s.location) + ')</option>'; }).join('');
    const pre = Array.isArray(preselect) ? preselect : [];
    const mineIds = {}; all.forEach(function (a) { if (a.mine) mineIds[a.id] = true; });
    const outsideMine = pre.some(function (id) { return !mineIds[id]; });
    if (outsideMine && $('showAll')) $('showAll').checked = true;
    const picker = createPicker($('pickHost'), { searchHost: $('sendSearch'), items: assetPickerItems(all, isAdmin && !outsideMine), multi: true, placeholder: 'Search by ID or type…', selected: pre });
    if ($('showAll')) $('showAll').addEventListener('change', function () { picker.setItems(assetPickerItems(all, !$('showAll').checked)); });
    $('submitTransfer').addEventListener('click', function (e) {
      const ids = picker.selected(), oth = others.values();
      if (!ids.length && !oth.length) return toast('Select at least one asset.', true);
      if (!$('toSup').value) return toast('Choose where the assets are going.', true);
      const dest = $('toSup').value, toOffice = dest === 'OFFICE';
      busy(e.target, function () {
        const f = photo.file();
        return (f ? uploadPhoto('transfer', 'transfer', f) : Promise.resolve('')).then(function (fid) {
          return callBackend('createTransfer', { toType: toOffice ? 'OFFICE' : 'SUPERVISOR', toId: toOffice ? '' : dest, assetIds: ids, others: oth, note: $('note').value, photoFileId: fid });
        }).then(function (res) { toast(res.itemCount + ' item(s) in transit · ' + res.transferId); go('transfers'); });
      });
    });
  });
};

// ---- Check-in ----
VIEWS.checkin = function () {
  $('view').innerHTML = '<div class="card"><div class="row spread"><h2>Check in your assets</h2><button class="linkBtn" data-go="home">Back</button></div>' +
    '<p class="small muted">Tick every asset you physically have with you right now. We compare this with our records and flag anything that does not match. Nothing is blocked while you do this.</p>' +
    '<div class="stickyHead"><div class="row"><button class="btn secondary small" id="tickMine">Tick everything the records say I hold</button></div>' +
    '<div id="chkSearch" style="margin-top:8px"></div><label class="f" style="margin-bottom:0"><input type="checkbox" id="showAll"> Also search assets recorded with someone else</label></div>' +
    '<div id="pickHost" style="margin-top:8px"></div><div id="othersHost"></div>' +
    '<div class="row" style="margin-top:14px"><button class="btn" id="submitCheckin">Submit check-in</button></div><div id="result"></div></div>';
  const others = othersField($('othersHost'));
  return callBackend('picker', { scope: 'all' }).then(function (all) {
    const mine = all.filter(function (a) { return a.mine && a.st === 'AVAILABLE'; });
    const picker = createPicker($('pickHost'), { searchHost: $('chkSearch'), items: assetPickerItems(all, true), multi: true, placeholder: 'Search your assets…' });
    $('showAll').addEventListener('change', function () { picker.setItems(assetPickerItems(all, !$('showAll').checked)); });
    $('tickMine').addEventListener('click', function () { picker.selectAll(mine.map(function (a) { return a.id; })); });
    $('submitCheckin').addEventListener('click', function (e) {
      busy(e.target, function () {
        return callBackend('checkin', { assetIds: picker.selected(), others: others.values() }).then(function (r) {
          $('result').innerHTML = '<div class="banner ' + (r.missing || r.conflicts ? 'warn' : 'info') + '" style="margin-top:12px"><div class="grow"><b>Check-in recorded.</b> Records expected ' + r.expected + ' asset(s). ' +
            (r.missing ? r.missing + ' not declared (flagged for review). ' : '') + (r.conflicts ? r.conflicts + ' recorded with someone else (flagged). ' : '') + (r.claimed ? r.claimed + ' newly recorded with you.' : '') +
            (!r.missing && !r.conflicts ? 'Everything matched.' : '') + '</div><button class="btn small" data-go="home">Done</button></div>';
          $('submitCheckin').classList.add('hidden');
        });
      });
    });
  });
};

// ---- Issues ----
function issueRow(i) {
  const closed = i.status === 'RESOLVED' || i.status === 'REPLACED';
  const selectable = me.role === 'ADMIN' && !closed;
  return '<div class="item" style="align-items:flex-start">' + (selectable ? '<label class="selbox"><input type="checkbox" data-isel="' + esc(i.id) + '"></label>' : '') +
    '<div class="grow"><div class="t">' + esc(i.assetId) + ' · ' + esc(i.type) + '</div><div class="small muted">' + esc(i.location) + ' · ' + esc(i.by) + ' · ' + fmt(i.at) + '</div>' +
    (i.description ? '<div class="small">' + esc(i.description) + '</div>' : '') + (i.resolution ? '<div class="small muted">Resolution: ' + esc(i.resolution) + '</div>' : '') +
    (i.photoFileId ? '<div class="row" style="margin-top:6px"><button class="btn secondary small" data-photo="' + esc(i.photoFileId) + '">View photo</button></div>' : '') + '</div>' +
    pill(i.status.replace('_', ' ').toLowerCase(), closed ? 'ok' : i.status === 'UNDER_REVIEW' ? 'info' : 'warn') + '</div>';
}

VIEWS.issues = function () {
  const openOnly = $('issueOpenOnly') ? $('issueOpenOnly').checked : true;
  return callBackend('issues', { openOnly: openOnly }).then(function (list) {
    const sel = new Set();
    const isAdmin = me.role === 'ADMIN';
    $('view').innerHTML = '<div class="card"><div class="stickyHead"><div class="row spread"><h2 style="margin:0">Issues</h2><div class="row">' + (isAdmin ? '<button class="linkBtn" id="issSelAll">Select all open</button>' : '') +
      '<label class="small"><input type="checkbox" id="issueOpenOnly"' + (openOnly ? ' checked' : '') + '> Open only</label></div></div></div>' +
      (isAdmin ? '<p class="small muted">Tick several issues to close or move them together with one note.</p>' : '') +
      (list.length ? list.map(issueRow).join('') : emptyState('No issues.')) + '</div>';
    $('issueOpenOnly').addEventListener('change', function () { go('issues', true); });
    if (!isAdmin) return;
    const updateBar = function () { $('barCount') && ($('barCount').textContent = sel.size + ' selected'); barShow(sel.size > 0); };
    const apply = function (status) {
      callBackend('updateIssues', { issueIds: Array.from(sel), status: status, resolution: $('barNote').value }).then(function (r) { toast(r.updated + ' issue(s) updated'); go('issues', true); }).catch(toastError);
    };
    barSet('<span id="barCount" class="grow"></span><input type="text" id="barNote" placeholder="Resolution note" style="max-width:220px">' +
      '<button class="btn secondary small" data-bar="review">Under review</button><button class="btn small" data-bar="resolved">Resolved</button><button class="btn secondary small" data-bar="replaced">Replaced</button>' +
      '<button class="btn secondary small" data-bar="clear">Clear</button>', {
      review: function () { apply('UNDER_REVIEW'); }, resolved: function () { apply('RESOLVED'); }, replaced: function () { apply('REPLACED'); },
      clear: function () { sel.clear(); document.querySelectorAll('[data-isel]').forEach(function (c) { c.checked = false; }); updateBar(); }
    });
    document.querySelectorAll('[data-isel]').forEach(function (c) {
      c.addEventListener('change', function () { if (c.checked) sel.add(c.dataset.isel); else sel.delete(c.dataset.isel); updateBar(); });
    });
    $('issSelAll').addEventListener('click', function () { document.querySelectorAll('[data-isel]').forEach(function (c) { c.checked = true; sel.add(c.dataset.isel); }); updateBar(); });
  });
};

VIEWS.issue = function (preset) {
  const pre = Array.isArray(preset) ? preset : (preset ? [preset] : []);
  $('view').innerHTML = '<div class="card"><h2>Report an issue</h2><p class="small muted">Pick one or several. If the problem is exactly the same on all of them, report them together.</p>' +
    '<div class="stickyHead"><label class="f">Devices and SD cards (type to search, tick to add)</label><div id="issSearch"></div></div><div id="pickHost"></div><div id="typeHost"></div>' +
    '<label class="f">What is wrong?</label><textarea id="desc"></textarea><div id="photoHost"></div><div class="row" style="margin-top:14px"><button class="btn" id="submitIssue">Report issue</button></div></div>';
  const photo = photoField($('photoHost'), 'Photo (recommended; used for all selected)');
  return callBackend('picker').then(function (all) {
    const byId = {}; all.forEach(function (a) { byId[a.id] = a; });
    const items = all.map(function (a) { return { id: a.id, label: (a.c === 'SD_CARD' ? 'SD card ' : '') + (a.t || ''), sub: a.h + ' · ' + a.loc }; });
    const paintTypes = function (ids) {
      const counts = { DEVICE: 0, SD_CARD: 0 };
      ids.forEach(function (id) { if (byId[id]) counts[byId[id].c]++; });
      $('typeHost').innerHTML = ['DEVICE', 'SD_CARD'].filter(function (c) { return counts[c]; }).map(function (c) {
        const prev = $('type_' + c) ? $('type_' + c).value : '';
        return '<label class="f">Issue type for ' + counts[c] + ' ' + (c === 'SD_CARD' ? 'SD card' : 'device') + (counts[c] > 1 ? 's' : '') + '</label><select id="type_' + c + '">' +
          OPTS.issueTypes[c].map(function (t) { return '<option' + (t.value === prev ? ' selected' : '') + '>' + esc(t.value) + '</option>'; }).join('') + '</select>';
      }).join('');
      $('submitIssue').textContent = ids.length > 1 ? 'Report issue on ' + ids.length + ' items' : 'Report issue';
    };
    const picker = createPicker($('pickHost'), { searchHost: $('issSearch'), items: items, multi: true, selected: pre, placeholder: 'Search by ID…', onChange: paintTypes });
    paintTypes(pre);
    $('submitIssue').addEventListener('click', function (e) {
      const ids = picker.selected();
      if (!ids.length) return toast('Pick at least one device or SD card.', true);
      const typeByCategory = {};
      ['DEVICE', 'SD_CARD'].forEach(function (c) { if ($('type_' + c)) typeByCategory[c] = $('type_' + c).value; });
      busy(e.target, function () {
        const f = photo.file();
        return (f ? uploadPhoto('issue', ids[0], f) : Promise.resolve('')).then(function (fid) {
          return callBackend('reportIssues', { assetIds: ids, typeByCategory: typeByCategory, description: $('desc').value, photoFileId: fid });
        }).then(function (r) { homeSel.clear(); toast(r.count + ' issue(s) reported'); go(me.role === 'SUPERVISOR' ? 'home' : 'issues'); });
      });
    });
  });
};

// ---- Search ----
VIEWS.search = function (preset) {
  $('view').innerHTML = '<div class="stickyHead flat"><h2 style="margin:0 0 8px">Find an asset</h2><div class="row"><input type="text" id="q" class="grow" placeholder="Device or SD card ID, e.g. D102 or SD054" value="' + esc(preset || '') + '"><button class="btn" id="go">Search</button></div></div><div id="detail"></div>';
  const run = function () {
    const q = $('q').value.trim(); if (!q) return;
    callBackend('search', { assetId: q }).then(renderDetail).catch(function (e) { $('detail').innerHTML = '<div class="card"><div class="muted">' + esc(e.message) + '</div></div>'; });
  };
  $('go').addEventListener('click', run);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  if (preset) run();
};

function renderDetail(d) {
  const a = d.asset;
  let html = '<div class="card"><div class="row spread"><div><h2 style="margin:0;font-size:20px">' + esc(a.id) + ' <span class="muted" style="font-size:14px">' + esc(catLabel(a.category)) + ' ' + esc(a.subType) + ' ' + esc(a.capacity) + '</span></h2></div>' +
    '<div class="row">' + pill(a.status.toLowerCase(), a.status === 'WORKING' ? 'ok' : 'bad') + (a.state !== 'AVAILABLE' ? pill(a.state.toLowerCase().replace('_', ' '), 'warn') : '') + (a.provisional ? pill('awaiting admin', 'prov') : '') + '</div></div>' +
    '<div class="fieldRow" style="margin-top:10px"><div><div class="small muted">Where it is now</div><b>' + esc(a.state === 'SHORT' ? 'Not received (' + a.locationName + ')' : a.locationName) + '</b></div>' +
    '<div><div class="small muted">Who has it</div><b>' + esc(a.holder) + '</b>' + (a.assignedTo ? '<div class="small">Using it today: ' + esc(a.assignedTo) + '</div>' : '') + '</div><div><div class="small muted">Last movement</div><b>' + fmt(a.lastMoveAt) + '</b></div></div>' +
    '<div class="row" style="margin-top:10px"><button class="btn secondary small" data-issue-for="' + esc(a.id) + '">Report issue</button>' + (a.state === 'AVAILABLE' ? '<button class="btn secondary small" data-send-for="' + esc(a.id) + '">Send / in transit</button>' : '') + '</div></div>';
  if (d.flags && d.flags.length) html += '<div class="card flag HIGH"><h2>Open flags</h2>' + d.flags.map(function (f) { return '<div class="small"><b>' + esc(f.Type) + ':</b> ' + esc(f.Detail) + '</div>'; }).join('') + '</div>';
  html += '<div class="card"><h2>Movement history</h2>' + (d.movements.length ? '<ul class="timeline">' + d.movements.map(function (m) {
    return '<li><b>' + esc(m.reason.replace(/_/g, ' ').toLowerCase()) + '</b> · ' + fmt(m.at) + '<div class="small muted">' + esc(m.from) + ' → ' + esc(m.to) + (m.ref ? ' · ' + esc(m.ref) : '') + ' · by ' + esc(m.by) + '</div></li>';
  }).join('') + '</ul>' : emptyState('No movements yet.')) + '</div>';
  html += '<div class="card"><h2>Issues</h2>' + (d.issues.length ? d.issues.map(function (i) {
    return '<div class="item"><div class="grow"><div class="t">' + esc(i.type) + '</div><div class="small muted">' + fmt(i.at) + ' · ' + esc(i.by) + '</div>' + (i.description ? '<div class="small">' + esc(i.description) + '</div>' : '') +
      (i.photoFileId ? '<button class="btn secondary small" data-photo="' + esc(i.photoFileId) + '">View photo</button>' : '') + '</div>' + pill(i.status.toLowerCase().replace('_', ' '), i.status === 'OPEN' ? 'warn' : 'ok') + '</div>';
  }).join('') : emptyState('No issues recorded.')) + '</div>';
  $('detail').innerHTML = html;
}

// ---- Flags ("needs attention") ----
const FLAG_TITLES = {
  SHORT_RECEIPT: 'Short receipt', HOLDERLESS: 'No holder', CONFLICT: 'Custody conflict', POSSIBLY_MISSING: 'Possibly missing', CUSTODY_MISMATCH: 'Sent from a different holder',
  PROVISIONAL_ASSET: 'Asset not in master list', CHECKIN_OVERDUE: 'Check-in overdue', STALE_TRANSIT: 'Stuck in transit', ASSET_MISSING: 'Reported missing', OFF_PLAN: 'Off planned movement'
};
const ASSIGNABLE = ['HOLDERLESS', 'CONFLICT', 'POSSIBLY_MISSING', 'CUSTODY_MISMATCH'];

let flagFilter = '';

VIEWS.flags = function () {
  return Promise.all([callBackend('flags'), me.role === 'ADMIN' ? callBackend('supervisorList') : Promise.resolve([])]).then(function (r) {
    const all = r[0]; supCache = r[1];
    const isAdmin = me.role === 'ADMIN';
    const types = Array.from(new Set(all.map(function (f) { return f.type; })));
    if (flagFilter && types.indexOf(flagFilter) === -1) flagFilter = '';
    const flags = all.filter(function (f) { return !flagFilter || f.type === flagFilter; });
    const byId = {}; all.forEach(function (f) { byId[f.id] = f; });
    const sel = new Set();
    $('view').innerHTML = '<div class="stickyHead flat"><div class="row spread"><h2 style="margin:0">Needs attention <span class="muted" style="font-weight:400">(' + flags.length + (flagFilter ? ' of ' + all.length : '') + ')</span></h2>' +
      '<div class="row"><select id="flagType" style="width:auto"><option value="">All types</option>' + types.map(function (t) { return '<option value="' + esc(t) + '"' + (t === flagFilter ? ' selected' : '') + '>' + esc(FLAG_TITLES[t] || t) + '</option>'; }).join('') + '</select>' +
      (isAdmin && flags.length ? '<button class="linkBtn" id="flagSelAll">Select all shown</button>' : '') + '</div></div></div>' +
      (isAdmin ? '<p class="small muted">Tick several to deal with them together (dismiss, assign to a holder, settle short receipts, acknowledge).</p>' : '') +
      (flags.length ? flags.map(function (f) {
        const prov = isAdmin && f.type === 'PROVISIONAL_ASSET'
          ? '<div class="row" style="margin-top:8px"><input type="text" placeholder="Real asset ID (if known)" id="newid_' + esc(f.id) + '" style="max-width:200px"><button class="btn small" data-ack="' + esc(f.assetId) + '" data-flag="' + esc(f.id) + '">Acknowledge this one</button></div>' : '';
        return '<div class="card flag ' + esc(f.severity) + '"><div class="row spread" style="align-items:flex-start">' + (isAdmin ? '<label class="selbox"><input type="checkbox" data-fsel="' + esc(f.id) + '"></label>' : '') +
          '<div class="grow"><b>' + esc(FLAG_TITLES[f.type] || f.type) + '</b>' + (f.assetId ? ' · <a href="#" data-asset="' + esc(f.assetId) + '">' + esc(f.assetId) + '</a>' : '') + (f.refId ? ' · ' + esc(f.refId) : '') + '</div>' +
          pill(f.severity.toLowerCase(), f.severity === 'HIGH' ? 'bad' : f.severity === 'MEDIUM' ? 'warn' : 'info') + '</div><div>' + esc(f.detail) + '</div><div class="small muted">' + fmt(f.at) + (f.location ? ' · ' + esc(f.location) : '') + '</div>' + prov + '</div>';
      }).join('') : '<div class="card">' + emptyState('Nothing needs attention.') + '</div>');
    $('flagType').addEventListener('change', function () { flagFilter = $('flagType').value; go('flags', true); });
    if (!isAdmin) return;

    const holderOpts = '<option value="ADMIN:me">Office (me)</option>' + supCache.map(function (s) { return '<option value="SUPERVISOR:' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
    barSet('<span id="barCount" class="grow"></span>' +
      '<button class="btn secondary small" data-bar="dismiss">Dismiss</button>' +
      '<select id="barHolder" style="width:auto">' + holderOpts + '</select><button class="btn small" data-bar="assign">Assign</button>' +
      '<select id="barShort" style="width:auto"><option value="RECOVERED">It turned up - receive</option><option value="RETURN_TO_SENDER">Return to sender</option><option value="LOST">Mark lost</option></select><button class="btn small" data-bar="short">Settle short</button>' +
      '<button class="btn small" data-bar="ack">Acknowledge</button><button class="btn secondary small" data-bar="clear">Clear</button>', {
      dismiss: function () { runBulk('DISMISS', { resolution: prompt('Why are you dismissing these? (optional)') || '' }); },
      assign: function () { const v = $('barHolder').value.split(':'); runBulk('ASSIGN', { holderType: v[0], holderId: v[0] === 'ADMIN' ? me.email : v[1] }); },
      short: function () { runBulk('SHORT', { resolution: $('barShort').value }); },
      ack: function () { runBulk('ACK', {}); },
      clear: function () { sel.clear(); document.querySelectorAll('[data-fsel]').forEach(function (c) { c.checked = false; }); updateBar(); }
    });
    function runBulk(op, arg) {
      callBackend('bulkFlags', { flagIds: Array.from(sel), op: op, arg: arg }).then(function (res) {
        toast(res.done + ' done' + (res.skipped ? ', ' + res.skipped + ' already closed' : '')); go('flags', true);
      }).catch(toastError);
    }
    function updateBar() {
      const picked = Array.from(sel).map(function (id) { return byId[id]; }).filter(Boolean);
      const every = function (fn) { return picked.length > 0 && picked.every(fn); };
      $('barCount').textContent = picked.length + ' selected';
      const enable = function (op, on) { const b = document.querySelector('#actionBar [data-bar="' + op + '"]'); if (b) b.disabled = !on; };
      enable('dismiss', every(function (f) { return f.type !== 'SHORT_RECEIPT'; }));
      enable('assign', every(function (f) { return ASSIGNABLE.indexOf(f.type) !== -1 && f.assetId; }));
      enable('short', every(function (f) { return f.type === 'SHORT_RECEIPT'; }));
      enable('ack', every(function (f) { return f.type === 'PROVISIONAL_ASSET'; }));
      $('barHolder').disabled = !every(function (f) { return ASSIGNABLE.indexOf(f.type) !== -1 && f.assetId; });
      $('barShort').disabled = !every(function (f) { return f.type === 'SHORT_RECEIPT'; });
      barShow(picked.length > 0);
    }
    document.querySelectorAll('[data-fsel]').forEach(function (c) {
      c.addEventListener('change', function () { if (c.checked) sel.add(c.dataset.fsel); else sel.delete(c.dataset.fsel); updateBar(); });
    });
    const selAll = $('flagSelAll');
    if (selAll) selAll.addEventListener('click', function () { document.querySelectorAll('[data-fsel]').forEach(function (c) { c.checked = true; sel.add(c.dataset.fsel); }); updateBar(); });
  });
};

// ---- Assets (admin) ----
VIEWS.assets = function () {
  $('view').innerHTML = '<div class="card"><h2>Add assets</h2><p class="small muted">One per line: <code>AssetID, DEVICE or SD_CARD, kind, serial, capacity</code>. New assets start in your custody at the Office. Existing IDs are skipped. For the first big import use <code>importAssetsFromTab()</code> in the script (see docs).</p>' +
    '<textarea id="bulk" style="min-height:140px" placeholder="D401, DEVICE, Android Phone, SN12345,&#10;SD401, SD_CARD, 128GB, , 128GB"></textarea><div class="row" style="margin-top:10px"><button class="btn" id="addBulk">Add assets</button></div><div id="bulkResult" class="small"></div></div>';
  $('addBulk').addEventListener('click', function (e) {
    const rows = $('bulk').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      const p = l.split(',').map(function (x) { return x.trim(); });
      return { AssetID: p[0], Category: p[1], SubType: p[2], Serial: p[3], Capacity: p[4] };
    });
    if (!rows.length) return toast('Paste at least one line.', true);
    busy(e.target, function () {
      return callBackend('addAssets', { rows: rows }).then(function (r) {
        $('bulkResult').innerHTML = '<b>' + r.added + ' added.</b>' + (r.skipped.length ? ' Skipped: ' + r.skipped.map(function (s) { return esc(s.id || '(blank)') + ' (' + esc(s.reason) + ')'; }).join(', ') : '');
      });
    });
  });
};

// ---- Supervisors & plan (admin / ops) ----
let planDraft = []; // movements added but not saved yet; survives tab switches

VIEWS.sups = function () {
  return Promise.all([callBackend('supervisors'), callBackend('properties')]).then(function (r) {
    const sups = r[0], props = r[1];
    let html = '<div class="card"><h2>Supervisor groups: where they are and where they are going</h2><p class="small muted">Current location comes from attendance logins. Planned moves are yours to set.</p>' + sups.map(function (s) {
      return '<div class="item" style="align-items:flex-start"><div class="grow"><div class="t">' + esc(s.name) + ' <span class="muted">' + esc(s.id) + '</span></div><div class="small">Now at <b>' + esc(s.locationName) + '</b>' + (s.since ? ' since ' + fmt(s.since) : '') + '</div>' +
        (s.planned.length ? '<div class="small">Planned: ' + s.planned.map(function (p) { return esc(p.locationName) + ' (' + esc(p.from) + (p.to ? ' → ' + esc(p.to) : '') + ')'; }).join('; ') + '</div>' : '') +
        (s.history.length ? '<div class="small muted">History: ' + s.history.map(function (p) { return esc(p.locationName) + ' ' + esc(p.from) + (p.to ? '→' + esc(p.to) : '→now'); }).join(' · ') + '</div>' : '') + '</div>' + pill(s.status.toLowerCase(), s.status === 'ACTIVE' ? 'ok' : '') + '</div>';
    }).join('') + '</div>';
    if (me.role === 'ADMIN') {
      html += '<div class="card"><h2>Plan moves</h2><p class="small muted">Add as many movements as you need, then save them together. Nothing is saved until you press <b>Save plan</b>.</p>' +
        '<div class="fieldRow"><div><label class="f">Supervisor</label><select id="planSup">' + sups.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="f">Property</label><select id="planLoc">' + props.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.id) + ')</option>'; }).join('') + '</select></div>' +
        '<div><label class="f">From</label><input type="date" id="planFrom"></div><div><label class="f">To (optional)</label><input type="date" id="planTo"></div></div>' +
        '<div class="row" style="margin-top:10px"><button class="btn secondary" id="addMove">+ Add movement</button></div>' +
        '<div id="planDraftHost"></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" id="savePlan">Save plan</button><button class="btn secondary" id="clearPlan">Clear list</button></div></div>' +
        '<div class="card"><h2>Rename a property</h2><p class="small muted">The Location ID never changes; the old name is kept in history.</p><div class="fieldRow"><div><label class="f">Property</label><select id="renLoc">' + props.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.id) + ')</option>'; }).join('') + '</select></div>' +
        '<div><label class="f">New name</label><input type="text" id="renName"></div></div><div class="row" style="margin-top:10px"><button class="btn" id="renBtn">Rename</button></div></div>';
    }
    $('view').innerHTML = html;
    if (me.role !== 'ADMIN') return;
    const supName = {}, propName = {};
    sups.forEach(function (s) { supName[s.id] = s.name; });
    props.forEach(function (p) { propName[p.id] = p.name; });
    const paintDraft = function () {
      $('planDraftHost').innerHTML = planDraft.length
        ? '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>#</th><th>Supervisor</th><th>Property</th><th>From</th><th>To</th><th></th></tr></thead><tbody>' +
          planDraft.map(function (m, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(supName[m.supervisorId] || m.supervisorId) + '</td><td>' + esc(propName[m.locationId] || m.locationId) + '</td><td>' + esc(m.from) +
              '</td><td>' + esc(m.to || 'open-ended') + '</td><td><button class="linkBtn" data-rmmove="' + i + '">Remove</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="small muted" style="margin-top:10px">No movements added yet.</p>';
      $('savePlan').textContent = 'Save plan' + (planDraft.length ? ' (' + planDraft.length + ' movement' + (planDraft.length > 1 ? 's' : '') + ')' : '');
      $('savePlan').disabled = !planDraft.length; $('clearPlan').disabled = !planDraft.length;
    };
    paintDraft();
    $('addMove').addEventListener('click', function () {
      const m = { supervisorId: $('planSup').value, locationId: $('planLoc').value, from: $('planFrom').value, to: $('planTo').value };
      if (!m.from) return toast('Choose a start date.', true);
      if (m.to && m.to < m.from) return toast('The end date is before the start date.', true);
      planDraft.push(m);
      // Next row usually continues from this one: same supervisor, starting the day after it ends.
      if (m.to) { const d = new Date(m.to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); $('planFrom').value = d.toISOString().slice(0, 10); $('planTo').value = ''; }
      paintDraft();
    });
    $('planDraftHost').addEventListener('click', function (e) {
      const b = e.target.closest('[data-rmmove]'); if (!b) return;
      planDraft.splice(Number(b.dataset.rmmove), 1); paintDraft();
    });
    $('clearPlan').addEventListener('click', function () { planDraft = []; paintDraft(); });
    $('savePlan').addEventListener('click', function (e) {
      busy(e.target, function () {
        return callBackend('addPlans', { plans: planDraft }).then(function (r) { planDraft = []; toast(r.saved + ' movement(s) saved'); go('sups', true); });
      });
    });
    $('renBtn').addEventListener('click', function (e) {
      busy(e.target, function () { return callBackend('renameProperty', { locationId: $('renLoc').value, name: $('renName').value }).then(function () { toast('Renamed'); go('sups', true); }); });
    });
  });
};

// ---- Reports ----
VIEWS.reports = function () {
  const defs = [['inventory', 'Inventory (current location of every asset)'], ['transfers', 'Transfers'], ['movements', 'Movement history (full audit trail)'], ['issues', 'Issues'], ['assignments', 'Worker assignments (current and history)']];
  $('view').innerHTML = '<div class="card"><h2>Reports (CSV)</h2>' + defs.map(function (d) {
    return '<div class="item"><div class="grow">' + esc(d[1]) + '</div><button class="btn secondary small" data-report="' + d[0] + '">Download</button></div>';
  }).join('') + '</div>';
};

function downloadCsv(name, rep) {
  const q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [rep.columns].concat(rep.rows).map(function (r) { return r.map(q).join(','); }).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---- Alerts ----
VIEWS.alerts = function () {
  return callBackend('notifications').then(function (list) {
    $('view').innerHTML = '<div class="card"><div class="row spread"><h2>Alerts</h2><button class="btn secondary small" id="readAll">Mark all read</button></div>' +
      (list.length ? list.map(function (n) {
        return '<div class="item"><div class="grow"' + (n.read ? ' style="opacity:.6"' : '') + '><div>' + esc(n.message) + '</div><div class="small muted">' + fmt(n.at) + '</div></div>' + (n.read ? '' : pill('new', 'info')) + '</div>';
      }).join('') : emptyState('No alerts yet.')) + '</div>';
    $('readAll').addEventListener('click', function () { callBackend('markRead', {}).then(function () { me.unread = 0; updateBadge(); go('alerts', true); }); });
  });
};

// ===================== EVENTS =====================

document.addEventListener('click', function (e) {
  const t = e.target.closest('[data-tab],[data-go],[data-act],[data-receive],[data-cancel],[data-photo],[data-asset],[data-issue],[data-issue-for],[data-short],[data-ack],[data-assign],[data-dismiss],[data-report],[data-unassign],[data-confirmitems],[data-confirmall],[data-send-for],[data-bar],[data-refreshcfg],#bellBtn,#signOutBtn');
  if (!t) return;
  const d = t.dataset;
  if (t.id === 'bellBtn') return go('alerts');
  if (t.id === 'signOutBtn') return signOut();
  if (d.tab) return go(d.tab);
  if (d.go) return go(d.go);
  if (d.act === 'send') return go('newTransfer');
  if (d.act === 'checkin') return go('checkin');
  if (d.act === 'issue') return go('issue');
  if (d.receive) return openReceive(d.receive);
  if (d.cancel) { if (confirm('Cancel this transfer? The assets return to the sender.')) callBackend('cancelTransfer', { transferId: d.cancel }).then(function () { toast('Cancelled'); go('transfers', true); }).catch(toastError); return; }
  if (d.photo) return viewPhoto(d.photo);
  if (d.issueFor) return go('issue', false, [d.issueFor]);
  if (d.sendFor) return go('newTransfer', false, [d.sendFor]);
  if (d.bar !== undefined) { const fn = barHandlers[d.bar]; if (fn) fn(); return; }
  if (d.refreshcfg !== undefined) return busy(t, function () { return callBackend('refreshConfig', {}).then(function () { return callBackend('options'); }).then(function (o) { OPTS = o; toast('Settings refreshed'); }); });
  if (d.asset) { e.preventDefault(); return go('search', false, d.asset); }
  if (d.issue) {
    const note = $('res_' + d.issue);
    return busy(t, function () { return callBackend('updateIssue', { issueId: d.issue, status: d.status, resolution: note ? note.value : '' }).then(function () { toast('Issue updated'); go('issues', true); }); });
  }
  if (d.short) return busy(t, function () { return callBackend('resolveShort', { flagId: d.flag, resolution: d.short }).then(function () { toast('Resolved'); go('flags', true); }); });
  if (d.ack) {
    const nid = $('newid_' + d.flag);
    return busy(t, function () { return callBackend('ackProvisional', { assetId: d.ack, newId: nid ? nid.value : '' }).then(function () { toast('Acknowledged'); go('flags', true); }); });
  }
  if (d.assign) {
    const v = $('asg_' + d.flag).value.split(':');
    return busy(t, function () {
      return callBackend('reassign', { assetId: d.assign, holderType: v[0], holderId: v[0] === 'ADMIN' ? me.email : v[1], reason: 'Assigned from flag ' + d.flag }).then(function () { toast('Assigned'); go('flags', true); });
    });
  }
  if (d.dismiss) { const why = prompt('Why are you dismissing this? (optional)'); if (why === null) return; return busy(t, function () { return callBackend('resolveFlag', { flagId: d.dismiss, resolution: why }).then(function () { toast('Dismissed'); go('flags', true); }); }); }
  if (d.unassign) { e.preventDefault(); return busy(t, function () { return callBackend('deassign', { assetIds: [d.unassign] }).then(function () { toast('Unassigned ' + d.unassign); go('team', true); }); }); }
  if (d.confirmall !== undefined) return busy(t, function () { return callBackend('confirmAssignments', {}).then(function (r) { toast(r.confirmed + ' assignment(s) confirmed'); go(tab, true); }); });
  if (d.confirmitems) return busy(t, function () { return callBackend('confirmAssignments', { assetIds: d.confirmitems.split(',') }).then(function () { toast('Confirmed'); go('team', true); }); });
  if (d.report) return busy(t, function () { return callBackend('report', { type: d.report }).then(function (rep) { downloadCsv(d.report, rep); }); });
});

initAuth();

// Pinned headers sit just under the top bar; measure it instead of guessing (it wraps on small phones).
function setTopbarVar() {
  const bar = document.querySelector('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', (bar.offsetHeight - 1) + 'px');
}
setTopbarVar();
window.addEventListener('resize', setTopbarVar);

// Someone with more than one role picks which one they are acting as; the whole app reloads for that role.
$('roleSwitch').addEventListener('change', function () {
  if (teamDirty && !confirm('You have unsaved assignment changes. Switch role without saving?')) { $('roleSwitch').value = activeRole; return; }
  teamDirty = false; activeRole = $('roleSwitch').value;
  try { localStorage.setItem('at_role', activeRole); } catch (e) { /* ignore */ }
  homeSel.clear(); startSession();
});
