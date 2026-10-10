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
let sessionToken = ''; // issued by the server after one Google sign-in; lets this device skip the sign-in for days
try { sessionToken = localStorage.getItem('at_session') || ''; } catch (e) { /* storage blocked: sign in every visit */ }
function saveSession(tok) {
  sessionToken = tok || '';
  try { if (tok) localStorage.setItem('at_session', tok); else localStorage.removeItem('at_session'); } catch (e) { /* ignore */ }
}
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

// Actions that only read. Everything else is a save, which wipes the screen memo below.
const READS = { saveLocation: 1, stays: 1, home: 1, picker: 1, search: 1, issues: 1, flags: 1, notifications: 1, supervisors: 1, properties: 1, supervisorList: 1, team: 1, assignments: 1, report: 1, options: 1, transfers: 1, pulse: 1, photoGet: 1, sync: 1 };
const NO_MEMO = { saveLocation: 1, search: 1, report: 1, photoGet: 1, pulse: 1, sync: 1, notifications: 1 };
let memo = {};          // last answer for each read, so a screen can be drawn instantly while a fresh answer loads
let memoEpoch = 0;      // bumped by every save, so an answer that was in flight during a save is not remembered
let lastStamp = '';     // change detector from the 45-second pulse
function memoKey(action, payload) { return action + '|' + JSON.stringify(payload || {}); }

function callBackend(action, payload) {
  const epoch = memoEpoch;
  if (!READS[action]) { memo = {}; memoEpoch++; lastStamp = ''; }
  return rawCall(action, payload).then(function (data) {
    if (READS[action] && !NO_MEMO[action] && epoch === memoEpoch) memo[memoKey(action, payload)] = { at: Date.now(), data: data };
    return data;
  }, function (e) {
    if (e && e.code === 'AUTH') signOut();
    throw e;
  });
}

/** A read that may be answered from the memo when it is younger than maxAgeMs (used for form pick-lists). */
function cachedCall(action, payload, maxAgeMs) {
  const hit = memo[memoKey(action, payload)];
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.data);
  return callBackend(action, payload);
}

function userIsBusy() {
  const el = document.activeElement;
  const typing = el && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(el.tagName) !== -1;
  return modalOpen() || teamDirty || !!typing;
}

/**
 * Stale-while-revalidate: if we already have an answer, draw it NOW; then ask the server and, if the answer
 * differs, draw again (unless the person has moved on, is typing, or has unsaved edits).
 */
function swr(action, payload, render) {
  const key = memoKey(action, payload);
  const hit = memo[key];
  const myNav = navId;
  if (hit) render(hit.data, true);
  if (hit && Date.now() - hit.at < 15000) return Promise.resolve(hit.data);
  if (!hit) $('view').innerHTML = '<div class="empty">Loading…</div>';   // nothing to show yet: never leave the previous screen under the new tab
  return callBackend(action, payload).then(function (data) {
    if (myNav !== navId) return data;                                   // they navigated elsewhere while we waited
    if (!hit) render(data, false);
    else if (JSON.stringify(hit.data) !== JSON.stringify(data) && !userIsBusy()) render(data, false);
    return data;
  });
}

function rawCall(action, payload) {
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
    const data = Object.assign({ sessionToken: sessionToken || undefined, googleIdToken: sessionToken ? undefined : idToken, asRole: activeRole }, payload || {});
    script.src = CONFIG.APPS_SCRIPT_URL + '?action=' + encodeURIComponent(action) + '&callback=' + encodeURIComponent(cb) +
      '&data=' + encodeURIComponent(JSON.stringify(data)) + '&_=' + Date.now();
    document.body.appendChild(script);
  }).then(handleResult);
}

function handleResult(res) {
  if (res && res.session) saveSession(res.session);   // the server renews the session for devices that stay in use
  if (res && res.ok) return res.data;
  if (res && res.code === 'AUTH') { saveSession(''); const a = new Error('Please sign in again.'); a.code = 'AUTH'; throw a; }
  const err = new Error(res && res.error ? res.error : 'Something went wrong.');
  err.code = res && res.code;
  throw err;
}

// ===================== PHOTOS =====================

// Photos are shrunk on the phone BEFORE they are uploaded: about 1024 px on the long side, JPEG, aimed at <= 160 KB
// (a 12 MP phone photo is 3-6 MB). Smaller uploads finish quickly even on a weak connection, so they no longer time out.
const PHOTO_TARGETS = [[1024, 0.7], [1024, 0.55], [800, 0.55], [640, 0.5]];   // [longest side in px, JPEG quality], tried in order
const PHOTO_TARGET_BYTES = 160 * 1024;
const preparedPhotos = typeof WeakMap !== 'undefined' ? new WeakMap() : null;   // File -> the promise of its compressed copy (started when the photo is chosen)

