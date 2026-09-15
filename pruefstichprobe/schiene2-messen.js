// Schiene 2: bevor der gezielte dritte Versuch vertraut wird, muss der
// ERSTE, generische Versuch (ohne Hinweis) schon etwas AEHNLICHES gelesen
// haben. Hier wird gemessen, wie aehnlich "aehnlich genug" sein muss.
//
// Gleitendes Fenster: der erwartete ingame-Name wird an jeder Stelle im
// gelesenen Text verglichen (per Levenshtein), das beste (kleinste)
// Ergebnis zaehlt. So ist es egal, WO im Text die Aehnlichkeit steckt.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { normalizeText } = require('../src/text-match');

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

// Bestes (kleinstes) Ergebnis ueber ein gleitendes Fenster derselben Laenge
// wie der gesuchte Name - gibt Distanz UND Anteil an der Laenge zurueck.
function besteAehnlichkeit(text, erwartet) {
  const normText = normalizeText(text).replaceAll(' ', ' '); // schon normalisiert
  const normErw = normalizeText(erwartet);
  const n = normErw.length;
  if (normText.length < n) return { distanz: levenshtein(normText, normErw), anteil: 1 };

  let beste = Infinity;
  for (let i = 0; i <= normText.length - n; i += 1) {
    const fenster = normText.slice(i, i + n);
    const d = levenshtein(fenster, normErw);
    if (d < beste) beste = d;
    if (beste === 0) break;
  }
  return { distanz: beste, anteil: beste / n };
}

async function lies(bildBase64, prompt = 'Lies allen Text im Bild ab.') {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: 'glm-ocr',
      messages: [{ role: 'user', content: prompt, images: [bildBase64] }],
      stream: false,
      options: { temperature: 0, repeat_penalty: 1.2, num_predict: 200 },
    }),
  });
  const d = await res.json();
  return d.message?.content || '';
}

async function ersterVersuch(dateiname) {
  const roh = fs.readFileSync(`pruefstichprobe/${dateiname}`);
  const s = await zuschneiden(roh);
  const bild = (s.ok ? s.buffer : roh).toString('base64');
  return lies(bild);
}

const FAELLE = [
  // GUT: Text stimmt (auch wenn verlesen), der dritte Versuch soll erlaubt sein.
  { bild: '07-rassauran.png', erwartet: 'krieg um ressourcen', soll: 'ERLAUBEN', notiz: '40er, echt behauptet' },
  { bild: '02-drift-popup.png', erwartet: 'krieg um ressourcen', soll: 'ERLAUBEN', notiz: '40er, echt behauptet' },
  // SCHLECHT: Text ist falsch zugeordnet, der dritte Versuch darf NICHT vertraut werden.
  { bild: '07-rassauran.png', erwartet: 'uebernahme des geschaefts', soll: 'SPERREN', notiz: 'faelschlich als Bizwar behauptet' },
  { bild: '07-rassauran.png', erwartet: 'krieg um das geschaeft', soll: 'SPERREN', notiz: 'faelschlich als Bizwar (2. Name)' },
  { bild: 'zarti-sk-2.png', erwartet: 'krieg um ressourcen', soll: 'SPERREN', notiz: 'faelschlich als 40er behauptet (ist SK+Bank)' },
  { bild: 'zarti-sk-2.png', erwartet: 'uebernahme des geschaefts', soll: 'SPERREN', notiz: 'faelschlich als Bizwar behauptet' },
  { bild: '01-megalodon-popup.png', erwartet: 'uebernahme des geschaefts', soll: 'SPERREN', notiz: 'faelschlich als Bizwar (ist 40er)' },
];

(async () => {
  const ergebnisse = [];
  const cache = {};

  for (const f of FAELLE) {
    if (!cache[f.bild]) cache[f.bild] = await ersterVersuch(f.bild);
    const text = cache[f.bild];
    const { distanz, anteil } = besteAehnlichkeit(text, f.erwartet);
    ergebnisse.push({ ...f, distanz, anteil });
    console.log(`${f.soll.padEnd(9)} ${f.bild.padEnd(22)} erwartet "${f.erwartet}" -> Distanz ${distanz}, Anteil ${(anteil * 100).toFixed(0)}%  (${f.notiz})`);
  }

  console.log('\n--- Rohtexte zur Kontrolle ---');
  for (const [bild, text] of Object.entries(cache)) {
    console.log(`\n${bild}:`);
    console.log('  ', JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 100)));
  }

  console.log('\n============================================================');
  const erlauben = ergebnisse.filter((e) => e.soll === 'ERLAUBEN');
  const sperren = ergebnisse.filter((e) => e.soll === 'SPERREN');
  console.log('ERLAUBEN-Faelle, Anteil:', erlauben.map((e) => (e.anteil * 100).toFixed(0) + '%').join(', '));
  console.log('SPERREN-Faelle, Anteil:', sperren.map((e) => (e.anteil * 100).toFixed(0) + '%').join(', '));
})();
