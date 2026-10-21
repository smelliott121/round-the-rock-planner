/* Fuel: targets, Lucy's products, sweat test, gut training log. */
(function () {
  'use strict';
  var A = window.App, P = A.P, $ = A.$, esc = A.esc, pl = A.planner;
  var KIND = { gel: 'Gel', drink: 'Drink mix', salt: 'Salt tab', chew: 'Chews', food: 'Food' };
  var gut = A.load(A.KEYS.gut, []) || [];
  var feel = '0', stRate = null;

  // ---------- Products ----------
  function renderProducts() {
    var box = $('products');
    box.innerHTML = '';
    if (!pl.products.length) { box.innerHTML = '<p>No products yet. Add the gels and drinks you use in training.</p>'; return; }
    pl.products.forEach(function (p, i) {
      var el = document.createElement('div');
      el.className = 'product' + (p.use ? '' : ' off');
      var kinds = Object.keys(KIND).map(function (k) { return '<option value="' + k + '"' + (k === p.kind ? ' selected' : '') + '>' + KIND[k] + '</option>'; }).join('');
      el.innerHTML =
        '<div><label>Name</label><input data-k="name" value="' + esc(p.name) + '" placeholder="Brand and flavour"></div>' +
        '<div><label>Type</label><select data-k="kind">' + kinds + '</select></div>' +
        '<div class="nums">' +
          '<div><label>Carbs (g)</label><input data-k="carbs" type="number" min="0" step="1" inputmode="decimal" value="' + (p.carbs || '') + '"></div>' +
          '<div><label>Sodium (mg)</label><input data-k="sodium" type="number" min="0" step="5" inputmode="decimal" value="' + (p.sodium || '') + '"></div>' +
          '<div><label>Caffeine (mg)</label><input data-k="caffeine" type="number" min="0" step="5" inputmode="decimal" value="' + (p.caffeine || '') + '"></div>' +
          (p.kind === 'drink' ? '<div><label>Mixed in (ml)</label><input data-k="ml" type="number" min="0" step="50" value="' + (p.ml || '') + '"></div>' : '<div></div>') +
        '</div>' +
        '<div class="foot"><label><input type="checkbox" data-k="use"' + (p.use ? ' checked' : '') + '> Use in race plan</label>' +
        '<button type="button" class="btn-x" aria-label="Remove product">Remove</button></div>';
      el.querySelectorAll('input, select').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var k = inp.dataset.k;
          if (k === 'use') p.use = inp.checked;
          else if (k === 'name' || k === 'kind') p[k] = inp.value;
          else p[k] = parseFloat(inp.value) || 0;
          pl.save(); A.emit('products');
          if (k === 'kind' || k === 'use') renderProducts();
        });
      });
      el.querySelector('.btn-x').addEventListener('click', function () {
        pl.products.splice(i, 1); pl.save(); A.emit('products'); renderProducts();
      });
      box.appendChild(el);
    });
  }

  // ---------- Sweat test ----------
  function updateSweat() {
    var before = parseFloat($('stBefore').value), after = parseFloat($('stAfter').value);
    stRate = P.sweatRate(before, after, parseFloat($('stDrank').value) || 0, parseFloat($('stMin').value));
    if (stRate == null) { $('stResult').innerHTML = '<span>Fill in both weights and how long you ran.</span>'; }
    else {
      var loss = (before - after) / before * 100;
      $('stResult').innerHTML = '<span>Sweat rate <b>' + stRate.toFixed(2) + ' L/h</b></span><span>Weight change <b>' + (loss > 0 ? '−' : '+') + Math.abs(loss).toFixed(1) + '%</b></span>';
    }
    $('stUse').disabled = stRate == null;
  }

  // ---------- Gut training ----------
  function saveGut() { A.save(A.KEYS.gut, gut); }
  function gph(e) { return e.carbs / (e.min / 60); }
  function renderGut() {
    var sorted = gut.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var target = A.num('carbs', 60);
    if (sorted.length) {
      var W = 800, H = 170, pad = { l: 40, r: 10, t: 12, b: 26 };
      var vals = sorted.map(gph), max = Math.max(target, Math.max.apply(null, vals)) * 1.15;
      var x = function (i) { return pad.l + (sorted.length === 1 ? (W - pad.l - pad.r) / 2 : i / (sorted.length - 1) * (W - pad.l - pad.r)); };
      var y = function (v) { return pad.t + (1 - v / max) * (H - pad.t - pad.b); };
      var colour = ['var(--ok)', 'var(--gorse)', 'var(--brick)'];
      var line = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
      var dots = vals.map(function (v, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="7" fill="' + colour[+sorted[i].feel || 0] + '" stroke="var(--paper)" stroke-width="2"/>'; }).join('');
      var ty = y(target).toFixed(1);
      $('gChart').innerHTML = '<h3>Carbs per hour on long runs</h3><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Carbs per hour across logged runs against a race target of ' + target + ' grams">' +
        '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + ty + '" y2="' + ty + '" stroke="var(--sea)" stroke-dasharray="6 5" stroke-width="2"/>' +
        '<text x="' + pad.l + '" y="' + (+ty - 8) + '" font-size="14" fill="var(--sea)">Race target ' + target + ' g/h</text>' +
        '<text x="4" y="' + (y(0) + 4) + '" font-size="13" fill="var(--stone)">0</text>' +
        '<path d="' + line + '" fill="none" stroke="var(--stone)" stroke-width="1.5" opacity="0.6"/>' + dots +
        '<text x="' + pad.l + '" y="' + (H - 6) + '" font-size="13" fill="var(--stone)">' + shortDate(sorted[0].date) + '</text>' +
        (sorted.length > 1 ? '<text x="' + (W - pad.r) + '" y="' + (H - 6) + '" text-anchor="end" font-size="13" fill="var(--stone)">' + shortDate(sorted[sorted.length - 1].date) + '</text>' : '') +
        '</svg><p class="hint">Green: fine. Yellow: a bit off. Red: bad. If your stomach complains, hold at that level for a few runs before stepping up.</p>';
    } else {
      $('gChart').innerHTML = '';
    }
    var box = $('gList');
    box.innerHTML = '';
    var feelText = ['Fine', 'A bit off', 'Bad'];
    sorted.slice().reverse().forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<div class="grow"><div class="t">' + Math.round(gph(e)) + ' g/h, ' + feelText[+e.feel || 0].toLowerCase() + '</div>' +
        '<div class="m">' + shortDate(e.date) + ', ' + e.min + ' min, ' + e.carbs + ' g' + (e.note ? '. ' + esc(e.note) : '') + '</div></div>' +
        '<button type="button" class="btn-x" aria-label="Delete this entry">✕</button>';
      row.querySelector('button').addEventListener('click', function () { gut = gut.filter(function (x) { return x.id !== e.id; }); saveGut(); renderGut(); });
      box.appendChild(row);
    });
  }
  function shortDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

  A.tab('fuel', {
    title: 'Fuel',
    snap: 'full',
    aside: function () { return A.num('carbs', 0) + ' g carbs per hour'; },
    init: function () {
      A.subnav('fuelNav', 'fuel');
      document.querySelectorAll('[data-add]').forEach(function (b) {
        b.addEventListener('click', function () {
          var kind = b.dataset.add;
          pl.products.push({ name: '', kind: kind, carbs: 0, sodium: 0, caffeine: 0, ml: kind === 'drink' ? 500 : 0, use: true });
          pl.save(); A.emit('products'); renderProducts();
          var names = $('products').querySelectorAll('input[data-k="name"]');
          if (names.length) names[names.length - 1].focus();
        });
      });
      ['stBefore', 'stAfter', 'stDrank', 'stMin'].forEach(function (id) { $(id).addEventListener('input', updateSweat); });
      $('stUse').addEventListener('click', function () {
        if (stRate == null) return;
        $('sweatRate').value = stRate.toFixed(2); pl.fields.sweatRate = $('sweatRate').value;
        if (!$('weight').value && $('stBefore').value) { $('weight').value = $('stBefore').value; pl.fields.weight = $('weight').value; }
        pl.save(); A.emit('plan'); A.toast('Sweat rate saved: ' + stRate.toFixed(2) + ' L/h');
      });
      $('gDate').value = new Date().toISOString().slice(0, 10);
      A.seg('gFeel', feel, function (v) { feel = v; });
      $('gAdd').addEventListener('click', function () {
        var min = parseFloat($('gMin').value), carbs = parseFloat($('gCarbs').value);
        if (!(min > 0) || !(carbs >= 0) || $('gCarbs').value === '') { A.toast('Add the run length and how many grams of carbs you took'); return; }
        gut.push({ id: 'g' + Date.now(), date: $('gDate').value || new Date().toISOString().slice(0, 10), min: min, carbs: carbs, feel: feel, note: $('gNote').value.trim() });
        saveGut(); renderGut();
        $('gMin').value = ''; $('gCarbs').value = ''; $('gNote').value = '';
        A.toast('Logged ' + Math.round(carbs / (min / 60)) + ' g per hour');
      });
      A.on('plan', function () { A.refreshAside(); renderGut(); });
      renderProducts(); updateSweat(); renderGut();
    },
    show: function () { A.showLayers(['start']); }
  });
})();
