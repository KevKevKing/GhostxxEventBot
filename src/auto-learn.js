
const knowledge = require('./knowledge');
const { normalizeText } = require('./text-match');

// In seinem Rueckzugskanal gilt: was ihm dort jemand mit Rechten erzaehlt, ist
// ein Fakt. Kein "merk dir" noetig, einfach sagen.
//
// Nicht alles ist aber eine Ansage: Fragen, Begruessungen und Zurufe sollen
// nicht im Gedaechtnis landen, sonst steht dort bald "hallo" und "test".

const MIN_LAENGE = 12;

// Kurze Zurufe, die keine Aussage sind.
const GEPLAUDER = new Set([
  'hallo', 'hi', 'hey', 'moin', 'servus', 'test', 'ok', 'okay', 'ja', 'nein',
  'danke', 'bitte', 'gut', 'passt', 'alles klar', 'jo', 'yo', 'lol', 'haha',
  'cool', 'nice', 'top', 'perfekt', 'geht klar', 'stimmt', 'genau',
]);

/**
 * Ist das eine Aussage, die man sich merken sollte?
 * Im Zweifel nein - lieber etwas verpassen als Muell speichern.
 */
// Die Anrede vor der eigentlichen Nachricht: "ghost wer ist X", "hey Ghostxx,
// wie gehts". Sie muss weg, bevor nach dem Fragewort gesucht wird - sonst steht
// am Satzanfang die Anrede statt "wer", und die Frage gilt als Aussage.
//
// Genau das ist passiert: "ghost wer ist Fedex Wave" wurde als Tatsache
// gespeichert, und die naechste Frage galt dann als Widerspruch dazu.
const ANREDE = /^\s*(hey|hi|hallo|na|ey|eyy|yo|mal|sag mal|sagmal|bitte)?[\s,]*ghost(xx|y|i|muffiin?)?\b[\s,?!]*/i;

function ohneAnrede(text) {
  return String(text || '').replace(ANREDE, '').trim();
}

// Ein Fragewort am Satzanfang.
const FRAGE_ANFANG = /^(wer|wen|wem|was|wann|wo|wie|warum|wieso|weshalb|welche[rsnm]?|kannst|kannste|hast|hat|habt|bist|seid|gibt es|gibts|ist das|darf|duerfen|dürfen|soll|sollen|weisst|weißt|kennst|kennt)\b/i;

// Fragen fangen im Deutschen oft nicht mit dem Fragewort an. Genau daran ist
// "bei wie vielen Events war Cell Yeat dabei" vorbeigerutscht: es begann mit
// "bei", galt als Ansage, wurde als Tatsache gespeichert - und blieb
// unbeantwortet.
//
// Zwei Wege dagegen: eindeutige Wendungen ueberall im Satz, und ein Fragewort
// unter den ersten drei Woertern.
const FRAGE_IM_SATZ = /\b(wie\s+(viele?n?|oft|lange|haeufig|häufig|teuer|gross|groß)|wieviele?n?|seit\s+wann|ab\s+wann|bis\s+wann|weisst\s+du|weißt\s+du|kannst\s+du|kennst\s+du|hast\s+du|sag\s+mal\s+wer)\b/i;
const FRAGE_FRUEH = /^(?:\S+\s+){0,2}(wer|wen|wem|was|wann|wo|wie|warum|wieso|weshalb|welche[rsnm]?)\b/i;

// Zuruf und Lob sind keine Tatsachen. "sehr gut beobachtet !" stand als
// angebliches Wissen im Gedaechtnis, und das naechste Lob galt dann als
// Widerspruch dazu.
//
// Aussortiert wird nur, wenn JEDES Wort aus diesem Vorrat kommt - sonst faellt
// auch "Gut zu wissen: die Bank ist Mo Mi Sa" durch.
const LOB = new Set([
  'auch', 'ja', 'ok', 'okay', 'und', 'na', 'so', 'das', 'war', 'ist', 'dir',
  'sehr', 'echt', 'wirklich', 'voll', 'ganz', 'richtig', 'mega', 'super',
  'gut', 'top', 'stark', 'sauber', 'perfekt', 'klasse', 'prima', 'nice',
  'geil', 'korrekt', 'brav', 'fein', 'bravo', 'respekt', 'schoen',
  'beobachtet', 'gemacht', 'erkannt', 'gemerkt', 'gesehen', 'gefunden',
  'geloest', 'gearbeitet', 'danke', 'stimmt', 'genau', 'passt', 'laeuft',
]);

