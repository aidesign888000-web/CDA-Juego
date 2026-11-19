/* CDA Boyacá Motor - revisión sobre Neon Drift '86.
 * Recoges ítems de revisión en la carretera (frenos, luces, bujes, gas...).
 * Cada uno muestra un consejo corto. Al juntar 10: "tanque bajo": entras a
 * tanquear (consejo largo) o respondes una trivia rápida para seguir. 90 s. */
var CDA = (function () {
  'use strict';

  var GAME_SECONDS = 90;
  var NEED = 10;               /* ítems para el tanque bajo */
  var ITEM_EVERY = 90;         /* un ítem cada N segmentos */
  var TRIVIA_SECONDS = 10;
  var ITEM_PTS = 50, TRIVIA_PTS = 300;

  var st = null, q = null, deck = [], last = 0, raf = 0, toastTimer = 0, quickTimer = 0;
  var name = '', plate = '';
  var iconCache = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function $(id) { return document.getElementById(id); }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- sprites de los ítems (se sirven a través de SPRITES.get) ---------- */
  function makeIcon(item) {
    var cv = document.createElement('canvas');
    cv.width = 40; cv.height = 40;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#14301f'; g.beginPath(); g.arc(20, 20, 19, 0, 6.3); g.fill();
    g.fillStyle = '#f97316'; g.beginPath(); g.arc(20, 20, 16, 0, 6.3); g.fill();
    g.fillStyle = '#fff7ed'; g.beginPath(); g.arc(20, 20, 13, 0, 6.3); g.fill();
    g.font = '18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(item.icono, 20, 21);
    return { canvas: cv, w: 40, h: 40, anchor: { x: 0.5, y: 1 } };
  }

  function patchSprites() {
    if (typeof SPRITES === 'undefined' || SPRITES.__cda) { return; }
    var orig = SPRITES.get;
    SPRITES.get = function (key) {
      if (typeof key === 'string' && key.indexOf('cda_') === 0) {
        if (!iconCache[key]) {
          var id = key.substring(4);
          for (var i = 0; i < CDA_ITEMS.length; i++) {
            if (CDA_ITEMS[i].id === id) { iconCache[key] = makeIcon(CDA_ITEMS[i]); }
          }
        }
        return iconCache[key] || null;
      }
      return orig.call(SPRITES, key);
    };
    SPRITES.__cda = true;
  }

  /* ---------- ítems en la pista ---------- */
  function placeItems() {
    var gs = GAME.state, segs = gs.segments, n = segs.length, k = 0, i, lane;
    var lanes = [-0.55, 0, 0.55];
    for (i = 0; i < n; i++) {                       /* limpiar marcas previas */
      var arr = segs[i].sprites;
      for (var j = arr.length - 1; j >= 0; j--) { if (arr[j].cda) { arr.splice(j, 1); } }
    }
    for (i = 30; i < n - 10; i += ITEM_EVERY) {
      lane = lanes[Math.floor(Math.random() * 3)];
      var it = CDA_ITEMS[k % CDA_ITEMS.length]; k++;
      segs[i].sprites.push({ source: 'cda_' + it.id, offset: lane, scale: 1.7, cda: true, id: it.id });
    }
    st.segLen = gs.trackLength / n;
  }

  function checkPickups(gs) {
    var segs = gs.segments, n = segs.length;
    var z = gs.position + gs.playerZ;
    var idx = Math.floor(z / st.segLen) % n;
    if (st.lastIdx == null) { st.lastIdx = idx; }
    var from = st.lastIdx, steps = 0;
    while (from !== idx && steps < 40) {
      from = (from + 1) % n; steps++;
      pickIn(segs[from], gs);
    }
    pickIn(segs[idx], gs);
    st.lastIdx = idx;
  }

  function pickIn(seg, gs) {
    var arr = seg.sprites;
    for (var j = arr.length - 1; j >= 0; j--) {
      var s = arr[j];
      if (s.cda && Math.abs(s.offset - gs.playerX) < 0.42) {
        arr.splice(j, 1);
        collect(s.id);
      }
    }
  }

  function collect(id) {
    var it = null;
    for (var i = 0; i < CDA_ITEMS.length; i++) { if (CDA_ITEMS[i].id === id) { it = CDA_ITEMS[i]; } }
    if (!it) { return; }
    st.count++; st.total++; st.pts += ITEM_PTS;
    st.checked[id] = true;
    toast(it.icono + ' ' + it.nombre + ': ' + it.tip);
    hud();
    if (st.count >= NEED) { lowTank(); }
  }

  function toast(text) {
    var t = $('cda-toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 4200);
  }

  /* ---------- UI ---------- */
  function init() {
    try {
      var u = new URLSearchParams(location.search);
      name = (u.get('n') || '').trim();
      plate = (u.get('p') || '').trim().toUpperCase();
    } catch (e) { /* ignore */ }
    patchSprites();
    var frame = document.querySelector('.screen-frame');
    var ui = el('div', 'cda-ui');
    frame.appendChild(ui);
    var h = el('div', 'cda-hud hidden'); h.id = 'cda-hud';
    var s = el('span', '', 'CDA 0'); s.id = 'cda-score';
    var c = el('span', 'cda-count', 'Revisión 0/10'); c.id = 'cda-count';
    var t = el('span', 'cda-time', '90 s'); t.id = 'cda-time';
    h.appendChild(s); h.appendChild(c); h.appendChild(t);
    ui.appendChild(h);
    var toastEl = el('div', 'cda-toast hidden'); toastEl.id = 'cda-toast';
    ui.appendChild(toastEl);
    var card = el('div', 'cda-card'); card.id = 'cda-card';
    ui.appendChild(card);
    showStart();
  }

  function clear() {
    var c = $('cda-card');
    c.innerHTML = '';
    c.classList.remove('hidden');
    c.parentNode.classList.add('shade');
    return c;
  }
  function hideCard() { var c = $('cda-card'); c.classList.add('hidden'); c.parentNode.classList.remove('shade'); }
  function button(text, cls, fn) {
    var b = el('button', 'cda-btn ' + (cls || ''), text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function focusGame() { var cv = $('screen'); if (cv && cv.focus) { cv.focus(); } }

  function showStart() {
    var c = clear();
    c.appendChild(el('h2', '', 'CDA Boyacá Motor'));
    c.appendChild(el('p', '', 'Maneja y recoge los ítems de revisión de tu carro. ¡Tienes 90 segundos!'));
    var n = el('input'); n.placeholder = 'Tu nombre'; n.value = name; n.maxLength = 24;
    var p = el('input'); p.placeholder = 'Placa (ABC123)'; p.value = plate; p.maxLength = 8;
    c.appendChild(n); c.appendChild(p);
    c.appendChild(button('Empezar', '', function () {
      name = n.value.trim(); plate = p.value.trim().toUpperCase();
      if (!name || !plate) { return; }
      start();
    }));
  }

  function start() {
    st = { pts: 0, count: 0, total: 0, right: 0, trivias: 0, left: GAME_SECONDS,
           over: false, asking: false, checked: {}, lastIdx: null, segLen: 200 };
    deck = shuffle(CDA_QUESTIONS);
    hideCard();
    $('cda-hud').classList.remove('hidden');
    try { GAME.startStage(0); } catch (e) { /* ignore */ }
    placeItems();
    focusGame();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!st || st.over || st.asking) { return; }
    var gs = GAME.state;
    if (gs.mode !== 'race') { return; }
    if (gs.lap !== st.lap) { st.lap = gs.lap; placeItems(); st.lastIdx = null; }
    st.left -= dt;
    if (gs.timeLeft < 8) { gs.timeLeft = 20; }
    checkPickups(gs);
    hud();
    if (st.left <= 0 && !st.asking) { finish(); }
  }

  function hud() {
    $('cda-score').textContent = 'CDA ' + st.pts;
    $('cda-count').textContent = 'Revisión ' + st.count + '/' + NEED;
    $('cda-time').textContent = Math.max(0, Math.ceil(st.left)) + ' s';
  }

  /* ---------- tanque bajo ---------- */
  function lowTank() {
    st.asking = true;
    try { GAME.pauseRace(); } catch (e) { /* ignore */ }
    var c = clear();
    c.appendChild(el('h2', 'bad', '¡Tanque bajo!'));
    c.appendChild(el('p', '', 'Revisaste ' + NEED + ' partes. Para seguir: entra a tanquear o responde una trivia rápida.'));
    c.appendChild(button('Entrar a tanquear', '', pitStop));
    c.appendChild(button('Trivia rápida (' + TRIVIA_SECONDS + ' s) +' + TRIVIA_PTS, 'alt', trivia));
  }

  function lastChecked() {
    var ids = Object.keys(st.checked), pick = ids[Math.floor(Math.random() * ids.length)];
    for (var i = 0; i < CDA_ITEMS.length; i++) { if (CDA_ITEMS[i].id === pick) { return CDA_ITEMS[i]; } }
    return CDA_ITEMS[0];
  }

  function pitStop() {
    var it = lastChecked();
    var c = clear();
    c.appendChild(el('h2', 'ok', '⛽ Pit stop'));
    c.appendChild(el('p', 'cda-tag', it.nombre));
    c.appendChild(el('p', 'fact', it.largo));
    c.appendChild(el('p', '', 'En el CDA Boyacá Motor revisamos esto por ti.'));
    c.appendChild(button('Seguir', '', resume));
  }

  function trivia() {
    if (!deck.length) { deck = shuffle(CDA_QUESTIONS); }
    q = deck.pop();
    var c = clear();
    var bar = el('div', 'cda-timer'); var fill = el('div', 'cda-timer-fill'); bar.appendChild(fill);
    c.appendChild(bar);
    c.appendChild(el('h3', '', q.pregunta));
    var done = false;
    function end(ok) {
      if (done) { return; }
      done = true; clearInterval(quickTimer);
      st.trivias++;
      if (ok) { st.right++; st.pts += TRIVIA_PTS; }
      var c2 = clear();
      c2.appendChild(el('h2', ok ? 'ok' : 'bad', ok ? '¡Correcto! +' + TRIVIA_PTS : 'Casi...'));
      if (!ok) { c2.appendChild(el('p', '', 'Respuesta: ' + q.opciones[q.correcta])); }
      c2.appendChild(el('p', 'fact', q.dato));
      c2.appendChild(button('Seguir', '', resume));
      hud();
    }
    q.opciones.forEach(function (o, i) {
      c.appendChild(button(o, 'opt', function () { end(i === q.correcta); }));
    });
    var t0 = performance.now();
    clearInterval(quickTimer);
    quickTimer = setInterval(function () {
      var p = (performance.now() - t0) / (TRIVIA_SECONDS * 1000);
      fill.style.width = Math.max(0, 100 - p * 100) + '%';
      if (p >= 1) { end(false); }
    }, 100);
  }

  function resume() {
    hideCard();
    st.count = 0;
    st.asking = false;
    hud();
    if (st.left <= 0) { finish(); return; }
    try { GAME.resumeRace(); } catch (e) { /* ignore */ }
    focusGame();
  }

  /* ---------- final ---------- */
  function titleFor(p) {
    return p >= 1000 ? 'Inspector Mayor de la Vía' : p >= 600 ? 'Piloto Boyacense Certificado'
      : p >= 300 ? 'Copiloto con Potencial' : 'Aprendiz de Revisión';
  }
  function checkedNames() {
    var out = [];
    CDA_ITEMS.forEach(function (it) { if (st.checked[it.id]) { out.push(it.nombre); } });
    return out;
  }
  function ranking() {
    try { return JSON.parse(localStorage.cdaRank || '[]'); } catch (e) { return []; }
  }

  function finish() {
    st.over = true; st.asking = true;
    try { GAME.pauseRace(); } catch (e) { /* ignore */ }
    var rows = ranking(), today = new Date().toDateString();
    rows.push({ n: name, p: plate, s: st.pts, d: today });
    try { localStorage.cdaRank = JSON.stringify(rows); } catch (e) { /* ignore */ }
    var top = rows.filter(function (r) { return r.d === today; })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 5);
    var c = clear();
    c.appendChild(el('h2', '', '¡Tiempo!'));
    c.appendChild(el('p', '', name + ' · ' + plate));
    c.appendChild(el('h3', 'ok', st.pts + ' puntos · ' + st.total + ' ítems revisados'));
    c.appendChild(el('p', 'title', titleFor(st.pts)));
    var names = checkedNames();
    if (names.length) { c.appendChild(el('p', '', 'Revisaste: ' + names.join(', ') + '.')); }
    var list = el('div', 'rank');
    list.appendChild(el('b', '', 'Ranking de hoy'));
    top.forEach(function (r, i) {
      list.appendChild(el('div', r.n === name && r.p === plate ? 'me' : '',
        (i + 1) + '. ' + r.n + ' (' + r.p.slice(0, 3) + '***)  ' + r.s));
    });
    c.appendChild(list);
    c.appendChild(button('Descargar diploma', '', diploma));
    c.appendChild(button('Jugar de nuevo', 'alt', function () { location.reload(); }));
  }

  function diploma() {
    var cv = document.createElement('canvas');
    cv.width = 800; cv.height = 1000;
    var x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 1000);
    x.strokeStyle = '#15803d'; x.lineWidth = 18; x.strokeRect(30, 30, 740, 940);
    x.strokeStyle = '#f97316'; x.lineWidth = 5; x.strokeRect(58, 58, 684, 884);
    x.fillStyle = '#15803d'; x.fillRect(58, 58, 684, 130);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 40px sans-serif';
    x.fillText('CDA BOYACÁ MOTOR', 400, 135);
    x.fillStyle = '#14301f'; x.font = '28px sans-serif';
    x.fillText('Se otorga el diploma de', 400, 270);
    x.fillStyle = '#c2570c'; x.font = 'bold 54px sans-serif';
    x.fillText(titleFor(st.pts), 400, 350);
    x.fillStyle = '#14301f'; x.font = '28px sans-serif'; x.fillText('a', 400, 420);
    x.font = 'bold 56px sans-serif'; x.fillText(name, 400, 490);
    x.font = '30px sans-serif'; x.fillText('Placa ' + plate, 400, 545);
    x.font = '120px sans-serif'; x.fillText('🚙', 400, 690);
    x.font = 'bold 44px sans-serif'; x.fillStyle = '#15803d';
    x.fillText(st.pts + ' puntos', 400, 780);
    x.font = '24px sans-serif'; x.fillStyle = '#14301f';
    x.fillText('Revisó: ' + (checkedNames().join(', ') || 'su carro'), 400, 840, 640);
    x.font = '22px sans-serif'; x.fillStyle = '#475569';
    x.fillText('Un carro revisado es un viaje seguro · Duitama', 400, 910);
    cv.toBlob(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'diploma-cda.png';
      a.click();
    });
  }

  return { init: init };
})();
