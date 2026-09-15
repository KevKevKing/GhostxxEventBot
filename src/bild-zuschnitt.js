const { Jimp } = require('jimp');

// Schneidet aus einem GTA-Screenshot den Streifen heraus, in dem die
// Eventnamen stehen.
//
// Warum ueberhaupt:
//
// Die Screenshots aus dem Logbuch sind rund 3680 x 1970 Pixel gross - sieben
// Megapixel. Der Kasten mit dem Eventnamen misst darin etwa 200 x 60 Pixel,
// also 0,2 Prozent der Flaeche. Das Bildmodell zerlegt trotzdem das ganze Bild
// in Kacheln und rechnet jede durch: gemessen 73 Sekunden pro Bild, bei einer
// Antwort von im Schnitt 54 Zeichen. Die Zeit geht also komplett ins Bild, nicht
// ins Formulieren.
//
// Verkleinern waere der falsche Weg - dann wird die ohnehin winzige Schrift noch
// kleiner. Zuschneiden behaelt die volle Schaerfe und wirft nur weg, was stoert:
// Chatverlauf, Killfeed, Kontostand, Werbung.
//
// Wo die Sachen liegen (an echten Screenshots ausgemessen, in Prozent):
//
//   Chatverlauf        0 - 35 %   <- weg damit
//   Wappenleiste (SK) 43 - 55 %
//   Eventkasten       57 - 87 %
//   Serverlogo        90 - 100 %
//
// Ein Ausschnitt ab 40 % Breite und bis 15 % Hoehe deckt SK und alle anderen
// Events ab - das war lange der einzige Zuschnitt, mit der Begruendung, es
// brauche keine Unterscheidung nach Eventart.
//
// Kevins Einwand (23.08.): genau diese Breite zieht auch grosse Popups mit
// rein (Megalodon-Jagd, Driftwettbewerb-Ankuendigung), die im Kasten nichts
// verloren haben und das Modell ablenken koennen. Gemessen an 14 bekannten
// Bildern schlaegt ein Zuschnitt nach behauptetem Typ den breiten Streifen -
// SK oben mittig (Wappen), alles andere enger oben rechts (Eventkasten,
// ohne Serverlogo und ohne die Popups darunter): 3/14 statt 2/14 Treffer,
// UND ~10% schneller (6622ms statt 7372ms im Schnitt). Kein Rateweg, siehe
// pruefstichprobe/text-geleiteter-zuschnitt-test.js.
//
// Ohne bekannten Typ (kein Text-Claim vorhanden) bleibt es beim breiten,
// generischen Streifen - da gibt es nichts, wonach sich gezielt zuschneiden
// liesse.

const LINKS = 0.4;
const RECHTS = 1.0;
const HOEHE = 0.15;
const OBEN = 0;

/**
 * @param {Buffer} buffer  Originalbild
 * @param {object} [optionen]
 * @param {number} [optionen.links]     ab welchem Anteil der Breite (0-1)
 * @param {number} [optionen.rechts]    bis welchem Anteil der Breite (0-1)
 * @param {number} [optionen.oben]      ab welchem Anteil der Hoehe (0-1), Standard 0 (ganz oben)
 * @param {number} [optionen.hoehe]     wieviel Anteil der Hoehe DAZU (0-1), ab "oben" gerechnet
 * @param {number} [optionen.skalieren] danach zusaetzlich verkleinern, z.B. 0.5
 * @returns {Promise<{ok: boolean, buffer?: Buffer, breite?: number, hoehe?: number, error?: string}>}
 *
 * Wirft nie: schlaegt der Zuschnitt fehl, meldet er das und der Aufrufer
 * schickt einfach das Originalbild. Ein kaputtes Bild darf keine Auszahlung
 * verhindern.
 */
async function zuschneiden(buffer, optionen = {}) {
  const linksAnteil = optionen.links ?? LINKS;
  const rechtsAnteil = optionen.rechts ?? RECHTS;
  const obenAnteil = optionen.oben ?? OBEN;
  const hoeheAnteil = optionen.hoehe ?? HOEHE;

  try {
    const bild = await Jimp.read(buffer);
    const breite = bild.bitmap.width;
    const hoehe = bild.bitmap.height;

    const x = Math.floor(breite * linksAnteil);
    const w = Math.max(1, Math.floor(breite * rechtsAnteil) - x);
    const y = Math.floor(hoehe * obenAnteil);
    const h = Math.max(1, Math.floor(hoehe * hoeheAnteil));

    // Sicherheitsnetz fuer ungewoehnlich kleine Bilder: lieber das Original
    // schicken als einen unbrauchbaren Schnipsel.
    if (w < 200 || h < 40) {
      return { ok: false, error: `Bild zu klein zum Zuschneiden (${breite}x${hoehe})` };
    }

    bild.crop({ x, y, w, h });

    if (optionen.skalieren && optionen.skalieren > 0 && optionen.skalieren < 1) {
      bild.scale(optionen.skalieren);
    }

    const raus = await bild.getBuffer('image/png');
    return { ok: true, buffer: raus, breite: bild.bitmap.width, hoehe: bild.bitmap.height };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  HOEHE,
  LINKS,
  RECHTS,
  zuschneiden,
};
