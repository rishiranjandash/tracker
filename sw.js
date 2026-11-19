/**
 * Keeps the app itself (the page, scripts and styles) on the phone, so it opens at once and also with no signal at all.
 * Only files from this site are handled; every call to the server (Google Apps Script) and Google sign-in go straight to the network, untouched.
 *   - the page: the network first (but only waits a few seconds), then the saved copy;
 *   - scripts, styles, icons: the saved copy at once, refreshed in the background. Their addresses carry the build number (?v=...), so a new release is a new address.
 */
const SHELL = 'at-shell-v1';
const MAX_FILES = 80;

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('at-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function keep(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(SHELL).then(function (c) {
    c.put(request, copy).then(function () {
      c.keys().then(function (ks) { if (ks.length > MAX_FILES) ks.slice(0, ks.length - MAX_FILES).forEach(function (k) { c.delete(k); }); });   // old builds' files are dropped
    });
  }).catch(function () { /* storage full: the app still works online */ });
  return response;
}

self.addEventListener('fetch', function (e) {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;                  // the server and Google sign-in are not ours to handle
  if (r.mode === 'navigate') {
    e.respondWith(new Promise(function (resolve) {
      let settled = false;
      const fallback = function () { caches.match(r, { ignoreSearch: true }).then(function (hit) { if (hit && !settled) { settled = true; resolve(hit); } }); };
      const timer = setTimeout(fallback, 4000);                    // a slow network: show the saved page instead of waiting
      fetch(r).then(function (res) { clearTimeout(timer); if (!settled) { settled = true; resolve(keep(r, res)); } else keep(r, res); },
        function () { clearTimeout(timer); caches.match(r, { ignoreSearch: true }).then(function (hit) { if (!settled) { settled = true; resolve(hit || Response.error()); } }); });
    }));
    return;
  }
  e.respondWith(caches.match(r).then(function (hit) {
    const net = fetch(r).then(function (res) { return keep(r, res); }, function () { return hit || Response.error(); });
    return hit || net;
  }));
});