function loadImageSource(file) {
  const viaTag = function () {
    return new Promise(function (resolve, reject) {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
      img.src = url;
    });
  };
  if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaTag);   // keeps the photo the right way up
  return viaTag();
}
function canvasToBlob(c, quality) {
  return new Promise(function (resolve, reject) { c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('Could not prepare the photo.')); }, 'image/jpeg', quality); });
}
function blobToBase64(b) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1]); };
    r.onerror = function () { reject(new Error('Could not read the photo.')); };
    r.readAsDataURL(b);
  });
}
/** File -> { b64, bytes, w, h }: a small JPEG, upright, on a white background. */
function compressPhoto(file) {
  return loadImageSource(file).then(function (src) {
    const sw = src.width, sh = src.height;
    const render = function (edge, quality) {
      const scale = Math.min(1, edge / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
      return canvasToBlob(c, quality).then(function (blob) { return { blob: blob, w: c.width, h: c.height }; });
    };
    let n = 0;
    const next = function () {
      const t = PHOTO_TARGETS[n++];
      return render(t[0], t[1]).then(function (r) { return (r.blob.size <= PHOTO_TARGET_BYTES || n >= PHOTO_TARGETS.length) ? r : next(); });
    };
    return next().then(function (r) {
      if (src.close) src.close();
      return blobToBase64(r.blob).then(function (b64) { return { b64: b64, bytes: r.blob.size, w: r.w, h: r.h }; });
    });
  });
}

function uploadPhoto(kind, refLabel, file) {
  if (window.MOCK_UPLOAD) return Promise.resolve(window.MOCK_UPLOAD(file));
  const prepared = (preparedPhotos && preparedPhotos.get(file)) || compressPhoto(file);
  return prepared.then(function (p) {
    return new Promise(function (resolve, reject) {
      const reqId = 'u' + Date.now() + Math.random().toString(36).slice(2);
      const iframe = document.createElement('iframe');
      iframe.name = 'up_' + reqId; iframe.style.display = 'none';
      const form = document.createElement('form');
      form.method = 'POST'; form.action = CONFIG.APPS_SCRIPT_URL; form.target = iframe.name; form.style.display = 'none';
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = 'payload';
      // the session token is what a signed-in device holds; the Google token alone is missing or too old on most devices
      inp.value = JSON.stringify({ sessionToken: sessionToken || undefined, googleIdToken: sessionToken ? undefined : idToken, kind: kind, refLabel: refLabel, mime: 'image/jpeg', base64: p.b64, requestId: reqId });
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
      timer = setTimeout(function () { finish(); reject(new Error('The photo upload is taking too long.')); }, 90000);
      document.body.appendChild(iframe); document.body.appendChild(form); form.submit();
    });
  });
}

/** Uploads the photo; if that fails the person may still send the report without it, so a weak connection never loses their work. */
function uploadPhotoOrSkip(kind, refLabel, file) {
  if (!file) return Promise.resolve('');
  return uploadPhoto(kind, refLabel, file).catch(function (e) {
    if (e && e.code === 'AUTH') throw e;
    if (confirm((e && e.message ? e.message : 'The photo could not be uploaded.') + '\n\nSend without the photo?')) return '';
    throw e;
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
  // start shrinking as soon as the photo is chosen, while the person finishes the form
  input.addEventListener('change', function () {
    const f = input.files && input.files[0], note = host.querySelector('#photoName');
    if (!f || window.MOCK_UPLOAD) { note.textContent = ''; return; }
    note.textContent = 'Preparing the photo…';
    const p = compressPhoto(f); if (preparedPhotos) preparedPhotos.set(f, p);
    p.then(function (r) { if (input.files && input.files[0] === f) note.textContent = 'Photo ready (' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB)'; })
      .catch(function (e) { if (input.files && input.files[0] === f) note.textContent = e.message; });
  });
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
  if (window.MOCK_EMAIL !== undefined) { startSession(true); return; }
  if (sessionToken) {                       // remembered: go straight in, no sign-in screen
    $('signedOut').classList.add('hidden');
    $('view').classList.remove('hidden');
    $('view').innerHTML = '<div class="empty">Opening…</div>';
    startSession(true);
    return;
  }
  showSignIn();
}

function showSignIn(message) {
  $('signedOut').classList.remove('hidden');
  $('signInError').textContent = message || '';
  if (showSignIn.ready) return;
  showSignIn.ready = true;
  const wait = setInterval(function () {
    if (!window.google || !google.accounts || !google.accounts.id) return;
    clearInterval(wait);
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: function (r) { loginWithGoogle(r.credential); }
    });
    google.accounts.id.renderButton($('googleSignInButton'), { theme: 'outline', size: 'large' });
  }, 100);
}

/** One Google sign-in buys a session this device keeps, so the next visit opens straight into the app. */
function loginWithGoogle(credential) {
  $('signInError').textContent = '';
  callBackend('login', { googleIdToken: credential, sessionToken: '' }).then(function (d) {
    saveSession(d.session);
    idToken = null;
    startSession(true);
  }).catch(function (e) { $('signInError').textContent = e.message; });
}

function startSession(withSync) {
  $('signInError').textContent = '';
  memo = {}; memoEpoch++; lastStamp = '';
  // The two requests run side by side; the home answer is remembered so the first screen draws without asking again.
  Promise.all([callBackend('home'), callBackend('options')]).then(function (r) {
    const h = r[0]; me = h; OPTS = r[1];
    $('signedOut').classList.add('hidden');
    $('tabs').classList.remove('hidden'); $('view').classList.remove('hidden');
    $('bellBtn').classList.remove('hidden'); $('signOutBtn').classList.remove('hidden'); $('helpBtn').classList.remove('hidden');
    activeRole = h.role; // the server may have fallen back from a stale remembered role
    // Only remember the choice for people who actually have a choice, so a single-role user on a shared device does not overwrite it.
    if (h.roles.length > 1) { try { localStorage.setItem('at_role', activeRole); } catch (e) { /* ignore */ } }
    $('userLabel').textContent = h.name + (h.roles.length > 1 ? '' : ' · ' + h.role.toLowerCase());
    const rs = $('roleSwitch');
    if (h.roles.length > 1) {
      rs.innerHTML = h.roles.map(function (x) { return '<option value="' + esc(x) + '"' + (x === h.role ? ' selected' : '') + '>Acting as: ' + esc(x.charAt(0) + x.slice(1).toLowerCase()) + '</option>'; }).join('');
      rs.classList.remove('hidden');
    } else rs.classList.add('hidden');
    buildTabs(); setTopbarVar();
    go(startTab());
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, (OPTS.ui.pollSeconds || CONFIG.POLL_SECONDS || 45) * 1000);
    updateBadge();
    if (withSync) setTimeout(backgroundSync, 300);
    setTimeout(prefetch, 900);
    setTimeout(recordLocation, 1500);
  }).catch(function (e) {
    if (e.code === 'AUTH') return;                       // callBackend already signed out
    if (e.code === 'NOT_LISTED') { saveSession(''); $('view').classList.add('hidden'); showSignIn(e.message); return; }
    $('signedOut').classList.remove('hidden'); $('view').classList.add('hidden');
    $('signInError').textContent = e.message;
    if (!sessionToken) showSignIn(e.message);
  });
}

/**
 * Whenever the app is opened (or comes back to the front after a while) the phone's position is saved, replacing the
 * previous one. It is best effort: no permission, no GPS or a slow network just means nothing is saved, and nothing else depends on it.
 */
let lastLocationAt = 0, hiddenAt = 0, stayPainter = null;   // stayPainter: redraws the schedule card on Home
function recordLocation() {
  if (!me || !navigator.geolocation || Date.now() - lastLocationAt < 60000) return;
  lastLocationAt = Date.now();
  try {
    navigator.geolocation.getCurrentPosition(function (p) {
      callBackend('saveLocation', { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }).then(function () {
        // Home was drawn before the position was saved, so its last-scan line used the OLD position: ask again now.
        delete memo[memoKey('stays', {})];
        if (tab === 'home' && stayPainter) callBackend('stays').then(stayPainter).catch(function () { /* keep what is shown */ });
      }).catch(function () { /* optional */ });
    }, function () { /* denied or unavailable: fine */ }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 10 * 60000) recordLocation();   // back after 10+ minutes counts as opening it again
});

function startTab() {
  let last = '';
  try { last = localStorage.getItem('at_tab_' + me.role) || ''; } catch (e) { /* ignore */ }
  const ok = TABS[me.role].some(function (t) { return t[0] === last; });
  return ok ? last : (me.role === 'SUPERVISOR' ? 'home' : 'dash');
}

/** Warm the screens people open next, in the background, one at a time, so the tab switch is instant. */
function prefetch() {
  const plan = { SUPERVISOR: [['stays', {}], ['transfers', {}], ['team', {}], ['picker', {}]], ADMIN: [['transfers', {}], ['flags', {}], ['issues', { openOnly: true }], ['supervisorList', {}], ['picker', {}]], OPS: [['flags', {}], ['issues', { openOnly: true }]] }[me.role] || [];
  let i = 0;
  (function next() {
    if (!me || i >= plan.length || document.hidden) return;
    const p = plan[i++];
    if (memo[memoKey(p[0], p[1])]) return next();
    callBackend(p[0], p[1]).catch(function () { /* optional */ }).then(function () { setTimeout(next, 250); });
  })();
}

/** Location sync runs on its own request AFTER the screen is drawn, so nothing waits for it. */
function backgroundSync() {
  if (!me) return;
  callBackend('sync').then(function (r) {
    if (r && r.moved && r.moved.length) { memo = {}; if (!userIsBusy()) go(tab, true); }
  }).catch(function () { /* the 5-minute job will catch up */ });
}

function signOut() {
  saveSession(''); idToken = null; me = null; clearInterval(pollTimer); memo = {}; memoEpoch++;
  $('signedOut').classList.remove('hidden');
  ['tabs', 'view', 'bellBtn', 'signOutBtn', 'helpBtn'].forEach(function (i) { $(i).classList.add('hidden'); });
  $('userLabel').textContent = ''; $('roleSwitch').classList.add('hidden');
  barClear();
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  if (window.onMockSignOut) window.onMockSignOut();
  if (window.MOCK_EMAIL === undefined) showSignIn();
}

function updateBadge() {
  const b = $('bellBadge');
  if (me && me.unread > 0) { b.textContent = me.unread; b.classList.remove('hidden'); } else b.classList.add('hidden');
}

/** Every 45 seconds: one tiny request. The screen only redraws if the server says something changed. */
let pulseCount = 0;
function poll() {
  if (!me || document.hidden) return;
  callBackend('pulse').then(function (p) {
    me.unread = p.unread; updateBadge();
    const changed = lastStamp && p.stamp !== lastStamp;
    lastStamp = p.stamp;
    if (changed) {
      memo = {};
      if (['home', 'dash', 'transfers', 'team', 'flags', 'issues'].indexOf(tab) !== -1 && !userIsBusy()) go(tab, true);
    }
    if (++pulseCount % 3 === 0) backgroundSync();
  }).catch(function () { /* transient */ });
}
document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

// ===================== NAV =====================

const TABS = {
  SUPERVISOR: [['home', 'Home'], ['team', 'Assign'], ['transfers', 'Transfers'], ['issue', 'Report issue'], ['search', 'Search']],
  ADMIN: [['dash', 'Dashboard'], ['schedule', 'Schedule'], ['transfers', 'Transfers'], ['flags', 'Needs attention'], ['issues', 'Issues'], ['assets', 'Assets'], ['sups', 'Supervisors'], ['search', 'Search'], ['reports', 'Reports']],
  OPS: [['dash', 'Dashboard'], ['schedule', 'Schedule'], ['flags', 'Needs attention'], ['issues', 'Issues'], ['search', 'Search'], ['reports', 'Reports']]
};
const PARENT_TAB = { newTransfer: 'transfers', checkin: 'home', alerts: null, help: null, property: 'dash' };

function buildTabs() {
  $('tabs').innerHTML = TABS[me.role].map(function (t) { return '<button data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('');
}

let navId = 0;

function go(t, keepScroll, arg) {
  if (tab === 'team' && teamDirty && t !== 'team' && !confirm('You have unsaved assignment changes. Leave without saving?')) return;
  teamDirty = false;
  setTopbarVar(); // the bar is taller once signed in (user label, alerts)
  tab = t; barClear();
  const pop0 = $('comboPop'); if (pop0) pop0.classList.add('hidden');
  const mine = ++navId;
  try { if (me && TABS[me.role].some(function (x) { return x[0] === t; })) localStorage.setItem('at_tab_' + me.role, t); } catch (e) { /* ignore */ }
  const hl = PARENT_TAB[t] !== undefined ? PARENT_TAB[t] : t;
  $('tabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === hl); });
  if (!keepScroll) window.scrollTo(0, 0);
  const v = VIEWS[t];
  Promise.resolve(v(arg)).catch(function (e) { if (mine === navId) $('view').innerHTML = '<div class="card"><div class="muted">' + esc(e.message) + '</div></div>'; });
}

function refreshHome() { return callBackend('home').then(function (h) { me = h; updateBadge(); return h; }); }

// ===================== VIEWS =====================

const VIEWS = {};

// ---- Supervisor home ----
let homeSel = new Set();

VIEWS.home = function () {
  return swr('home', {}, function (h) {
    me = h; updateBadge();
    const devs = h.assets.filter(function (a) { return a.category === 'DEVICE'; });
    const sds = h.assets.filter(function (a) { return a.category === 'SD_CARD'; });
    const existing = {}; h.assets.forEach(function (a) { existing[a.id] = true; });
    homeSel.forEach(function (id) { if (!existing[id]) homeSel.delete(id); });
    let html = '';
    if (h.checkin) {
      html += '<div class="banner ' + (h.checkin.overdue ? 'bad' : 'warn') + '"><div class="grow"><b>' + (h.checkin.overdue ? 'Check-in overdue' : 'Check-in needed') +
        '</b><div class="small">You are at a new property. List the assets you hold so we can match them to our records. You can keep working meanwhile.</div></div>' +
        '<button class="btn" data-act="checkin">Check in now</button></div>';
    }
    if (h.team && (h.team.dueConfirm || h.team.assignAlert)) {
      html += '<div class="banner warn"><div class="grow"><b>Assignments need attention</b><div class="small">' +
        (h.team.assignAlert ? h.team.unassignedDevices + ' device(s) not assigned to anyone yet. ' : '') +
        (h.team.dueConfirm ? h.team.dueConfirm + ' assignment(s) not confirmed for ' + OPTS.ui.confirmEveryHours + '+ hours.' : '') + '</div></div><button class="btn" data-go="team">Open Assign</button></div>';
    }
    html += '<div id="stayBox"></div>';
    html += '<div class="card"><div class="row spread"><div id="scanLine">' + scanLineHtml(null, h) + '</div>' +
      '<div class="row"><button class="btn" data-act="send">Send assets</button><button class="btn secondary" data-act="issue">Report issue</button></div></div>' +
      '<div class="row" style="margin-top:10px">' + pill(devs.length + ' devices here', 'info') + pill(sds.length + ' SD cards here', 'info') +
      (devs.some(function (a) { return a.status !== 'WORKING'; }) ? pill('faulty devices', 'bad') : '') + '</div></div>';
    html += '<div class="card"><h2 style="margin:0">Assets with your team</h2>' +
      '<p class="small muted" style="margin:6px 0 0" id="assetScope">' + assetScopeText(h, null) + '</p>' +
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
    const myNav = navId, hit = memo[memoKey('stays', {})];
    const paintStays = function (s) {
      if (myNav !== navId) return;
      const box = $('stayBox'); if (box) { box.innerHTML = staySection(s); wireStays(box); }
      const sl = $('scanLine'); if (sl) sl.innerHTML = scanLineHtml(s.scan, h);
      const sc = $('assetScope'); if (sc) sc.textContent = assetScopeText(h, s);
    };   // not swr: that would blank the whole screen while it loads
    stayPainter = paintStays;
    if (hit) paintStays(hit.data);
    callBackend('stays').then(paintStays).catch(function (e) {   // the rest of Home still works; say so instead of waiting forever
      const sl = $('scanLine'); if (sl && myNav === navId) sl.innerHTML = scanLineHtml({ failed: true, message: e && e.message ? e.message : '' }, h);
      const box = $('stayBox'); if (box && myNav === navId && !box.innerHTML) box.innerHTML = '<div class="card"><h2>Your property schedule</h2><div class="small muted">Could not load the schedule' + (e && e.message ? ': ' + esc(e.message) : '') + '. <button class="linkBtn" data-go="home">Try again</button></div></div>';
    });
  });
};

// ---- Property schedule (from the Actual_property_List tab) ----

/** The "Location checked / Last scan" line on Home (the newer of the phone's saved location and the attendance scan). No distances are shown; the property name only appears when the scan matches the schedule. */
/** The asset list is everything in the supervisor's location group; today's property (from the schedule) is shown beside it so people can tell which stay it means. */
function assetScopeText(h, stays) {
  const prop = stays && stays.current && stays.current.length ? stays.current.map(function (x) { return x.property; }).join(' / ') : '';
  return 'Location group: ' + h.locationName + (prop ? '  ·  Today\'s property: ' + prop : '') + '. These are the assets recorded in your group, not only at one property.';
}

function scanLineHtml(scan, h) {
  let title = 'Checking your last scan…', badge = '';
  if (scan && scan.failed) { title = 'Location status not available'; badge = pill('Try again in a moment', 'info'); }
  else if (scan) {
    if (!scan.hasScan) title = 'No location or scan yet today';
    else {
      title = (scan.source === 'GPS' ? 'Location checked ' : 'Last scan ') + scan.time;
      if (scan.status === 'AT_PROPERTY') badge = pill('At ' + scan.property, 'ok');
      else if (scan.status === 'NOT_AT_PROPERTY') badge = pill('Not at your scheduled property', 'warn');
      else if (scan.status === 'NO_SCHEDULE') badge = pill('No property scheduled for you', 'info');
    }
  }
  return '<div class="muted small">Attendance</div><h2 style="font-size:20px;margin:0">' + esc(title) + '</h2>' + (badge ? '<div style="margin-top:4px">' + badge + '</div>' : '') +
    '';
}

function telLink(p) { return p.tel ? '<a class="btn small" href="tel:' + esc(p.tel) + '">Call ' + esc(p.phone) + '</a><button class="btn secondary small" data-copy="' + esc(p.phone) + '">Copy</button>' : (p.phone ? '<span class="small">' + esc(p.phone) + '</span><button class="btn secondary small" data-copy="' + esc(p.phone) + '">Copy</button>' : ''); }

function stayCard(s, withSup) {
  const links = (s.mapUrl ? '<a class="btn small" href="' + esc(s.mapUrl) + '" target="_blank" rel="noopener">Open in Maps</a>' : '') +
    (s.directionsUrl ? '<a class="btn secondary small" href="' + esc(s.directionsUrl) + '" target="_blank" rel="noopener">Directions</a>' : '') +
    (s.listingUrl ? '<a class="btn secondary small" href="' + esc(s.listingUrl) + '" target="_blank" rel="noopener">Listing</a>' : '');
  return '<div class="stay"><div class="row spread"><div class="t">' + esc(s.property) + '</div><div class="small muted">' + esc(s.start) + '</div></div>' +
    (withSup ? '<div class="small muted">' + esc(s.supervisorName) + '</div>' : '') +
    (s.address ? '<div class="small">' + esc(s.address) + '</div>' : '<div class="small muted">Address not added yet.</div>') +
    (links ? '<div class="row stayBtns">' + links + '</div>' : '') +
    (s.contacts.length ? s.contacts.map(function (c) {
      return '<div class="contact"><div class="small"><b>' + esc(c.role) + '</b>' + (c.name ? ': ' + esc(c.name) : '') + '</div><div class="row stayBtns">' + telLink(c) + '</div></div>';
    }).join('') : '<div class="small muted">No host or caretaker number added yet.</div>') +
    (s.complete ? '' : '<div class="small muted">Some details are missing. Contact your manager to add them.</div>') + '</div>';
}

function staySection(s) {
  if (!s.listed && !s.current.length && !s.next.length) return '<div class="card"><h2>Your property schedule</h2><div class="small muted">No property is scheduled for you yet. Contact your manager if you expected one.</div></div>';
  const block = function (title, list, cls) {
    return '<div class="stayBlock ' + (cls || '') + '"><h3>' + esc(title) + '</h3>' + (list.length ? list.map(function (x) { return stayCard(x); }).join('') : '<div class="small muted">Nothing scheduled.</div>') + '</div>';
  };
  let html = '<div class="card"><h2>Your property schedule</h2>' + block(s.titles.current, s.current, 'now') +
    (s.phase === 'CHECKIN' && s.previous.length ? block(s.titles.previous, s.previous, 'prev') : '') +
    block(s.titles.next, s.next, 'next');
  if (s.history.length) {
    html += '<details class="stayHist"><summary>Past properties (' + s.history.length + ')</summary>' + s.history.map(function (x) { return stayCard(x); }).join('') + '</details>';
  }
  return html + '</div>';
}

function copyText(text) {
  const done = function () { toast('Copied ' + text); };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); }); } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy. Press and hold the number to copy it.', true); }
  document.body.removeChild(t);
}
function wireStays(root) {
  if (root._stayWired) return; root._stayWired = true;   // the box is repainted in place: listen once
  root.addEventListener('click', function (e) { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); });
}

