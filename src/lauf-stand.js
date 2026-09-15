// Wo steht die Sammelauszahlung gerade?
//
// Der Anlass: ein Lauf ueber 34 Tickets dauerte 90 Minuten, und Kevin sah in
// der Zeit genau nichts. Zwei Gruende, beide behoben:
//
//   1. Die Fortschrittsmeldung hing an der Antwort auf den Slash-Befehl.
//      Discord schliesst die nach 15 Minuten - danach lief jede Aktualisierung
//      ins Leere, und der Fehler wurde still verschluckt.
//   2. Die Abrechnungen wurden erst nach dem letzten Ticket verschickt.
//
// Der Stand liegt hier und nicht in logbook-batch.js, damit das Dashboard ihn
// lesen kann, ohne den Auszahlungscode anzufassen.

let stand = leer();

function leer() {
  return {
    laeuft: false,
    seit: null,
    fertig: 0,
    gesamt: 0,
    bilder: 0,
    zugestellt: 0,
    abgehakt: 0,
    aktuell: '',
    beendet: null,
  };
}

function starteLauf(gesamt) {
  stand = { ...leer(), laeuft: true, seit: Date.now(), gesamt };
  return stand;
}

function meldeFortschritt(teil) {
  if (!stand.laeuft) return stand;
  stand = { ...stand, ...teil };
  return stand;
}

function beendeLauf() {
  stand = { ...stand, laeuft: false, aktuell: '', beendet: Date.now() };
  return stand;
}

/**
 * Der Stand samt Hochrechnung.
 *
 * Die Restzeit kommt aus dem eigenen Lauf, nicht aus einer festen Annahme:
 * ein Ticket mit 29 Bildern dauert dreissigmal so lang wie eines mit einem.
 */
function laufStand() {
  if (!stand.seit) return { ...stand, dauerSek: 0, restSek: null };

  const dauerSek = Math.round(((stand.beendet || Date.now()) - stand.seit) / 1000);
  let restSek = null;

  if (stand.laeuft && stand.fertig > 0 && stand.gesamt > stand.fertig) {
    const proTicket = dauerSek / stand.fertig;
    restSek = Math.round(proTicket * (stand.gesamt - stand.fertig));
  }

  return { ...stand, dauerSek, restSek };
}

module.exports = { beendeLauf, laufStand, meldeFortschritt, starteLauf };
