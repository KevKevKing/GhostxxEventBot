// Testet eine unscharfe Katalog-Suche (gleitendes Fenster, Levenshtein) gegen
// ALLE bekannten Rohtexte und ALLE Events - auch die, die NICHT im Bild
// stehen. Gesucht wird nach Zufallstreffern: matcht irgendein falsches Event
// bei einer bestimmten Schwelle, obwohl es gar nicht im Bild ist?

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const { EVENTS } = require('../src/logbook-events');
const { normalizeText } = require('../src/text-match');
const { zuschneiden } = require('../src/bild-zuschnitt');

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[a.length][b.length];
}

function besteAehnlichkeit(text, gesucht) {
  const n = gesucht.length;
  if (text.length < n) return levenshtein(text, gesucht) / n;
  let beste = Infinity;
  for (let i = 0; i <= text.length - n; i += 1) {
    const d = levenshtein(text.slice(i, i + n), gesucht);
    if (d < beste) beste = d;
    if (beste === 0) break;
  }
  return beste / n;
}

const SCHWELLEN = [0.15, 0.20, 0.25, 0.30];

const BEKANNT = {
  '01-megalodon-popup.png': ['40er'],
  '02-drift-popup.png': ['40er'],
  '03-sk-wappen.png': ['sk'],
  '04-40er-blass.png': ['40er'],
  '06-meeting.png': ['40er'],
  '07-rassauran.png': ['40er'],
  '08-uebermacht.png': ['40er'],
  'Grand_Theft_Auto_V_Screenshot_2026.08.17_-_21.43.16.56.png': ['40er', 'bank'],
  'zarti-sk-1.png': ['sk'],
  'zarti-sk-2.png': ['sk', 'bank'],
  'Screenshot 2026-08-17 042452.png': ['sk'],
  'Screenshot 2026-08-17 042509.png': ['sk'],
  'Screenshot 2026-08-17 042520.png': ['sk'],
  'Screenshot 2026-08-17 042528.png': ['sk'],
  'Screenshot 2026-08-17 042539.png': ['sk'],
};

async function lies(bildBase64) {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: 'glm-ocr',
      messages: [{ role: 'user', content: 'Lies allen Text im Bild ab.', images: [bildBase64] }],
      stream: false,
      options: { temperature: 0, repeat_penalty: 1.2, num_predict: 200 },
    }),
  });
  const d = await res.json();
  return d.message?.content || '';
}

(async () => {
  const gelesen = {};
  for (const datei of Object.keys(BEKANNT)) {
    const roh = fs.readFileSync(`pruefstichprobe/${datei}`);
    const s = await zuschneiden(roh);
    const bild = (s.ok ? s.buffer : roh).toString('base64');
    gelesen[datei] = normalizeText(await lies(bild));
    console.log(`gelesen: ${datei}`);
  }

  for (const schwelle of SCHWELLEN) {
    console.log(`\n=== Schwelle ${(schwelle * 100).toFixed(0)}% ===`);
    let echteTreffer = 0;
    let echteVerpasst = 0;
    let falscheTreffer = 0;

    for (const [datei, text] of Object.entries(gelesen)) {
      const wahr = BEKANNT[datei];
      const gefunden = [];

      for (const event of EVENTS) {
        for (const name of event.ingame) {
          const anteil = besteAehnlichkeit(text, name);
          if (anteil <= schwelle) { gefunden.push(event.key); break; }
        }
      }
      const gefundenSet = [...new Set(gefunden)];

      for (const key of wahr) {
        if (gefundenSet.includes(key)) echteTreffer += 1; else echteVerpasst += 1;
      }
      const falsche = gefundenSet.filter((k) => !wahr.includes(k));
      if (falsche.length) {
        falscheTreffer += falsche.length;
        console.log(`  FALSCHER TREFFER bei ${datei}: ${falsche.join(', ')} (wahr waere: ${wahr.join(', ')})`);
      }
    }

    console.log(`  echte Events gefunden: ${echteTreffer}, verpasst: ${echteVerpasst}, falsche Treffer: ${falscheTreffer}`);
  }
})();
