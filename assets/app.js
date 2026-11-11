/*
 * One script drives every page. Each page's <body> says where it is:
 *   data-root      path from this page back to the site root ("./" or "../")
 *   data-district  slug of the district to show; absent on the home page, which lists districts
 *
 * Data (all relative to data-root):
 *   data/districts.json  [{ slug, name, link }]   link = that district's WhatsApp group invite
 *   data/<slug>.json     [[name, phone], ...]     phone = digits with country code
 *   messages.json        message templates using {name} and {link}
 */
(function () {
  'use strict';

  var PER = 50;                 // contacts per section
  var KEY = 'wa-sent-v1';       // localStorage: { phone: timestamp }
  var ROOT = document.body.dataset.root || './';
  var SLUG = document.body.dataset.district || '';
  var app = document.getElementById('app');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJSON(path) {
    return fetch(ROOT + path).then(function (r) {
      if (!r.ok) throw new Error(path + ' (' + r.status + ')');
      return r.json();
    });
  }

  function fail(err) {
    var hint = location.protocol === 'file:' ? '<br>Open the site through a web server, not straight from the file.' : '';
    app.innerHTML = '<main><div class="notice"><b>Couldn’t load this page.</b> ' + esc(err && err.message || err) + hint + '</div></main>';
  }

  /* ---------- home: list of districts ---------- */
  function showDistricts() {
    getJSON('data/districts.json').then(function (ds) {
      app.innerHTML =
        '<header><div class="bar"><h1>WhatsApp Sender</h1></div></header>' +
        '<main><p class="lead">Choose a district.</p><nav class="districts">' +
        ds.map(function (d) { return '<a class="district" href="' + esc(d.slug) + '/">' + esc(d.name) + '</a>'; }).join('') +
        '</nav></main>';
    }).catch(fail);
  }

  /* ---------- district: contacts to message ---------- */
  function showDistrict() {
    Promise.all([getJSON('data/districts.json'), getJSON('data/' + SLUG + '.json'), getJSON('messages.json')])
      .then(function (r) {
        var district = r[0].filter(function (d) { return d.slug === SLUG; })[0];
        if (!district) throw new Error('Unknown district "' + SLUG + '"');
        renderDistrict(district, r[1], r[2]);
      })
      .catch(fail);
  }

  function renderDistrict(district, C, M) {
    var sent = {};
    try { sent = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    function save() { try { localStorage.setItem(KEY, JSON.stringify(sent)); } catch (e) {} }

    var lastIdx = -1;
    function pickMessage(name) {
      var i;
      do { i = Math.floor(Math.random() * M.length); } while (M.length > 1 && i === lastIdx);
      lastIdx = i;
      return M[i].replace(/\{(name|link)\}/gi, function (_, k) {
        return k.toLowerCase() === 'name' ? (name || 'there') : district.link;
      });
    }

    var sections = [];
    for (var i = 0; i < C.length; i += PER) sections.push(C.slice(i, i + PER));

    app.innerHTML =
      '<header>' +
        '<div class="bar">' +
          '<h1>' + esc(district.name) + '</h1>' +
          '<select id="jump" aria-label="Jump to section"></select>' +
          '<button class="ghost" id="reset" title="Clear sent marks for ' + esc(district.name) + '">Reset</button>' +
        '</div>' +
        '<div class="stats" id="stats"></div>' +
        '<div class="chips" id="chips"></div>' +
      '</header>' +
      '<main id="list"></main>';

    var list = document.getElementById('list');
    var jump = document.getElementById('jump');
    var chips = document.getElementById('chips');
    var stats = document.getElementById('stats');

    sections.forEach(function (rows, s) {
      var d = document.createElement('details');
      d.id = 'sec' + (s + 1);
      var html = '<summary>Section ' + (s + 1) + '<span class="count"></span></summary>';
      rows.forEach(function (c, k) {
        var idx = s * PER + k;
        html += '<div class="row" data-i="' + idx + '"><span class="idx">' + (idx + 1) + '</span>' +
          '<span class="name">' + esc(c[0] || c[1]) + '<span class="num">+' + esc(c[1]) + '</span></span>' +
          '<a class="send" href="#" target="_blank" rel="noopener">Send</a></div>';
      });
      d.innerHTML = html;
      list.appendChild(d);

      var o = document.createElement('option');
      o.value = s + 1; o.textContent = 'Section ' + (s + 1);
      jump.appendChild(o);

      var ch = document.createElement('button');
      ch.className = 'chip'; ch.textContent = s + 1; ch.dataset.s = s + 1;
      chips.appendChild(ch);
    });

    function refresh() {
      var total = 0;
      sections.forEach(function (rows, s) {
        var d = document.getElementById('sec' + (s + 1)), n = 0;
        d.querySelectorAll('.row').forEach(function (r) {
          var is = !!sent[C[r.dataset.i][1]];
          r.classList.toggle('sent', is);
          if (is) n++;
        });
        total += n;
        d.querySelector('.count').textContent = n + ' / ' + rows.length + ' sent';
        chips.children[s].classList.toggle('done', n === rows.length);
      });
      stats.textContent = total + ' of ' + C.length + ' sent · ' + sections.length + ' sections · ' + M.length + ' message variants';
    }

    function goTo(n) {
      var d = document.getElementById('sec' + n);
      if (!d) return;
      d.open = true;
      jump.value = n;
      Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle('active', c.dataset.s == n); });
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    jump.addEventListener('change', function () { goTo(jump.value); });
    chips.addEventListener('click', function (e) { if (e.target.dataset.s) goTo(e.target.dataset.s); });

    // Build the wa.me link at click time so each click gets a different message variant.
    list.addEventListener('click', function (e) {
      var a = e.target.closest('a.send');
      if (!a) return;
      var c = C[a.closest('.row').dataset.i];
      a.href = 'https://wa.me/' + c[1] + '?text=' + encodeURIComponent(pickMessage(c[0]));
      sent[c[1]] = Date.now();
      save();
      setTimeout(refresh, 0);
    });

    // Reset only touches this district's contacts.
    document.getElementById('reset').addEventListener('click', function () {
      if (confirm('Clear all "sent" marks for ' + district.name + '?')) {
        C.forEach(function (c) { delete sent[c[1]]; });
        save();
        refresh();
      }
    });

    refresh();
    if (sections.length) goTo(1);
    window.scrollTo(0, 0);
  }

  if (SLUG) showDistrict(); else showDistricts();
})();
