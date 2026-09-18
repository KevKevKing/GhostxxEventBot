// Stille-Erkennung fuer die Aufnahme nach dem Aufwachwort - rein
// funktional, ohne Mikrofon-Zugriff, damit es ohne echte Hardware testbar
// ist. pvrecorder liefert Frames zu 512 Samples bei 16kHz (~32ms/Frame).

function berechneLautstaerke(frame) {
  let summe = 0;
  for (let i = 0; i < frame.length; i += 1) summe += frame[i] * frame[i];
  return Math.sqrt(summe / frame.length);
}

/**
 * schwelle: RMS-Schwellwert fuer "leise" (16-Bit-PCM, Bereich -32768..32767).
 *   Startwert 500 - haengt vom Mikrofon ab, wird bei der manuellen Abnahme
 *   (siehe Umsetzungsplan) nachjustiert, gemessen statt vermutet.
 * stilleFramesZumBeenden: 12 Frames = ~384ms Stille beendet die Aufnahme -
 *   kurz genug fuer Reaktionsfreude, lang genug um eine normale
 *   Sprechpause mitten im Satz nicht faelschlich als Ende zu werten.
 * maxFrames: 500 Frames = ~16s hartes Limit, falls nie richtig still wird.
 */
function erstelleStilleErkennung({ schwelle = 500, stilleFramesZumBeenden = 12, maxFrames = 500 } = {}) {
  let stilleZaehler = 0;
  let frameZaehler = 0;
  let fertig = false;
  // Ohne das wuerde eine kurze natuerliche Pause direkt nach dem Aufwachwort
  // (bevor der Satz ueberhaupt angefangen hat) schon als "fertig, war
  // still" gewertet - die Aufnahme endet dann, bevor der Nutzer ueberhaupt
  // zu reden angefangen hat (gemessen in der Handpruefung/Task 8: "komme
  // nicht dazu zu reden"). Stille zaehlt daher erst, NACHDEM mindestens
  // einmal ein lauter Frame gesehen wurde.
  let spracheGehoert = false;

  function framePruefen(frame) {
    if (fertig) return true;

    frameZaehler += 1;
    const lautstaerke = berechneLautstaerke(frame);

    if (lautstaerke < schwelle) {
      if (spracheGehoert) stilleZaehler += 1;
    } else {
      spracheGehoert = true;
      stilleZaehler = 0;
    }

    if (stilleZaehler >= stilleFramesZumBeenden || frameZaehler >= maxFrames) {
      fertig = true;
    }

    return fertig;
  }

  function istFertig() {
    return fertig;
  }

  return { framePruefen, istFertig };
}

module.exports = { berechneLautstaerke, erstelleStilleErkennung };
