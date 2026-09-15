const fs = require('node:fs/promises');
const path = require('node:path');
const { Jimp, rgbaToInt } = require('jimp');
const toIco = require('to-ico');

// Baut das App-Icon: derselbe leuchtende Kern wie im Dashboard
// (dashboard-seite.js, .ruheorb .kern) - violett mit einem Cyan-Lichtstreifen
// am Rand, dieselben zwei Farben wie ueberall sonst bei Ghostxx. Kein
// externes Bild noetig, keine Rechte-Frage - alles gezeichnet.
//
// Gezeichnet wird EINMAL gross (512px) und fuer jede kleinere Groesse
// heruntergerechnet - das gibt glattere Kanten als jede Groesse einzeln aus
// Pixeln zu berechnen, gerade bei den ganz kleinen (16px, 24px).

const MEISTER_GROESSE = 512;
const GROESSEN = [16, 24, 32, 48, 64, 128, 256];
const ZIEL_ORDNER = path.join(__dirname, 'assets');

function mische(a, b, t) {
  return a + (b - a) * t;
}

function farbMischen(a, b, t) {
  return {
    r: Math.round(mische(a.r, b.r, t)),
    g: Math.round(mische(a.g, b.g, t)),
    b: Math.round(mische(a.b, b.b, t)),
  };
}

/** Der Kern selbst: violetter Verlauf plus Cyan-Lichtstreifen unten rechts. */
async function kernZeichnen(groesse) {
  const bild = new Jimp({ width: groesse, height: groesse, color: 0x00000000 });
  const mitte = groesse / 2;
  const radius = groesse * 0.44;

  // Derselbe Verlauf wie im Dashboard: weiss im Zentrum -> helles Violett ->
  // dunkles Violett aussen.
  const stopps = [
    { bei: 0.0, r: 255, g: 255, b: 255 },
    { bei: 0.35, r: 233, g: 213, b: 255 },
    { bei: 0.7, r: 168, g: 85, b: 247 },
    { bei: 1.0, r: 76, g: 29, b: 149 },
  ];
  const cyan = { r: 103, g: 232, b: 249 };

  const violettBei = (t) => {
    for (let i = 0; i < stopps.length - 1; i += 1) {
      const a = stopps[i];
      const b = stopps[i + 1];
      if (t >= a.bei && t <= b.bei) return farbMischen(a, b, (t - a.bei) / (b.bei - a.bei));
    }
    return stopps[stopps.length - 1];
  };

  // Zweite Lichtquelle unten rechts, wie im CSS "radial-gradient(circle at
  // 74% 72%, cyan, transparent 42%)" - dieselbe Position, jetzt in Pixeln.
  const cyanX = mitte + radius * 0.48;
  const cyanY = mitte + radius * 0.44;
  const cyanRadius = radius * 0.85;

  for (let y = 0; y < groesse; y += 1) {
    for (let x = 0; x < groesse; x += 1) {
      const dx = x - mitte + radius * 0.09; // Hauptlicht leicht oben-links
      const dy = y - mitte - radius * 0.13;
      const distanz = Math.sqrt(dx * dx + dy * dy);
      if (distanz > radius) continue;

      const t = Math.min(1, distanz / radius);
      let farbe = violettBei(t);

      const cyanDx = x - cyanX;
      const cyanDy = y - cyanY;
      const cyanDist = Math.sqrt(cyanDx * cyanDx + cyanDy * cyanDy);
      if (cyanDist < cyanRadius) {
        const staerke = (1 - cyanDist / cyanRadius) * 0.55;
        farbe = farbMischen(farbe, cyan, staerke);
      }

      // Weicher Rand, damit der Kreis nicht gezackt aussieht.
      const randStart = radius * 0.93;
      let alpha = 255;
      if (distanz > randStart) {
        alpha = Math.round(255 * (1 - (distanz - randStart) / (radius - randStart)));
      }

      bild.setPixelColor(rgbaToInt(farbe.r, farbe.g, farbe.b, Math.max(0, alpha)), x, y);
    }
  }

  return bild;
}

/** Weicher Schein hinter dem Kern - dieselbe Idee wie ".ruheorb .hauch". */
async function scheinZeichnen(groesse) {
  const bild = new Jimp({ width: groesse, height: groesse, color: 0x00000000 });
  const mitte = groesse / 2;
  const radius = groesse * 0.42;

  for (let y = 0; y < groesse; y += 1) {
    for (let x = 0; x < groesse; x += 1) {
      const dx = x - mitte;
      const dy = y - mitte;
      const distanz = Math.sqrt(dx * dx + dy * dy);
      if (distanz > radius) continue;

      const t = distanz / radius;
      const alpha = Math.round(150 * (1 - t) ** 1.6);
      if (alpha <= 0) continue;

      bild.setPixelColor(rgbaToInt(168, 85, 247, alpha), x, y);
    }
  }

  return bild.blur(Math.max(2, Math.round(groesse * 0.05)));
}

(async () => {
  await fs.mkdir(ZIEL_ORDNER, { recursive: true });

  const schein = await scheinZeichnen(MEISTER_GROESSE);
  const kern = await kernZeichnen(MEISTER_GROESSE);

  const meister = new Jimp({ width: MEISTER_GROESSE, height: MEISTER_GROESSE, color: 0x00000000 });
  meister.composite(schein, 0, 0);
  meister.composite(kern, 0, 0);

  const puffer = [];
  for (const groesse of GROESSEN) {
    const verkleinert = meister.clone().resize({ w: groesse, h: groesse });
    const buf = await verkleinert.getBuffer('image/png');
    puffer.push(buf);
    if (groesse === 256) await fs.writeFile(path.join(ZIEL_ORDNER, 'icon.png'), buf);
  }

  const ico = await toIco(puffer);
  await fs.writeFile(path.join(ZIEL_ORDNER, 'icon.ico'), ico);

  console.log('Icon erzeugt:', path.join(ZIEL_ORDNER, 'icon.ico'));
})().catch((error) => {
  console.error('Icon-Erzeugung fehlgeschlagen:', error.message);
  process.exit(1);
});
