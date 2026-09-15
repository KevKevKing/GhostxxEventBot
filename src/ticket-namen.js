const { spielerNummer } = require('./namens-gedaechtnis');

// Der Ticketbot benennt ein Ticket beim Uebernehmen um, und was dabei
// herauskommt, liest sich schlecht:
//
//   63-ghost_muffin1-ghost_muffin1
//   danny-imucupancium-156215
//
// Im Logbuch-Bereich stehen die untereinander und man erkennt niemanden wieder.
// Schoener waere der Name, den Discord sowieso anzeigt: "! Ghost Muffiin | 266391".
//
// Discord laesst das aber nicht zu. Gemessen an Wegwerf-Kanaelen auf dem Server:
//
//   gesendet  "! Ghost Muffiin | 266391"
//   gespeichert  "-ghost-muffiin--266391"
//
// Drei Dinge passieren:
//   1. Grossbuchstaben werden klein gemacht - auch die breiten Ｇｒｏｓｓ
//      buchstaben, die haben in Unicode naemlich eine Kleinschreibung.
//   2. Jedes Leerzeichen wird zum Bindestrich. Jedes: normales, breites (U+3000),
//      schmales (U+2009), geschuetztes (U+00A0), Ogham (U+1680).
//   3. Manche Zeichen fliegen ganz raus - "!", "|", und alles Unsichtbare
//      (Braille-Blank U+2800, Hangul-Fueller U+3164, Zero-Width U+200B).
//      Die Woerter kleben danach aneinander.
//
// Ein echter Abstand ist also nicht zu haben. Was durchkommt:
//   - die mathematischen Buchstaben (U+1D400 aufwaerts). Die haben in Unicode
//     keine Kleinschreibung, deshalb laesst Discord sie in Ruhe.
//   - sichtbare Trennzeichen wie "·" und "│".
//
// Daraus wird:  𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215

// Mathematical Sans-Serif Bold. Kein Markdown-Fettdruck, sondern eigene Zeichen -
// deshalb ueberlebt es im Kanalnamen.
const GROSS = 0x1d5d4;
const KLEIN = 0x1d5ee;

const WORTTRENNER = '·'; // ·
const NUMMERNTRENNER = '│'; // │

// Discord erlaubt 100 Zeichen. Ein mathematischer Buchstabe zaehlt als zwei
// (Ersatzzeichenpaar), deshalb ist hier frueher Schluss als man denkt.
const MAX = 100;

function fett(text) {
  return String(text)
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(GROSS + c.charCodeAt(0) - 65))
    .replace(/[a-z]/g, (c) => String.fromCodePoint(KLEIN + c.charCodeAt(0) - 97));
}

/**
 * Text, den auch die Konsole darstellen kann.
 *
 * Das Log laeuft ueber PowerShell, und die schreibt fuer jedes Zeichen, das
 * sie nicht kennt, ein Fragezeichen. Aus "𝗠𝗮𝘅·𝗞𝗼𝗸│227216" wurde im Terminal
 * eine Wand aus "������". Fettbuchstaben zurueckuebersetzen reicht nicht -
 * die Trennzeichen und der Gedankenstrich fallen auch durch.
 */
function fuerKonsole(text) {
  return entfetten(text)
    .replace(/[·•]/g, ' ')
    .replace(/[│|]/g, '| ')
    .replace(/[—–]/g, '-')
    .replace(/[„""]/g, '"')
    // Was dann noch uebrig ist, kann die Konsole ohnehin nicht.
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Mathematische Buchstaben zurueck zu normalen - fuer Suche und Vergleich. */
function entfetten(text) {
  return [...String(text || '')].map((zeichen) => {
    const code = zeichen.codePointAt(0);
    if (code >= GROSS && code < GROSS + 26) return String.fromCharCode(65 + code - GROSS);
    if (code >= KLEIN && code < KLEIN + 26) return String.fromCharCode(97 + code - KLEIN);
    return zeichen;
  }).join('');
}

// Die meisten schreiben "Name | 266391" oder "Name I 258761". Manche lassen den
// Strich weg: "Max Kok  227216". Fuer das Namensgedaechtnis reicht die strengere
// Lesart, hier nicht - sonst bliebe so ein Ticket haesslich, obwohl die Nummer
// klar dasteht.
//
// Der Schraegstrich gehoert dazu: "Aurelia Aquila/304359" und
// "Timo Hash/224608" blieben monatelang unaufgeraeumt, weil er fehlte. Ohne
// erkennbare Nummer benennt Ghostxx absichtlich nicht um - das Ticket waere
// spaeter niemandem mehr zuzuordnen. Nur stand die Nummer hier klar da.
const NUMMER_LOCKER = /[\s|I/\\]\s*(\d{4,7})\s*$/;

/** Die Spielernummer aus einem Anzeigenamen - auch ohne Trennstrich davor. */
function nummerAus(anzeigename) {
  const streng = spielerNummer(anzeigename);
  if (streng) return streng;
  const treffer = String(anzeigename || '').match(NUMMER_LOCKER);
  return treffer ? treffer[1] : '';
}

/**
 * Der Anzeigename ohne Spielernummer und ohne Zierrat davor.
 * "! Ghost Muffiin | 266391" -> "Ghost Muffiin"
 */
function nurDerName(anzeigename) {
  return String(anzeigename || '')
    .replace(NUMMER_LOCKER, '')
    // Fuehrende Zeichen, die viele sich vor den Namen setzen, damit sie in der
    // Mitgliederliste weiter oben stehen: "!", ".", "-", Emoji.
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}

/**
 * Wie soll das Ticket heissen?
 *
 * Leer, wenn der Anzeigename keine Spielernummer hat - dann darf nicht
 * umbenannt werden. Die Nummer ist der einzige Faden, an dem der Bot das
 * Ticket spaeter noch einem Menschen zuordnen kann; ohne sie waere das
 * huebschere Ticket ein verlorenes.
 */
function zuKanalname(anzeigename) {
  const nummer = nummerAus(anzeigename);
  if (!nummer) return '';

  const woerter = nurDerName(anzeigename).split(/\s+/).filter(Boolean);
  if (!woerter.length) return '';

  const name = woerter.map(fett).join(WORTTRENNER);
  const voll = `${name}${NUMMERNTRENNER}${nummer}`;
  if (voll.length <= MAX) return voll;

  // Zu lang: lieber Woerter hinten weglassen als mitten im Namen abschneiden.
  // Die Nummer bleibt auf jeden Fall dran.
  const platz = MAX - NUMMERNTRENNER.length - nummer.length;
  const gekuerzt = [];
  let laenge = 0;
  for (const wort of woerter.map(fett)) {
    const dazu = (gekuerzt.length ? WORTTRENNER.length : 0) + wort.length;
    if (laenge + dazu > platz) break;
    gekuerzt.push(wort);
    laenge += dazu;
  }
  if (!gekuerzt.length) return '';
  return `${gekuerzt.join(WORTTRENNER)}${NUMMERNTRENNER}${nummer}`;
}

/** Hat Ghostxx diesen Kanal schon aufgeraeumt? */
function istAufgeraeumt(kanalName) {
  return String(kanalName || '').includes(NUMMERNTRENNER);
}

module.exports = {
  entfetten,
  fett,
  fuerKonsole,
  istAufgeraeumt,
  nummerAus,
  nurDerName,
  zuKanalname,
  NUMMERNTRENNER,
  WORTTRENNER,
};
