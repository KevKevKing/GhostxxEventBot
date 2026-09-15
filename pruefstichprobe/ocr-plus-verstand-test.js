// Testet Kevins Idee (25.08.): OCR (glm-ocr, scharfe Augen) liest den Text,
// qwen3.5:9b (Verstand) urteilt danach NUR anhand des Textes - statt dass ein
// einzelnes Modell gleichzeitig lesen UND urteilen muss.
//
// FESTE Stichprobe, feste Wahrheit (wahrheit.json) - dieselben fuenf Bilder
// wie in vergleich.js, damit das Ergebnis mit der bisherigen Messung
// vergleichbar bleibt. Sequentiell, nicht parallel - GPU-Nebenlaeufigkeit
// verfaelscht die Zeiten (siehe fruehere Messungen in diesem Ordner).

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const path = require('node:path');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { findEventsInImageText } = require('../src/logbook-events');

const ORDNER = __dirname;
const OLLAMA = 'http://127.0.0.1:11434';
const ZEITLIMIT_MS = 120000;

const AUSWAHL = [
  '01-megalodon-popup',
  '02-drift-popup',
  '03-sk-wappen', // Sonderfall: nur zwei Wappen, GAR KEIN Text - Kevins Idee
                  // muesste hier strukturell scheitern, wenn glm-ocr nichts
                  // ausser Text liefert. Genau das ist interessant zu sehen.
  '04-40er-blass',
  '07-rassauran',
];

const wahrheit = new Map(
  JSON.parse(fs.readFileSync(path.join(ORDNER, 'wahrheit.json'), 'utf8'))
    .map((w) => [w.name, w]),
);

const PROMPT_ALT = 'Das ist der obere Rand eines GTA5-Grand-Screenshots.\n\n'
  + 'Hier stehen die Namen laufender Familien-Events, jeweils ueber einer Liste mit\n'
  + 'Familiennamen und Punktzahlen. Es koennen mehrere gleichzeitig sein.\n\n'
  + 'Lies ab, was dasteht. Erfinde nichts.\n\n'
  + 'EVENTS: <alle Eventnamen die du siehst, mit Komma getrennt, sonst "keins">\n'
  + 'GEWINNENDE_FAMILIE: <Name, sonst "steht nicht da">\n'
  + 'WAPPEN: <ja, wenn zwei Familienwappen mit Spielerzahlen zu sehen sind, sonst nein>';

const PROMPT_OCR = 'Lies allen Text im Bild ab.';

// Zweiter Schritt fuer Kevins Idee: qwen3.5:9b bekommt NUR den OCR-Text, kein
// Bild mehr - reines Textverstehen, keine Bildverarbeitung nebenbei.
function promptVerstand(ocrText) {
  return 'Das ist Text, den ein OCR-Modell aus dem oberen Rand eines '
    + 'GTA5-Grand-Screenshots abgelesen hat:\n\n"""\n' + ocrText + '\n"""\n\n'
    + 'Darin stehen Namen laufender Familien-Events, jeweils ueber einer Liste mit\n'
    + 'Familiennamen und Punktzahlen. Erfinde nichts, was nicht im Text steht.\n\n'
    + 'EVENTS: <alle Eventnamen die im Text stehen, mit Komma getrennt, sonst "keins">\n'
    + 'GEWINNENDE_FAMILIE: <Name, sonst "steht nicht da">';
}

