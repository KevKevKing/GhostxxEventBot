// Was fuer welches Event bezahlt wird.
//
// Quelle ist NICHT die Tabelle, sondern der Kanal auszahlung-info: dort steht
// die Liste vom 28.04.2026 und danach mehrere Anpassungen, die hier schon
// eingerechnet sind:
//
//   01.05.  Staatliche Kontrolle 50k -> 80k
//           Weinberge            50k -> 100k
//           BizWar    50/100/150k -> 75/150/250k
//   07.05.  40er Win 50k -> 60k, Lose 20k -> 25k
//   24.05.  RP-Fabrik Win 350k -> 275k, Lose 50k
//
// Aendern sich die Saetze, kann man sie Ghostxx im Chat sagen - dann liegen sie
// in bot-settings und diese Tabelle ist nur noch der Ausgangswert.

const SAETZE = {
  '40er': { win: 60000, lose: 25000 },
  sk: { win: 80000, lose: 0 },
  ekz: { win: 50000, lose: 0 },
  'rp-fabrik': { win: 275000, lose: 50000 },
  giesserei: { win: 50000, lose: 20000 },
  hafen: { win: 50000, lose: 0, hinweis: 'pro Drop' },
  waffenfabrik: { win: 50000, lose: 20000 },
  weinberge: { win: 100000, lose: 25000 },
  famraid: { win: 25000, lose: 0 },
  flugzeugtraeger: { win: 40000, lose: 20000 },
  bank: { win: 40000, lose: 20000 },

  // Nicht ausrechenbar - hier muss ein Mensch ran.
  bizwar: {
    win: null,
    lose: 0,
    vonHand: 'BizWar zahlt 75k, 150k oder 250k je nach Unternehmen',
  },
  famwar: {
    win: null,
    lose: null,
    vonHand: 'FamWar richtet sich nach den erhaltenen Gegenstaenden',
  },
};

// Steht in derselben Nachricht und gehoert zur Auszahlung dazu.
const MINDESTBETRAG = 1000000;
const MIN_PERSONEN_IM_BILD = 4;

function satzFuer(eventKey) {
  return SAETZE[eventKey] || null;
}

/**
 * Rechnet eine Auszaehlung in Geld um.
 *
 * @param {Map<string, {win: number, lose: number}>} zaehler aus tally()
 * @returns {{summe: number, zeilen: Array, offen: Array}}
 *   offen = Events, die jemand von Hand bewerten muss.
 */
function rechne(zaehler) {
  const zeilen = [];
  const offen = [];
  let summe = 0;

  for (const [key, stand] of zaehler) {
    const satz = satzFuer(key);

    if (!satz) {
      offen.push({ key, grund: 'kein Satz hinterlegt', stand });
      continue;
    }

    if (satz.vonHand) {
      offen.push({ key, grund: satz.vonHand, stand });
      continue;
    }

    const betrag = stand.win * satz.win + stand.lose * satz.lose;
    summe += betrag;

    zeilen.push({
      key,
      win: stand.win,
      lose: stand.lose,
      betrag,
      hinweis: satz.hinweis || '',
    });
  }

  return { summe, zeilen: zeilen.sort((a, b) => b.betrag - a.betrag), offen };
}

function euro(betrag) {
  return `$${betrag.toLocaleString('de-DE')}`;
}

/** Kurze Zusammenfassung fuer die Auszahlungsmeldung. */
function formatiere(ergebnis) {
  if (!ergebnis.zeilen.length && !ergebnis.offen.length) return '';

  const teile = [];

  if (ergebnis.zeilen.length) {
    teile.push(`**Auszahlung: ${euro(ergebnis.summe)}**`);
    teile.push(ergebnis.zeilen
      .map((z) => `${z.key} ${z.win}W/${z.lose}L = ${euro(z.betrag)}${z.hinweis ? ` (${z.hinweis})` : ''}`)
      .join(' · '));
  }

  if (ergebnis.offen.length) {
    teile.push(`Von Hand: ${ergebnis.offen.map((o) => `${o.key} (${o.grund})`).join(' · ')}`);
  }

  if (ergebnis.summe && ergebnis.summe < MINDESTBETRAG) {
    teile.push(`-# Unter ${euro(MINDESTBETRAG)} wird laut auszahlung-info nicht ausgezahlt.`);
  }

  return teile.join('\n');
}

module.exports = {
  MINDESTBETRAG,
  MIN_PERSONEN_IM_BILD,
  SAETZE,
  euro,
  formatiere,
  rechne,
  satzFuer,
};
