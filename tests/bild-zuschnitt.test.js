const { Jimp } = require('jimp');
const { check, equal, finish, section } = require('./lib');
const { HOEHE, LINKS, RECHTS, zuschneiden } = require('../src/bild-zuschnitt');

// Der Zuschnitt ist der zweite Anlauf der Bildpruefung. Geht er schief, darf
// er nie werfen - dann wird einfach das Originalbild weiterbenutzt.

async function testbild(breite, hoehe) {
  const bild = new Jimp({ width: breite, height: hoehe, color: 0x336699ff });
  return bild.getBuffer('image/png');
}

(async () => {
  section('Schnitt trifft den oberen Rand');
  // Typischer Screenshot aus dem Logbuch: ultrabreit, sieben Megapixel.
  const gross = await testbild(3681, 1967);
  const r = await zuschneiden(gross);

  check('geht durch', r.ok, r.error);
  equal('Breite: ab 40 Prozent', r.breite, 3681 - Math.floor(3681 * LINKS));
  equal('Hoehe: oberste 15 Prozent', r.hoehe, Math.floor(1967 * HOEHE));

  const vorher = 3681 * 1967;
  const nachher = r.breite * r.hoehe;
  check(`spart Bildpunkte (${(vorher / nachher).toFixed(1)}x weniger)`, nachher * 8 < vorher);

  section('Zusaetzlich verkleinern');
  const klein = await zuschneiden(gross, { skalieren: 0.5 });
  check('geht durch', klein.ok, klein.error);
  check('halb so breit', Math.abs(klein.breite - r.breite / 2) <= 1, `${klein.breite} statt ${r.breite / 2}`);
  check('halb so hoch', Math.abs(klein.hoehe - r.hoehe / 2) <= 1, `${klein.hoehe} statt ${r.hoehe / 2}`);

  section('Auch der Abschlussbildschirm wird geschnitten');
  // Der ist nur 1920x1080 - der Schnitt muss trotzdem sauber durchlaufen.
  const abschluss = await zuschneiden(await testbild(1920, 1080));
  check('geht durch', abschluss.ok, abschluss.error);
  equal('Hoehe', abschluss.hoehe, Math.floor(1080 * HOEHE));

  section('Zu kleine Bilder bleiben unangetastet');
  // Lieber das Original schicken als einen unbrauchbaren Schnipsel. Der
  // Aufrufer erkennt das an ok === false und nimmt dann das ganze Bild.
  const winzig = await zuschneiden(await testbild(300, 200));
  check('wird abgelehnt', !winzig.ok, JSON.stringify(winzig));
  check('  mit Begruendung', /zu klein/.test(winzig.error || ''), winzig.error);

  section('Kaputte Daten werfen nicht');
  // Ein unlesbares Bild darf keine Auszahlung stoppen.
  const muell = await zuschneiden(Buffer.from('das ist kein bild'));
  check('meldet nur', muell.ok === false && typeof muell.error === 'string', JSON.stringify(muell));

  const leer = await zuschneiden(Buffer.alloc(0));
  check('leerer Puffer meldet nur', leer.ok === false);

  section('Einstellbare Groesse');
  const eigen = await zuschneiden(gross, { links: 0.5, hoehe: 0.1 });
  equal('halbe Breite', eigen.breite, 3681 - Math.floor(3681 * 0.5));
  equal('zehn Prozent Hoehe', eigen.hoehe, Math.floor(1967 * 0.1));

  section('Ohne rechts: bis zum rechten Rand, wie bisher');
  equal('Standardwert ist 1.0', RECHTS, 1.0);

  section('Rechte Grenze (23.08.: text-geleiteter Zuschnitt)');
  // schnittFuerTyp() in logbook-vision.js nutzt das fuer SK (0.40-0.60) und
  // andere Events (0.63-0.90) - hier nur die Mechanik pruefen, nicht die
  // konkreten Werte (die stehen dort und sind an echten Bildern gemessen).
  const sk = await zuschneiden(gross, { links: 0.40, rechts: 0.60, hoehe: 0.13 });
  check('geht durch', sk.ok, sk.error);
  equal('Breite: 20 Prozent-Streifen', sk.breite, Math.floor(3681 * 0.60) - Math.floor(3681 * 0.40));

  const eventKasten = await zuschneiden(gross, { links: 0.63, rechts: 0.90, hoehe: 0.10 });
  check('geht durch', eventKasten.ok, eventKasten.error);
  equal('Breite: 27 Prozent-Streifen', eventKasten.breite, Math.floor(3681 * 0.90) - Math.floor(3681 * 0.63));
  check('schmaler als der generische Streifen', eventKasten.breite < (3681 - Math.floor(3681 * LINKS)));

  finish();
})();