/** Admin-only: what the status was worked out from, so a surprising answer can be explained. */
function scanWhy(sc) {
  const d = sc && sc.debug; if (!d) return '';
  const cands = d.candidates.length ? d.candidates.map(function (c) {
    return esc(c.property) + ' (starts ' + esc(c.start) + '): ' + (c.metersAway !== null ? c.metersAway + ' m away' : (c.lat === null ? 'property has no coordinates' : 'no coordinates on the position'));
  }).join('; ') : 'no property to compare with right now';
  return '<details class="small muted"><summary>Why</summary>Used the ' + (d.source === 'GPS' ? 'phone location' : 'attendance scan') + ' of ' + esc(d.time) + (d.lat !== null ? ' (' + d.lat + ', ' + d.lng + ')' : '') + '. Counts as at a property within ' + d.meters + ' m. ' + cands + '.</details>';
}

// Admin / ops: where every supervisor is now and next, and the full history.
VIEWS.schedule = function () {
  return swr('stays', {}, function (s) {
    const pick = function (arr) { return arr.length ? arr.map(function (x) { return '<div class="small"><b>' + esc(x.property) + '</b> <span class="muted">(' + esc(x.start) + ')</span></div>'; }).join('') : '<div class="small muted">None</div>'; };
    let html = '<div class="card"><h2>Property schedule</h2><p class="small muted" style="margin:0 0 8px">Check-in is after ' + esc(s.checkinFrom) + ' (up to ' + esc(s.checkinBy) + '). Before then a supervisor is still at the previous property.</p>' +
      s.supervisors.map(function (x) {
        const sc = x.scan || {}; const scanTxt = !sc.hasScan ? pill('No scan today', 'info') : (sc.status === 'AT_PROPERTY' ? pill('Scanned ' + sc.time + ' at ' + sc.property, 'ok') : sc.status === 'NOT_AT_PROPERTY' ? pill('Scanned ' + sc.time + ', not at scheduled property', 'warn') : pill('Scanned ' + sc.time, 'info'));
        return '<div class="stay"><div class="row spread"><div class="t">' + esc(x.name) + '</div></div><div style="margin:4px 0">' + scanTxt + '</div>' + scanWhy(sc) + '<div class="small muted">Now</div>' + pick(x.current) + '<div class="small muted" style="margin-top:6px">Next</div>' + pick(x.next) + '</div>';
      }).join('') + '</div>';
    if (s.unmatched.length) {
      html += '<div class="card"><h2>Not linked to a supervisor (' + s.unmatched.length + ')</h2><p class="small muted" style="margin:0 0 6px">The supervisor on these rows does not match anyone in the user list. Ask the manager to correct the supervisor email.</p>' +
        s.unmatched.map(function (u) { return '<div class="small">' + esc(u.property) + ' <span class="muted">(' + esc(u.start) + ', ' + esc(u.supervisor || 'no supervisor') + ')</span></div>'; }).join('') + '</div>';
    }
    const names = []; s.history.forEach(function (h) { if (names.indexOf(h.supervisorName) === -1) names.push(h.supervisorName); });
    html += '<div class="card"><h2>Movement history</h2><div class="stickyHead"><select id="histSup" class="grow"><option value="">All supervisors</option>' +
      names.sort().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select></div><div id="histList"></div></div>';
    $('view').innerHTML = html;
    const paint = function () {
      const f = $('histSup').value;
      const rows = s.history.filter(function (h) { return !f || h.supervisorName === f; });
      $('histList').innerHTML = rows.length ? rows.map(function (x) { return stayCard(x, true); }).join('') : emptyState('No past properties in this period.');
    };
    $('histSup').addEventListener('change', paint); paint();
    wireStays($('view'));
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
  return swr('home', {}, function (h) {
    me = h; updateBadge();
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
        return '<tr class="clickrow" data-prop="' + esc(p.locationId) + '"><td><b>' + esc(p.name) + '</b> <span class="small" style="color:var(--brand)">details ›</span><div class="small muted">' + esc(p.locationId) + '</div></td><td>' + esc(p.supervisors.join(', ') || '-') + '</td><td class="num">' + p.workforce +
          '</td><td class="num">' + p.devicesWorking + '</td><td class="num">' + p.devicesRequired + '</td><td>' + g(p.deviceGap) + '</td><td class="num">' + p.devicesFaulty +
          '</td><td class="num">' + p.sdCards + '</td><td class="num">' + p.sdRequired + '</td><td>' + g(p.sdGap) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (d.unlocated ? '<p class="small muted">' + d.unlocated + ' asset(s) are with a supervisor whose location is not known yet, or at a property that is not in the list.</p>' : '') +
      '<p class="small muted">Workforce is today\'s attendance by Location ID. Only working devices count towards the requirement. ' + (me.role === 'ADMIN' ? '<button class="linkBtn" data-refreshcfg>Refresh settings</button> (settings are cached for a couple of minutes)' : '') + '</p></div>';
    $('view').innerHTML = html;
  });
};

// ---- One property in detail (admin / ops, opened from the dashboard) ----
VIEWS.property = function (locationId) {
  return swr('property', { locationId: locationId }, function (d) {
    const c = d.counts;
    const gap = function (n) { return n < 0 ? '<span class="gap-neg">Short ' + (-n) + '</span>' : n > 0 ? '<span class="gap-pos">Surplus ' + n + '</span>' : 'OK'; };
    const tile = function (n, l, cls) { return '<div class="tile ' + (cls || '') + '" style="cursor:default"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    const chipsOf = function (items) {
      return items.length ? items.map(function (i) { return '<span class="chip">' + esc(i.assetId) + ' <span class="small">' + (i.category === 'SD_CARD' ? 'SD' : esc(i.subType || 'device')) + '</span></span>'; }).join(' ') : '<span class="small muted">nothing</span>';
    };
    const person = function (w) {
      return '<tr><td><b>' + esc(w.name) + '</b>' +
        (w.registered === false ? '<div style="margin-top:2px">' + pill('Not registered in the Awign app yet', 'warn') + '</div>' : '') + '</td>' +
        '<td>' + chipsOf(w.items.filter(function (i) { return i.category === 'DEVICE'; })) + '</td><td>' + chipsOf(w.items.filter(function (i) { return i.category === 'SD_CARD'; })) + '</td></tr>';
    };
    const assetRows = function (list, showWorker) {
      return list.length ? '<div class="tablewrap"><table><tbody>' + list.map(function (a) {
        return '<tr><td><a href="#" data-asset="' + esc(a.id) + '"><b>' + esc(a.id) + '</b></a> <span class="muted">' + esc(a.subType || '') + '</span></td><td>' +
          (showWorker && a.worker ? 'with <b>' + esc(a.worker) + '</b>' : '') + (a.issue ? '<span style="color:var(--bad)">' + esc(a.issue) + '</span>' : '') + '</td><td class="small muted">' + esc(a.holder) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="small muted">None.</div>';
    };
    const section = function (title, cls, list, showWorker) { return '<h3>' + title + ' (' + list.length + ')</h3>' + assetRows(list, showWorker); };
    let html = '<div class="stickyHead flat"><div class="row spread"><div><h2 style="margin:0">' + esc(d.name) + '</h2><div class="small muted">' + esc(d.locationId) + ' · ' +
      (d.supervisors.length ? 'Supervisor: ' + d.supervisors.map(function (x) { return esc(x.name); }).join(', ') : 'no supervisor there now') + '</div></div><button class="btn secondary" data-go="dash">‹ Dashboard</button></div></div>';
    html += '<div class="tiles">' + tile(c.workforce + (c.unregistered ? ' <span class="small">(' + c.unregistered + ' not registered)</span>' : ''), 'Workforce today') +
      tile(c.devicesWorking + ' / ' + c.devicesRequired, 'Working devices / needed · ' + gap(c.deviceGap).replace(/<[^>]+>/g, ''), c.deviceGap < 0 ? 'bad' : '') +
      tile(c.sdWorking + ' / ' + c.sdRequired, 'SD cards / needed · ' + gap(c.sdGap).replace(/<[^>]+>/g, ''), c.sdGap < 0 ? 'warn' : '') +
      tile(d.devices.faulty.length + d.sdCards.faulty.length, 'Faulty (devices + SD)', d.devices.faulty.length + d.sdCards.faulty.length ? 'warn' : '') +
      tile(d.devices.idle.length, 'Idle working devices') + tile(d.issues.length, 'Open issues', d.issues.length ? 'warn' : '') + '</div>';
    if (d.withoutDevice.length) html += '<div class="banner warn"><div class="grow"><b>' + d.withoutDevice.length + ' present worker(s) have no device:</b> ' + d.withoutDevice.map(esc).join(', ') + '</div></div>';
    html += '<div class="card"><h2>Workforce today, and what each person has</h2>' + (d.workforce.length ? '<div class="tablewrap"><table><thead><tr><th>Person</th><th>Device</th><th>SD cards</th></tr></thead><tbody>' + d.workforce.map(person).join('') + '</tbody></table></div>' : emptyState('Nobody has scanned in here today.')) +
      (d.absentWithItems.length ? '<h3>Not scanned in today, still holding items</h3><div class="tablewrap"><table><tbody>' + d.absentWithItems.map(person).join('') + '</tbody></table></div>' : '') + '</div>';
    html += '<div class="card"><h2>Devices</h2>' + section('Faulty', 'bad', d.devices.faulty) + section('Missing', 'bad', d.devices.missing) + section('Idle (working, nobody has it)', '', d.devices.idle) + section('Assigned', '', d.devices.assigned, true) + '</div>';
    html += '<div class="card"><h2>SD cards</h2>' + section('Faulty', 'bad', d.sdCards.faulty) + section('Missing', 'bad', d.sdCards.missing) + section('Idle (working, nobody has it)', '', d.sdCards.idle) + section('Assigned', '', d.sdCards.assigned, true) + '</div>';
    html += '<div class="card"><h2>Open issues and flags here</h2>' + (d.issues.length ? d.issues.map(function (i) { return '<div class="item"><div class="grow"><b>' + esc(i.assetId) + '</b> · ' + esc(i.type) + '<div class="small muted">' + esc(i.by) + ' · ' + fmt(i.at) + '</div></div>' + pill(i.status.replace('_', ' ').toLowerCase(), 'warn') + '</div>'; }).join('') : '<div class="small muted">No open issues.</div>') +
      (d.flags.length ? '<h3>Flags</h3>' + d.flags.map(function (f) { return '<div class="item"><div class="grow"><b>' + esc(FLAG_TITLES[f.type] || f.type) + '</b> · ' + esc(f.detail) + '</div>' + pill(f.severity.toLowerCase(), f.severity === 'HIGH' ? 'bad' : f.severity === 'MEDIUM' ? 'warn' : 'info') + '</div>'; }).join('') : '') + '</div>';
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
  return swr('team', {}, function (t) {
    const s = t.summary;
    let html = '<div class="row spread" style="margin-bottom:12px"><h2 style="margin:0">Assign · ' + esc(t.locationName) + '</h2></div>';
    if (s.assignAlert) html += '<div class="banner warn"><div class="grow"><b>' + s.unassignedDevices + ' device(s) not assigned yet</b><div class="small">Give them to today’s workers below. (Expected by ' + esc(t.assignBy) + '.)</div></div></div>';
    if (s.dueConfirm) html += '<div class="banner info"><div class="grow"><b>' + s.dueConfirm + ' assignment(s) not confirmed for ' + OPTS.ui.confirmEveryHours + '+ hours</b><div class="small">If nothing changed, one tap keeps them with the same people. They stay assigned either way until you change them, they go faulty, or they are sent.</div></div><button class="btn" data-confirmall>Still with same people</button></div>';
    html += '<div class="stickyHead flat" id="gridHead"><div class="row"><input type="text" id="wFilter" placeholder="Find a worker…" style="max-width:220px">' +
      '<button class="btn secondary small" id="clearDev">Take all devices off</button><button class="btn secondary small" id="clearSd">Take all SD cards off</button></div>' +
      '<div class="small muted" id="freeLine" style="margin-top:6px"></div></div>' +
      '<div id="preBanner"></div><div id="wkGrid" class="wkgrid"></div>' +
      '' +
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
    names[w.workerId] = w; order.push(w.workerId);
    cells[w.workerId] = { DEVICE: [], SD_CARD: [] };
    w.items.forEach(function (i) {
      owner[i.assetId] = w.workerId;
      if (!info[i.assetId]) info[i.assetId] = { id: i.assetId, category: i.category, subType: i.subType, was: w.name };
      (cells[w.workerId][i.category] = cells[w.workerId][i.category] || []).push(i.assetId);
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
      // One box: type to filter OR tap the always-visible arrow to see the list (a native datalist hides its arrow in many browsers).
      (canEdit ? '<div class="combo"><input type="text" class="comboIn" data-in="' + esc(w + '|' + cat) + '" placeholder="Type or pick an ID…" autocomplete="off">' +
        '<button type="button" class="comboBtn" data-open="' + esc(w + '|' + cat) + '" aria-label="Show the list" title="Show the list">▾</button></div>' : '') + '</div>';
  };

  const paint = function () {
    const q = $('wFilter').value.trim().toLowerCase();
    const list = order.filter(function (id) { return !q || (names[id].name + ' ' + id + ' ' + (names[id].email || '')).toLowerCase().indexOf(q) !== -1; });
    $('wkGrid').innerHTML = list.length ? list.map(function (id) {
      const w = names[id], ids = CATS.reduce(function (acc, c) { return acc.concat(baseline[id][c]); }, []).join(',');
      return '<div class="wk' + (w.present ? '' : ' absent') + '"><div class="row spread" style="align-items:flex-start"><div><b>' + esc(w.name) + '</b> <span class="small muted">' + esc(w.shift || '') + '</span>' +
        (w.registered === false ? '<div style="margin-top:3px">' + pill('Not registered in the Awign app yet', 'warn') + '</div>' : '') +
        '<div style="margin-top:3px">' +
        (w.team ? pill('Your team', 'info') + ' ' : (w.assignable ? pill('Scanned in at this property', '') + ' ' : '')) +
        (!w.assignable ? pill('not marked present today', 'warn') : (!w.present ? pill(w.elsewhere ? 'Scanned in at ' + w.elsewhere : 'Not scanned in yet today', 'warn') : '')) + '</div></div>' +
        (ids ? '<button class="linkBtn" data-confirmitems="' + esc(ids) + '">Still with them</button>' : '') + '</div>' +
        slot(id, 'DEVICE', w.assignable) + slot(id, 'SD_CARD', w.assignable) +
        (pre.length && w.assignable ? '<button class="btn small" data-give="' + esc(id) + '" style="margin-top:8px">Give the ' + pre.length + ' selected here</button>' : '') + '</div>';
    }).join('') : emptyState(t.workers.length ? 'No worker matches.' : 'No workers are marked present at your property yet today.');
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

  // ----- the dropdown list (opens on focus, on typing, or on the arrow button; click an item to add it) -----
  const pop = (function () {
    let el = $('comboPop');
    if (!el) { el = document.createElement('div'); el.id = 'comboPop'; el.className = 'comboPop hidden'; document.body.appendChild(el); }
    return el;
  })();
  let comboKey = '';
  const ownerLabel = function (id) {
    const p = placedBy(id), o = p || owner[id];
    return o ? (names[o] ? names[o].name : 'someone') : '';
  };
  const showCombo = function (key) {
    const inp = document.querySelector('[data-in="' + key + '"]');
    if (!inp) { pop.classList.add('hidden'); return; }
    comboKey = key;
    const parts = key.split('|'), w = parts[0], cat = parts[1];
    const q = inp.value.trim().toLowerCase();
    const max = OPTS.ui.pickerMax || 50;
    const all = Object.keys(info).filter(function (id) {
      return info[id].category === cat && cells[w][cat].indexOf(id) === -1 && (!q || (id + ' ' + (info[id].subType || '')).toLowerCase().indexOf(q) !== -1);
    }).sort(function (x, y) {
      const fx = ownerLabel(x) ? 1 : 0, fy = ownerLabel(y) ? 1 : 0;
      return fx - fy || natural(x, y);                                   // free ones first
    });
    pop.innerHTML = all.length ? all.slice(0, max).map(function (id) {
      const who = ownerLabel(id);
      return '<div class="opt" data-pick="' + esc(id) + '"><span><b>' + esc(id) + '</b> <span class="small muted">' + esc(info[id].subType || '') + '</span></span>' +
        (who ? pill('now with ' + who, 'info') : pill('free', 'ok')) + '</div>';
    }).join('') + (all.length > max ? '<div class="small muted" style="padding:8px 12px">Showing ' + max + ' of ' + all.length + ' - keep typing to narrow down.</div>' : '')
      : '<div class="small muted" style="padding:10px 12px">' + (q ? 'Nothing matches "' + esc(inp.value) + '".' : 'No ' + (cat === 'SD_CARD' ? 'SD cards' : 'devices') + ' to pick.') + '</div>';
    const r = inp.closest('.combo').getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + 'px';
    pop.style.width = Math.max(r.width, 260) + 'px';
    if (below < 220 && r.top > below) { pop.style.top = 'auto'; pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
    else { pop.style.bottom = 'auto'; pop.style.top = (r.bottom + 4) + 'px'; }
    pop.classList.remove('hidden');
  };
  const hideCombo = function () { comboKey = ''; pop.classList.add('hidden'); };
  pop.addEventListener('mousedown', function (e) { e.preventDefault(); });          // keep focus where it is while clicking an item
  pop.addEventListener('click', function (e) {
    const o = e.target.closest('[data-pick]'); if (!o || !comboKey) return;
    const key = comboKey, parts = key.split('|');
    add(parts[0], parts[1], o.dataset.pick); focusKey = ''; paint(); showCombo(key);   // stays open so several can be picked in a row
  });
  document.addEventListener('mousedown', function (e) {
    if (pop.classList.contains('hidden')) return;
    if (e.target.closest('.combo') || e.target.closest('#comboPop')) return;
    hideCombo();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideCombo(); });
  window.addEventListener('scroll', hideCombo, { passive: true });
  window.addEventListener('resize', hideCombo);

  const grid = $('wkGrid');
  grid.addEventListener('focusin', function (e) { const el = e.target.closest('[data-in]'); if (el) showCombo(el.dataset.in); });
  grid.addEventListener('input', function (e) { const el = e.target.closest('[data-in]'); if (el) showCombo(el.dataset.in); });
  grid.addEventListener('keydown', function (e) {
    const el0 = e.target.closest('[data-in]');
    if (el0 && e.key === 'ArrowDown') { showCombo(el0.dataset.in); return; }
    const el = e.target.closest('[data-in]');
    if (!el || e.key !== 'Enter') return;
    e.preventDefault();
    const p = el.dataset.in.split('|'), r = resolve(el.value, p[1]);
    if (r.err) return r.err ? toast(r.err, true) : null;
    focusKey = el.dataset.in; add(p[0], p[1], r.id); paint();
  });
  grid.addEventListener('click', function (e) {
    const rm = e.target.closest('[data-rm]'), un = e.target.closest('[data-undo]'), op = e.target.closest('[data-open]'), gv = e.target.closest('[data-give]');
    if (op) {                                                           // the arrow: open/close the list for that box
      if (comboKey === op.dataset.open && !pop.classList.contains('hidden')) hideCombo(); else showCombo(op.dataset.open);
    } else if (rm) {
      e.preventDefault(); const p = rm.dataset.rm.split('|');
      CATS.forEach(function (c) { cells[p[0]][c] = cells[p[0]][c].filter(function (x) { return x !== p[1]; }); }); paint();
    } else if (un) {
      e.preventDefault(); const p = un.dataset.undo.split('|');
      add(p[0], info[p[1]].category, p[1]); paint();
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
// Any admin for a transfer to the Office; the named supervisor or a supervisor at the same property for a transfer to a supervisor.
function canReceive(t) {
  if (t.canReceive !== undefined) return t.canReceive;   // the server decides (it knows who is at which property)
  if (t.toType === 'OFFICE') return me.role === 'ADMIN';
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
  else if (t.status === 'IN_TRANSIT') html += '<span class="small muted">Waiting for ' + esc(t.to) + ' to confirm</span>';
  if (t.status === 'IN_TRANSIT' && (me.role === 'ADMIN' || t.sentBy === me.name)) html += '<button class="btn secondary small" data-cancel="' + esc(t.id) + '">Cancel</button>';
  if (t.photoFileId) html += '<button class="btn secondary small" data-photo="' + esc(t.photoFileId) + '">View photo</button>';
  return html + '</div></div>';
}

let currentTransfers = [];
VIEWS.transfers = function () {
  return swr('transfers', {}, function (list) {
    currentTransfers = list;
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
  const t = currentTransfers.find(function (x) { return x.id === transferId; });
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
  return Promise.all([cachedCall('picker', {}, 30000), cachedCall('supervisorList', {}, 300000)]).then(function (r) {
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
        return uploadPhotoOrSkip('transfer', 'transfer', f).then(function (fid) {
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
  return cachedCall('picker', { scope: 'all' }, 30000).then(function (all) {
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
  return swr('issues', { openOnly: openOnly }, function (list) {
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
  return cachedCall('picker', {}, 30000).then(function (all) {
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
        return uploadPhotoOrSkip('issue', ids[0], f).then(function (fid) {
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
  PROVISIONAL_ASSET: 'Asset not in master list', CHECKIN_OVERDUE: 'Check-in overdue', STALE_TRANSIT: 'Stuck in transit', ASSET_MISSING: 'Reported missing', OFF_PLAN: 'Off planned movement', OFF_SCHEDULE: 'Not at scheduled property'
};
const ASSIGNABLE = ['HOLDERLESS', 'CONFLICT', 'POSSIBLY_MISSING', 'CUSTODY_MISMATCH'];

let flagFilter = '';

VIEWS.flags = function () {
  const people = me.role === 'ADMIN' ? cachedCall('supervisorList', {}, 300000) : Promise.resolve([]);
  return people.then(function (sl) {
    supCache = sl;
    return swr('flags', {}, renderFlags);
  });
};

function renderFlags(all) {
  {
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
        return '<div class="card flag ' + esc(f.severity) + '"><div class="row spread" style="align-items:flex-start">' + (isAdmin && !f.readonly ? '<label class="selbox"><input type="checkbox" data-fsel="' + esc(f.id) + '"></label>' : '') +
          '<div class="grow"><b>' + esc(f.title || FLAG_TITLES[f.type] || f.type) + '</b>' + (f.assetId ? ' · <a href="#" data-asset="' + esc(f.assetId) + '">' + esc(f.assetId) + '</a>' : '') + (f.refId ? ' · ' + esc(f.refId) : '') + '</div>' +
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
  }
}

// ---- Help (everyone) ----
let helpFrom = '';
VIEWS.help = function () {
  if (tab !== 'help') helpFrom = tab;
  const secs = helpSections(me.role);
  const link = CONFIG.HELP_DOC_URL ? '<p class="small"><a href="' + esc(CONFIG.HELP_DOC_URL) + '" target="_blank" rel="noopener">Open the full User Guide</a></p>' : '';
  $('view').innerHTML = '<div class="card"><div class="row spread"><h2 style="margin:0">Help</h2><button class="linkBtn" id="helpBack">Back</button></div>' +
    '<div class="stickyHead"><input type="text" id="helpFilter" placeholder="Search help…" class="grow"></div>' +
    '<div id="helpList">' + secs.map(function (s, i) { return '<details class="helpSec" data-i="' + i + '"><summary>' + esc(s.title) + '</summary><div class="helpBody">' + s.html + '</div></details>'; }).join('') + '</div>' +
    '<div id="helpNone" class="small muted hidden">Nothing matches. Try a different word, or contact your manager.</div>' + link + '</div>';
  $('helpBack').addEventListener('click', function () { go(helpFrom && helpFrom !== 'help' ? helpFrom : startTab()); });
  $('helpFilter').addEventListener('input', function () {
    const q = $('helpFilter').value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('#helpList .helpSec').forEach(function (d) {
      const hit = !q || d.textContent.toLowerCase().indexOf(q) !== -1;
      d.classList.toggle('hidden', !hit); if (hit) shown++;
      if (q && hit) d.open = true;
    });
    $('helpNone').classList.toggle('hidden', shown > 0);
  });
  return Promise.resolve();
};

// ---- Assets (admin) ----
VIEWS.assets = function () {
  $('view').innerHTML = '<div class="card"><h2>Add assets</h2><p class="small muted">One per line: <code>AssetID, DEVICE or SD_CARD, kind, serial, capacity</code>. New assets start in your custody at the Office. Existing IDs are skipped. For the first big import use <code>importAssetsFromTab()</code> in the script (see docs).</p>' +
    '<textarea id="bulk" style="min-height:140px" placeholder="D401, DEVICE, Android Phone, SN12345,&#10;SD401, SD_CARD, 128GB, , 128GB"></textarea><div class="row" style="margin-top:10px"><button class="btn" id="addBulk">Add assets</button></div><div id="bulkResult" class="small"></div></div>' +
    '<div class="card"><h2>Import from a CSV file</h2><p class="small muted">For many assets at once. Download the template, fill it in, then choose the file. You see a summary before anything is saved. Columns: AssetID, Category (DEVICE or SD_CARD), SubType, Serial, Capacity, HolderEmail (optional).</p>' +
    '<div class="row"><button class="btn secondary" id="csvTemplate">Download CSV template</button><label class="btn" for="csvFile" style="margin:0">Choose CSV file</label><input type="file" id="csvFile" accept=".csv,text/csv" class="hidden"></div>' +
    '<div id="csvPreview" class="small" style="margin-top:10px"></div></div>';
  wireCsvImport();
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

/** Admin > Assets: download the template, choose a filled-in file, review, import. Nothing is saved until Import is tapped. */
function wireCsvImport() {
  let pending = [];
  const download = function (name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('csvTemplate').addEventListener('click', function () { download('asset-import-template.csv', assetCsvTemplate()); });
  $('csvFile').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      const res = assetRowsFromCsv(parseCsv(String(reader.result)));
      pending = res.rows;
      const prob = res.problems.length ? '<div style="margin-top:6px"><b>' + res.problems.length + ' row' + (res.problems.length > 1 ? 's' : '') + ' will be left out:</b><ul style="margin:4px 0 0 18px">' +
        res.problems.slice(0, 15).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + (res.problems.length > 15 ? '<li>and ' + (res.problems.length - 15) + ' more</li>' : '') + '</ul></div>' : '';
      $('csvPreview').innerHTML = '<div><b>' + esc(f.name) + ':</b> ' + pending.length + ' asset' + (pending.length === 1 ? '' : 's') + ' ready to import.</div>' + prob +
        (pending.length ? '<div class="row" style="margin-top:10px"><button class="btn" id="csvImport">Import ' + pending.length + ' asset' + (pending.length === 1 ? '' : 's') + '</button></div><div id="csvResult" class="small" style="margin-top:8px"></div>' : '');
      e.target.value = '';
      const go2 = $('csvImport'); if (!go2) return;
      go2.addEventListener('click', function () {
        busy(go2, function () {
          let added = 0; const skipped = [];
          const chunks = []; for (let i = 0; i < pending.length; i += 150) chunks.push(pending.slice(i, i + 150));
          return chunks.reduce(function (p, chunk) {
            return p.then(function () { return callBackend('addAssets', { rows: chunk }).then(function (r) { added += r.added; r.skipped.forEach(function (s) { skipped.push(s); }); }); });
          }, Promise.resolve()).then(function () {
            pending = [];
            $('csvResult').innerHTML = '<b>' + added + ' added.</b>' + (skipped.length ? ' <b>' + skipped.length + ' skipped:</b> ' + skipped.slice(0, 30).map(function (s) { return esc(s.id || '(blank)') + ' (' + esc(s.reason) + ')'; }).join(', ') + (skipped.length > 30 ? ' and ' + (skipped.length - 30) + ' more' : '') + '. <button class="linkBtn" id="csvSkipped">Download the skipped rows</button>' : '');
            const sk = $('csvSkipped');
            if (sk) sk.addEventListener('click', function () { download('skipped-assets.csv', [['AssetID', 'Reason']].concat(skipped.map(function (s) { return [s.id, s.reason]; })).map(function (r) { return r.map(csvQuote).join(','); }).join('\r\n') + '\r\n'); });
            go2.classList.add('hidden'); toast(added + ' asset' + (added === 1 ? '' : 's') + ' added');
          });
        }).catch(toastError);
      });
    };
    reader.readAsText(f);
  });
}

// ---- Supervisors (admin / ops) ----
VIEWS.sups = function () {
  return Promise.all([callBackend('supervisors'), callBackend('properties')]).then(function (r) {
    const sups = r[0], props = r[1];
    let html = '<div class="card"><h2>Supervisors: where they are and what is next</h2><p class="small muted">Current location group comes from attendance. Upcoming properties come from the property schedule (see the Schedule tab); they are no longer entered here.</p>' + sups.map(function (s) {
      return '<div class="item" style="align-items:flex-start"><div class="grow"><div class="t">' + esc(s.name) + ' <span class="muted">' + esc(s.id) + '</span></div><div class="small">Attendance location <b>' + esc(s.locationName) + '</b>' + (s.since ? ' since ' + fmt(s.since) : '') + '</div>' +
        (s.planned.length ? '<div class="small">Upcoming: ' + s.planned.map(function (p) { return esc(p.locationName) + ' (' + esc(p.from) + ')'; }).join('; ') + '</div>' : '<div class="small muted">Nothing upcoming in the schedule.</div>') +
        (s.history.length ? '<div class="small muted">Attendance history: ' + s.history.map(function (p) { return esc(p.locationName) + ' ' + esc(p.from) + (p.to ? '→' + esc(p.to) : '→now'); }).join(' · ') + '</div>' : '') + '</div>' + pill(s.status.toLowerCase(), s.status === 'ACTIVE' ? 'ok' : '') + '</div>';
    }).join('') + '</div>';
    if (me.role === 'ADMIN') {
      html += '<div class="card"><h2>Rename a property</h2><p class="small muted">The Location ID never changes; the old name is kept in history.</p><div class="fieldRow"><div><label class="f">Property</label><select id="renLoc">' + props.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.id) + ')</option>'; }).join('') + '</select></div>' +
        '<div><label class="f">New name</label><input type="text" id="renName"></div></div><div class="row" style="margin-top:10px"><button class="btn" id="renBtn">Rename</button></div></div>';
    }
    $('view').innerHTML = html;
    if (me.role !== 'ADMIN') return;
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
  const t = e.target.closest('[data-tab],[data-go],[data-act],[data-receive],[data-cancel],[data-photo],[data-asset],[data-issue],[data-issue-for],[data-short],[data-ack],[data-assign],[data-dismiss],[data-report],[data-unassign],[data-confirmitems],[data-confirmall],[data-send-for],[data-bar],[data-refreshcfg],[data-prop],#bellBtn,#signOutBtn,#helpBtn');
  if (!t) return;
  const d = t.dataset;
  if (t.id === 'bellBtn') return go('alerts');
  if (t.id === 'helpBtn') return go('help');
  if (t.id === 'signOutBtn') return signOut();
  if (d.tab) return go(d.tab);
  if (d.go) return go(d.go);
  if (d.act === 'send') return go('newTransfer');
  if (d.act === 'checkin') return go('checkin');
  if (d.act === 'issue') return go('issue');
  if (d.receive) return openReceive(d.receive);
  if (d.cancel) { if (confirm('Cancel this transfer? The assets return to the sender.')) callBackend('cancelTransfer', { transferId: d.cancel }).then(function () { toast('Cancelled'); go('transfers', true); }).catch(toastError); return; }
  if (d.photo) return viewPhoto(d.photo);
  if (d.prop) return go('property', false, d.prop);
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
