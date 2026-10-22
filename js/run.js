/* Run: make training routes anywhere, Lucy's saved routes, conditions and water along the way. */
(function () {
  'use strict';
  var A = window.App, P = A.P, $ = A.$, esc = A.esc;
  var gen = Object.assign({ start: null, km: 15, terrain: 'hilly', shape: 'loop', pace: '6:30' }, A.load(A.KEYS.gen, {}) || {});
  var library = A.load(A.KEYS.routes, []) || [];
  var results = [], current = null, busy = false, sub = null;
  var COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

  function saveGen() { A.save(A.KEYS.gen, gen); }
  function saveLib() { return A.save(A.KEYS.routes, library); }
  function flatPace() { var m = P.parseHM(gen.pace); return m != null ? m / 60 : 6.5; }

  // ---------- Start point ----------
  function setStart(lat, lon, name) {
    gen.start = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    A.state.placeName = name || null; A.saveState();
    saveGen(); drawStart(); A.emit('start-changed');
  }
  function drawStart() {
    $('go').disabled = !gen.start || busy;
    if (gen.start && !/Start set in/.test($('startInfo').textContent)) $('startInfo').textContent = 'Start set. Tap the map to move it.';
    A.setData('start', gen.start ? A.pointOf(gen.start) : null);
  }

  // ---------- Generator ----------
  function offset(p, km, deg) {
    var rad = Math.PI / 180, d = km / 6371, b = deg * rad, la = p.lat * rad, lo = p.lon * rad;
    var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 / rad, lon: lo2 / rad };
  }
  var WIGGLE = 1.25;   // paths wiggle, so aim the straight-line shape at about 80% of the distance
  function waypoints(start, km, bearing, shape) {
    if (shape === 'oab') return [start, offset(start, km / 2 / WIGGLE, bearing), start];
    var r = km / (2 * Math.PI * WIGGLE), c = offset(start, r, bearing), pts = [start];
    for (var k = 1; k <= 3; k++) pts.push(offset(c, r, bearing + 180 + k * 90));
    pts.push(start);
    return pts;
  }
  function candidate(bearing) {
    var target = gen.km;
    return A.route(waypoints(gen.start, target, bearing, gen.shape)).then(function (r1) {
      var ratio = target / r1.km;
      if (Math.abs(ratio - 1) <= 0.1) return r1;
      return A.route(waypoints(gen.start, target * ratio, bearing, gen.shape)).then(function (r2) {
        return Math.abs(r2.km - target) < Math.abs(r1.km - target) ? r2 : r1;
      }, function () { return r1; });
    }).then(function (r) { r.bearing = bearing; return r; });
  }

  function generate() {
    if (!gen.start || busy) return;
    busy = true; drawStart();
    results = []; renderResults(); A.setData('others', null);
    var bearings = [0, 60, 120, 180, 240, 300], found = [], done = 0, target = gen.km;
    $('progress').textContent = 'Finding paths (0 of 6)…';
    bearings.reduce(function (p, b) {
      return p.then(function () {
        return candidate(b).then(function (r) { found.push(r); }, function () {})
          .then(function () { done++; $('progress').textContent = 'Finding paths (' + done + ' of 6)…'; });
      });
    }, Promise.resolve()).then(function () {
      var near = found.filter(function (r) { return Math.abs(r.km - target) / target <= 0.2; });
      if (!near.length) throw new Error(found.length ? 'none-near' : 'none');
      $('progress').textContent = 'Checking the hills…';
      return near.reduce(function (p, r) {
        return p.then(function () {
          return A.withElevation(r.coords.map(function (c) { return { lat: c[1], lon: c[0], ele: null }; }))
            .then(function (prof) { r.profile = prof; }, function () { r.profile = null; });
        });
      }, Promise.resolve()).then(function () { return near.filter(function (r) { return r.profile; }); });
    }).then(function (scored) {
      if (!scored.length) throw new Error('elevation');
      scored.forEach(function (r) { r.up = r.profile.ascent; r.upPerKm = r.up / r.km; });
      if (gen.terrain === 'hilly') scored.sort(function (a, b) { return b.upPerKm - a.upPerKm; });
      else if (gen.terrain === 'flat') scored.sort(function (a, b) { return a.upPerKm - b.upPerKm; });
      else scored.sort(function (a, b) { return Math.abs(a.km - target) - Math.abs(b.km - target); });
      var picked = [];
      scored.forEach(function (r) {
        var dup = picked.some(function (q) { return Math.abs(q.km - r.km) < 0.3 && Math.abs(q.up - r.up) < 15; });
        if (!dup && picked.length < 3) picked.push(r);
      });
      var label = { hilly: 'Hilly', flat: 'Flat', rolling: '' }[gen.terrain];
      results = picked.map(function (r) {
        var name = (label ? label + ' ' : '') + Math.round(r.km) + ' km ' + (gen.shape === 'oab' ? 'out and back' : 'loop') + ' heading ' + COMPASS[Math.round(r.bearing / 45) % 8];
        return makeRoute(name, r.profile, 'gen');
      });
      $('progress').textContent = results.length === 1 ? 'One route found.' : results.length + ' routes found. Tap one to see it.';
      renderResults();
      select(results[0], true);
    }).catch(function (e) {
      $('progress').innerHTML = '<span class="error">' + (e.message === 'none-near' ? 'Couldn\'t get close to ' + target + ' km from here. Try another start point or distance.' :
        e.message === 'elevation' ? 'Found routes but couldn\'t check the hills. Check your connection and try again.' :
        'The route service didn\'t answer. Check your connection and try again in a minute.') + '</span>';
    }).then(function () { busy = false; drawStart(); });
  }

  function makeRoute(name, prof, source, id) {
    return { id: id || null, name: name, profile: prof, source: source,
      points: prof.raw.map(function (p) { return { lat: p.lat, lon: p.lon, ele: P.eleAt(prof, p.km) }; }) };
  }
  function stats(r) { return P.sectionStats(r.profile, 0, r.profile.totalKm, flatPace(), false, A.paceModel()); }

  function renderResults() {
    var box = $('results');
    box.innerHTML = '';
    results.forEach(function (r) {
      var s = stats(r), b = document.createElement('button');
      b.type = 'button'; b.className = 'pick'; b.setAttribute('aria-pressed', r === current ? 'true' : 'false');
      b.innerHTML = '<div class="t">' + esc(r.name) + '</div><div class="stats"><span><b>' + s.km.toFixed(1) + ' km</b></span><span><b>+' + Math.round(s.up) + ' m</b></span><span>About <b>' + P.fmtDur(s.minutes) + '</b></span></div>';
      b.addEventListener('click', function () { select(r, true); });
      box.appendChild(b);
    });
    A.setData('others', { type: 'FeatureCollection', features: results.filter(function (r) { return r !== current; }).map(function (r) { return A.lineOf(r.points); }) });
  }

  // ---------- Selected route ----------
  function select(r, refit) {
    if (A.isFlying()) A.stopFly();
    current = r;
    renderResults(); renderDetail();
    A.setData('route', r ? A.lineOf(r.points) : null);
    if (r && refit) A.fitPoints(r.points);
  }

  function renderDetail() {
    var box = $('routeDetail');
    if (!current || (sub && sub.get() === 'pace')) { box.hidden = true; return; }
    box.hidden = false;
    var s = stats(current);
    $('rdTitle').textContent = current.name;
    $('rdStats').innerHTML = '<span><b>' + s.km.toFixed(1) + ' km</b></span><span><b>+' + Math.round(s.up) + ' m</b> climb</span><span>About <b>' + P.fmtDur(s.minutes) + '</b></span>';
    $('rdProfile').innerHTML = A.profileSVG(current.profile, { axis: true, height: 120 });
    if (document.activeElement !== $('rdName')) $('rdName').value = current.name;
    $('rdSave').textContent = current.source === 'lib' ? 'Rename' : 'Save to Lucy\'s routes';
    renderConditions(s.minutes);
    renderPois();
  }

  function renderConditions(minutes) {
    var p0 = current.points[0], me = current;
    $('rdConditions').innerHTML = '';
    A.weather(p0.lat, p0.lon).then(function (w) {
      if (current !== me) return;
      var off = w.utc_offset_seconds || 0, c = w.current || {}, now = Date.now() / 1000;
      var sunset = w.daily && w.daily.sunset ? w.daily.sunset[0] : null, finish = now + minutes * 60;
      var line = '<div class="stats"><span>Now <b>' + Math.round(c.temperature_2m) + '°</b></span><span>Wind <b>' + Math.round(c.wind_speed_10m) + ' mph</b> from the ' +
        A.compass(c.wind_direction_10m) + '</span><span>Gusts <b>' + Math.round(c.wind_gusts_10m) + '</b></span></div>';
      var light = '';
      if (sunset && now < sunset) {
        var spare = sunset - finish;
        light = spare >= 0
          ? '<div class="okbox">Starting now, you\'d finish around ' + A.clockAt(finish, off) + ', ' + fmtGap(spare) + ' before sunset.</div>'
          : '<div class="warnbox">Starting now, you\'d finish around ' + A.clockAt(finish, off) + ', after sunset at ' + A.clockAt(sunset, off) +
            '. Take a head torch, or start by ' + A.clockAt(sunset - minutes * 60, off) + '.</div>';
      } else if (sunset) {
        light = '<div class="warnbox">It\'s dark now. Take a head torch and something bright to wear.</div>';
      }
      $('rdConditions').innerHTML = line + light;
    }).catch(function () {});
  }
  function fmtGap(sec) { var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }

  function renderPois() {
    var me = current;
    $('rdPois').innerHTML = '<p class="hint">Checking for water taps and toilets on the way…</p>';
    A.poisNear(current.points, 75).then(function (near) {
      if (current !== me) return;
      var w = near.filter(function (p) { return p.kind === 'water'; }).length, t = near.length - w;
      $('rdPois').innerHTML = '<p class="hint">' + (near.length
        ? 'Within 75 m of the route: ' + w + ' water ' + (w === 1 ? 'tap' : 'taps') + ' and ' + t + ' ' + (t === 1 ? 'toilet' : 'toilets') + '. Tap the drop button on the map to show them.'
        : 'No water taps or toilets are mapped along this route, so carry what you need.') + '</p>';
    }, function () { if (current === me) $('rdPois').innerHTML = ''; });
  }

  // ---------- Library ----------
  function fromLib(item) {
    return makeRoute(item.name, P.buildProfile(item.pts.map(function (q) { return { lon: q[0], lat: q[1], ele: q[2] }; })), 'lib', item.id);
  }
  function itemKm(item) {
    var km = 0;
    for (var k = 1; k < item.pts.length; k++) {
      var a = item.pts[k - 1], b = item.pts[k], r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r;
      var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
      km += 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return km;
  }
  function renderLib() {
    var box = $('lib');
    box.innerHTML = '';
    if (!library.length) { box.innerHTML = '<p>No saved routes yet. Make one on New route and save it, or import a GPX below.</p>'; return; }
    library.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="grow"><div class="t">' + esc(item.name) + '</div><div class="m">' + itemKm(item).toFixed(1) + ' km' + (item.created ? ', saved ' + new Date(item.created + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '') + '</div></div>' +
        '<button type="button" class="btn quiet">View</button><button type="button" class="btn-x" aria-label="Delete ' + esc(item.name) + '">✕</button>';
      row.querySelector('.btn').addEventListener('click', function () {
        results = []; renderResults();
        try { select(fromLib(item), true); A.setSheet('half'); } catch (e) { A.toast('That route couldn\'t be opened.'); }
      });
      row.querySelector('.btn-x').addEventListener('click', function () {
        if (!confirm('Delete "' + item.name + '"?')) return;
        library.splice(i, 1); saveLib(); renderLib();
        if (current && current.id === item.id) select(null);
      });
      box.appendChild(row);
    });
  }
  function toLibItem(r) {
    return { id: r.id, name: r.name, created: new Date().toISOString().slice(0, 10),
      pts: r.points.map(function (q) { return [+q.lon.toFixed(6), +q.lat.toFixed(6), +q.ele.toFixed(1)]; }) };
  }

  // ---------- Tab ----------
  A.tab('run', {
    title: 'Plan a run',
    snap: 'half',
    aside: function () { return library.length ? library.length + ' saved' : ''; },
    init: function () {
      sub = A.subnav('runNav', 'run', function (v) { $('places').innerHTML = ''; $('routeDetail').hidden = v === 'pace' || !current; });
      A.on('open-pace', function () { A.show('run'); sub.set('pace'); A.setSheet('full'); });
      A.on('pace-model', function () {
        var lp = A.learnedFlatPace();
        if (lp && gen.pace === '6:30') { gen.pace = P.fmtPace(lp); $('genPace').value = gen.pace; saveGen(); }
        renderResults(); if (current) renderDetail();
      });
      $('genKm').value = gen.km; $('genPace').value = gen.pace;
      $('genKm').addEventListener('change', function () { gen.km = Math.max(3, Math.min(50, parseFloat(this.value) || 15)); this.value = gen.km; saveGen(); });
      $('genPace').addEventListener('input', function () { gen.pace = this.value; saveGen(); if (current) renderDetail(); renderResults(); });
      A.seg('genTerrain', gen.terrain, function (v) { gen.terrain = v; saveGen(); });
      A.seg('genShape', gen.shape, function (v) { gen.shape = v; saveGen(); });
      $('go').addEventListener('click', generate);

      $('searchForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var q = $('place').value.trim(); if (!q) return;
        $('findBtn').disabled = true; $('places').innerHTML = '<p class="hint">Searching…</p>';
        A.geocode(q).then(function (places) {
          var box = $('places'); box.innerHTML = '';
          if (!places.length) { box.innerHTML = '<p class="hint">Nothing found. Try adding the county, for example "Wye, Kent".</p>'; return; }
          places.forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'pick'; b.textContent = p.name;
            b.addEventListener('click', function () {
              box.innerHTML = '';
              var short = p.name.split(',')[0];
              setStart(p.lat, p.lon, short);
              results = []; renderResults(); select(null);
              A.flyTo({ center: [p.lon, p.lat], zoom: 13, duration: 1500 });
              $('startInfo').textContent = 'Start set in ' + short + '. Tap the map to fine-tune it.';
            });
            box.appendChild(b);
          });
        }, function () {
          $('places').innerHTML = '<p class="hint error">Search didn\'t work just now. Try again in a moment, or move the map and tap to set a start.</p>';
        }).then(function () { $('findBtn').disabled = false; });
      });

      $('locate').addEventListener('click', function () {
        if (!navigator.geolocation) { $('startInfo').textContent = 'This browser can\'t share your location. Tap the map instead.'; return; }
        $('startInfo').textContent = 'Finding you…';
        navigator.geolocation.getCurrentPosition(function (pos) {
          setStart(pos.coords.latitude, pos.coords.longitude, null);
          $('startInfo').textContent = 'Start set where you are. Tap the map to move it.';
          A.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13, duration: 1200 });
        }, function () { $('startInfo').textContent = 'Couldn\'t get your location. Tap the map instead.'; }, { enableHighAccuracy: true, timeout: 10000 });
      });

      $('rdFly').addEventListener('click', function () {
        if (current) A.fly(current.profile, 0, current.profile.dist.length - 1, function () { A.fitPoints(current.points); });
      });
      $('rdGpx').addEventListener('click', function () {
        if (current) A.download(A.slug(current.name) + '.gpx', P.toGPX(current.points, current.name, false));
      });
      $('rdSave').addEventListener('click', function () {
        if (!current) return;
        var name = $('rdName').value.trim() || current.name;
        current.name = name;
        if (current.source === 'lib') {
          var it = library.find(function (x) { return x.id === current.id; }); if (it) it.name = name;
          if (saveLib()) A.toast('Renamed');
        } else {
          current.id = 'r' + Date.now(); current.source = 'lib';
          library.unshift(toLibItem(current));
          if (saveLib()) A.toast('Saved to Lucy\'s routes');
        }
        renderLib(); renderResults(); renderDetail(); A.refreshAside();
      });

      $('importGpx').addEventListener('change', function () {
        var files = Array.prototype.slice.call(this.files); this.value = '';
        files.reduce(function (p, f) {
          return p.then(function () {
            return f.text().then(function (text) {
              var pts = P.parseGPX(text);
              if (pts.length < 2) throw new Error('empty');
              var stride = Math.max(1, Math.floor(pts.length / 4000));   // thin 1-second recordings
              var thin = pts.filter(function (_, i) { return i % stride === 0 || i === pts.length - 1; });
              A.toast('Importing ' + f.name + '…');
              return A.withElevation(thin).then(function (prof) {
                var r = makeRoute(f.name.replace(/\.gpx$/i, ''), prof, 'lib', 'r' + Date.now() + Math.floor(Math.random() * 1000));
                library.unshift(toLibItem(r));
                if (saveLib()) { renderLib(); results = []; renderResults(); select(r, true); A.toast('Imported ' + r.name); A.refreshAside(); }
              });
            }).catch(function () { A.toast('Couldn\'t import ' + f.name + '. Is it a GPX with a track in it?'); });
          });
        }, Promise.resolve());
      });

      renderLib();
      drawStart();
    },
    show: function () {
      A.showLayers(['others', 'route', 'start']);
      drawStart();
      if (current) A.fitPoints(current.points);
      else if (gen.start) A.flyTo({ center: [gen.start.lon, gen.start.lat], zoom: 12.5, duration: 900 });
    },
    onMapClick: function (e) {
      if (sub.get() !== 'plan') return;
      setStart(e.lngLat.lat, e.lngLat.lng, null);
      $('startInfo').textContent = 'Start set. Tap the map to move it.';
      A.toast('Start set');
    }
  });
})();
