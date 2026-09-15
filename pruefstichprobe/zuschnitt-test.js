// Welcher Zuschnitt taugt am besten fuer glm-ocr?
//
// Der aktuelle nimmt ab 40 % Breite die oberen 15 %. Darin steckt viel, was
// nicht gebraucht wird: links Landschaft, rechts das Serverlogo mit ID und
// Spielerzahl. Der Eventkasten selbst ist ein schmaler Streifen dazwischen.
//
// Gemessen wird an echten Bildern aus einem Ticket, wo im Text steht, welches
// Event es sein muss. Kein Raten - die Wahrheit hat der Mensch selbst
// hingeschrieben.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const { Jimp } = require('jimp');
const { config } = require('../src/config');
const { findEventsInImageText, findEventInText } = require('../src/logbook-events');

const OLLAMA = 'http://127.0.0.1:11434';
const TICKET = process.argv[2] || '1536445726689595465';

// links/rechts/hoehe jeweils als Anteil des Originals.
const VARIANTEN = [
  { name: 'jetzt   (40-100%, 15%)', links: 0.40, rechts: 1.00, hoehe: 0.15 },
  { name: 'ohne Logo (40-85%, 12%)', links: 0.40, rechts: 0.85, hoehe: 0.12 },
  { name: 'eng     (50-85%, 10%)', links: 0.50, rechts: 0.85, hoehe: 0.10 },
  { name: 'sehr eng(55-82%, 8%)', links: 0.55, rechts: 0.82, hoehe: 0.08 },
];

async function schneide(roh, v) {
  const bild = await Jimp.read(roh);
  const b = bild.bitmap.width;
  const h = bild.bitmap.height;
  const x = Math.floor(b * v.links);
  const w = Math.max(1, Math.floor(b * v.rechts) - x);
  const hh = Math.max(1, Math.floor(h * v.hoehe));
  return bild.crop({ x, y: 0, w, h: hh }).getBuffer('image/png');
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
        options: { temperature: 0, repeat_penalty: 1.2, num_predict: 300 },
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

  const beitraege = msgs.filter((m) => !m.author?.bot && (m.attachments || []).length).reverse();
  console.log(`${beitraege.length} Nachweise, ${VARIANTEN.length} Zuschnitte\n`);

  const ergebnis = VARIANTEN.map((v) => ({ ...v, treffer: 0, ms: 0 }));

  for (const m of beitraege) {
    const soll = findEventInText(m.content || '');
    const roh = Buffer.from(await fetch(m.attachments[0].url).then((r) => r.arrayBuffer()));

    const zeile = [`"${(m.content || '').slice(0, 10).padEnd(10)}"`];

    for (const [i, v] of VARIANTEN.entries()) {
      const zugeschnitten = await schneide(roh, v);
      const r = await lies(zugeschnitten.toString('base64'));
      const treffer = r.ok && findEventsInImageText(r.text).some((e) => e.key === soll?.key);
      if (treffer) ergebnis[i].treffer += 1;
      ergebnis[i].ms += r.ms;
      zeile.push(`${treffer ? '✓' : '·'}${String(r.ms).padStart(5)}ms`);
    }

    console.log(zeile.join('  '));
  }

  const n = beitraege.length;
  console.log('\n============================================================');
  for (const e of ergebnis) {
    console.log(`${e.name.padEnd(24)} ${e.treffer}/${n}   ${Math.round(e.ms / n)} ms im Schnitt`);
  }
})();
