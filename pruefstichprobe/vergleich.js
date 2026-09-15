// Vergleicht das bisherige Bildmodell mit dem neuen OCR-Modell.
//
// FESTE Stichprobe, feste Wahrheit (wahrheit.json, von Hand nachgesehen).
// Fuenf Bilder pro Modell, damit der Lauf in zehn Minuten durch ist.
//
// Der Unterschied zwischen den beiden ist grundsaetzlich:
//
//   qwen3-vl  bekommt eine FRAGE ("welche Events siehst du?") und antwortet
//             in einem festen Format. Es entscheidet selbst, was wichtig ist.
//   glm-ocr   liest stumpf ALLEN Text ab. Die Zuordnung zum Eventkatalog
//             macht danach der Code.
//
// Das zweite passt besser zum Grundsatz des Projekts: erst ablesen, dann
// zuordnen. Das Modell soll nicht raten, was gemeint ist.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const path = require('node:path');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { findEventsInImageText } = require('../src/logbook-events');

const ORDNER = __dirname;
const OLLAMA = 'http://127.0.0.1:11434';
const ZEITLIMIT_MS = 120000;

// Fuenf Bilder, fuenf verschiedene Problemarten.
const AUSWAHL = [
  '01-megalodon-popup', // kleiner Kasten neben grossem buntem Popup
  '02-drift-popup',     // Kasten am oberen Bildrand angeschnitten
  '03-sk-wappen',       // nur zwei Wappen, gar kein Eventname
  '04-40er-blass',      // Kasten blass und klein
  '07-rassauran',       // wurde frueher als "Krieg um Rassauran" verlesen
];

const wahrheit = new Map(
  JSON.parse(fs.readFileSync(path.join(ORDNER, 'wahrheit.json'), 'utf8'))
    .map((w) => [w.name, w]),
);

// Der bisherige Prompt - woertlich aus logbook-vision.js, damit hier nichts
// anderes gemessen wird als das, was der Bot wirklich benutzt.
const PROMPT_ALT = 'Das ist der obere Rand eines GTA5-Grand-Screenshots.\n\n'
  + 'Hier stehen die Namen laufender Familien-Events, jeweils ueber einer Liste mit\n'
  + 'Familiennamen und Punktzahlen. Es koennen mehrere gleichzeitig sein.\n\n'
  + 'Lies ab, was dasteht. Erfinde nichts.\n\n'
  + 'EVENTS: <alle Eventnamen die du siehst, mit Komma getrennt, sonst "keins">\n'
  + 'GEWINNENDE_FAMILIE: <Name, sonst "steht nicht da">\n'
  + 'WAPPEN: <ja, wenn zwei Familienwappen mit Spielerzahlen zu sehen sind, sonst nein>';

// Fuer ein OCR-Modell: keine Formatvorgabe, keine Frage. Nur ablesen.
const PROMPT_OCR = 'Lies allen Text im Bild ab.';

async function frage(modell, bildBase64, prompt, optionen = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
      body: JSON.stringify({
        model: modell,
        messages: [{ role: 'user', content: prompt, images: [bildBase64] }],
        stream: false,
        options: { temperature: 0, ...optionen },
      }),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - t0, fehler: `HTTP ${res.status}` };
    const d = await res.json();
    return { ok: true, ms: Date.now() - t0, text: d.message?.content || '' };
  } catch (error) {
    return { ok: false, ms: Date.now() - t0, fehler: error.message };
  }
}

/** Aus dem abgelesenen Text die Katalog-Events ziehen - wie im Bot. */
function eventsAus(text) {
  return findEventsInImageText(text).map((e) => e.key);
}

function urteil(gefunden, soll, wappenErkannt) {
  if (!soll) return gefunden.length ? 'falsch positiv' : 'richtig';
  if (soll === 'sk' && wappenErkannt && !gefunden.length) return 'richtig (Wappen)';
  return gefunden.includes(soll) ? 'richtig' : 'verpasst';
}

(async () => {
  const ergebnisse = { 'qwen3-vl:8b': [], 'glm-ocr': [] };

  for (const name of AUSWAHL) {
    const soll = wahrheit.get(name);
    const roh = fs.readFileSync(path.join(ORDNER, `${name}.png`));
    const schnitt = await zuschneiden(roh);
    const bild = (schnitt.ok ? schnitt.buffer : roh).toString('base64');

    console.log(`\n${name}  (soll: ${soll?.wahrheit || 'nichts'})`);

    // Das bisherige Modell, mit seinem eigenen Prompt.
    const alt = await frage('qwen3-vl:8b', bild, PROMPT_ALT);
    const altEvents = alt.ok ? eventsAus((/EVENTS:(.*)/i.exec(alt.text) || [, ''])[1]) : [];
    const altWappen = alt.ok && /WAPPEN:\s*ja/i.test(alt.text);
    const altUrteil = alt.ok ? urteil(altEvents, soll?.wahrheit, altWappen) : 'FEHLER';
    ergebnisse['qwen3-vl:8b'].push({ name, urteil: altUrteil, ms: alt.ms });
    console.log(`  qwen3-vl:8b  ${String(alt.ms).padStart(6)}ms  ${altUrteil.padEnd(16)} ${JSON.stringify(alt.ok ? (/EVENTS:(.*)/i.exec(alt.text) || [, ''])[1].trim().slice(0, 50) : alt.fehler)}`);

    // Das OCR-Modell: liest alles, die Zuordnung macht der Katalog.
    // repeat_penalty gegen die leeren Bloecke, die es sonst anhaengt.
    const neu = await frage('glm-ocr', bild, PROMPT_OCR, { repeat_penalty: 1.2, num_predict: 400 });
    const neuEvents = neu.ok ? eventsAus(neu.text) : [];
    // Wappen erkennt ein OCR-Modell nicht als solche - aber die Familiennamen
    // mit Zahlen daneben sind ein brauchbares Anzeichen.
    const neuWappen = neu.ok && /unknown|el egnu/i.test(neu.text);
    const neuUrteil = neu.ok ? urteil(neuEvents, soll?.wahrheit, neuWappen) : 'FEHLER';
    ergebnisse['glm-ocr'].push({ name, urteil: neuUrteil, ms: neu.ms });
    console.log(`  glm-ocr      ${String(neu.ms).padStart(6)}ms  ${neuUrteil.padEnd(16)} ${JSON.stringify(neu.ok ? neu.text.replace(/\s+/g, ' ').trim().slice(0, 50) : neu.fehler)}`);
  }

  console.log('\n============================================================');
  for (const [modell, liste] of Object.entries(ergebnisse)) {
    const richtig = liste.filter((e) => e.urteil.startsWith('richtig')).length;
    const zeit = Math.round(liste.reduce((s, e) => s + e.ms, 0) / liste.length);
    console.log(`${modell.padEnd(14)} ${richtig}/${liste.length} richtig, im Schnitt ${zeit} ms`);
  }
  console.log('\n(Gemessen an derselben festen Stichprobe, beide mit Zuschnitt.)');
})();
