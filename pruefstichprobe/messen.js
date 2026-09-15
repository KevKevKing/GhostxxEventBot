// Misst, wie gut das Bildmodell die feste Stichprobe liest.
//
// FESTE Stichprobe, absichtlich: die Bilder liegen als Dateien da und die
// Wahrheit steht in wahrheit.json - von Hand nachgesehen, nicht vom Modell.
// Eine bei jedem Lauf neu gezogene Stichprobe macht zwei Zahlen unvergleichbar.
//
// Gemessen wird jeder Weg einzeln, damit man sieht, WORAN es liegt:
//   ganz      - das Originalbild, so wie der erste Anlauf es schickt
//   schnitt   - nur der obere Streifen, so wie der zweite Anlauf
//
// Das Gedaechtnis wird umgangen (ohneGedaechtnis), sonst misst man nur das,
// was frueher einmal herauskam.

process.chdir(require('path').join(__dirname, '..'));

const fs = require('fs');
const path = require('path');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { findEventsInImageText } = require('../src/logbook-events');

const ORDNER = __dirname;
const wahrheit = JSON.parse(fs.readFileSync(path.join(ORDNER, 'wahrheit.json'), 'utf8'));

async function frage(bildBase64, prompt) {
  const { chat } = require('../src/ollama');
  const { config } = require('../src/config');

  const t0 = Date.now();
  const r = await chat({
    model: config.ollamaVisionModel,
    messages: [{ role: 'user', content: prompt, images: [bildBase64] }],
    temperature: 0,
    keepAlive: config.ollamaVisionKeepAlive,
  });

  if (!r.ok) return { ok: false, error: r.error, timedOut: r.timedOut, ms: Date.now() - t0 };

  const zeilen = String(r.content || '').split(/\r?\n/);
  const feld = (name) => {
    const z = zeilen.find((x) => new RegExp(`^\\s*${name}\\s*:`, 'i').test(x));
    return z ? z.split(':').slice(1).join(':').trim() : '';
  };

  return {
    ok: true,
    events: feld('EVENTS'),
    wappen: /^ja\b/i.test(feld('WAPPEN')),
    ms: Date.now() - t0,
  };
}

function urteil(antwort, soll) {
  if (!antwort.ok) return 'FEHLER';
  const gefunden = findEventsInImageText(antwort.events).map((e) => e.key);
  if (!soll) return gefunden.length ? 'falsch positiv' : 'richtig';
  if (soll === 'sk' && antwort.wappen && !gefunden.length) return 'richtig (Wappen)';
  return gefunden.includes(soll) ? 'richtig' : 'verpasst';
}

(async () => {
  // Die Prompts aus dem echten Code holen, damit hier nichts anderes gemessen
  // wird als das, was der Bot wirklich benutzt.
  const quelle = fs.readFileSync(path.join(ORDNER, '..', 'src', 'logbook-vision.js'), 'utf8');
  const holePrompt = (name) => {
    const m = quelle.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
    return m ? m[1] : null;
  };
  const PROMPT = holePrompt('PROMPT');
  const PROMPT_STREIFEN = holePrompt('PROMPT_STREIFEN');

  if (!PROMPT || !PROMPT_STREIFEN) {
    console.log('Prompts nicht gefunden - Messung abgebrochen.');
    return;
  }

  const zaehler = { ganz: 0, schnitt: 0, zusammen: 0, gesamt: 0 };
  let zeitGanz = 0;
  let zeitSchnitt = 0;

  for (const probe of wahrheit) {
    const datei = path.join(ORDNER, `${probe.name}.png`);
    if (!fs.existsSync(datei)) continue;

    const roh = fs.readFileSync(datei);
    zaehler.gesamt += 1;

    const ganz = await frage(roh.toString('base64'), PROMPT);
    const u1 = urteil(ganz, probe.wahrheit);
    zeitGanz += ganz.ms;

    const schnitt = await zuschneiden(roh);
    const geschnitten = schnitt.ok
      ? await frage(schnitt.buffer.toString('base64'), PROMPT_STREIFEN)
      : { ok: false, error: 'Zuschnitt fehlgeschlagen', ms: 0 };
    const u2 = urteil(geschnitten, probe.wahrheit);
    zeitSchnitt += geschnitten.ms;

    if (u1.startsWith('richtig')) zaehler.ganz += 1;
    if (u2.startsWith('richtig')) zaehler.schnitt += 1;
    // So laeuft es im Bot: erst ganz, bei Fehlanzeige der Schnitt.
    if (u1.startsWith('richtig') || u2.startsWith('richtig')) zaehler.zusammen += 1;

    console.log(`\n${probe.name}  (soll: ${probe.wahrheit || 'nichts'})`);
    console.log(`  ${probe.notiz}`);
    console.log(`  ganz    ${String(ganz.ms).padStart(6)}ms  ${u1.padEnd(16)} las: ${JSON.stringify(ganz.ok ? ganz.events : ganz.error)}${ganz.wappen ? ' +Wappen' : ''}`);
    console.log(`  schnitt ${String(geschnitten.ms).padStart(6)}ms  ${u2.padEnd(16)} las: ${JSON.stringify(geschnitten.ok ? geschnitten.events : geschnitten.error)}${geschnitten.wappen ? ' +Wappen' : ''}`);
  }

  const n = zaehler.gesamt;
  console.log('\n============================================================');
  console.log(`Stichprobe: ${n} Bilder`);
  console.log(`  nur ganzes Bild : ${zaehler.ganz}/${n}   (im Schnitt ${Math.round(zeitGanz / n)} ms)`);
  console.log(`  nur Zuschnitt   : ${zaehler.schnitt}/${n}   (im Schnitt ${Math.round(zeitSchnitt / n)} ms)`);
  console.log(`  beides wie im Bot: ${zaehler.zusammen}/${n}`);
})();