function istLob(text) {
  const woerter = normalizeText(text).split(' ').filter(Boolean);
  if (!woerter.length) return false;
  return woerter.every((wort) => LOB.has(wort));
}

/** Ist das eine Frage - egal an welcher Stelle das Fragewort steht? */
function istFrage(text) {
  const kern = ohneAnrede(text);
  if (kern.endsWith('?')) return true;
  if (FRAGE_ANFANG.test(kern)) return true;
  if (FRAGE_IM_SATZ.test(kern)) return true;
  if (FRAGE_FRUEH.test(kern)) return true;
  return false;
}

function istAussage(text) {
  const roh = String(text || '').trim();
  if (roh.length < MIN_LAENGE) return false;

  const normalisiert = normalizeText(roh);
  if (GEPLAUDER.has(normalisiert)) return false;
  if (istLob(roh)) return false;

  // Fragen sind keine Ansagen.
  if (roh.endsWith('?')) return false;

  const kern = ohneAnrede(roh);
  if (kern.length < MIN_LAENGE) return false;
  if (istFrage(kern)) return false;

  // Reine Erwaehnungen, Links oder Emoji-Wuesten.
  if (!/[a-zäöüß]{3}/i.test(roh)) return false;
  if (/^https?:\/\//i.test(roh)) return false;

  return true;
}

function bedeutsameWoerter(text) {
  return new Set(
    normalizeText(text)
      .split(' ')
      .filter((wort) => wort.length >= 3 && !GEPLAUDER.has(wort) && !STOPP_INTERN.has(wort)),
  );
}

const STOPP_INTERN = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'und', 'oder', 'aber', 'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'wird',
  'von', 'vom', 'mit', 'bei', 'fuer', 'auf', 'aus', 'zum', 'zur', 'nach',
  'als', 'auch', 'nicht', 'nur', 'noch', 'schon', 'sich', 'man', 'wir', 'ihr',
  'sie', 'dass', 'wenn', 'weil', 'immer', 'mal', 'jetzt', 'ab', 'mehr', 'uns',
  'unser', 'unsere', 'unseren',
]);

/**
 * Beruehrt die neue Aussage ein Thema, zu dem schon etwas gespeichert ist?
 *
 * Bewusst OHNE Sprachmodell. Ich hatte es zuerst damit versucht - auf die Frage,
 * ob "Bank machen wir jetzt dienstags" dem gespeicherten "Bank machen wir
 * montags" widerspricht, antwortete es "NEIN WIDERSPRUCH KEITER". Weder das
 * Format noch der Inhalt stimmten.
 *
 * Deshalb wird nur gemessen, ob es um dieselbe Sache geht - entscheiden tut ein
 * Mensch per Knopf. Lieber einmal zu viel gefragt als stillschweigend zwei
 * widersprechende Saetze im Gedaechtnis.
 */
async function findeWiderspruch(neu) {
  const neueWoerter = bedeutsameWoerter(neu);
  if (!neueWoerter.size) return { widerspruch: false };

  const facts = await knowledge.list();
  let bester = null;

  for (const fact of facts) {
    const alteWoerter = bedeutsameWoerter(fact.text);
    const gemeinsam = [...neueWoerter].filter((wort) => alteWoerter.has(wort));
    if (!gemeinsam.length) continue;

    // Ein langes gemeinsames Wort ("waffenfabrik", "turfleader") reicht als
    // Themenbezug. Kurze Woerter erst ab zwei Treffern.
    const spezifisch = gemeinsam.some((wort) => wort.length >= 4);
    if (!spezifisch && gemeinsam.length < 2) continue;

    // Sind beide Saetze inhaltlich identisch, ist es kein Konflikt - das faengt
    // knowledge.remember als "schon bekannt" ab.
    if (normalizeText(fact.text) === normalizeText(neu)) continue;

    const punkte = gemeinsam.reduce((summe, wort) => summe + wort.length, 0);
    if (!bester || punkte > bester.punkte) bester = { fact, punkte, gemeinsam };
  }

  if (!bester) return { widerspruch: false };
  return { widerspruch: true, alt: bester.fact, gemeinsam: bester.gemeinsam };
}

module.exports = {
  GEPLAUDER,
  MIN_LAENGE,
  findeWiderspruch,
  istAussage,
  istFrage,
  istLob,
};
