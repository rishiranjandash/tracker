/**
 * PICTURE UPLOAD YOU CAN RELY ON.
 *  - A picture is cut into small pieces (about 45 KB each). Every piece is sent (and re-sent) on its own, so one slow or dropped request
 *    costs one piece, never the whole picture; the server only saves the file when all pieces are there, and saves it once.
 *  - Each piece is tried on two routes: a plain POST whose answer is read directly, then the older hidden-form route.
 *  - Waiting for the network to come back is part of the retry (a send that starts in a lift finishes when the signal returns).
 *  - Everything needed to send an invoice (the form and the compressed pictures) is kept in IndexedDB on the phone until the server has
 *    confirmed it, so closing the app, losing signal or reloading never loses it.
 * Loaded before app.js; uses its globals (sessionToken, idToken, CONFIG) only when called.
 */

const UP_PIECE = 45000;   // characters of base64 per piece (the server accepts up to 70000)

function upId(prefix) {
  const r = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(9))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('') : Math.random().toString(16).slice(2, 20);
  return prefix + '-' + Date.now().toString(36) + '-' + r;
}
function upSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function upAuth() { return { sessionToken: sessionToken || undefined, googleIdToken: sessionToken ? undefined : idToken }; }

/** Waits (up to maxMs) for the network to be back, so a retry is not wasted while the phone is offline. */
function upWaitOnline(maxMs) {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise(function (resolve) {
    const done = function () { clearTimeout(t); window.removeEventListener('online', done); resolve(); };
    const t = setTimeout(done, maxMs);
    window.addEventListener('online', done);
  });
}

/** Route 1: a plain-text POST; the JSON answer is read directly. Throws { fromServer: true } for an answer that says no, anything else is a network problem. */
function upPostFetch(body, timeoutMs) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs);
  return fetch(CONFIG.APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unreadable answer from the server.'); }
      if (j && j.ok) return j.data;
      const err = new Error((j && j.error) || 'The upload was refused.'); err.fromServer = true; throw err;
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

/** Route 2: the hidden form + a message back from the page Google returns. Slower and less certain, used when route 1 cannot connect. */
function upPostForm(body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const reqId = upId('f');
    const iframe = document.createElement('iframe');
    iframe.name = 'up_' + reqId; iframe.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST'; form.action = CONFIG.APPS_SCRIPT_URL; form.target = iframe.name; form.style.display = 'none';
    const inp = document.createElement('input'); inp.type = 'hidden'; inp.name = 'payload';
    inp.value = JSON.stringify(Object.assign({}, body, { requestId: reqId })); form.appendChild(inp);
    let timer;
    function finish() { clearTimeout(timer); window.removeEventListener('message', onMsg); iframe.remove(); form.remove(); }
    function onMsg(e) {
      const m = e.data && e.data.assetTrackerUpload;
      if (!m || m.requestId !== reqId) return;
      let host = ''; try { host = new URL(e.origin).hostname; } catch (x) { host = String(e.origin); }
      if (!/googleusercontent\.com$/.test(host)) return;
      finish();
      if (m.result && m.result.ok) resolve(m.result.data);
      else { const err = new Error((m.result && m.result.error) || 'The upload was refused.'); err.fromServer = true; reject(err); }
    }
    window.addEventListener('message', onMsg);
    timer = setTimeout(function () { finish(); reject(new Error('No answer from the server.')); }, timeoutMs);
    document.body.appendChild(iframe); document.body.appendChild(form); form.submit();
  });
}

/** One request, as many tries as it takes (default 6), waiting for the network and backing off; both routes each try. Resolves with the server's data. */
async function upSend(body, opts) {
  opts = opts || {};
  const tries = opts.tries || 6;
  let last = null;
  for (let n = 1; n <= tries; n++) {
    await upWaitOnline(30000);
    const t0 = Date.now();
    try {
      const data = await upPostFetch(Object.assign({}, upAuth(), body), 30000);
      if (opts.log) opts.log('sent in ' + (Date.now() - t0) + ' ms' + (n > 1 ? ' (try ' + n + ')' : ''));
      return data;
    } catch (e1) {
      if (e1 && e1.fromServer) throw e1;
      last = e1;
      if (opts.log) opts.log('direct route failed after ' + (Date.now() - t0) + ' ms: ' + (e1 && e1.message || e1) + '; trying the other route');
      const t1 = Date.now();
      try {
        const data = await upPostForm(Object.assign({}, upAuth(), body), 40000);
        if (opts.log) opts.log('other route worked in ' + (Date.now() - t1) + ' ms');
        return data;
      } catch (e2) {
        if (e2 && e2.fromServer) throw e2;
        last = e2;
        if (opts.log) opts.log('other route failed after ' + (Date.now() - t1) + ' ms: ' + (e2 && e2.message || e2));
      }
    }
    if (n < tries) await upSleep(Math.min(20000, 1000 * Math.pow(2, n - 1)));
  }
  throw last || new Error('The upload could not be sent.');
}

