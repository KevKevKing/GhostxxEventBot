const { Jimp } = require('jimp');
const { config } = require('./config');
const { chat } = require('./ollama');
const { halteFest, merke } = require('./bild-gedaechtnis');

// Liest Uhrzeit und Datum aus der unteren rechten Ecke eines Screenshots.
//
// Der Anlass: Jemand hat zwei Aufnahmen desselben 40er eingereicht, vier
// Sekunden auseinander. Verschiedene Dateien, verschiedene Bildmasse - der
// Fingerabdruck konnte sie nicht als Doppel erkennen. Identisch waren aber
// Kontostand, Killfeed, Ort und vor allem die Spieluhr: beide 20:46 am
// 09.08.2026.
//
// Ein Event laeuft nie zweimal in derselben Stunde. Zwei Nachweise fuer
// dasselbe Event mit derselben Stunde sind also derselbe Durchgang.
//
// Warum das hier funktioniert, obwohl die Eventerkennung nur bei 80 Prozent
// liegt: Die Uhr steht immer an derselben Stelle, ist gross und besteht nur aus
// Ziffern. Auf dem Ausschnitt von rund 300 x 100 Pixeln braucht das Modell
// 4 bis 6 Sekunden statt 47 - und hat in der Probe alle drei Bilder richtig
// gelesen.

const LINKS = 0.78;
const OBEN = 0.88;

// Seit 17.08.: glm-ocr statt qwen3-vl:8b, gemessen an drei echten Ecken -
// glm-ocr hat alle drei richtig gelesen (20:44, 21:47, 20:28 mit dem
// jeweiligen Datum), qwen3-vl:8b lieferte mit dem Formular-Prompt bei allen
// dreien eine leere oder unbrauchbare Antwort. Deshalb kein Formular mehr,
// nur noch die Bitte, alles abzulesen - wie beim Ereignis-Lesen.
const PROMPT = 'Lies allen Text im Bild ab.';

async function schneideEcke(buffer) {
  const bild = await Jimp.read(buffer);
  const breite = bild.bitmap.width;
  const hoehe = bild.bitmap.height;

  const x = Math.floor(breite * LINKS);
  const y = Math.floor(hoehe * OBEN);
  const w = breite - x;
  const h = hoehe - y;

  if (w < 80 || h < 30) return null;

  bild.crop({ x, y, w, h });
  return bild.getBuffer('image/png');
}

// Im Ausschnitt steht neben der Spieluhr oft noch ein Countdown ("VERBLEIBEND
// 07:05 VOR EMPFANG") - auch eine Uhrzeit-foermige Zahl, aber ohne Datum
// daneben. Die echte Spieluhr erkennt man daran, dass DIREKT danach ein
// Datum folgt (im Spiel steht es eine Zeile drunter) - der Countdown hat nie
// eins. \D{0,15} laesst dafuer nur ein, zwei kurze Woerter Abstand zu, nicht
// eine ganze Wall of Text dazwischen.
function leseAntwort(text) {
  const zeilen = String(text || '');
  const treffer = /(\d{1,2}):(\d{2})\D{0,15}?(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/.exec(zeilen);
  if (!treffer) return null;

  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  const tag = Number(treffer[3]);
  const monat = Number(treffer[4]);
  const jahr = Number(treffer[5].length === 2 ? `20${treffer[5]}` : treffer[5]);

  // Grober Plausibilitaetstest - ein verlesener Wert soll nicht als Tatsache
  // durchgehen.
  if (stunde > 23 || minute > 59 || tag < 1 || tag > 31 || monat < 1 || monat > 12) return null;
  if (jahr < 2020 || jahr > 2100) return null;

  return {
    stunde,
    minute,
    tag,
    monat,
    jahr,
    // Der Schluessel, an dem sich Doppel erkennen lassen: Tag plus Stunde.
    stundenSchluessel: `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')} ${String(stunde).padStart(2, '0')}`,
    text: `${String(tag).padStart(2, '0')}.${String(monat).padStart(2, '0')}.${jahr} ${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * @returns {Promise<null|{stundenSchluessel: string, text: string, ...}>}
 * Wirft nie - ohne Uhrzeit laeuft die Auszahlung wie bisher weiter.
 */
async function leseUhrzeit(buffer, optionen = {}) {
  try {
    // Die Spieluhr steht fest im Bild - einmal gelesen reicht fuer immer.
    const base64 = buffer.toString('base64');
    if (!optionen.ohneGedaechtnis) {
      const gemerkt = await merke(base64).catch(() => null);
      if (gemerkt && 'zeitpunkt' in gemerkt) return gemerkt.zeitpunkt;
    }

    const ecke = await schneideEcke(buffer);
    if (!ecke) return null;

    const r = await chat({
      model: optionen.model || config.ollamaEventVisionModel,
      messages: [{ role: 'user', content: PROMPT, images: [ecke.toString('base64')] }],
      temperature: 0,
      keepAlive: config.ollamaVisionKeepAlive,
      // Wie beim Ereignis-Lesen: ohne Obergrenze haengt glm-ocr Wiederholungen
      // an, bis die Zeitgrenze zuschlaegt. Der Ausschnitt ist winzig, 60 Token
      // reichen mit viel Luft.
      numPredict: 60,
    });

    if (!r.ok) return null;

    const zeitpunkt = leseAntwort(r.content);
    if (!optionen.ohneGedaechtnis) {
      await halteFest(base64, { zeitpunkt }).catch(() => null);
    }
    return zeitpunkt;
  } catch {
    return null;
  }
}

module.exports = {
  LINKS,
  OBEN,
  leseAntwort,
  leseUhrzeit,
  schneideEcke,
};
