// Beide Modelle ueber ein ECHTES Ticket laufen lassen.
//
// Die Wahrheit steht hier im Text des Beitrags ("40er Win"), den der Mensch
// selbst geschrieben hat. Gemessen wird also: findet das Modell im Bild das
// Event wieder, das der Mensch angegeben hat?
//
// Das ist naeher am Alltag als die Stichprobe mit den fuenf Problemfaellen -
// dort waren absichtlich nur schwere Bilder drin.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const { config } = require('../src/config');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { findEventsInImageText, findEventInText } = require('../src/logbook-events');

const TICKET = process.argv[2] || '1536445726689595465';
const OLLAMA = 'http://127.0.0.1:11434';

const PROMPT_ALT = 'Das ist der obere Rand eines GTA5-Grand-Screenshots.\n\n'
  + 'Hier stehen die Namen laufender Familien-Events, jeweils ueber einer Liste mit\n'
  + 'Familiennamen und Punktzahlen. Es koennen mehrere gleichzeitig sein.\n\n'
  + 'Lies ab, was dasteht. Erfinde nichts.\n\n'
  + 'EVENTS: <alle Eventnamen die du siehst, mit Komma getrennt, sonst "keins">\n'
  + 'GEWINNENDE_FAMILIE: <Name, sonst "steht nicht da">\n'
  + 'WAPPEN: <ja, wenn zwei Familienwappen mit Spielerzahlen zu sehen sind, sonst nein>';

const PROMPT_OCR = 'Lies allen Text im Bild ab.';

async function frage(modell, bild, prompt, optionen = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: modell,
        messages: [{ role: 'user', content: prompt, images: [bild] }],
        stream: false,
        options: { temperature: 0, ...optionen },
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
  const msgs = await fetch(`https://discord.com/api/v10/channels/${TICKET}/messages?limit=100`, {
    headers: { Authorization: `Bot ${config.token}` },
  }).then((r) => r.json());

  const beitraege = msgs
    .filter((m) => !m.author?.bot && (m.attachments || []).length)
    .reverse();

  console.log(`${beitraege.length} Nachweise\n`);

  const zaehler = { alt: 0, neu: 0, beide: 0, keiner: 0 };
  let zeitAlt = 0;
  let zeitNeu = 0;

  for (const m of beitraege) {
    const angegeben = findEventInText(m.content || '');
    const anhang = m.attachments[0];

    const roh = Buffer.from(await fetch(anhang.url).then((r) => r.arrayBuffer()));
    const schnitt = await zuschneiden(roh);
    const bild = (schnitt.ok ? schnitt.buffer : roh).toString('base64');

    const alt = await frage('qwen3-vl:8b', bild, PROMPT_ALT);
    const altText = alt.ok ? (/EVENTS:(.*)/i.exec(alt.text) || [, ''])[1] : '';
    const altTreffer = findEventsInImageText(altText).some((e) => e.key === angegeben?.key);
    zeitAlt += alt.ms;

    const neu = await frage('glm-ocr', bild, PROMPT_OCR, { repeat_penalty: 1.2, num_predict: 400 });
    const neuTreffer = neu.ok && findEventsInImageText(neu.text).some((e) => e.key === angegeben?.key);
    zeitNeu += neu.ms;

    if (altTreffer) zaehler.alt += 1;
    if (neuTreffer) zaehler.neu += 1;
    if (altTreffer && neuTreffer) zaehler.beide += 1;
    if (!altTreffer && !neuTreffer) zaehler.keiner += 1;

    const zeichen = (t) => (t ? '✓' : '·');
    console.log(`"${(m.content || '').slice(0, 12).padEnd(12)}"  qwen ${zeichen(altTreffer)} ${String(alt.ms).padStart(6)}ms   glm ${zeichen(neuTreffer)} ${String(neu.ms).padStart(5)}ms`);
    if (!altTreffer || !neuTreffer) {
      console.log(`      qwen las: ${JSON.stringify(altText.trim().slice(0, 60))}`);
      console.log(`      glm  las: ${JSON.stringify((neu.text || '').replace(/\s+/g, ' ').trim().slice(0, 60))}`);
    }
  }

  const n = beitraege.length;
  console.log('\n============================================================');
  console.log(`qwen3-vl:8b   ${zaehler.alt}/${n} gefunden, im Schnitt ${Math.round(zeitAlt / n)} ms`);
  console.log(`glm-ocr       ${zaehler.neu}/${n} gefunden, im Schnitt ${Math.round(zeitNeu / n)} ms`);
  console.log(`beide         ${zaehler.beide}/${n}`);
  console.log(`keiner        ${zaehler.keiner}/${n}`);
})();
