/* My pace: learn Lucy's own hill curve from recorded runs, used by the race plan, sections and routes. */
(function () {
  'use strict';
  var A = window.App, P = A.P, $ = A.$, esc = A.esc;
  var state = Object.assign({ runs: [], use: true }, A.load(A.KEYS.pace, {}) || {});
  var model = null;

  function refit() { model = state.runs.length ? P.fitPaceModel(state.runs) : null; }
  function save() { return A.save(A.KEYS.pace, state); }
  refit();

  // What the rest of the app uses. Null means "use the average runner's curve".
  A.paceModel = function () { return state.use && model ? model : null; };
  A.learnedFlatPace = function () { return model ? model.flatPace : null; };

  function gradeLabel(g) { return g === 0 ? 'Flat' : (g > 0 ? 'Climb ' : 'Descent ') + Math.round(Math.abs(g) * 100) + '%'; }

  function chart() {
    var W = 800, H = 260, pad = { l: 52, r: 12, t: 14, b: 34 };
    var gx0 = -0.3, gx1 = 0.3, flat = model.flatPace;
    var yMax = Math.min(30, Math.ceil(Math.max(P.costOf(model, 0.3), P.gradeCost(0.3) / P.gradeCost(0)) * flat / 5) * 5);
    var x = function (g) { return pad.l + (g - gx0) / (gx1 - gx0) * (W - pad.l - pad.r); };
    var y = function (v) { return pad.t + (1 - Math.min(v, yMax) / yMax) * (H - pad.t - pad.b); };
    var hers = '', avg = '';
    for (var g = gx0, i = 0; g <= gx1 + 1e-9; g += 0.01, i++) {
      hers += (i ? ' L' : 'M') + x(g).toFixed(1) + ',' + y(P.costOf(model, g) * flat).toFixed(1);
      avg += (i ? ' L' : 'M') + x(g).toFixed(1) + ',' + y(P.gradeCost(g) / P.gradeCost(0) * flat).toFixed(1);
    }
    var dots = '', all = [];
    state.runs.forEach(function (r) { r.chunks.forEach(function (c) { all.push([c[0], c[1] / r.flatPace * flat]); }); });
    var step = Math.max(1, Math.floor(all.length / 500));
    for (var k = 0; k < all.length; k += step) {
      var c = all[k];
      if (c[0] < gx0 || c[0] > gx1) continue;
      dots += '<circle cx="' + x(c[0]).toFixed(1) + '" cy="' + y(c[1]).toFixed(1) + '" r="3" fill="var(--sea)" opacity="0.18"/>';
    }
    var axes = '';
    for (var t = 0; t <= yMax; t += 5) {
      axes += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--rule)"/>' +
        '<text x="' + (pad.l - 8) + '" y="' + (y(t) + 5) + '" text-anchor="end" font-size="14" fill="var(--stone)">' + t + ':00</text>';
    }
    [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].forEach(function (gg) {
      axes += '<text x="' + x(gg) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="14" fill="var(--stone)">' + (gg > 0 ? '+' : '') + Math.round(gg * 100) + '%</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Your pace at each gradient compared with an average runner">' + axes + dots +
      '<path d="' + avg + '" fill="none" stroke="var(--stone)" stroke-width="2" stroke-dasharray="6 5"/>' +
      '<path d="' + hers + '" fill="none" stroke="var(--gorse)" stroke-width="3.5"/>' +
      '<text x="' + (pad.l + 6) + '" y="' + (pad.t + 14) + '" font-size="14" fill="var(--stone)">min per km</text></svg>' +
      '<p class="hint">Yellow: you. Dashed: an average runner at your flat pace. Dots: each 200 m of your runs.</p>';
  }

  function render() {
    var box = $('paceResult');
    var totalKm = state.runs.reduce(function (s, r) { return s + r.km; }, 0);
    if (!state.runs.length) { box.innerHTML = ''; }
    else if (!model) {
      box.innerHTML = '<div class="warnbox">Not enough running yet to learn from (' + totalKm.toFixed(1) + ' km). Add a couple more runs, ideally with some hills.</div>';
    } else {
      var flat = model.flatPace;
      var rows = [-0.15, -0.05, 0, 0.05, 0.1, 0.15, 0.2].map(function (g) {
        var mine = P.costOf(model, g) * flat, avg = P.gradeCost(g) / P.gradeCost(0) * flat, diff = mine - avg;
        var learned = g === 0 || (g > 0 ? g <= model.steepest.up + 0.02 : g >= model.steepest.down - 0.02);
        return '<tr><td>' + gradeLabel(g) + '</td><td class="clock">' + P.fmtPace(mine) + '</td><td>' + P.fmtPace(avg) + '</td><td>' +
          (g === 0 ? '' : (learned ? (Math.abs(diff) < 0.08 ? 'same' : (diff > 0 ? '+' : '−') + P.fmtPace(Math.abs(diff))) : 'not enough data')) + '</td></tr>';
      }).join('');
      var up = Math.round(model.steepest.up * 100), down = Math.round(-model.steepest.down * 100);
      box.innerHTML = '<div class="stats"><span>Flat pace <b>' + P.fmtPace(flat) + '/km</b></span><span>From <b>' + model.runs + '</b> ' + (model.runs === 1 ? 'run' : 'runs') +
        ', <b>' + totalKm.toFixed(0) + ' km</b></span></div>' +
        '<div class="profile">' + chart() + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Slope</th><th>You</th><th>Average</th><th>Difference</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="hint">Learned from climbs up to ' + up + '% and descents to ' + down + '%. Steeper than that follows the average runner, scaled to you. Flat pace is the average of your latest runs.</p>' +
        '<label class="check"><input type="checkbox" id="paceUse"' + (state.use ? ' checked' : '') + '> Use my pace for race splits, sections and routes</label>';
      $('paceUse').addEventListener('change', function () { state.use = this.checked; save(); A.emit('pace-model'); A.toast(state.use ? 'Using your pace' : 'Using the average runner'); });
    }
    var list = $('paceRuns');
    list.innerHTML = '';
    $('paceRunsTitle').hidden = !state.runs.length;
    state.runs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="grow"><div class="t">' + esc(r.name) + '</div><div class="m">' +
        new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + r.km.toFixed(1) + ' km, +' + Math.round(r.ascent) +
        ' m, flat ' + P.fmtPace(r.flatPace) + '/km' + (r.stoppedMin >= 1 ? ', ' + Math.round(r.stoppedMin) + ' min of stops ignored' : '') + '</div></div>' +
        '<button type="button" class="btn-x" aria-label="Remove ' + esc(r.name) + '">✕</button>';
      row.querySelector('button').addEventListener('click', function () {
        state.runs = state.runs.filter(function (x) { return x.id !== r.id; });
        save(); refit(); render(); A.emit('pace-model');
      });
      list.appendChild(row);
    });
  }

  var WHY = {
    'no-times': 'has no times in it, so it\'s a planned route rather than a recorded run. Export the run itself from COROS.',
    'too-short': 'is too short to learn from (needs at least 1 km of running).',
    'no-heights': 'has no heights in it.'
  };

  function importFiles(files) {
    var added = 0, problems = [];
    $('paceProgress').textContent = 'Reading your runs…';
    return files.reduce(function (p, f) {
      return p.then(function () {
        return f.text().then(function (text) {
          var pts = P.parseTrack(text);
          if (pts.length < 2) throw new Error('empty');
          var noEle = pts.every(function (q) { return q.ele == null; });
          var ready = noEle ? A.withElevation(pts.map(function (q) { return { lat: q.lat, lon: q.lon, ele: null }; })).then(function (prof) {
            pts.forEach(function (q, i) { q.ele = P.eleAt(prof, prof.raw[i].km); });
            return pts;
          }) : Promise.resolve(pts);
          return ready.then(function (ptsE) {
            var a = P.analyseRun(ptsE);
            var dup = state.runs.some(function (r) { return r.date === a.date && Math.abs(r.km - a.km) < 0.15; });
            if (dup) { problems.push(f.name + ' is already in your list.'); return; }
            a.id = 'p' + Date.now() + Math.floor(Math.random() * 1000);
            a.name = f.name.replace(/\.(gpx|tcx)$/i, '');
            a.km = +a.km.toFixed(2); a.movingMin = +a.movingMin.toFixed(1); a.stoppedMin = +a.stoppedMin.toFixed(1);
            a.ascent = Math.round(a.ascent); a.flatPace = +a.flatPace.toFixed(3);
            state.runs.push(a); added++;
          });
        }).catch(function (e) {
          problems.push(f.name + ' ' + (WHY[e && e.message] || 'couldn\'t be read. Is it a GPX or TCX of a run?'));
        });
      });
    }, Promise.resolve()).then(function () {
      if (added) { save(); refit(); A.emit('pace-model'); }
      render();
      $('paceProgress').innerHTML = (added ? 'Added ' + added + (added === 1 ? ' run.' : ' runs.') + (model ? ' Your pace is updated.' : '') : '') +
        problems.map(function (m, i) { return (added || i ? '<br>' : '') + '<span class="error">' + esc(m) + '</span>'; }).join('');
    });
  }

  A.onInit(function () {
    $('paceFiles').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files); this.value = '';
      if (files.length) importFiles(files);
    });
    render();
  });
})();
