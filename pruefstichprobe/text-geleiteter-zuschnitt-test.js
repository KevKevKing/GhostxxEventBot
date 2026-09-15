// Kevins Idee (23.08.): statt immer derselben breiten Ecke den Ausschnitt
// nach dem behaupteten Eventtyp waehlen - SK oben mittig, andere Events
// enger oben rechts, ohne die grossen Popups (Megalodon-Jagd,
// Driftwettbewerb etc.), die im generischen Schnitt mit drinhaengen.
//
// Getestet an der lokalen Stichprobe (pruefstichprobe/), Wahrheit aus
// wahrheit.json + der bekannten SK-Zusatzbilder. Kein Raten - vorher
// gemessen, nicht vermutet.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('fs');
const { Jimp } = require('jimp');
const { findEventsInImageText } = require('../src/logbook-events');

const OLLAMA = 'http://127.0.0.1:11434';

const WAHRHEIT = JSON.parse(fs.readFileSync('pruefstichprobe/wahrheit.json', 'utf8'))
  .filter((w) => w.wahrheit)
  .map((w) => ({ datei: `${w.name}.png`, key: w.wahrheit }));

// Zusatzbilder ohne eigenen wahrheit.json-Eintrag, Wahrheit aus fruehreren
// Messungen (fuzzy-katalog-messen.js) uebernommen.
const ZUSATZ = [
  { datei: 'zarti-sk-1.png', key: 'sk' },
  { datei: 'zarti-sk-2.png', key: 'sk' },
  { datei: 'Screenshot 2026-08-17 042452.png', key: 'sk' },
  { datei: 'Screenshot 2026-08-17 042509.png', key: 'sk' },
  { datei: 'Screenshot 2026-08-17 042520.png', key: 'sk' },
  { datei: 'Screenshot 2026-08-17 042528.png', key: 'sk' },
  { datei: 'Screenshot 2026-08-17 042539.png', key: 'sk' },
];

const BILDER = [...WAHRHEIT, ...ZUSATZ].filter((b) => fs.existsSync(`pruefstichprobe/${b.datei}`));

// Die drei Anlaeufe: aktueller Produktions-Schnitt, textgeleiteter Schnitt,
// ganzes Bild als Grundlinie.
async function schneide(roh, links, rechts, hoehe) {
  const bild = await Jimp.read(roh);
  const b = bild.bitmap.width;
  const h = bild.bitmap.height;
  const x = Math.floor(b * links);
  const w = Math.max(1, Math.floor(b * rechts) - x);
  const hh = Math.max(1, Math.floor(h * hoehe));
  return bild.crop({ x, y: 0, w, h: hh }).getBuffer('image/png');
}

function textgeleiteterSchnitt(roh, key) {
  // sk: Wappen stehen oben mittig (43-55% gemessen), etwas Luft drumherum.
  if (key === 'sk') return schneide(roh, 0.40, 0.60, 0.13);
  // alles andere: der kleine Eventkasten steht oben rechts, deutlich
  // schmaler als der generische 40-100%-Streifen - laesst Popups darunter
  // (Megalodon-Jagd, Driftwettbewerb) und das Serverlogo ganz rechts weg.
  return schneide(roh, 0.63, 0.90, 0.10);
}

function aktuellerSchnitt(roh) {
  return schneide(roh, 0.40, 1.00, 0.15);
}

async function lies(bildBase64) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: 'glm-ocr',
        messages: [{ role: 'user', content: 'Lies allen Text im Bild ab.', images: [bildBase64] }],
        stream: false,
        options: { temperature: 0, repeat_penalty: 1.2, num_predict: 200 },
      }),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - t0 };
    const d = await res.json();
    return { ok: true, ms: Date.now() - t0, text: d.message?.content || '' };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

(async () => {
  console.log(`${BILDER.length} Bilder mit bekannter Wahrheit\n`);

  const ergebnis = {
    aktuell: { treffer: 0, ms: 0 },
    textgeleitet: { treffer: 0, ms: 0 },
    ganzesBild: { treffer: 0, ms: 0 },
  };

  for (const b of BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${b.datei}`);

    // Nacheinander, nicht gleichzeitig: zwei Bild-Anfragen parallel teilen
    // sich die Grafikkarte und werden beide langsamer - gemessen schon
    // einmal in diesem Projekt (siehe ollama.js, reihe()). Das wuerde die
    // Zeitmessung hier verfaelschen.
    const aktuell = await aktuellerSchnitt(roh).then((buf) => lies(buf.toString('base64')));
    const textgeleitet = await textgeleiteterSchnitt(roh, b.key).then((buf) => lies(buf.toString('base64')));
    const ganzesBild = await lies(roh.toString('base64'));

    const zeile = [b.datei.padEnd(45), `(${b.key})`.padEnd(6)];
    for (const [name, r] of [['aktuell', aktuell], ['textgeleitet', textgeleitet], ['ganzesBild', ganzesBild]]) {
      const treffer = r.ok && findEventsInImageText(r.text).some((e) => e.key === b.key);
      if (treffer) ergebnis[name].treffer += 1;
      ergebnis[name].ms += r.ms;
      zeile.push(`${treffer ? '✓' : '·'}${String(r.ms).padStart(5)}ms`);
    }
    console.log(zeile.join('  '));
  }

  const n = BILDER.length;
  console.log('\n============================================================');
  for (const [name, e] of Object.entries(ergebnis)) {
    console.log(`${name.padEnd(14)} ${e.treffer}/${n}   ${Math.round(e.ms / n)} ms im Schnitt`);
  }
})();
