/* Race: course, splits and fuel per leg, checkpoints, training sections, crew sheet. */
(function () {
  'use strict';
  var A = window.App, P = A.P, $ = A.$, esc = A.esc, pl = A.planner;
  var profile = null, plan = null, fuel = null, sub = null, markers = [], lookupId = 0;
  var KIND = { gel: 'Gel', drink: 'Drink mix', salt: 'Salt tab', chew: 'Chews', food: 'Food' };
  var sec = Object.assign({ from: 0, to: 10, oab: false, pace: '6:30', preset: null }, A.load(A.KEYS.section, {}) || {});
  function saveSec() { A.save(A.KEYS.section, sec); }

  // ---------- Course ----------
  function useGPX(text, cachedEle) {
    var myId = ++lookupId, prof;
    try { prof = P.buildProfile(P.parseGPX(text)); }
    catch (e) { A.toast('That file has no route in it. Is it a GPX?'); return; }
    pl.gpx = text;
    if (prof.hasEle) { pl.eleCache = null; pl.save(); setProfile(prof, ''); return; }
    if (cachedEle && cachedEle.n === prof.dist.length) {
      try { setProfile(P.applyElevation(prof, cachedEle.idx, cachedEle.ele), 'Heights from terrain data'); return; } catch (e) { /* refetch */ }
    }
    pl.save();
    setProfile(prof, 'Looking up heights…');
    A.elevation(prof).then(function (r) {
      if (myId !== lookupId) return;
      pl.eleCache = r.cache; pl.save();
      setProfile(r.profile, 'Heights from terrain data');
    }, function () {
      if (myId === lookupId) setProfile(prof, 'Couldn\'t look up heights, so splits are flat-paced. Load the file again when online.');
    });
  }

  function setProfile(prof, note) {
    profile = prof;
    $('raceEmpty').hidden = true; $('raceMain').hidden = false;
    $('courseStats').innerHTML = '<span><b>' + prof.totalKm.toFixed(1) + ' km</b></span><span><b>+' + Math.round(prof.ascent) + ' m</b> climb</span>' +
      (note ? '<span>' + esc(note) + '</span>' : '');
    A.setData('course', A.lineOf(prof.raw));
    ['secFrom', 'secTo', 'secFromR', 'secToR'].forEach(function (id) { $(id).max = prof.totalKm.toFixed(1); });
    renderAll();
    if (A.current() === 'race') frame();
  }

  function frame() {
    if (!profile) return;
    if (sub && sub.get() === 'sections') fitSection();
    else A.fitPoints(profile.raw);
  }

  // ---------- Checkpoints ----------
  function sortCps() { pl.checkpoints.sort(function (a, b) { return a.km - b.km; }); }
  function renumber() { pl.checkpoints.forEach(function (c, i) { if (/^Checkpoint \d+$/.test(c.name)) c.name = 'Checkpoint ' + (i + 1); }); }
  function addCp(km) {
    pl.checkpoints.push({ name: 'Checkpoint ' + (pl.checkpoints.length + 1), km: Math.round(km * 10) / 10, stopMin: 3, cutoff: '' });
    sortCps(); renumber(); pl.save(); renderAll();
    A.toast('Checkpoint added at ' + (Math.round(km * 10) / 10) + ' km');
  }

  function renderCheckpoints() {
    var box = $('cps');
    box.innerHTML = '';
    if (!pl.checkpoints.length) { box.innerHTML = '<p>No checkpoints yet. Add them here, or tap the elevation profile on the Plan tab.</p>'; return; }
    pl.checkpoints.forEach(function (c, i) {
      var row = document.createElement('div');
      row.className = 'cp';
      row.innerHTML = '<div><label>Name</label><input data-k="name" value="' + esc(c.name) + '"></div>' +
        '<div><label>km</label><input data-k="km" type="number" step="0.1" value="' + c.km + '"></div>' +
        '<div><label>Stop (min)</label><input data-k="stopMin" type="number" min="0" value="' + c.stopMin + '"></div>' +
        '<div class="cutoff"><label>Cutoff</label><input data-k="cutoff" type="time" value="' + esc(c.cutoff || '') + '"></div>' +
        '<button type="button" class="btn-x" aria-label="Remove ' + esc(c.name) + '">✕</button>';
      row.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var k = inp.dataset.k;
          c[k] = (k === 'km' || k === 'stopMin') ? (parseFloat(inp.value) || 0) : inp.value;
          if (k === 'km') sortCps();
          pl.save(); renderAll();
        });
      });
      row.querySelector('button').addEventListener('click', function () { pl.checkpoints.splice(i, 1); pl.save(); renderAll(); });
      box.appendChild(row);
    });
  }

  // ---------- Plan ----------
  function computePlan() {
    var target = P.parseHM($('target').value), start = P.parseHM($('start').value);
    if (target == null || start == null) throw new Error('Enter the target as h:mm, for example 11:00.');
    plan = P.computePlan(profile, {
      targetMin: target, startMin: start, fatigue: A.num('fatigue', 0) / 100, model: A.paceModel(),
      carbsPerHour: A.num('carbs', 0), fluidPerHour: A.num('fluid', 0), finishCutoffMin: P.parseHM($('finishCutoff').value),
      checkpoints: pl.checkpoints.map(function (c) { return { name: c.name, km: c.km, stopMin: c.stopMin || 0, cutoffMin: P.parseHM(c.cutoff) }; })
    });
    plan.target = target; plan.start = start;
    var caff = $('caffKm').value;
    fuel = P.computeFuel(plan.rows, {
      carbsPerHour: A.num('carbs', 0), fluidPerHour: A.num('fluid', 0), sweatSodium: A.num('sweatNa', 0),
      sweatRate: A.num('sweatRate', 0), weightKg: A.num('weight', 0),
      caffeineFromKm: caff === '' ? plan.totalKm / 2 : (parseFloat(caff) || 0)
    }, pl.products);
  }

  function carryText(leg) {
    var hasDrink = pl.products.some(function (p) { return p.use && p.kind === 'drink' && p.ml > 0; });
    var parts = leg.items.map(function (it) {
      var p = pl.products[it.index];
      return P.fmtCount(it.count) + ' ' + esc(p.name || KIND[p.kind]) + (p.kind === 'drink' ? ' in ' + Math.round(it.count * p.ml) + ' ml' : '');
    });
    if (!hasDrink && leg.need.fluid > 0) parts.push(Math.round(leg.need.fluid / 50) * 50 + ' ml water');
    return parts.length ? parts.join(', ') : 'nothing needed';
  }

  function renderPlan() {
    if (!profile) return;
    try { computePlan(); } catch (e) { $('plan').innerHTML = ''; $('summary').innerHTML = '<span class="error">' + esc(e.message) + '</span>'; return; }
    var hasProducts = pl.products.some(function (p) { return p.use; });
    $('summary').innerHTML = '<span>Finish <b>' + P.fmtClock(plan.start + plan.target) + '</b></span>' +
      '<span>Moving <b>' + P.fmtPace(plan.movingMin / plan.totalKm) + '/km</b></span>' +
      '<span>Stops <b>' + Math.round(plan.stopsMin) + ' min</b></span>' +
      '<span>Carbs <b>' + Math.round(fuel.sum.needCarbs) + ' g</b></span><span>Sodium <b>' + Math.round(fuel.sum.needSodium) + ' mg</b></span>';
    renderPredict();
    $('warnings').innerHTML = fuel.warnings.map(function (w) { return '<div class="warnbox">' + esc(w) + '</div>'; }).join('');

    var html = '<thead><tr><th>Point</th><th>km</th><th>Arrive</th><th class="hide-sm">Elapsed</th><th class="hide-sm">Climb</th><th>Pace</th><th>Carbs</th><th>Buffer</th></tr></thead><tbody>';
    if (hasProducts) html += '<tr class="carry"><td colspan="8">Start with: ' + carryText(fuel.legs[0]) + '</td></tr>';
    plan.rows.forEach(function (r, i) {
      var last = i === plan.rows.length - 1;
      var buf = r.bufferMin == null ? '–' : '<span class="' + (r.bufferMin < 20 ? 'bad' : 'ok') + '">' + P.fmtDur(r.bufferMin) + '</span>';
      html += '<tr' + (hasProducts && !last ? ' class="has-carry"' : '') + '><td class="name">' + esc(r.name) + '</td><td>' + r.km.toFixed(1) + '</td>' +
        '<td class="clock">' + P.fmtClock(r.arriveClockMin) + '</td><td class="hide-sm">' + P.fmtDur(r.arriveElapsedMin) + '</td>' +
        '<td class="hide-sm">+' + Math.round(r.legUp) + '</td><td>' + P.fmtPace(r.paceMinPerKm) + '</td><td>' + r.carbsG + ' g</td><td>' + buf + '</td></tr>';
      if (hasProducts && !last) html += '<tr class="carry"><td colspan="8">Pick up for the next leg: ' + carryText(fuel.legs[i + 1]) + '</td></tr>';
    });
    $('plan').innerHTML = html + '</tbody>';

    if (hasProducts) {
      $('shopping').innerHTML = '<h3>Race-day kit</h3><div class="list">' + fuel.totals.map(function (n, i) {
        if (!n) return '';
        var p = pl.products[i];
        return '<div class="row"><span class="grow">' + esc(p.name || KIND[p.kind]) + '</span><b class="num">' + Math.ceil(n) + '</b></div>';
      }).join('') + '</div><p class="hint">That gives ' + Math.round(fuel.sum.carbs) + ' g carbs and ' + Math.round(fuel.sum.sodium) + ' mg sodium' +
        (fuel.sum.caffeine ? ', with ' + Math.round(fuel.sum.caffeine) + ' mg caffeine' : '') + '. Pack a spare or two of each.</p>';
    } else {
      $('shopping').innerHTML = '<p class="hint">Add your gels and drinks on the Fuel tab to see what to carry on each leg.</p>';
    }
    drawMarkers();
  }

  // Checkpoint markers with arrival times, shown on the Race tab only.
  function drawMarkers() {
    clearMarkers();
    if (A.current() !== 'race' || !profile) return;
    A.whenMap(function () {
      var rows = plan ? plan.rows : [];
      pl.checkpoints.forEach(function (c) {
        if (c.km <= 0 || c.km >= profile.totalKm) return;
        var row = rows.find(function (r) { return Math.abs(r.km - c.km) < 0.05; });
        var p = P.sectionPoints(profile, c.km, c.km)[0];
        var el = document.createElement('div');
        el.className = 'cp-marker';
        el.innerHTML = '<span class="lab">' + esc(c.name.replace(/^Checkpoint (\d+)$/, 'CP$1')) + (row ? ' ' + P.fmtClock(row.arriveClockMin) : '') + '</span><span class="dot"></span>';
        markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(A.map()));
      });
    });
  }
  function clearMarkers() { markers.forEach(function (m) { m.remove(); }); markers = []; }

  function renderProfile() {
    if (!profile) return;
    $('raceProfile').innerHTML = A.profileSVG(profile, { axis: true, marks: pl.checkpoints.map(function (c) { return c.km; }) });
  }

  // ---------- Predicted finish from her own pace ----------
  function renderPredict() {
    var box = $('predict');
    if (!profile || !plan) { box.innerHTML = ''; return; }
    var model = A.paceModel();
    if (!model && A.learnedFlatPace()) {
      box.innerHTML = '<p class="hint">Your own pace is switched off, so splits use an average runner. Turn it back on under <a href="#" id="toPace">Run, My pace</a>.</p>';
      $('toPace').addEventListener('click', function (e) { e.preventDefault(); A.emit('open-pace'); });
      return;
    }
    if (!model) {
      box.innerHTML = '<p class="hint">Want a predicted finish? Add a few recorded runs under <a href="#" id="toPace">Run, My pace</a> and the splits will use how you actually run hills.</p>';
      $('toPace').addEventListener('click', function (e) { e.preventDefault(); A.emit('open-pace'); });
      return;
    }
    var fatigue = A.num('fatigue', 0) / 100;
    var finish = Math.round(P.predictMoving(profile, model, model.flatPace, fatigue) + plan.stopsMin);
    var gap = plan.target - finish;
    box.innerHTML = '<h3>On your current form</h3><div class="stats"><span>Predicted finish <b>' + P.fmtDur(finish) + '</b></span><span>Clock <b>' + P.fmtClock(plan.start + finish) + '</b></span>' +
      '<span>' + (Math.abs(gap) < 3 ? 'Right on your target' : (gap > 0 ? P.fmtDur(gap) + ' inside your target' : P.fmtDur(-gap) + ' over your target')) + '</span></div>' +
      '<p class="hint">Holding your training flat pace of ' + P.fmtPace(model.flatPace) + '/km with your own hill pace, slowing ' + Math.round(fatigue * 100) + '% by the end. ' +
      'An ultra usually slows more than shorter training runs suggest, so treat this as a best case until you\'ve logged some long runs.</p>' +
      (Math.abs(gap) >= 3 ? '<div class="actions"><button type="button" class="btn quiet" id="usePredict">Use ' + P.fmtDur(finish) + ' as my target</button></div>' : '');
    var b = $('usePredict');
    if (b) b.addEventListener('click', function () {
      var t = $('target'); t.value = P.fmtDur(finish); t.dispatchEvent(new Event('input'));
      A.toast('Target set to ' + P.fmtDur(finish));
    });
  }

  // ---------- Race-day forecast (within 16 days) ----------
  function renderRaceWx() {
    var race = (A.races() || []).find(function (r) { return /rock/i.test(r.name); });
    if (!race || !profile) { $('raceWx').innerHTML = ''; return; }
    var d = A.daysUntil(race.date);
    if (d < 0) { $('raceWx').innerHTML = ''; return; }
    if (d > 15) {
      var from = new Date(new Date(race.date + 'T12:00:00').getTime() - 15 * 86400000);
      $('raceWx').innerHTML = '<p class="hint">The race-day forecast appears here from ' + from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + '.</p>';
      return;
    }
    var mid = P.sectionPoints(profile, profile.totalKm / 2, profile.totalKm / 2)[0];
    A.weather(mid.lat, mid.lon).then(function (w) {
      var off = w.utc_offset_seconds || 0, h = w.hourly, s = P.parseHM($('start').value) || 360, t = P.parseHM($('target').value) || 660;
      var idx = [];
      for (var i = 0; i < h.time.length; i++) {
        if (A.dayKey(h.time[i], off) !== race.date) continue;
        var hr = +A.clockAt(h.time[i], off).slice(0, 2) * 60;
        if (hr >= s - 60 && hr <= s + t) idx.push(i);
      }
      if (!idx.length) { $('raceWx').innerHTML = ''; return; }
      var temps = idx.map(function (i) { return h.temperature_2m[i]; }), winds = idx.map(function (i) { return h.wind_gusts_10m[i]; });
      var rain = Math.max.apply(null, idx.map(function (i) { return h.precipitation_probability[i] || 0; }));
      var maxT = Math.max.apply(null, temps);
      $('raceWx').innerHTML = '<h3>Race-day forecast</h3><div class="stats"><span><b>' + Math.round(Math.min.apply(null, temps)) + '–' + Math.round(maxT) + '°</b></span>' +
        '<span>Gusts up to <b>' + Math.round(Math.max.apply(null, winds)) + ' mph</b></span><span>Rain chance <b>' + rain + '%</b></span></div>' +
        (maxT >= 20 ? '<div class="warnbox">A warm day. Sweat rate rises in heat, so aim for the upper end of your fluid range, keep sodium up and slow early to stay cool.</div>' : '');
    }).catch(function () { $('raceWx').innerHTML = ''; });
  }

  // ---------- Sections ----------
  var presets = [];
  function buildPresets() {
    presets = [];
    var total = +profile.totalKm.toFixed(1);
    var marks = [{ name: 'Start', km: 0 }].concat(pl.checkpoints.filter(function (c) { return c.km > 0 && c.km < total; })).concat([{ name: 'Finish', km: total }]);
    if (marks.length > 2) {
      for (var i = 1; i < marks.length; i++) {
        presets.push({ id: 'leg' + i, label: short(marks[i - 1].name) + ' to ' + short(marks[i].name), from: marks[i - 1].km, to: marks[i].km });
      }
    }
    [10, 15, 20].forEach(function (len) { var w = P.hilliestWindow(profile, len); presets.push({ id: 'hill' + len, label: 'Hilliest ' + len + ' km', from: w.from, to: w.to }); });
    presets.push({ id: 'all', label: 'Whole lap', from: 0, to: total });
    $('presets').innerHTML = presets.map(function (p) { return '<button type="button" class="chip" data-id="' + p.id + '">' + esc(p.label) + '</button>'; }).join('');
  }
  function short(name) { return String(name).replace(/^Checkpoint (\d+)$/, 'CP$1'); }

  function renderSection(refit) {
    if (!profile) return;
    var total = +profile.totalKm.toFixed(1);
    sec.from = Math.max(0, Math.min(total - 0.5, +(+sec.from).toFixed(1)));
    sec.to = Math.max(sec.from + 0.5, Math.min(total, +(+sec.to).toFixed(1)));
    $('secFrom').value = sec.from; $('secTo').value = sec.to; $('secFromR').value = sec.from; $('secToR').value = sec.to;
    $('secOab').checked = !!sec.oab; if (document.activeElement !== $('secPace')) $('secPace').value = sec.pace;
    document.querySelectorAll('#presets .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.id === sec.preset ? 'true' : 'false'); });
    saveSec();
    var m = P.parseHM(sec.pace), st = P.sectionStats(profile, sec.from, sec.to, m != null ? m / 60 : 6.5, sec.oab, A.paceModel());
    $('secStats').innerHTML = '<span><b>' + st.km.toFixed(1) + ' km</b></span><span><b>+' + Math.round(st.up) + ' m</b> climb</span><span>About <b>' + P.fmtDur(st.minutes) + '</b></span>';
    $('secProfile').innerHTML = A.profileSVG(profile, { from: sec.from, to: sec.to, height: 110 });
    if (A.current() === 'race' && sub && sub.get() === 'sections') {
      A.setData('section', A.lineOf(P.sectionPoints(profile, sec.from, sec.to)));
      if (refit) fitSection();
    }
  }
  var fitTimer = null;
  function fitSection() { clearTimeout(fitTimer); fitTimer = setTimeout(function () { A.fitPoints(P.sectionPoints(profile, sec.from, sec.to)); }, 120); }
  function setFrom(v) { var len = sec.to - sec.from; if (v >= sec.to) sec.to = v + len; sec.from = v; sec.preset = null; renderSection(true); }
  function setTo(v) { var len = sec.to - sec.from; if (v <= sec.from) sec.from = Math.max(0, v - len); sec.to = v; sec.preset = null; renderSection(true); }

  // ---------- Crew sheet ----------
  function printSheet() {
    if (!plan) return;
    var hasProducts = pl.products.some(function (p) { return p.use; });
    var rows = plan.rows.map(function (r, i) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + r.km.toFixed(1) + '</td><td><b>' + P.fmtClock(r.arriveClockMin) + '</b></td><td>' + P.fmtDur(r.arriveElapsedMin) + '</td>' +
        '<td>' + (r.cutoffMin != null ? P.fmtClock(r.cutoffMin) : '') + '</td><td style="text-align:left;white-space:normal">' +
        (hasProducts && i < plan.rows.length - 1 ? carryText(fuel.legs[i + 1]) : '') + '</td></tr>';
    }).join('');
    $('printArea').innerHTML = '<h1>Lucy\'s crew sheet: Round the Rock</h1>' +
      '<p>Start ' + esc($('start').value) + ', target ' + esc($('target').value) + ', finish ' + P.fmtClock(plan.start + plan.target) + '</p>' +
      (hasProducts ? '<p>Start with: ' + carryText(fuel.legs[0]) + '</p>' : '') +
      '<table><thead><tr><th>Point</th><th>km</th><th>Arrive</th><th>Elapsed</th><th>Cutoff</th><th style="text-align:left">Hand over for next leg</th></tr></thead><tbody>' + rows + '</tbody></table>';
    window.print();
  }

  function renderAll() {
    if (!profile) return;
    renderCheckpoints(); renderProfile(); renderPlan(); buildPresets(); renderSection(false); renderRaceWx();
    A.refreshAside();
  }

  // ---------- Tab ----------
  A.tab('race', {
    title: 'Round the Rock',
    snap: 'half',
    aside: function () { return profile ? profile.totalKm.toFixed(1) + ' km, +' + Math.round(profile.ascent) + ' m' : ''; },
    init: function () {
      function readFile(input) {
        input.addEventListener('change', function () {
          var f = input.files[0]; if (!f) return;
          f.text().then(function (t) { useGPX(t, null); input.value = ''; });
        });
      }
      readFile($('gpx')); readFile($('gpx2'));
      sub = A.subnav('raceNav', 'race', function (v) {
        if (A.current() !== 'race') return;
        A.showLayers(v === 'sections' ? ['course', 'section'] : ['course']);
        if (v === 'sections') renderSection(true); else if (profile) A.fitPoints(profile.raw);
      });
      $('raceProfile').addEventListener('click', function (e) {
        if (!profile) return;
        var km = A.kmFromSvgClick(e, $('raceProfile'), profile.totalKm);
        if (km != null && km > 0.5 && km < profile.totalKm - 0.5) addCp(km);
      });
      $('addCp').addEventListener('click', function () {
        var last = pl.checkpoints.length ? pl.checkpoints[pl.checkpoints.length - 1].km : 0;
        addCp(Math.min(profile ? profile.totalKm - 0.5 : 70, last + 10));
      });
      $('autoCp').addEventListener('click', function () {
        if (!profile) return;
        pl.checkpoints = [];
        for (var km = 10; km < profile.totalKm - 2; km += 10) pl.checkpoints.push({ name: 'Checkpoint ' + (pl.checkpoints.length + 1), km: km, stopMin: 3, cutoff: '' });
        pl.save(); renderAll();
      });
      $('clearCp').addEventListener('click', function () {
        if (!pl.checkpoints.length || !confirm('Remove all checkpoints?')) return;
        pl.checkpoints = []; pl.save(); renderAll();
      });
      $('print').addEventListener('click', printSheet);
      A.on('plan', function () { if (profile) { renderPlan(); renderRaceWx(); } });
      A.on('pace-model', function () {
        var lp = A.learnedFlatPace();
        if (lp && sec.pace === '6:30') sec.pace = P.fmtPace(lp);
        if (profile) renderAll();
      });
      A.on('products', function () { if (profile) renderPlan(); });
      A.on('races', function () { if (profile) renderRaceWx(); });

      $('presets').addEventListener('click', function (e) {
        var b = e.target.closest('.chip'); if (!b) return;
        var p = presets.find(function (x) { return x.id === b.dataset.id; });
        sec.from = p.from; sec.to = p.to; sec.preset = p.id; renderSection(true);
      });
      $('secFrom').addEventListener('change', function () { setFrom(parseFloat(this.value) || 0); });
      $('secTo').addEventListener('change', function () { setTo(parseFloat(this.value) || 0); });
      $('secFromR').addEventListener('input', function () { sec.from = Math.min(parseFloat(this.value), sec.to - 0.5); sec.preset = null; renderSection(false); });
      $('secToR').addEventListener('input', function () { sec.to = Math.max(parseFloat(this.value), sec.from + 0.5); sec.preset = null; renderSection(false); });
      $('secFromR').addEventListener('change', fitSection);
      $('secToR').addEventListener('change', fitSection);
      $('secOab').addEventListener('change', function () { sec.oab = this.checked; renderSection(false); });
      $('secPace').addEventListener('input', function () { sec.pace = this.value; renderSection(false); });
      $('secFly').addEventListener('click', function () {
        if (!profile) return;
        A.fly(profile, Math.round(sec.from / P.STEP_KM), Math.round(sec.to / P.STEP_KM), fitSection);
      });
      $('secGpx').addEventListener('click', function () {
        if (!profile) return;
        var name = 'Round the Rock ' + sec.from + '–' + sec.to + ' km' + (sec.oab ? ' out and back' : '');
        A.download('rtr-' + sec.from + '-' + sec.to + 'km' + (sec.oab ? '-oab' : '') + '.gpx', P.toGPX(P.sectionPoints(profile, sec.from, sec.to), name, sec.oab));
      });

      if (pl.gpx) useGPX(pl.gpx, pl.eleCache);
    },
    show: function () {
      $('raceEmpty').hidden = !!profile; $('raceMain').hidden = !profile;
      var v = sub.get();
      A.showLayers(v === 'sections' ? ['course', 'section'] : ['course']);
      if (profile) { renderSection(false); drawMarkers(); frame(); renderRaceWx(); }
    },
    hide: function () { clearMarkers(); }
  });
})();
