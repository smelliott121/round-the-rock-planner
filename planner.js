/*
 * Core pacing engine for the Round the Rock planner.
 * Pure functions, no DOM, so it can be tested with Node.
 *
 * Model: the course is resampled every 100 m. Each step gets an effort weight
 * from Tobler's hiking function (relative to flat ground) plus a linear fatigue
 * term. Moving time is shared out in proportion to those weights so the plan
 * always lands exactly on the target finish time, after aid-station stops.
 */
(function (root) {
  'use strict';

  var STEP_KM = 0.1;

  function parseGPX(text) {
    var re = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    var trk = [], rte = [], m;
    while ((m = re.exec(text))) {
      var attrs = m[2] || '';
      var body = m[3] || '';
      var lat = attrs.match(/lat\s*=\s*["']([-\d.eE+]+)["']/);
      var lon = attrs.match(/lon\s*=\s*["']([-\d.eE+]+)["']/);
      if (!lat || !lon) continue;
      var ele = body.match(/<ele>\s*([-\d.eE+]+)\s*<\/ele>/);
      var p = { lat: +lat[1], lon: +lon[1], ele: ele ? +ele[1] : null };
      (m[1] === 'trkpt' ? trk : rte).push(p);
    }
    return trk.length ? trk : rte;
  }

  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function buildProfile(points) {
    if (!points || points.length < 2) throw new Error('The GPX file has no track points.');
    var hasEle = points.some(function (p) { return p.ele !== null; });
    var lastEle = 0;
    var cum = [0];
    var raw = points.map(function (p, i) {
      if (p.ele !== null) lastEle = p.ele;
      if (i > 0) cum.push(cum[i - 1] + haversineKm(points[i - 1], p));
      return { lat: p.lat, lon: p.lon, ele: p.ele !== null ? p.ele : lastEle };
    });
    var total = cum[cum.length - 1];
    var n = Math.max(2, Math.round(total / STEP_KM) + 1);

    var dist = [], ele = [], lat = [], lon = [], j = 0;
    for (var i = 0; i < n; i++) {
      var d = Math.min(total, i * STEP_KM);
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      var span = cum[j + 1] - cum[j];
      var t = span > 0 ? (d - cum[j]) / span : 0;
      dist.push(d);
      ele.push(raw[j].ele + t * (raw[j + 1].ele - raw[j].ele));
      lat.push(raw[j].lat + t * (raw[j + 1].lat - raw[j].lat));
      lon.push(raw[j].lon + t * (raw[j + 1].lon - raw[j].lon));
    }

    // Light smoothing (300 m window) so GPS noise doesn't invent climbing.
    var smooth = ele.map(function (_, i) {
      var s = 0, c = 0;
      for (var k = Math.max(0, i - 1); k <= Math.min(ele.length - 1, i + 1); k++) { s += ele[k]; c++; }
      return s / c;
    });

    var climb = climbBetween({ ele: smooth }, 0, smooth.length - 1);
    return {
      dist: dist, ele: smooth, lat: lat, lon: lon,
      totalKm: total, ascent: climb.up, descent: climb.down, hasEle: hasEle
    };
  }

  function climbBetween(profile, i0, i1) {
    var up = 0, down = 0;
    for (var i = i0; i < i1; i++) {
      var d = profile.ele[i + 1] - profile.ele[i];
      if (d > 0) up += d; else down -= d;
    }
    return { up: up, down: down };
  }

  // Tobler: speed = 6·exp(-3.5·|g + 0.05|). Return time cost relative to flat.
  function gradeCost(g) {
    g = Math.max(-0.45, Math.min(0.45, g));
    return Math.exp(-3.5 * 0.05) / Math.exp(-3.5 * Math.abs(g + 0.05));
  }

  function indexAt(profile, km) {
    return Math.max(0, Math.min(profile.dist.length - 1, Math.round(km / STEP_KM)));
  }

  function computePlan(profile, opts) {
    var total = profile.totalKm;
    var fatigue = opts.fatigue || 0;
    var cps = (opts.checkpoints || [])
      .filter(function (c) { return c.km > 0 && c.km < total; })
      .slice()
      .sort(function (a, b) { return a.km - b.km; });

    var stops = cps.reduce(function (s, c) { return s + (c.stopMin || 0); }, 0);
    var moving = opts.targetMin - stops;
    if (moving <= 0) throw new Error('Aid-station stops add up to more than the target time.');

    var n = profile.dist.length;
    var w = [0], sum = 0;
    for (var i = 0; i < n - 1; i++) {
      var seg = profile.dist[i + 1] - profile.dist[i];
      if (seg <= 0) { w.push(sum); continue; }
      var g = (profile.ele[i + 1] - profile.ele[i]) / (seg * 1000);
      var mid = (profile.dist[i] + profile.dist[i + 1]) / 2;
      sum += gradeCost(g) * (1 + fatigue * (mid / total)) * seg;
      w.push(sum);
    }
    var scale = moving / sum;
    function movingAt(km) {
      var x = km / STEP_KM, i = Math.floor(x);
      if (i >= n - 1) return w[n - 1] * scale;
      return (w[i] + (x - i) * (w[i + 1] - w[i])) * scale;
    }

    var marks = [{ name: 'Start', km: 0, stopMin: 0, cutoffMin: null }]
      .concat(cps)
      .concat([{ name: 'Finish', km: total, stopMin: 0, cutoffMin: opts.finishCutoffMin || null }]);

    var rows = [], stopsSoFar = 0;
    for (var k = 1; k < marks.length; k++) {
      var a = marks[k - 1], b = marks[k];
      var legMoving = movingAt(b.km) - movingAt(a.km);
      stopsSoFar += a.stopMin || 0;
      var arrive = movingAt(b.km) + stopsSoFar;
      var legKm = b.km - a.km;
      var c = climbBetween(profile, indexAt(profile, a.km), indexAt(profile, b.km));
      var clock = opts.startMin + arrive;
      rows.push({
        name: b.name || ('Checkpoint ' + k),
        km: b.km,
        legKm: legKm,
        legUp: c.up,
        legDown: c.down,
        legMovingMin: legMoving,
        paceMinPerKm: legKm > 0 ? legMoving / legKm : 0,
        arriveElapsedMin: arrive,
        arriveClockMin: clock,
        stopMin: b.stopMin || 0,
        cutoffMin: b.cutoffMin,
        bufferMin: b.cutoffMin != null ? b.cutoffMin - clock : null,
        carbsG: Math.round((legMoving / 60) * (opts.carbsPerHour || 0) / 5) * 5,
        fluidMl: Math.round((legMoving / 60) * (opts.fluidPerHour || 0) / 50) * 50
      });
    }
    return { rows: rows, movingMin: moving, stopsMin: stops, totalKm: total };
  }

  function fmtDur(min) {
    var neg = min < 0; min = Math.abs(Math.round(min));
    var s = Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');
    return neg ? '-' + s : s;
  }
  function fmtClock(min) {
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function fmtPace(minPerKm) {
    var s = Math.round(minPerKm * 60);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function parseHM(str) {
    var m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  var api = {
    parseGPX: parseGPX, buildProfile: buildProfile, computePlan: computePlan,
    gradeCost: gradeCost, fmtDur: fmtDur, fmtClock: fmtClock, fmtPace: fmtPace,
    parseHM: parseHM, STEP_KM: STEP_KM
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(this);