/**
 * Sends one compressed picture (base64 JPEG) and resolves with its Drive file id. uploadId stays the same for retries of the same picture, so the
 * server never saves it twice. opts: { uploadId, onProgress(done, total), log(line) }.
 */
async function uploadChunked(kind, refLabel, b64, opts) {
  opts = opts || {};
  if (window.MOCK_UPLOAD_B64) return window.MOCK_UPLOAD_B64(b64, opts.mime);
  const uploadId = opts.uploadId || upId('up');
  const total = Math.max(1, Math.ceil(b64.length / UP_PIECE));
  let missing = []; for (let i = 0; i < total; i++) missing.push(i);
  const common = { mode: 'chunk', uploadId: uploadId, total: total, kind: kind, refLabel: refLabel, mime: opts.mime || 'image/jpeg' };
  let sent = 0;
  for (let round = 0; round < 4; round++) {
    for (const i of missing) {
      const r = await upSend(Object.assign({}, common, { index: i, data: b64.slice(i * UP_PIECE, (i + 1) * UP_PIECE) }), { log: opts.log ? function (l) { opts.log('piece ' + (i + 1) + '/' + total + ': ' + l); } : null });
      sent++; if (opts.onProgress) opts.onProgress(Math.min(sent, total), total);
      if (r && r.done) return r.fileId;
    }
    const fin = await upSend(Object.assign({}, common, { finish: true }), { log: opts.log });
    if (fin && fin.done) return fin.fileId;
    missing = (fin && fin.missing && fin.missing.length) ? fin.missing : missing;   // the server lost some pieces: send just those again
    if (opts.log) opts.log('the server asked for ' + missing.length + ' piece(s) again');
  }
  throw new Error('The picture could not be sent completely. Check your signal and try again.');
}

// ---------- the phone's own durable storage (IndexedDB), with a plain-memory fallback ----------
const LocalStore = (function () {
  let dbp = null; const mem = {};
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open('at_outbox', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('items', { keyPath: 'key' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        try {
          const t = db.transaction('items', mode), st = t.objectStore('items');
          const out = fn(st);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error || new Error('storage aborted')); };
        } catch (e) { reject(e); }
      });
    });
  }
  return {
    put: function (item) { return tx('readwrite', function (st) { if (!st) { mem[item.key] = item; return; } return st.put(item); }); },
    del: function (key) { return tx('readwrite', function (st) { if (!st) { delete mem[key]; return; } return st.delete(key); }); },
    all: function () {
      return open().then(function (db) {
        if (!db) return Object.keys(mem).map(function (k) { return mem[k]; });
        return new Promise(function (resolve, reject) { const r = db.transaction('items', 'readonly').objectStore('items').getAll(); r.onsuccess = function () { resolve(r.result || []); }; r.onerror = function () { reject(r.error); }; });
      });
    },
    persistent: function () { return open().then(function (db) { return !!db; }); }
  };
})();

/** "Test photo upload" in Help: sends a tiny picture and says exactly where it stops, with timings. */
async function runUploadTest(log) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#1b5ec7'; g.font = '20px sans-serif'; g.fillText('Upload test ' + new Date().toISOString().slice(0, 19), 10, 100);
  const b64 = c.toDataURL('image/jpeg', 0.7).split(',')[1];
  log('Phone: ' + (typeof perfDevice === 'function' ? perfDevice() : navigator.userAgent) + ' · network ' + ((navigator.connection && navigator.connection.effectiveType) || 'unknown') + ' · online ' + navigator.onLine);
  log('Storage on this phone: ' + ((await LocalStore.persistent()) ? 'durable (IndexedDB)' : 'memory only (pictures would not survive closing the app)'));
  log('Picture of ' + Math.round(b64.length * 0.75 / 1024) + ' KB, ' + Math.max(1, Math.ceil(b64.length / UP_PIECE)) + ' piece(s).');
  const t0 = Date.now();
  try {
    const id = await uploadChunked('test', 'UPLOADTEST', b64, { log: function (l) { log('  ' + l); } });
    log('RESULT: it works. The picture is saved (' + id + ') in ' + (Date.now() - t0) + ' ms.');
    return true;
  } catch (e) {
    log('RESULT: it FAILED after ' + (Date.now() - t0) + ' ms: ' + (e && e.message || e));
    return false;
  }
}
