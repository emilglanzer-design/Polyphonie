/*
 * thuis.js — terug naar de startpagina vanuit elke kastjes-app.
 * Laad na kastjes.js:  <script src="../thuis.js"></script>
 *
 *  - Esc op het toetsenbord: meteen terug.
 *  - Op een kastje toets 1 én toets 2 samen 1,5 seconde vasthouden: terug.
 *  - Een klein glazen lipje links op het scherm (met de muis).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var START = script && script.src ? script.src.replace(/thuis\.js(\?.*)?$/, 'index.html') : '../index.html';
  var KLEUR = { 1: '#ff7a1a', 2: '#3b8bff', 3: '#21c06b', 4: '#b768ff' };
  var DUUR = 1500;

  var css = document.createElement('style');
  css.textContent =
    '.th-lip{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:9998;display:flex;align-items:center;gap:6px;padding:12px 10px 12px 8px;' +
    'background:rgba(255,255,255,.42);-webkit-backdrop-filter:blur(20px) saturate(170%);backdrop-filter:blur(20px) saturate(170%);border:1px solid rgba(255,255,255,.8);border-left:0;' +
    'border-radius:0 12px 12px 0;color:#111;text-decoration:none;font:600 10px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.14em;writing-mode:vertical-rl;' +
    'box-shadow:0 10px 30px -14px rgba(0,0,0,.4);opacity:.55;transition:opacity .2s}' +
    '.th-lip:hover{opacity:1}.th-lip b{color:#ff5a00}' +
    '.th-laag{position:fixed;inset:0;z-index:9999;display:none;place-items:center;background:rgba(228,228,224,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
    '.th-laag.aan{display:grid}' +
    '.th-kaart{display:grid;justify-items:center;gap:14px;padding:28px 34px;border-radius:22px;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.85);' +
    'box-shadow:0 30px 80px -30px rgba(0,0,0,.45);font:600 12px "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#111}' +
    '.th-kaart svg{width:96px;height:96px}';
  document.head.appendChild(css);

  var lip = document.createElement('a');
  lip.className = 'th-lip';
  lip.href = START;
  lip.title = 'Terug naar start (Esc)';
  lip.innerHTML = '<b>◀</b> START';
  var laag = document.createElement('div');
  laag.className = 'th-laag';
  laag.innerHTML = '<div class="th-kaart"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(0,0,0,.1)" stroke-width="8"/>' +
    '<circle id="th-ring" cx="50" cy="50" r="42" fill="none" stroke="#ff5a00" stroke-width="8" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="264" transform="rotate(-90 50 50)"/>' +
    '<text x="50" y="57" text-anchor="middle" font-size="22" font-weight="700" fill="#111">◀</text></svg>' +
    '<div>Terug naar start</div><div style="color:#77776f;font-size:10px">loslaten = blijven</div></div>';
  function plaats() { document.body.appendChild(lip); document.body.appendChild(laag); }
  if (document.body) plaats(); else document.addEventListener('DOMContentLoaded', plaats);

  function naarStart() { location.href = START; }
  // Esc = terug, behalve als er een venster of tekstveld open is (dan sluit de app eerst dat venster).
  function vensterOpen() {
    var v = document.querySelectorAll('.venster, dialog[open], [data-venster]');
    for (var i = 0; i < v.length; i++) if (!v[i].hidden && v[i].offsetParent !== null) return true;
    return false;
  }
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (vensterOpen()) return;
    naarStart();
  }, true);

  if (!window.Kastjes) return;
  var vast = { 1: {}, 2: {}, 3: {}, 4: {} }, wie = 0, begin = 0;
  Kastjes.on(function (e) {
    if (e.type !== 'toets') return;
    vast[e.speler][e.nr] = e.ingedrukt;
    var beide = vast[e.speler][1] && vast[e.speler][2];
    if (beide && !wie) { wie = e.speler; begin = performance.now(); laag.classList.add('aan'); requestAnimationFrame(lus); }
    if (!beide && wie === e.speler) stop();
  });
  function stop() { wie = 0; laag.classList.remove('aan'); }
  function lus(nu) {
    if (!wie) return;
    var t = Math.min(1, (nu - begin) / DUUR), ring = document.getElementById('th-ring');
    ring.setAttribute('stroke', KLEUR[wie]);
    ring.setAttribute('stroke-dashoffset', String(264 * (1 - t)));
    if (t >= 1) { naarStart(); return; }
    requestAnimationFrame(lus);
  }
})();