async function frage(modell, prompt, { bildBase64, optionen = {} } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modell,
        messages: [{ role: 'user', content: prompt, ...(bildBase64 ? { images: [bildBase64] } : {}) }],
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

function eventsAus(text) {
  return findEventsInImageText(text).map((e) => e.key);
}

function urteil(gefunden, soll, wappenErkannt) {
  if (!soll) return gefunden.length ? 'falsch positiv' : 'richtig';
  if (soll === 'sk' && wappenErkannt && !gefunden.length) return 'richtig (Wappen)';
  return gefunden.includes(soll) ? 'richtig' : 'verpasst';
}

(async () => {
  const ergebnisse = { aktuell: [], hybrid: [], 'nur ocr+code': [] };

  for (const name of AUSWAHL) {
    const soll = wahrheit.get(name);
    const roh = fs.readFileSync(path.join(ORDNER, `${name}.png`));
    const schnitt = await zuschneiden(roh);
    const bild = (schnitt.ok ? schnitt.buffer : roh).toString('base64');

    console.log(`\n${name}  (soll: ${soll?.wahrheit || 'nichts'})`);

    // --- Aktuell: qwen3-vl:8b sieht das Bild und urteilt in einem Schritt.
    const alt = await frage('qwen3-vl:8b', PROMPT_ALT, { bildBase64: bild });
    const altEvents = alt.ok ? eventsAus((/EVENTS:(.*)/i.exec(alt.text) || [, ''])[1]) : [];
    const altWappen = alt.ok && /WAPPEN:\s*ja/i.test(alt.text);
    const altUrteil = alt.ok ? urteil(altEvents, soll?.wahrheit, altWappen) : 'FEHLER';
    ergebnisse.aktuell.push({ name, urteil: altUrteil, ms: alt.ms });
    console.log(`  aktuell (qwen3-vl:8b)      ${String(alt.ms).padStart(6)}ms  ${altUrteil.padEnd(16)}`);

    // --- Hybrid: glm-ocr liest, dann urteilt qwen3.5:9b NUR am Text.
    const gelesen = await frage('glm-ocr', PROMPT_OCR, { bildBase64: bild, optionen: { repeat_penalty: 1.2, num_predict: 400 } });
    let hybridUrteil = 'FEHLER';
    let hybridMs = gelesen.ms;
    let hybridEvents = [];
    let hybridWappen = false;
    if (gelesen.ok) {
      const verstand = await frage('qwen3.5:9b', promptVerstand(gelesen.text), { optionen: { num_predict: 150 } });
      hybridMs += verstand.ms;
      if (verstand.ok) {
        hybridEvents = eventsAus((/EVENTS:(.*)/i.exec(verstand.text) || [, ''])[1]);
        // glm-ocr liest nur Text - reine Wappenbilder ohne Namen/Zahlen bleiben
        // ihm zwangslaeufig verborgen. Das ist der Punkt, den dieser Test
        // pruefen soll, kein Bonus-Erkennungsweg wie im alten Vergleich.
        hybridUrteil = urteil(hybridEvents, soll?.wahrheit, false);
      }
    }
    ergebnisse.hybrid.push({ name, urteil: hybridUrteil, ms: hybridMs });
    console.log(`  hybrid (glm-ocr+qwen3.5:9b) ${String(hybridMs).padStart(6)}ms  ${hybridUrteil.padEnd(16)}`
      + `  ocr-text: ${JSON.stringify(gelesen.ok ? gelesen.text.replace(/\s+/g, ' ').trim().slice(0, 60) : gelesen.fehler)}`);

    // --- Dritter Vergleich, ohne neue Ollama-Anfrage: was der Code selbst
    // (findEventsInImageText, wie es leseEventsFrisch() heute produktiv
    // benutzt) direkt aus dem rohen OCR-Text macht - OHNE den Umweg ueber ein
    // zweites Sprachmodell dazwischen.
    const nurCodeEvents = gelesen.ok ? eventsAus(gelesen.text) : [];
    const nurCodeUrteil = gelesen.ok ? urteil(nurCodeEvents, soll?.wahrheit, false) : 'FEHLER';
    ergebnisse['nur ocr+code'].push({ name, urteil: nurCodeUrteil, ms: gelesen.ms });
    console.log(`  nur ocr+code (kein 2. LLM) ${String(gelesen.ms).padStart(6)}ms  ${nurCodeUrteil.padEnd(16)}`);
  }

  console.log('\n============================================================');
  for (const [name, liste] of Object.entries(ergebnisse)) {
    const richtig = liste.filter((e) => e.urteil.startsWith('richtig')).length;
    const zeit = Math.round(liste.reduce((s, e) => s + e.ms, 0) / liste.length);
    console.log(`${name.padEnd(10)} ${richtig}/${liste.length} richtig, im Schnitt ${zeit} ms`);
  }
  console.log('\n(Gemessen an derselben festen Stichprobe wie vergleich.js, beide mit Zuschnitt.)');
})();
