/* Offline support: the app itself is network-first (so updates arrive straight away)
   with a cached copy for when there's no signal. Map tiles she has viewed are kept too. */
var VERSION = 'v3-2026-10-21';
var APP = 'app-' + VERSION, TILES = 'tiles-v1';
var SHELL = ['./', 'index.html', 'css/app.css', 'planner.js', 'js/app.js', 'js/today.js', 'js/race.js', 'js/run.js', 'js/fuel.js', 'js/kit.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css'];
var TILE_HOSTS = ['tiles.openfreemap.org', 's3.amazonaws.com'];
var APP_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
var MAX_TILES = 3000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== APP && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(APP).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined) || Response.error();
    });
  });
}

var trimCount = 0;
function cacheFirstTile(req) {
  return caches.open(TILES).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          c.put(req, res.clone());
          if (++trimCount % 200 === 0) c.keys().then(function (keys) { keys.slice(0, Math.max(0, keys.length - MAX_TILES)).forEach(function (k) { c.delete(k); }); });
        }
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (TILE_HOSTS.indexOf(url.hostname) >= 0 && !/\/styles\//.test(url.pathname)) { e.respondWith(cacheFirstTile(req)); return; }
  if (url.origin === self.location.origin || APP_HOSTS.indexOf(url.hostname) >= 0 || (url.hostname === 'tiles.openfreemap.org')) {
    e.respondWith(networkFirst(req));
  }
  // Everything else (routing, place search, weather) goes straight to the network;
  // the app keeps its own copies of forecasts for offline use.
});
