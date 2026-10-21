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
      totalKm: total, ascent: climb.up, descent: climb.down, hasEle: hasEle,
      raw: raw.map(function (p, i) { return { lat: p.lat, lon: p.lon, km: cum[i] }; })
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

  // Pick points along the course to look up elevation for (GPX files without <ele>).
  function elevationSamples(profile, everyKm) {
    var stride = Math.max(1, Math.round((everyKm || 0.2) / STEP_KM));
    var idx = [];
    for (var i = 0; i < profile.dist.length; i += stride) idx.push(i);
    if (idx[idx.length - 1] !== profile.dist.length - 1) idx.push(profile.dist.length - 1);
    return {
      idx: idx,
      lat: idx.map(function (i) { return +profile.lat[i].toFixed(5); }),
      lon: idx.map(function (i) { return +profile.lon[i].toFixed(5); })
    };
  }

  // Fill the profile's elevation from looked-up samples, smooth, and recompute climb.
  function applyElevation(profile, idx, ele) {
    if (!idx || !ele || idx.length !== ele.length || idx.length < 2) throw new Error('Elevation lookup came back incomplete.');
    var filled = new Array(profile.dist.length);
    for (var s = 0; s < idx.length - 1; s++) {
      var i0 = idx[s], i1 = idx[s + 1];
      var e0 = Math.max(0, +ele[s] || 0), e1 = Math.max(0, +ele[s + 1] || 0);
      for (var i = i0; i <= i1; i++) filled[i] = e0 + (i1 > i0 ? (i - i0) / (i1 - i0) : 0) * (e1 - e0);
    }
    // Wider smoothing (500 m) than for GPS heights: the elevation model is 90 m grid data.
    var smooth = filled.map(function (_, i) {
      var sum = 0, c = 0;
      for (var k = Math.max(0, i - 2); k <= Math.min(filled.length - 1, i + 2); k++) { sum += filled[k]; c++; }
      return sum / c;
    });
    var climb = climbBetween({ ele: smooth }, 0, smooth.length - 1);
    return {
      dist: profile.dist, ele: smooth, lat: profile.lat, lon: profile.lon,
      totalKm: profile.totalKm, ascent: climb.up, descent: climb.down,
      hasEle: true, eleSource: 'dem', raw: profile.raw
    };
  }

  /*
   * Fuel: turn each leg's needs into servings of her own products.
   *   fluid  = hours × fluid per hour (she sets it; the UI warns above sweat rate)
   *   sodium = litres drunk × sweat sodium (mg/L), so what she drinks is about
   *            as salty as what she sweats
   *   carbs  = hours × carbs per hour
   * Order: a drink mix covers the fluid (and brings its own carbs and sodium),
   * gels/chews/food top up carbs (rotating between products), salt tabs top up sodium.
   */
  var SOLID_KINDS = { gel: 1, chew: 1, food: 1 };

  function sweatRate(beforeKg, afterKg, drankMl, minutes) {
    if (!(beforeKg > 0) || !(afterKg > 0) || !(minutes > 0)) return null;
    var litres = (beforeKg - afterKg) + (drankMl || 0) / 1000;
    if (litres <= 0) return null;
    return litres / (minutes / 60);
  }

  function legFuel(movingMin, legStartKm, opts, products) {
    var h = movingMin / 60;
    var need = {
      carbs: h * (opts.carbsPerHour || 0),
      fluid: h * (opts.fluidPerHour || 0),
      sodium: h * (opts.fluidPerHour || 0) / 1000 * (opts.sweatSodium || 0)
    };
    var got = { carbs: 0, fluid: 0, sodium: 0, caffeine: 0 };
    var counts = products.map(function () { return 0; });
    function add(i, n) {
      var p = products[i];
      counts[i] += n;
      got.carbs += n * (p.carbs || 0);
      got.sodium += n * (p.sodium || 0);
      got.caffeine += n * (p.caffeine || 0);
    }

    var drinkIdx = products.findIndex(function (p) { return p.use && p.kind === 'drink' && p.ml > 0; });
    if (drinkIdx >= 0 && need.fluid > 0) {
      var servings = Math.round(need.fluid / products[drinkIdx].ml * 2) / 2;
      if (servings > 0) add(drinkIdx, servings);
    }
    got.fluid = need.fluid;

    var solids = [];
    // Caffeinated products only from the chosen km (default: halfway).
    var caffOk = legStartKm >= (opts.caffeineFromKm || 0);
    products.forEach(function (p, i) {
      if (p.use && SOLID_KINDS[p.kind] && p.carbs > 0 && (caffOk || !(p.caffeine > 0))) solids.push(i);
    });
    if (solids.length) {
      var smallest = Math.min.apply(null, solids.map(function (i) { return products[i].carbs; }));
      for (var guard = 0; guard < 300 && got.carbs < need.carbs - smallest / 2; guard++) {
        var pick = solids.reduce(function (best, i) { return counts[i] < counts[best] ? i : best; }, solids[0]);
        add(pick, 1);
      }
    }

    var saltIdx = products.findIndex(function (p) { return p.use && p.kind === 'salt' && p.sodium > 0; });
    if (saltIdx >= 0) {
      var tab = products[saltIdx].sodium;
      for (var g2 = 0; g2 < 100 && got.sodium < need.sodium - tab / 2; g2++) add(saltIdx, 1);
    }

    var items = [];
    counts.forEach(function (n, i) { if (n > 0) items.push({ index: i, name: products[i].name, kind: products[i].kind, count: n }); });
    return { need: need, got: got, items: items, counts: counts };
  }

  function computeFuel(rows, opts, products) {
    products = products || [];
    var legs = rows.map(function (r, i) { return legFuel(r.legMovingMin, i ? rows[i - 1].km : 0, opts, products); });
    var totals = products.map(function () { return 0; });
    var sum = { carbs: 0, fluid: 0, sodium: 0, caffeine: 0, needCarbs: 0, needSodium: 0 };
    legs.forEach(function (l) {
      l.counts.forEach(function (n, i) { totals[i] += n; });
      sum.carbs += l.got.carbs; sum.fluid += l.got.fluid; sum.sodium += l.got.sodium; sum.caffeine += l.got.caffeine;
      sum.needCarbs += l.need.carbs; sum.needSodium += l.need.sodium;
    });
    var warnings = [];
    if (opts.sweatRate > 0 && opts.fluidPerHour / 1000 > opts.sweatRate) {
      warnings.push('Fluid target is above your sweat rate (' + opts.sweatRate.toFixed(2) + ' L/h). Drinking more than you sweat over a long race can dilute blood sodium (hyponatraemia), so keep fluid at or below sweat rate.');
    }
    if (opts.weightKg > 0 && sum.caffeine / opts.weightKg > 6) {
      warnings.push('Caffeine comes to ' + Math.round(sum.caffeine) + ' mg (' + (sum.caffeine / opts.weightKg).toFixed(1) + ' mg/kg), above the 3–6 mg/kg range usually studied. Only race on amounts you have tried in training.');
    }
    var anyCarb = products.some(function (p) { return p.use && p.carbs > 0; });
    if (anyCarb && sum.carbs < sum.needCarbs * 0.9) {
      warnings.push('Your products only cover ' + Math.round(sum.carbs) + ' g of the ' + Math.round(sum.needCarbs) + ' g carbs target. Add a gel, chew or food with carbs.');
    }
    return { legs: legs, totals: totals, sum: sum, warnings: warnings };
  }

  /*
   * Training sections: a stretch of the course between two km marks, optionally
   * as an out-and-back. Time uses the same grade model from a flat training pace.
   */
  function eleAt(profile, km) {
    var x = Math.max(0, Math.min(profile.totalKm, km)) / STEP_KM, i = Math.floor(x);
    if (i >= profile.ele.length - 1) return profile.ele[profile.ele.length - 1];
    return profile.ele[i] + (x - i) * (profile.ele[i + 1] - profile.ele[i]);
  }

  function sectionPoints(profile, fromKm, toKm) {
    var pts = profile.raw.filter(function (p) { return p.km > fromKm && p.km < toKm; });
    function at(km) {
      var i = Math.max(0, Math.min(profile.dist.length - 1, Math.round(km / STEP_KM)));
      return { lat: profile.lat[i], lon: profile.lon[i], km: km };
    }
    pts = [at(fromKm)].concat(pts).concat([at(toKm)]);
    return pts.map(function (p) { return { lat: p.lat, lon: p.lon, km: p.km, ele: eleAt(profile, p.km) }; });
  }

  function sectionStats(profile, fromKm, toKm, flatPaceMin, outAndBack) {
    var i0 = Math.round(fromKm / STEP_KM), i1 = Math.round(toKm / STEP_KM);
    var c = climbBetween(profile, i0, i1);
    var t = 0;
    for (var i = i0; i < i1 && i < profile.dist.length - 1; i++) {
      var seg = profile.dist[i + 1] - profile.dist[i];
      if (seg <= 0) continue;
      var g = (profile.ele[i + 1] - profile.ele[i]) / (seg * 1000);
      t += gradeCost(g) * seg * flatPaceMin;
      if (outAndBack) t += gradeCost(-g) * seg * flatPaceMin;
    }
    var km = toKm - fromKm;
    return {
      km: outAndBack ? km * 2 : km,
      up: outAndBack ? c.up + c.down : c.up,
      down: outAndBack ? c.up + c.down : c.down,
      minutes: t
    };
  }

  // Steepest window of a given length (by climb), for the "hilliest" presets.
  function hilliestWindow(profile, lengthKm) {
    var n = Math.round(lengthKm / STEP_KM);
    if (n >= profile.ele.length - 1) return { from: 0, to: profile.totalKm };
    var up = [0];
    for (var i = 0; i < profile.ele.length - 1; i++) up.push(up[i] + Math.max(0, profile.ele[i + 1] - profile.ele[i]));
    var best = 0, bestI = 0;
    for (var j = 0; j + n < up.length; j++) {
      if (up[j + n] - up[j] > best) { best = up[j + n] - up[j]; bestI = j; }
    }
    return { from: +(bestI * STEP_KM).toFixed(1), to: +((bestI + n) * STEP_KM).toFixed(1) };
  }

  function toGPX(points, name, outAndBack) {
    var all = outAndBack ? points.concat(points.slice(0, -1).reverse()) : points;
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Round the Rock Planner" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '<metadata><name>' + esc(name) + '</name></metadata>\n<trk><name>' + esc(name) + '</name><trkseg>\n' +
      all.map(function (p) {
        return '<trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '"><ele>' + p.ele.toFixed(1) + '</ele></trkpt>';
      }).join('\n') +
      '\n</trkseg></trk>\n</gpx>\n';
  }

  function bearing(a, b) {
    var rad = Math.PI / 180;
    var y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
    var x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  function fmtCount(n) { return (n % 1 ? n.toFixed(1) : String(n)) + '×'; }

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
    gradeCost: gradeCost, elevationSamples: elevationSamples, applyElevation: applyElevation,
    sweatRate: sweatRate, computeFuel: computeFuel,
    sectionPoints: sectionPoints, sectionStats: sectionStats, hilliestWindow: hilliestWindow,
    toGPX: toGPX, bearing: bearing, eleAt: eleAt, fmtCount: fmtCount, fmtDur: fmtDur, fmtClock: fmtClock, fmtPace: fmtPace,
    parseHM: parseHM, STEP_KM: STEP_KM
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(this);
