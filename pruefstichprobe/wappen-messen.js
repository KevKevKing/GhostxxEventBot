// Kevins fuenf echte SK-Wappen-Screenshots durch glm-ocr (mit Zuschnitt) -
// um zu sehen, welches Textmuster die zwei Familienwappen zuverlaessig
// erkennt, BEVOR irgendeine Regel geschrieben wird.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const { zuschneiden } = require('../src/bild-zuschnitt');

const BILDER = [
  'Screenshot 2026-08-17 042452.png',
  'Screenshot 2026-08-17 042509.png',
  'Screenshot 2026-08-17 042520.png',
  'Screenshot 2026-08-17 042528.png',
  'Screenshot 2026-08-17 042539.png',
];

async function lies(bildBase64) {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: 'glm-ocr',
      messages: [{ role: 'user', content: 'Lies allen Text im Bild ab.', images: [bildBase64] }],
      stream: false,
      options: { temperature: 0, repeat_penalty: 1.2, num_predict: 500 },
    }),
  });
  const d = await res.json();
  return d.message?.content || '';
}

(async () => {
  for (const name of BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const schnitt = await zuschneiden(roh);
    const bild = (schnitt.ok ? schnitt.buffer : roh).toString('base64');
    const text = await lies(bild);
    console.log(`\n${name}`);
    console.log(`  ${JSON.stringify(text.replace(/\s+/g, ' ').trim())}`);
  }
})();
