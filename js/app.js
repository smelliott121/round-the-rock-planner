/*
 * App core: storage, events, services (routing, elevation, weather, tides,
 * places, water/toilets), the map, the slide-up sheet, tabs, notes, fly-through.
 * Tab modules (today, race, run, fuel, kit) register with App.tab().
 */
(function () {
  'use strict';
  var P = window.Planner;
  var $ = function (id) { return document.getElementById(id); };

  // Storage keys. The first five are the ones the earlier pages used, so saved data carries over.
  var KEYS = {
    planner: 'rtr-planner-v1', section: 'rtr-map-v1', gen: 'rtr-gen-v1', routes: 'rtr-routes-v1', geo: 'rtr-geo-v1',
    app: 'rtr-app-v1', notes: 'rtr-notes-v1', gut: 'rtr-gut-v1', kit: 'rtr-kit-v1', shoes: 'rtr-shoes-v1',
    wx: 'rtr-wx-v1', pois: 'rtr-pois-v1'
  };

  function load(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('Phone storage is full, so that wasn\'t saved. Delete an old route and try again.'); return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function limiter(gap) {
    var next = 0;
    return function () { var now = Date.now(), wait = Math.max(0, next - now); next = now + wait + gap; return sleep(wait); };
  }

  // ---------- Events ----------
  var handlers = {};
  function on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); }
  function emit(evt, data) { (handlers[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  // ---------- Toast and banner ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function banner(msg) { var b = $('banner'); if (msg) { b.textContent = msg; b.hidden = false; } else b.hidden = true; }

  // ---------- Shared planner data (race + fuel) ----------
  var FIELDS = ['target', 'start', 'finishCutoff', 'fatigue', 'carbs', 'fluid', 'weight', 'sweatRate', 'sweatNa', 'caffKm'];
  var pd = load(KEYS.planner, {}) || {};
  var planner = {
    fields: pd.fields || FIELDS.reduce(function (o, k) { if (pd[k] != null) o[k] = pd[k]; return o; }, {}),
    checkpoints: Array.isArray(pd.checkpoints) ? pd.checkpoints : [],
    products: Array.isArray(pd.products) ? pd.products : [],
    gpx: pd.gpx || null,
    eleCache: pd.eleCache || null,
    save: function () {
      return save(KEYS.planner, { fields: planner.fields, checkpoints: planner.checkpoints, products: planner.products, gpx: planner.gpx, eleCache: planner.eleCache });
    }
  };
  function bindFields() {
    FIELDS.forEach(function (k) {
      var el = $(k); if (!el) return;
      if (planner.fields[k] != null) el.value = planner.fields[k];
      el.addEventListener('input', function () { planner.fields[k] = el.value; planner.save(); emit('plan'); });
    });
  }
  function num(k, def) { var v = parseFloat($(k) ? $(k).value : planner.fields[k]); return isNaN(v) ? def : v; }

  // ---------- Services ----------
  var osrmGate = limiter(1100), geoGate = limiter(1100), overpassGate = limiter(1000);

  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function elevation(prof) {
    var s = P.elevationSamples(prof, 0.2), out = [], starts = [];
    for (var i = 0; i < s.idx.length; i += 100) starts.push(i);
    return starts.reduce(function (p, a) {
      return p.then(function () {
        return getJSON('https://api.open-meteo.com/v1/elevation?latitude=' + s.lat.slice(a, a + 100).join(',') +
          '&longitude=' + s.lon.slice(a, a + 100).join(',')).then(function (j) {
          if (!j || !Array.isArray(j.elevation)) throw new Error('Bad elevation');
          out = out.concat(j.elevation);
        });
      });
    }, Promise.resolve()).then(function () { return { profile: P.applyElevation(prof, s.idx, out), cache: { n: prof.dist.length, idx: s.idx, ele: out } }; });
  }
  function withElevation(points) {
    var prof = P.buildProfile(points);
    return prof.hasEle ? Promise.resolve(prof) : elevation(prof).then(function (r) { return r.profile; });
  }

  // FOSSGIS OSRM foot routing: at most one request per second (their policy).
  function route(points) {
    return osrmGate().then(function () {
      return getJSON('https://routing.openstreetmap.de/routed-foot/route/v1/driving/' +
        points.map(function (p) { return p.lon.toFixed(5) + ',' + p.lat.toFixed(5); }).join(';') +
        '?overview=full&geometries=geojson&continue_straight=false');
    }).then(function (j) {
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('No route');
      return { coords: j.routes[0].geometry.coordinates, km: j.routes[0].distance / 1000 };
    });
  }

  // Nominatim: only when Lucy presses Find, cached, one request per second.
  function geocode(q) {
    var key = q.trim().toLowerCase(), cache = load(KEYS.geo, {}) || {};
    if (cache[key]) return Promise.resolve(cache[key].r);
    return geoGate().then(function () {
      return getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en-GB&q=' + encodeURIComponent(q.trim()));
    }).then(function (list) {
      var places = (list || []).map(function (p) { return { name: p.display_name, lat: +p.lat, lon: +p.lon }; });
      cache[key] = { t: Date.now(), r: places };
      Object.keys(cache).sort(function (a, b) { return cache[b].t - cache[a].t; }).slice(30).forEach(function (k) { delete cache[k]; });
      save(KEYS.geo, cache);
      return places;
    });
  }

  function cached(kind, lat, lon, ttlMin, fetcher) {
    var store = load(KEYS.wx, {}) || {};
    var key = kind + ':' + lat.toFixed(2) + ',' + lon.toFixed(2);
    var hit = store[key];
    if (hit && Date.now() - hit.t < ttlMin * 60000) return Promise.resolve(hit.d);
    return fetcher().then(function (d) {
      store[key] = { t: Date.now(), d: d };
      Object.keys(store).sort(function (a, b) { return store[b].t - store[a].t; }).slice(8).forEach(function (k) { delete store[k]; });
      save(KEYS.wx, store);
      return d;
    }, function (err) { if (hit) return hit.d; throw err; });   // offline: fall back to the last forecast
  }

  function weather(lat, lon) {
    return cached('wx', lat, lon, 30, function () {
      return getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
        '&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code' +
        '&daily=sunrise,sunset,temperature_2m_max,uv_index_max&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code' +
        '&timezone=auto&wind_speed_unit=mph&forecast_days=16&timeformat=unixtime');
    });
  }

  function tides(lat, lon) {
    return cached('tide', lat, lon, 180, function () {
      return getJSON('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
        '&hourly=sea_level_height_msl&timezone=auto&forecast_days=3&timeformat=unixtime');
    });
  }

  // Public Overpass servers. The main one is often overloaded, so try the next if it's
  // busy, rate-limited, slow or unreachable.
  var OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];
  function overpassQuery(q) {
    var i = 0;
    function attempt() {
      var url = OVERPASS[i] + '?data=' + encodeURIComponent(q);
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
      return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function (err) {
        clearTimeout(timer);
        if (++i < OVERPASS.length) return attempt();
        throw err;
      });
    }
    return attempt();
  }

  // Overpass: water taps and toilets inside a box. Cached per rounded box.
  function pois(s, w, n, e) {
    var key = [s, w, n, e].map(function (v) { return v.toFixed(2); }).join(',');
    var store = load(KEYS.pois, {}) || {};
    if (store[key] && Date.now() - store[key].t < 7 * 86400000) return Promise.resolve(store[key].d);
    var bbox = [s, w, n, e].map(function (v) { return v.toFixed(4); }).join(',');
    var q = '[out:json][timeout:20];(node["amenity"="drinking_water"](' + bbox + ');node["amenity"="water_point"](' + bbox + ');' +
      'node["amenity"="toilets"](' + bbox + '););out body 300;';
    return overpassGate().then(function () { return overpassQuery(q); }).then(function (j) {
      var d = (j.elements || []).map(function (el) {
        var t = el.tags || {};
        return { lat: el.lat, lon: el.lon, kind: t.amenity === 'toilets' ? 'toilet' : 'water', name: t.name || '', hours: t.opening_hours || '', fee: t.fee || '' };
      });
      store[key] = { t: Date.now(), d: d };
      Object.keys(store).sort(function (a, b) { return store[b].t - store[a].t; }).slice(15).forEach(function (k) { delete store[k]; });
      save(KEYS.pois, store);
      return d;
    });
  }

  // ---------- Map ----------
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var map = null, mapReady = false, readyQueue = [], flat = false;
  var gen = load(KEYS.gen, {}) || {};
  var home = gen.start ? [gen.start.lon, gen.start.lat] : [-2.13, 49.215];

  function lineOf(points) {
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(function (p) { return [p.lon, p.lat]; }) } };
  }
  function pointOf(p) { return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }; }

  function initMap() {
    map = new maplibregl.Map({
      container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
      center: home, zoom: gen.start ? 12 : 10.6, pitch: 50, bearing: -15, maxPitch: 80,
      attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');

    var TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
    map.on('load', function () {
      map.addSource('dem', { type: 'raster-dem', tiles: TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles on AWS</a>' });
      map.addSource('dem-shade', { type: 'raster-dem', tiles: TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
      var firstSymbol = (map.getStyle().layers || []).find(function (l) { return l.type === 'symbol'; });
      map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-shade',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#2c3a33' } }, firstSymbol && firstSymbol.id);
      map.setTerrain({ source: 'dem', exaggeration: 1.8 });

      ['course', 'section', 'others', 'route', 'start', 'runner', 'pois'].forEach(function (id) { map.addSource(id, { type: 'geojson', data: EMPTY }); });
      var round = { 'line-join': 'round', 'line-cap': 'round' };
      map.addLayer({ id: 'course', type: 'line', source: 'course', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'others', type: 'line', source: 'others', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.6 } });
      ['section', 'route'].forEach(function (id) {
        map.addLayer({ id: id + '-casing', type: 'line', source: id, layout: round, paint: { 'line-color': '#22292b', 'line-width': 8, 'line-opacity': 0.55 } });
        map.addLayer({ id: id, type: 'line', source: id, layout: round, paint: { 'line-color': '#f0b81c', 'line-width': 5 } });
      });
      map.addLayer({ id: 'start', type: 'circle', source: 'start',
        paint: { 'circle-radius': 8, 'circle-color': '#0e5a63', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      map.addLayer({ id: 'pois', type: 'circle', source: 'pois', layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
          'circle-color': ['match', ['get', 'kind'], 'toilet', '#7b4f8e', '#2d86c9'] } });
      map.addLayer({ id: 'runner', type: 'circle', source: 'runner',
        paint: { 'circle-radius': 8, 'circle-color': '#f0b81c', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });

      map.on('click', 'pois', function (e) {
        var f = e.features[0], pr = f.properties;
        var html = '<b>' + (pr.kind === 'toilet' ? 'Toilets' : 'Drinking water') + '</b>' + (pr.name ? esc(pr.name) + '<br>' : '') +
          (pr.hours ? 'Open: ' + esc(pr.hours) + '<br>' : '') + (pr.fee === 'yes' ? 'Charge to use' : '');
        new maplibregl.Popup({ offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
      });

      mapReady = true;
      padMap();
      readyQueue.splice(0).forEach(function (fn) { try { fn(); } catch (err) { console.error(err); } });
    });

    map.on('click', function (e) {
      if (flying || Date.now() - stoppedAt < 600) return;
      if (mapReady && poisOn && map.queryRenderedFeatures(e.point, { layers: ['pois'] }).length) return;
      if (noteMode) { newNoteAt(e.lngLat); return; }
      var t = tabs[current];
      if (t && t.onMapClick) t.onMapClick(e);
    });
  }

  function whenMap(fn) { if (mapReady) fn(); else readyQueue.push(fn); }
  function flyTo(opts) { whenMap(function () { map.flyTo(opts); }); }
  function setData(src, data) { whenMap(function () { map.getSource(src).setData(data || EMPTY); }); }
  function showLayers(ids) {
    whenMap(function () {
      ['course', 'section-casing', 'section', 'others', 'route-casing', 'route', 'start'].forEach(function (id) {
        map.setLayoutProperty(id, 'visibility', ids.indexOf(id.replace('-casing', '')) >= 0 ? 'visible' : 'none');
      });
    });
  }
  function fitPoints(points, opts) {
    whenMap(function () {
      if (!points || points.length < 2) return;
      var b = new maplibregl.LngLatBounds();
      points.forEach(function (p) { b.extend([p.lon, p.lat]); });
      map.fitBounds(b, Object.assign({ padding: 40, pitch: flat ? 0 : 50, duration: 900, maxZoom: 15 }, opts || {}));
    });
  }
  function isWide() { return window.matchMedia('(min-width: 900px)').matches; }
  function padMap() {
    if (!map) return;
    if (isWide()) { map.setPadding({ left: 470, top: 20, right: 60, bottom: 20 }); return; }
    var vis = Math.max(0, window.innerHeight - sheetEl().getBoundingClientRect().top);
    map.setPadding({ top: 20, left: 10, right: 56, bottom: Math.min(vis, window.innerHeight * 0.75) });
  }

  // ---------- Fly-through ----------
  var flying = false, rafId = null, flyEnd = null, stoppedAt = 0;
  function fly(prof, i0, i1, onEnd) {
    if (!mapReady || flying) return;
    i1 = Math.min(prof.dist.length - 1, i1);
    if (i1 - i0 < 3) return;
    flying = true; flyEnd = onEnd || null;
    var prevSnap = sheetState;
    setSheet('peek');
    var duration = Math.max(15000, Math.min(70000, (prof.dist[i1] - prof.dist[i0]) * 3500));
    var t0 = null, heading = null;
    function pt(f) {
      var k = Math.min(i1, Math.max(i0, f)), i = Math.floor(k), r = k - i, j = Math.min(i1, i + 1);
      return { lat: prof.lat[i] + r * (prof.lat[j] - prof.lat[i]), lon: prof.lon[i] + r * (prof.lon[j] - prof.lon[i]) };
    }
    function frame(ts) {
      if (!flying) return;
      if (t0 == null) t0 = ts;
      var u = Math.min(1, (ts - t0) / duration), f = i0 + u * (i1 - i0);
      var here = pt(f), want = P.bearing(here, pt(f + 6));
      if (heading == null) heading = want;
      heading = (heading + (((want - heading + 540) % 360) - 180) * 0.06 + 360) % 360;
      map.getSource('runner').setData(pointOf(here));
      map.jumpTo({ center: [here.lon, here.lat], bearing: heading, pitch: 62, zoom: 14.6 });
      if (u < 1) rafId = requestAnimationFrame(frame); else stopFly();
    }
    var s0 = pt(i0);
    banner('Flying through. Tap the map to stop.');
    map.flyTo({ center: [s0.lon, s0.lat], zoom: 14.6, pitch: 62, duration: 1200 });
    map.once('moveend', function () { if (flying) rafId = requestAnimationFrame(frame); });
    flyEnd = function () { setSheet(prevSnap); if (onEnd) onEnd(); };
  }
  function stopFly() {
    if (!flying) return;
    flying = false; stoppedAt = Date.now(); cancelAnimationFrame(rafId); banner(null);
    if (mapReady) map.getSource('runner').setData(EMPTY);
    var cb = flyEnd; flyEnd = null; if (cb) cb();
  }

  // ---------- Elevation profile SVG ----------
  function profileSVG(prof, opts) {
    opts = opts || {};
    var W = 800, H = opts.height || 140, padT = 8, padB = opts.axis ? 20 : 6;
    var n = prof.dist.length, step = Math.max(1, Math.floor(n / 400));
    var minE = Math.min.apply(null, prof.ele), maxE = Math.max.apply(null, prof.ele);
    if (maxE - minE < 20) maxE = minE + 20;
    var x = function (km) { return (km / prof.totalKm) * W; };
    var y = function (e) { return padT + (1 - (e - minE) / (maxE - minE)) * (H - padT - padB); };
    var base = '';
    for (var i = 0; i < n; i += step) base += (i ? ' L' : 'M') + x(prof.dist[i]).toFixed(1) + ',' + y(prof.ele[i]).toFixed(1);
    base += ' L' + x(prof.totalKm).toFixed(1) + ',' + y(prof.ele[n - 1]).toFixed(1);
    var from = opts.from != null ? opts.from : 0, to = opts.to != null ? opts.to : prof.totalKm;
    var i0 = Math.round(from / P.STEP_KM), i1 = Math.min(n - 1, Math.round(to / P.STEP_KM));
    var hi = '';
    for (var j = i0; j <= i1; j++) hi += (j === i0 ? 'M' : ' L') + x(prof.dist[j]).toFixed(1) + ',' + y(prof.ele[j]).toFixed(1);
    var area = hi + ' L' + x(prof.dist[i1]).toFixed(1) + ',' + (H - padB) + ' L' + x(prof.dist[i0]).toFixed(1) + ',' + (H - padB) + ' Z';
    var whole = from <= 0 && to >= prof.totalKm;
    var marks = (opts.marks || []).map(function (km) {
      var xx = x(km).toFixed(1);
      return '<line x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--sea)" stroke-width="1.5" stroke-dasharray="4 4"/>';
    }).join('');
    var axis = '';
    if (opts.axis) {
      var stepKm = prof.totalKm > 40 ? 10 : prof.totalKm > 15 ? 5 : 2;
      for (var k = 0; k <= prof.totalKm; k += stepKm) {
        axis += '<text x="' + Math.min(W - 14, Math.max(8, x(k))) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="13" fill="var(--stone)">' + k + '</text>';
      }
      axis += '<text x="4" y="' + (padT + 12) + '" font-size="13" fill="var(--stone)">' + Math.round(maxE) + ' m</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Elevation profile, ' + Math.round(minE) + ' to ' + Math.round(maxE) + ' metres">' +
      (whole ? '' : '<path d="' + base + '" fill="none" stroke="var(--stone)" stroke-width="1.5" opacity="0.5"/>') +
      '<path d="' + area + '" fill="var(--fill)"/>' +
      '<path d="' + hi + '" fill="none" stroke="var(--gorse)" stroke-width="2.5"/>' + marks + axis + '</svg>';
  }
  function kmFromSvgClick(ev, el, totalKm) {
    var svg = el.querySelector('svg'); if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return (ev.clientX - r.left) / r.width * totalKm;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/gpx+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route'; }

  // ---------- Sheet ----------
  var sheetState = 'half';
  function sheetEl() { return $('sheet'); }
  function snapY(state) {
    var el = sheetEl(), H = el.offsetHeight, vh = window.innerHeight;
    var tab = 62;
    var visible = state === 'full' ? H : state === 'peek' ? 132 + tab : Math.round(vh * 0.5);
    return Math.max(0, H - visible);
  }
  function setSheet(state) {
    sheetState = state;
    if (isWide()) { sheetEl().style.transform = ''; $('sheetBody').style.paddingBottom = ''; padMap(); return; }
    var y = snapY(state);
    sheetEl().style.transform = 'translateY(' + y + 'px)';
    // The lower part of the sheet is off-screen when it's not fully open, so add that
    // much room at the end of the scroll area to keep every control reachable.
    $('sheetBody').style.paddingBottom = (y + 28) + 'px';
    setTimeout(padMap, 340);
  }
  function initSheet() {
    var el = sheetEl(), head = $('sheetHead');
    var startY = 0, startT = 0, lastY = 0, lastT = 0, moved = false, dragging = false;
    function currentT() { var m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform); return m ? +m[1] : snapY(sheetState); }
    head.addEventListener('pointerdown', function (e) {
      if (isWide()) return;
      dragging = true; moved = false; startY = lastY = e.clientY; startT = currentT(); lastT = Date.now();
      el.classList.add('dragging'); head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      var t = Math.max(0, Math.min(snapY('peek'), startT + dy));
      el.style.transform = 'translateY(' + t + 'px)';
      lastY = e.clientY; lastT = Date.now();
    });
    function end(e) {
      if (!dragging) return;
      dragging = false; el.classList.remove('dragging');
      if (!moved) { setSheet(sheetState === 'full' ? 'half' : sheetState === 'half' ? 'full' : 'half'); return; }
      var t = currentT();
      $('sheetBody').style.paddingBottom = (t + 28) + 'px';
      var vel = (e.clientY - lastY) / Math.max(1, Date.now() - lastT);
      var opts = ['full', 'half', 'peek'].map(function (s) { return { s: s, y: snapY(s) }; });
      var target = t + vel * 180;
      opts.sort(function (a, b) { return Math.abs(a.y - target) - Math.abs(b.y - target); });
      setSheet(opts[0].s);
    }
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    window.addEventListener('resize', function () { setSheet(sheetState); });
  }

  // ---------- Tabs ----------
  var tabs = {}, order = [], current = null;
  var appState = load(KEYS.app, {}) || {};
  function saveApp() { save(KEYS.app, appState); }

  function tab(name, def) { tabs[name] = def; order.push(name); }
  function show(name) {
    if (!tabs[name]) name = 'today';
    if (flying) stopFly();
    if (noteMode) setNoteMode(false);
    var prev = tabs[current];
    if (prev && prev.hide) prev.hide();
    current = name; appState.tab = name; saveApp();
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('on', p.id === 'p-' + name); });
    document.querySelectorAll('.tabbar [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'); });
    var def = tabs[name];
    $('sheetTitle').textContent = def.title;
    $('sheetAside').textContent = def.aside ? def.aside() : '';
    $('sheetBody').scrollTop = 0;
    if (history.replaceState) history.replaceState(null, '', '#' + name);
    setSheet(def.snap || 'half');
    if (def.show) def.show();
  }
  function refreshAside() { var d = tabs[current]; $('sheetAside').textContent = d && d.aside ? d.aside() : ''; }

  // Segmented control inside a panel that swaps [data-sub] blocks.
  function subnav(navId, key, onChange) {
    var nav = $(navId), panel = nav.closest('.panel');
    var subs = panel.querySelectorAll('.sub');
    var val = (appState.sub || {})[key] || nav.querySelector('button').dataset.v;
    function set(v) {
      val = v;
      nav.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); });
      subs.forEach(function (s) { s.hidden = s.dataset.sub !== v; });
      appState.sub = appState.sub || {}; appState.sub[key] = v; saveApp();
      if (onChange) onChange(v);
    }
    nav.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) set(b.dataset.v); });
    set(val);
    return { set: set, get: function () { return val; } };
  }
  // Plain segmented option (no sub-panels).
  function seg(id, value, onSet) {
    var box = $(id);
    function paint(v) { box.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === String(v) ? 'true' : 'false'); }); }
    box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; paint(b.dataset.v); onSet(b.dataset.v); });
    paint(value);
    return { set: paint };
  }

  // ---------- Notes on the map ----------
  var NOTE_KINDS = [
    { v: 'water', label: 'Water', icon: '💧' }, { v: 'toilet', label: 'Toilet', icon: '🚻' },
    { v: 'crew', label: 'Crew spot', icon: '👋' }, { v: 'climb', label: 'Steep or steps', icon: '⛰️' },
    { v: 'hazard', label: 'Take care', icon: '⚠️' }, { v: 'note', label: 'Note', icon: '📝' }
  ];
  var notes = load(KEYS.notes, []) || [];
  var noteMarkers = [], noteMode = false, draftPopup = null;
  function kindOf(v) { return NOTE_KINDS.find(function (k) { return k.v === v; }) || NOTE_KINDS[5]; }
  function drawNotes() {
    whenMap(function () {
      noteMarkers.forEach(function (m) { m.remove(); }); noteMarkers = [];
      notes.forEach(function (n) {
        var el = document.createElement('div');
        el.className = 'note-marker'; el.setAttribute('role', 'button'); el.setAttribute('aria-label', kindOf(n.kind).label + ': ' + n.text);
        el.innerHTML = '<span>' + kindOf(n.kind).icon + '</span>';
        var pop = new maplibregl.Popup({ offset: 22 });
        var box = document.createElement('div');
        box.innerHTML = '<b>' + esc(kindOf(n.kind).label) + '</b>' + esc(n.text || '') + '<br><span style="color:#5d6a6c;font-size:12px">' + esc(n.created || '') + '</span><br>';
        var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete note';
        del.addEventListener('click', function () {
          notes = notes.filter(function (x) { return x.id !== n.id; }); save(KEYS.notes, notes); pop.remove(); drawNotes(); toast('Note deleted');
        });
        box.appendChild(del); pop.setDOMContent(box);
        el.addEventListener('click', function (ev) { ev.stopPropagation(); });
        noteMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-4, 0] }).setLngLat([n.lon, n.lat]).setPopup(pop).addTo(map));
      });
    });
  }
  function setNoteMode(onOff) {
    noteMode = onOff;
    $('toolNote').classList.toggle('on', onOff); $('toolNote').setAttribute('aria-pressed', onOff ? 'true' : 'false');
    banner(onOff ? 'Tap the map where the note should go' : null);
    if (onOff && sheetState === 'full') setSheet('half');
  }
  function newNoteAt(lngLat) {
    setNoteMode(false);
    if (draftPopup) draftPopup.remove();
    var box = document.createElement('div');
    box.innerHTML = '<b>New note</b><select aria-label="Type of note" style="min-height:34px;margin:4px 0">' +
      NOTE_KINDS.map(function (k) { return '<option value="' + k.v + '">' + k.icon + ' ' + k.label + '</option>'; }).join('') +
      '</select><input aria-label="Note text" placeholder="e.g. tap by the café" style="min-height:34px">' +
      '<div style="display:flex;gap:12px;margin-top:6px"><button type="button" data-a="save" style="color:#0e5a63;font-weight:600">Save</button><button type="button" data-a="cancel" style="color:#5d6a6c">Cancel</button></div>';
    draftPopup = new maplibregl.Popup({ closeOnClick: false, offset: 8 }).setLngLat(lngLat).setDOMContent(box).addTo(map);
    box.querySelector('input').focus();
    box.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'save') {
        notes.push({ id: 'n' + Date.now(), lat: +lngLat.lat.toFixed(6), lon: +lngLat.lng.toFixed(6),
          kind: box.querySelector('select').value, text: box.querySelector('input').value.trim(), created: new Date().toISOString().slice(0, 10) });
        save(KEYS.notes, notes); drawNotes(); toast('Note saved');
      }
      draftPopup.remove(); draftPopup = null;
    });
  }

  // ---------- Water and toilets ----------
  var poisOn = false, poiData = [];
  function setPois(onOff) {
    poisOn = onOff;
    $('toolPois').classList.toggle('on', onOff); $('toolPois').setAttribute('aria-pressed', onOff ? 'true' : 'false');
    whenMap(function () { map.setLayoutProperty('pois', 'visibility', onOff ? 'visible' : 'none'); });
    if (onOff) loadPoisInView();
  }
  function loadPoisInView() {
    whenMap(function () {
      if (map.getZoom() < 10.5) { toast('Zoom in a little to see water taps and toilets'); return; }
      var b = map.getBounds();
      pois(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).then(function (d) {
        mergePois(d);
        var w = d.filter(function (p) { return p.kind === 'water'; }).length, t = d.length - w;
        toast(d.length ? 'Showing ' + w + ' water ' + (w === 1 ? 'tap' : 'taps') + ' and ' + t + ' ' + (t === 1 ? 'toilet' : 'toilets') : 'No water taps or toilets mapped around here');
      }, function () { toast('The water and toilet map service is busy right now. Try again in a minute.'); });
    });
  }
  function mergePois(d) {
    var seen = {};
    poiData = poiData.concat(d).filter(function (p) { var k = p.lat.toFixed(5) + p.lon.toFixed(5) + p.kind; if (seen[k]) return false; seen[k] = 1; return true; });
    setData('pois', { type: 'FeatureCollection', features: poiData.map(function (p) {
      return { type: 'Feature', properties: { kind: p.kind, name: p.name, hours: p.hours, fee: p.fee }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
    }) });
  }
  // Water and toilets within `metres` of a route (also shows them on the map).
  function poisNear(points, metres) {
    var s = 90, w = 180, n = -90, e = -180;
    points.forEach(function (p) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); });
    var pad = 0.004;
    return pois(s - pad, w - pad, n + pad, e + pad).then(function (d) {
      mergePois(d);
      var step = Math.max(1, Math.floor(points.length / 600));
      var thin = points.filter(function (_, i) { return i % step === 0; });
      return d.filter(function (q) {
        return thin.some(function (p) { return Math.abs(p.lat - q.lat) < 0.002 && Math.abs(p.lon - q.lon) < 0.003 && hav(p, q) <= metres; });
      });
    });
  }
  function hav(a, b) {
    var r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ---------- Weather helpers ----------
  var WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail' };
  function wxText(code) { return WX[code] || ''; }
  function compass(deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
  // Wind arrow points the way the wind is blowing to.
  function windArrow(deg) { return '<span class="arrow" aria-hidden="true" style="transform:rotate(' + ((deg + 180) % 360) + 'deg)">↑</span>'; }
  // Local clock for a unix time in the forecast's own time zone.
  function clockAt(unix, offsetSec) {
    var d = new Date((unix + offsetSec) * 1000);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function dayKey(unix, offsetSec) { return new Date((unix + offsetSec) * 1000).toISOString().slice(0, 10); }

  // ---------- Start ----------
  function start() {
    initSheet();
    try { initMap(); }
    catch (e) {
      // No map library (e.g. first open with no signal): everything else still works.
      $('map').innerHTML = '<p style="padding:80px 24px;text-align:center;color:#5d6a6c">The map needs a connection the first time it opens. Everything else works without it.</p>';
      document.querySelector('.map-tools').hidden = true;
    }
    bindFields();
    order.forEach(function (n) { if (tabs[n].init) tabs[n].init(); });
    document.querySelectorAll('.tabbar [data-tab]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
    $('toolNote').addEventListener('click', function () { setNoteMode(!noteMode); });
    $('toolPois').addEventListener('click', function () { setPois(!poisOn); });
    $('toolView').addEventListener('click', function () {
      flat = !flat;
      whenMap(function () {
        map.setTerrain(flat ? null : { source: 'dem', exaggeration: 1.8 });
        map.easeTo({ pitch: flat ? 0 : 50, bearing: flat ? 0 : -15, duration: 700 });
      });
      toast(flat ? 'Flat map' : '3D map');
    });
    whenMap(function () {
      map.on('moveend', function () { if (poisOn && !flying) loadPoisInView(); });
      map.on('dragstart', function () { if (flying) stopFly(); });
    });
    $('map').addEventListener('pointerdown', function () { if (flying) stopFly(); });
    drawNotes();
    var first = (location.hash || '').replace('#', '') || appState.tab || 'today';
    show(first);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  window.App = {
    P: P, $: $, KEYS: KEYS, load: load, save: save, esc: esc, sleep: sleep, on: on, emit: emit, toast: toast, banner: banner,
    planner: planner, num: num,
    route: route, geocode: geocode, weather: weather, tides: tides, elevation: elevation, withElevation: withElevation, poisNear: poisNear,
    whenMap: whenMap, flyTo: flyTo, setData: setData, showLayers: showLayers, fitPoints: fitPoints, lineOf: lineOf, pointOf: pointOf,
    map: function () { return map; }, isFlat: function () { return flat; },
    fly: fly, stopFly: stopFly, isFlying: function () { return flying; },
    profileSVG: profileSVG, kmFromSvgClick: kmFromSvgClick, download: download, slug: slug,
    setSheet: setSheet, sheetState: function () { return sheetState; },
    tab: tab, show: show, current: function () { return current; }, refreshAside: refreshAside, subnav: subnav, seg: seg,
    state: appState, saveState: saveApp,
    wxText: wxText, compass: compass, windArrow: windArrow, clockAt: clockAt, dayKey: dayKey,
    start: start
  };
})();
