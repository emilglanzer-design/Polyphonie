/*
 * kastjes.js — gedeelde code voor alle kastjes-pagina's (versie 0.1)
 *
 * Elke pagina laadt dit bestand. Het leest de vier kastjes uit (USB-MIDI in Chrome)
 * én het toetsenbord, en geeft beide door als dezelfde gebeurtenissen.
 * Een pagina hoeft dus niet te weten of er kastjes of een toetsenbord aan hangen.
 *
 *   Kastjes.on(function (e) { ... })
 *     e.speler     1 t/m 4
 *     e.type       'joystick'       e.richting = 'boven' | 'onder' | 'links' | 'rechts'
 *                                   (komt één keer bij duwen, en herhaalt zolang je vasthoudt)
 *                  'joystick-druk'  e.ingedrukt = true/false
 *                  'knop'           e.welke = 'links' | 'rechts', e.stap = +1 of -1
 *                  'knop-druk'      e.welke = 'links' | 'rechts', e.ingedrukt = true/false
 *                  'toets'          e.nr = 1 | 2, e.ingedrukt = true/false
 *     e.bron       'toetsenbord' | 'midi'
 *
 *   Kastjes.joystick(speler)   -> { x, y } tussen -1 en 1 (voor vloeiend verplaatsen)
 *   Kastjes.led(speler, '#ff7a1a')   ledstrip in een kleur zetten
 *   Kastjes.onLed(fn)          fn(speler, kleur) voor een virtuele ledstrip op het scherm
 *   Kastjes.onStatus(fn)       fn({ midi: 'aan' | 'geen' | 'geblokkeerd', kastjes: n })
 *   Kastjes.toetsen            de toetsenbordindeling per speler (voor een hulpscherm)
 *
 * VOORSTEL MIDI-afspraken (nog te bevestigen bij het schrijven van de Pico-code):
 *   MIDI-kanaal 1 t/m 4 = speler 1 t/m 4
 *   CC 1  joystick X   0..127 (64 = midden, 0 = links)
 *   CC 2  joystick Y   0..127 (64 = midden, 0 = boven)
 *   CC 10 draaiknop links  relatief: 1..63 = +stappen, 65..127 = -(128-waarde) stappen
 *   CC 11 draaiknop rechts relatief, zelfde codering
 *   Noot 60 joystick indrukken, 61 knop links indrukken, 62 knop rechts indrukken,
 *   Noot 63 toets 1, 64 toets 2   (note on = ingedrukt, note off of velocity 0 = los)
 *   Naar het kastje: CC 20/21/22 = rood/groen/blauw 0..127 op het kanaal van de speler.
 *
 * Terugvaloptie zonder Chrome: het kastje meldt zich als toetsenbord en stuurt precies
 * de toetsen hieronder. Dan werkt elke pagina ook in Safari.
 */
