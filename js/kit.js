/* Kit: race kit checklist and shoe mileage. */
(function () {
  'use strict';
  var A = window.App, $ = A.$, esc = A.esc;
  var uid = function () { return 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); };
  function list(texts) { return texts.map(function (t) { return { id: uid(), text: t, done: false }; }); }
  var DEFAULT_KIT = { groups: [
    { name: 'Carry on race day', items: list(['Soft flasks or bottles, at least 1 litre', 'Waterproof jacket', 'Phone, charged', 'Whistle', 'Foil blanket',
      'Cup for checkpoints', 'Gels and salt tabs for the first leg', 'Blister plasters', 'Cap and sunglasses', 'Card or a little cash']) },
    { name: 'Drop bag or crew', items: list(['Spare socks', 'Spare top', 'Anti-chafe balm', 'Sun cream', 'Refills of gels and drink mix',
      'Something salty and something sweet for late on', 'Warm layer for the finish']) },
    { name: 'Night before', items: list(['Race number and pins', 'Watch charged with the route loaded', 'Kit laid out', 'Breakfast ready', 'Bottles filled', 'Alarm set']) }
  ] };
  var kit = A.load(A.KEYS.kit, null) || JSON.parse(JSON.stringify(DEFAULT_KIT));
  var shoes = A.load(A.KEYS.shoes, []) || [];
  function saveKit() { A.save(A.KEYS.kit, kit); A.refreshAside(); }
  function saveShoes() { A.save(A.KEYS.shoes, shoes); }

  function renderKit() {
    var box = $('kitGroups');
    box.innerHTML = '';
    kit.groups.forEach(function (g) {
      var done = g.items.filter(function (i) { return i.done; }).length;
      var h = document.createElement('h2');
      h.textContent = g.name + ' (' + done + ' of ' + g.items.length + ')';
      box.appendChild(h);
      g.items.forEach(function (it, idx) {
        var row = document.createElement('div');
        row.className = 'kit-item' + (it.done ? ' done' : '');
        row.innerHTML = '<label><input type="checkbox"' + (it.done ? ' checked' : '') + '> ' + esc(it.text) + '</label>' +
          '<button type="button" class="btn-x" aria-label="Remove ' + esc(it.text) + '">✕</button>';
        row.querySelector('input').addEventListener('change', function () { it.done = this.checked; saveKit(); renderKit(); });
        row.querySelector('.btn-x').addEventListener('click', function () { g.items.splice(idx, 1); saveKit(); renderKit(); });
        box.appendChild(row);
      });
    });
    $('kitGroup').innerHTML = kit.groups.map(function (g, i) { return '<option value="' + i + '">' + esc(g.name) + '</option>'; }).join('');
  }

  function renderShoes() {
    var box = $('shoeList');
    box.innerHTML = '';
    if (!shoes.length) { box.innerHTML = '<p>No shoes yet. Add the pairs you run in to keep track of their mileage.</p>'; return; }
    shoes.forEach(function (s, i) {
      var pct = Math.min(100, s.km / s.max * 100), over = s.km >= s.max, near = s.km >= s.max * 0.85;
      var row = document.createElement('div');
      row.className = 'section';
      row.innerHTML = '<div class="row" style="border:none;padding-bottom:0"><div class="grow"><div class="t">' + esc(s.name) + (s.retired ? ' (retired)' : '') + '</div>' +
        '<div class="m"><span class="num">' + Math.round(s.km) + '</span> of ' + s.max + ' km' + (over ? ', time for a new pair' : near ? ', getting close' : '') + '</div></div>' +
        '<button type="button" class="btn-x" data-a="del" aria-label="Delete ' + esc(s.name) + '">✕</button></div>' +
        '<div class="bar' + (near ? ' full' : '') + '"><i style="width:' + pct.toFixed(0) + '%"></i></div>' +
        (s.retired ? '' : '<div class="grid field" style="grid-template-columns:1fr auto auto;align-items:end"><div><label>Add a run (km)</label><input type="number" min="0" step="0.1" inputmode="decimal"></div>' +
          '<button type="button" class="btn" data-a="add">Add</button><button type="button" class="btn quiet" data-a="retire">Retire</button></div>');
      row.addEventListener('click', function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        if (a === 'del') { if (confirm('Delete ' + s.name + '?')) { shoes.splice(i, 1); saveShoes(); renderShoes(); } }
        if (a === 'retire') { s.retired = true; saveShoes(); renderShoes(); }
        if (a === 'add') {
          var v = parseFloat(row.querySelector('input').value);
          if (v > 0) { s.km = Math.round((s.km + v) * 10) / 10; saveShoes(); renderShoes(); A.toast('Added ' + v + ' km to ' + s.name); }
        }
      });
      box.appendChild(row);
    });
  }

  A.tab('kit', {
    title: 'Kit',
    snap: 'full',
    aside: function () {
      var all = 0, done = 0;
      kit.groups.forEach(function (g) { all += g.items.length; done += g.items.filter(function (i) { return i.done; }).length; });
      return done + ' of ' + all + ' packed';
    },
    init: function () {
      A.subnav('kitNav', 'kit');
      $('kitAdd').addEventListener('click', function () {
        var t = $('kitText').value.trim(); if (!t) { A.toast('Type the item first'); return; }
        kit.groups[+$('kitGroup').value].items.push({ id: uid(), text: t, done: false });
        $('kitText').value = ''; saveKit(); renderKit();
      });
      $('kitReset').addEventListener('click', function () {
        kit.groups.forEach(function (g) { g.items.forEach(function (i) { i.done = false; }); });
        saveKit(); renderKit(); A.toast('Everything unticked');
      });
      $('shoeAdd').addEventListener('click', function () {
        var name = $('shoeName').value.trim(); if (!name) { A.toast('Give the shoes a name'); return; }
        shoes.push({ id: uid(), name: name, km: parseFloat($('shoeKm').value) || 0, max: parseFloat($('shoeMax').value) || 650, retired: false });
        $('shoeName').value = ''; $('shoeKm').value = 0; saveShoes(); renderShoes();
      });
      renderKit(); renderShoes();
    },
    show: function () { A.showLayers(['start']); }
  });
})();
