/* Today: race countdowns, conditions where Lucy runs, daylight and tides. */
(function () {
  'use strict';
  var A = window.App, $ = A.$, esc = A.esc;
  var JERSEY = { lat: 49.214, lon: -2.131, name: 'Jersey' };
  var DEFAULT_RACES = [
    { id: 'london', name: 'London Marathon', date: '2027-04-25' },
    { id: 'rtr', name: 'Round the Rock', date: '2027-07-31' }
  ];
  var races = (A.state.races || DEFAULT_RACES).map(function (r) { return Object.assign({}, r); });
  function saveRaces() { A.state.races = races; A.saveState(); A.emit('races', races); }

  function daysUntil(dateStr) {
    var t = new Date(dateStr + 'T00:00:00'), now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((t - today) / 86400000);
  }
  function longDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderCountdowns() {
    var list = races.filter(function (r) { return r.date && daysUntil(r.date) >= 0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!list.length) { $('countdowns').innerHTML = '<p>No races coming up. Add one below.</p>'; return; }
    $('countdowns').innerHTML = list.map(function (r) {
      var d = daysUntil(r.date), big, unit;
      if (d === 0) { big = 'Today'; unit = ''; }
      else if (d < 14) { big = d; unit = d === 1 ? 'day' : 'days'; }
      else { big = Math.floor(d / 7); unit = 'weeks'; }
      return '<div class="count"><div class="bigcol"><span class="big">' + big + '</span><span class="unit">' + unit + '</span></div>' +
        '<div class="what">' + esc(r.name) + '</div>' +
        '<div class="when">' + longDate(r.date) + (d >= 14 ? ', ' + d + ' days away' : '') + '</div></div>';
    }).join('');
  }

  function renderRaceEdit() {
    var box = $('raceEditList');
    box.innerHTML = '';
    races.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'grid field';
      row.style.gridTemplateColumns = '1.4fr 1fr auto';
      row.innerHTML = '<div><label>Race</label><input data-k="name" value="' + esc(r.name) + '"></div>' +
        '<div><label>Date</label><input data-k="date" type="date" value="' + esc(r.date) + '"></div>' +
        '<button type="button" class="btn-x" aria-label="Remove ' + esc(r.name) + '" style="align-self:end">✕</button>';
      row.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('change', function () { r[inp.dataset.k] = inp.value; saveRaces(); renderCountdowns(); });
      });
      row.querySelector('button').addEventListener('click', function () { races.splice(i, 1); saveRaces(); renderRaceEdit(); renderCountdowns(); });
      box.appendChild(row);
    });
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'London 2027 runs over two days, 24 and 25 April. Set the day you\'re given. Round the Rock is from the race listing, so check it with the organiser.';
    box.appendChild(hint);
  }

  function where() {
    var g = A.load(A.KEYS.gen, {}) || {};
    if (g.start) return { lat: g.start.lat, lon: g.start.lon, name: A.state.placeName || 'your run start' };
    return JERSEY;
  }

  function renderWeather() {
    var loc = where();
    $('wxPlace').textContent = 'Conditions in ' + (loc.name === 'your run start' ? 'the area of your run' : loc.name);
    A.weather(loc.lat, loc.lon).then(function (w) {
      var off = w.utc_offset_seconds || 0, c = w.current || {}, h = w.hourly || {};
      $('wxNow').innerHTML = '<div class="now"><span class="temp num">' + Math.round(c.temperature_2m) + '°</span>' +
        '<div class="desc">' + esc(A.wxText(c.weather_code)) + ', feels like ' + Math.round(c.apparent_temperature) + '°<br>' +
        'Wind ' + Math.round(c.wind_speed_10m) + ' mph from the ' + A.compass(c.wind_direction_10m) + ' ' + A.windArrow(c.wind_direction_10m) +
        ', gusts ' + Math.round(c.wind_gusts_10m) + '</div></div>';
      var now = Date.now() / 1000, first = 0;
      while (first < (h.time || []).length - 1 && h.time[first] < now - 3600) first++;
      var hours = '';
      for (var i = first; i < Math.min(first + 12, h.time.length); i++) {
        hours += '<div class="hour">' + A.clockAt(h.time[i], off).slice(0, 2) + ':00<b>' + Math.round(h.temperature_2m[i]) + '°</b>' +
          (h.precipitation_probability[i] != null ? h.precipitation_probability[i] + '% rain<br>' : '') + Math.round(h.wind_speed_10m[i]) + ' mph</div>';
      }
      $('wxHours').innerHTML = hours;
      var d = w.daily || {};
      var sunset = d.sunset && d.sunset[0], sunrise = d.sunrise && d.sunrise[0];
      var left = sunset ? sunset - now : 0;
      $('wxDay').innerHTML =
        (sunrise ? '<span>Sunrise <b>' + A.clockAt(sunrise, off) + '</b></span>' : '') +
        (sunset ? '<span>Sunset <b>' + A.clockAt(sunset, off) + '</b></span>' : '') +
        (left > 0 ? '<span>Daylight left <b>' + Math.floor(left / 3600) + 'h ' + String(Math.floor(left % 3600 / 60)).padStart(2, '0') + 'm</b></span>' : '<span>After sunset</span>') +
        (d.uv_index_max ? '<span>UV <b>' + Math.round(d.uv_index_max[0]) + '</b></span>' : '');
    }).catch(function () {
      $('wxNow').innerHTML = '<p class="hint">The forecast didn\'t load. It\'ll try again when you\'re back online.</p>';
      $('wxHours').innerHTML = ''; $('wxDay').innerHTML = '';
    });

    A.tides(loc.lat, loc.lon).then(function (t) {
      var h = t.hourly || {}, ts = h.time || [], hs = h.sea_level_height_msl || [];
      var ok = hs.filter(function (v) { return v != null; }).length > 12;
      $('tideSection').hidden = !ok;
      if (!ok) return;
      renderTides(ts, hs, t.utc_offset_seconds || 0);
    }).catch(function () { $('tideSection').hidden = true; });
  }

  // High and low water from hourly heights, refined with a parabola through each turning point.
  function turningPoints(ts, hs) {
    var out = [];
    for (var i = 1; i < hs.length - 1; i++) {
      var a = hs[i - 1], b = hs[i], c = hs[i + 1];
      if (a == null || b == null || c == null) continue;
      var high = b >= a && b > c, low = b <= a && b < c;
      if (!high && !low) continue;
      var den = a - 2 * b + c, off = den ? 0.5 * (a - c) / den : 0;
      off = Math.max(-0.5, Math.min(0.5, off));
      out.push({ t: ts[i] + off * 3600, h: b - 0.25 * (a - c) * off, high: high });
    }
    return out;
  }

  function renderTides(ts, hs, off) {
    var now = Date.now() / 1000;
    var turns = turningPoints(ts, hs).filter(function (p) { return p.t > now - 1800; }).slice(0, 4);
    $('tideList').innerHTML = turns.map(function (p) {
      var day = A.dayKey(p.t, off) === A.dayKey(now, off) ? '' : ' tomorrow';
      return '<span>' + (p.high ? 'High' : 'Low') + ' <b>' + A.clockAt(p.t, off) + '</b>' + day + '</span>';
    }).join('');
    // Curve from now to +30 h.
    var from = now - 2 * 3600, to = now + 30 * 3600;
    var pts = [];
    for (var i = 0; i < ts.length; i++) if (ts[i] >= from && ts[i] <= to && hs[i] != null) pts.push([ts[i], hs[i]]);
    if (pts.length < 4) { $('tideChart').innerHTML = ''; return; }
    var W = 800, H = 110, min = Math.min.apply(null, pts.map(function (p) { return p[1]; })), max = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var x = function (t) { return (t - from) / (to - from) * W; }, y = function (v) { return 10 + (1 - (v - min) / (max - min || 1)) * (H - 30); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1); }).join(' ');
    var labels = turns.map(function (p) {
      return '<text x="' + Math.min(W - 24, Math.max(24, x(p.t))) + '" y="' + (p.high ? y(p.h) - 4 : y(p.h) + 16) + '" text-anchor="middle" font-size="14" fill="var(--stone)">' + A.clockAt(p.t, off) + '</text>';
    }).join('');
    $('tideChart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tide curve for the next day">' +
      '<path d="' + d + ' L' + x(pts[pts.length - 1][0]).toFixed(1) + ',' + H + ' L' + x(pts[0][0]).toFixed(1) + ',' + H + ' Z" fill="color-mix(in srgb, var(--sea) 18%, transparent)"/>' +
      '<path d="' + d + '" fill="none" stroke="var(--sea)" stroke-width="2.5"/>' +
      '<line x1="' + x(now) + '" x2="' + x(now) + '" y1="0" y2="' + H + '" stroke="var(--gorse)" stroke-width="2"/>' +
      '<text x="' + (x(now) + 6) + '" y="' + (H - 6) + '" font-size="13" fill="var(--stone)">now</text>' + labels + '</svg>';
  }

  A.tab('today', {
    title: 'Today',
    snap: 'half',
    aside: function () { return new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); },
    init: function () {
      $('addRace').addEventListener('click', function () {
        races.push({ id: 'r' + Date.now(), name: 'New race', date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) });
        saveRaces(); renderRaceEdit(); renderCountdowns();
      });
      renderRaceEdit();
      A.on('start-changed', function () { if (A.current() === 'today') renderWeather(); });
    },
    show: function () {
      renderCountdowns();
      renderWeather();
      A.showLayers(['start']);
    }
  });

  A.races = function () { return races; };
  A.daysUntil = daysUntil;
})();