(function () {
  'use strict';

  var handlers = [];
  var ledHandlers = [];
  var statusHandlers = [];
  var status = { midi: 'geen', kastjes: 0 };
  var midiOut = [];

  // ---------- toetsenbordindeling (fysieke posities, werkt ook op een Nederlandse Mac) ----------
  // Per speler: joystick (4 richtingen), joystick indrukken, knop links -/+, knop rechts -/+,
  // knop rechts indrukken, toets 1, toets 2.
  var TOETSEN = {
    1: { boven: 'KeyW', links: 'KeyA', onder: 'KeyS', rechts: 'KeyD', druk: 'KeyE',
         knopLinksMin: 'Digit1', knopLinksPlus: 'Digit2', knopRechtsMin: 'Digit3', knopRechtsPlus: 'Digit4',
         knopRechtsDruk: 'KeyR', toets1: 'KeyZ', toets2: 'KeyX' },
    2: { boven: 'KeyT', links: 'KeyF', onder: 'KeyG', rechts: 'KeyH', druk: 'KeyY',
         knopLinksMin: 'Digit5', knopLinksPlus: 'Digit6', knopRechtsMin: 'Digit7', knopRechtsPlus: 'Digit8',
         knopRechtsDruk: 'KeyU', toets1: 'KeyC', toets2: 'KeyV' },
    3: { boven: 'KeyI', links: 'KeyJ', onder: 'KeyK', rechts: 'KeyL', druk: 'KeyO',
         knopLinksMin: 'Digit9', knopLinksPlus: 'Digit0', knopRechtsMin: 'Minus', knopRechtsPlus: 'Equal',
         knopRechtsDruk: 'KeyP', toets1: 'KeyB', toets2: 'KeyN' },
    4: { boven: 'ArrowUp', links: 'ArrowLeft', onder: 'ArrowDown', rechts: 'ArrowRight', druk: 'Enter',
         knopLinksMin: 'BracketLeft', knopLinksPlus: 'BracketRight', knopRechtsMin: 'Semicolon', knopRechtsPlus: 'Quote',
         knopRechtsDruk: 'Backslash', toets1: 'Period', toets2: 'Slash' }
  };

  var codeNaar = {}; // 'KeyW' -> { speler: 1, functie: 'boven' }
  Object.keys(TOETSEN).forEach(function (s) {
    var m = TOETSEN[s];
    Object.keys(m).forEach(function (f) { codeNaar[m[f]] = { speler: +s, functie: f }; });
  });

  // joystickstand per speler, uit toetsenbord en uit MIDI
  var toetsJoy = { 1: {}, 2: {}, 3: {}, 4: {} };            // ingedrukte richtingtoetsen
  var midiJoy = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 }, 3: { x: 0, y: 0 }, 4: { x: 0, y: 0 } };
  var herhaal = { 1: null, 2: null, 3: null, 4: null };     // { richting, volgende }

  function emit(e) {
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](e); } catch (err) { console.error(err); }
    }
  }

  function joystick(speler) {
    var t = toetsJoy[speler], x = 0, y = 0;
    if (t.links) x -= 1; if (t.rechts) x += 1; if (t.boven) y -= 1; if (t.onder) y += 1;
    var m = midiJoy[speler];
    if (Math.abs(m.x) > Math.abs(x)) x = m.x;
    if (Math.abs(m.y) > Math.abs(y)) y = m.y;
    return { x: x, y: y };
  }

  function richtingVan(v) {
    var drempel = 0.5;
    if (Math.max(Math.abs(v.x), Math.abs(v.y)) < drempel) return null;
    if (Math.abs(v.x) >= Math.abs(v.y)) return v.x < 0 ? 'links' : 'rechts';
    return v.y < 0 ? 'boven' : 'onder';
  }

  // Richting-gebeurtenissen: één keer bij duwen, daarna herhalen zolang je vasthoudt.
  var EERSTE_HERHALING = 420, HERHALING = 230;
  function tik(nu, bron) {
    for (var s = 1; s <= 4; s++) {
      var r = richtingVan(joystick(s)), h = herhaal[s];
      if (!r) { herhaal[s] = null; continue; }
      if (!h || h.richting !== r) {
        herhaal[s] = { richting: r, volgende: nu + EERSTE_HERHALING };
        emit({ speler: s, type: 'joystick', richting: r, bron: bron || 'toetsenbord', herhaling: false });
      } else if (nu >= h.volgende) {
        h.volgende = nu + HERHALING;
        emit({ speler: s, type: 'joystick', richting: r, bron: bron || 'toetsenbord', herhaling: true });
      }
    }
  }
  function lus(nu) { tik(nu); requestAnimationFrame(lus); }
  requestAnimationFrame(lus);

  function inTekstveld(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function toetsGebeurtenis(ev, ingedrukt) {
    if (inTekstveld(ev.target)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = codeNaar[ev.code];
    if (!k) return;
    ev.preventDefault();
    var s = k.speler, f = k.functie;
    if (f === 'boven' || f === 'onder' || f === 'links' || f === 'rechts') {
      toetsJoy[s][f] = ingedrukt;
      if (ingedrukt && !ev.repeat) tik(performance.now(), 'toetsenbord');
      return;
    }
    if (f.indexOf('knop') === 0 && f.indexOf('Druk') < 0) {
      if (!ingedrukt) return; // draaien: elke toetsaanslag (ook herhaling) is één stap
      emit({ speler: s, type: 'knop', welke: f.indexOf('Links') > 0 ? 'links' : 'rechts',
             stap: /Plus$/.test(f) ? 1 : -1, bron: 'toetsenbord' });
      return;
    }
    if (ev.repeat) return;
    if (f === 'druk') emit({ speler: s, type: 'joystick-druk', ingedrukt: ingedrukt, bron: 'toetsenbord' });
    else if (f === 'knopRechtsDruk') emit({ speler: s, type: 'knop-druk', welke: 'rechts', ingedrukt: ingedrukt, bron: 'toetsenbord' });
    else if (f === 'toets1') emit({ speler: s, type: 'toets', nr: 1, ingedrukt: ingedrukt, bron: 'toetsenbord' });
    else if (f === 'toets2') emit({ speler: s, type: 'toets', nr: 2, ingedrukt: ingedrukt, bron: 'toetsenbord' });
  }
  window.addEventListener('keydown', function (e) { toetsGebeurtenis(e, true); });
  window.addEventListener('keyup', function (e) { toetsGebeurtenis(e, false); });
  window.addEventListener('blur', function () {
    for (var s = 1; s <= 4; s++) toetsJoy[s] = {};
  });

  // ---------- USB-MIDI (Chrome) ----------
  function relatief(v) { return v === 0 || v === 64 ? 0 : (v < 64 ? v : -(128 - v)); }

  function midiBericht(msg) {
    var d = msg.data, cmd = d[0] & 0xf0, s = (d[0] & 0x0f) + 1;
    if (s < 1 || s > 4) return;
    if (cmd === 0xb0) {
      var cc = d[1], v = d[2];
      if (cc === 1) { midiJoy[s].x = (v - 64) / 63; tik(performance.now(), 'midi'); }
      else if (cc === 2) { midiJoy[s].y = (v - 64) / 63; tik(performance.now(), 'midi'); }
      else if (cc === 10 || cc === 11) {
        var n = relatief(v), welke = cc === 10 ? 'links' : 'rechts';
        for (var i = 0; i < Math.abs(n); i++) emit({ speler: s, type: 'knop', welke: welke, stap: n > 0 ? 1 : -1, bron: 'midi' });
      }
    } else if (cmd === 0x90 || cmd === 0x80) {
      var ingedrukt = cmd === 0x90 && d[2] > 0, noot = d[1];
      if (noot === 60) emit({ speler: s, type: 'joystick-druk', ingedrukt: ingedrukt, bron: 'midi' });
      else if (noot === 61) emit({ speler: s, type: 'knop-druk', welke: 'links', ingedrukt: ingedrukt, bron: 'midi' });
      else if (noot === 62) emit({ speler: s, type: 'knop-druk', welke: 'rechts', ingedrukt: ingedrukt, bron: 'midi' });
      else if (noot === 63) emit({ speler: s, type: 'toets', nr: 1, ingedrukt: ingedrukt, bron: 'midi' });
      else if (noot === 64) emit({ speler: s, type: 'toets', nr: 2, ingedrukt: ingedrukt, bron: 'midi' });
    }
  }

  function zetStatus(midi, n) {
    status = { midi: midi, kastjes: n };
    statusHandlers.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }

  function koppelMidi(access) {
    function verbind() {
      var n = 0;
      access.inputs.forEach(function (inp) { inp.onmidimessage = midiBericht; n++; });
      midiOut = [];
      access.outputs.forEach(function (o) { midiOut.push(o); });
      zetStatus('aan', n);
      // leds opnieuw zetten na in- of uitpluggen
      Object.keys(ledKleur).forEach(function (s) { stuurLed(+s, ledKleur[s]); });
    }
    access.onstatechange = verbind;
    verbind();
  }

  if (navigator.requestMIDIAccess) {
    try {
      navigator.requestMIDIAccess({ sysex: false }).then(koppelMidi, function () { zetStatus('geblokkeerd', 0); });
    } catch (e) { zetStatus('geblokkeerd', 0); }
  } else {
    zetStatus('geen', 0);
  }

  // ---------- ledstrip ----------
  var ledKleur = {};
  function hexNaarRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function stuurLed(s, kleur) {
    if (!midiOut.length) return;
    var rgb = kleur ? hexNaarRgb(kleur) : [0, 0, 0], ch = s - 1;
    midiOut.forEach(function (o) {
      try {
        o.send([0xb0 | ch, 20, rgb[0] >> 1]);
        o.send([0xb0 | ch, 21, rgb[1] >> 1]);
        o.send([0xb0 | ch, 22, rgb[2] >> 1]);
      } catch (e) {}
    });
  }

  window.Kastjes = {
    on: function (fn) { handlers.push(fn); },
    joystick: joystick,
    led: function (speler, kleur) {
      if (ledKleur[speler] === kleur) return;
      ledKleur[speler] = kleur;
      stuurLed(speler, kleur);
      ledHandlers.forEach(function (fn) { try { fn(speler, kleur); } catch (e) {} });
    },
    onLed: function (fn) { ledHandlers.push(fn); },
    onStatus: function (fn) { statusHandlers.push(fn); fn(status); },
    toetsen: TOETSEN
  };
})();
