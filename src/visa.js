const { config } = require('./config');
const { chat } = require('./ollama');

// Liest Pass-Screenshots aus dem Abstimmungskanal.
//
// Der Bot gibt nur eine unverbindliche Einschaetzung ab und stimmt niemals
// selbst ab. Was er nicht sicher lesen kann, meldet er als unsicher, statt eine
// Zahl zu erfinden - bei Bewerbungen echter Leute ist Raten das schlimmste
// Ergebnis.

const { readSettings } = require('./bot-settings');

const PROMPT = `Du liest einen Screenshot eines Ingame-Reisepasses.

Lies genau diese Werte ab und gib NUR JSON zurück, ohne Erklärung:
{"name":"<Name links, Vor- und Nachname>","visum":<Zahl aus "ANGEKOMMEN IM STAAT VOR X JAHREN">,"id":<Zahl aus "REISEPASSNUMMER">}

Regeln:
- "visum" ist die Jahreszahl aus "ANGEKOMMEN IM STAAT VOR ... JAHREN".
- "id" ist die REISEPASSNUMMER.
- Kannst du einen Wert nicht sicher lesen, setze ihn auf null. Rate niemals.
- Das Feld "EHEFRAU" ist egal.`;

function parseModelJson(content) {
  const text = String(content || '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** Bewertet gelesene Werte gegen die aktuell gespeicherten Aufnahmeregeln. */
function judge({ visum, id }, rules) {
  const minYears = rules.visaMinYears;
  const maxId = rules.visaMaxId;
  const reasons = [];
  let verdict = 'ok';

  if (visum === null) {
    reasons.push('Visum nicht lesbar');
    verdict = 'unsicher';
  } else if (visum < minYears) {
    reasons.push(`Visum nur ${visum} Jahre (mindestens ${minYears})`);
    verdict = 'ablehnen';
  } else {
    reasons.push(`Visum ${visum} Jahre`);
  }

  if (id === null) {
    reasons.push('ID nicht lesbar');
    if (verdict !== 'ablehnen') verdict = 'unsicher';
  } else if (id > maxId) {
    reasons.push(`ID ${id} ist zu hoch (max. ${maxId})`);
    verdict = 'ablehnen';
  } else {
    reasons.push(`ID ${id}`);
  }

  return { verdict, reasons };
}

function formatVerdict(name, { verdict, reasons }) {
  const who = name ? `**${name}**` : 'Der Pass';
  const detail = reasons.join(', ');

  if (verdict === 'ablehnen') {
    return `${who}: würde ich **nicht** annehmen — ${detail}.`;
  }

  if (verdict === 'unsicher') {
    return `${who}: kann ich nicht sicher lesen — ${detail}. Schaut lieber selbst drauf.`;
  }

  return `${who}: sieht gut aus — ${detail}.`;
}

/**
 * Liest einen Pass-Screenshot und gibt eine Einschaetzung zurueck.
 * imageBase64 ohne data:-Praefix.
 */
async function analysePassport(imageBase64) {
  // Modellwahl wie beim Chat: ist die Grafikkarte frei, liest das grosse Modell
  // am genauesten. Laeuft ein Spiel, braeuchte es rund 30 Sekunden - das kleine
  // schafft dieselben Zahlen in der Haelfte. Mit VISA_FORCE_BIG_MODEL=true
  // bleibt es immer beim grossen.
  const result = await chat({
    model: config.visaForceBigModel ? config.ollamaModel : undefined,
    messages: [{ role: 'user', content: PROMPT, images: [imageBase64] }],
    temperature: 0,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const parsed = parseModelJson(result.content);
  if (!parsed) {
    return { ok: false, error: 'Antwort war kein gültiges JSON', raw: result.content };
  }

  const values = {
    name: parsed.name ? String(parsed.name).trim() : '',
    visum: toNumber(parsed.visum),
    id: toNumber(parsed.id),
  };

  const rules = await readSettings();
  const verdict = judge(values, rules);

  return {
    ok: true,
    model: result.model,
    values,
    rules,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    text: formatVerdict(values.name, verdict),
    ms: result.ms,
  };
}

module.exports = {
  analysePassport,
  formatVerdict,
  judge,
  parseModelJson,
};
