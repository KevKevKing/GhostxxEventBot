require('dotenv').config();

// Eigenstaendige Ollama-Anbindung fuer die Sprachsteuerung - bewusst KEIN
// Import aus src/ollama.js (sprachsteuerung/ darf nie vom Bot-Code
// abhaengen). Dieselbe Modellwahl-Logik wie src/ollama.js's pickModel()
// (60%-GPU-Schwelle), aber unabhaengiger Code.

const GPU_SCHWELLE = 0.6;

// Kurze, gesprochen-taugliche Antworten: eine lange Textantwort liest sich
// schlecht vor, und niemand will einer Sprachausgabe fuenf Saetze zuhoeren,
// die man eigentlich nur ueberfliegen wuerde.
const SYSTEM_PROMPT = 'Du bist Ghostxx, ein deutschsprachiger Assistent. '
  + 'Deine Antworten werden laut vorgelesen, deshalb: kurz (1-2 Saetze), '
  + 'keine Aufzaehlungen, keine Formatierung, keine Emojis, normal '
  + 'gesprochene Sprache statt Schriftsprache.';

async function pickModel({ fetchImpl = fetch } = {}) {
  const gross = process.env.OLLAMA_MODELL;
  const klein = process.env.OLLAMA_MODELL_KLEIN;

  try {
    const res = await fetchImpl(`${process.env.OLLAMA_URL}/api/ps`);
    if (!res.ok) return gross;
    const daten = await res.json();
    const geladen = (daten.models || []).find((m) => m.name === gross);
    if (!geladen || !geladen.size) return gross;

    const anteil = geladen.size_vram / geladen.size;
    return anteil < GPU_SCHWELLE ? klein : gross;
  } catch {
    // Nicht erreichbar - der eigentliche Fehler zeigt sich gleich beim
    // Chat-Aufruf selbst, hier optimistisch beim grossen Modell bleiben.
    return gross;
  }
}

async function antworte(text, { fetchImpl = fetch } = {}) {
  const modell = await pickModel({ fetchImpl });

  let res;
  try {
    res = await fetchImpl(`${process.env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modell,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    });
  } catch {
    return { ok: false, grund: 'nicht_erreichbar' };
  }

  if (!res.ok) return { ok: false, grund: 'nicht_erreichbar' };

  const daten = await res.json();
  const antwortText = String(daten.message?.content || '').trim();
  if (!antwortText) return { ok: false, grund: 'leer' };

  return { ok: true, text: antwortText };
}

module.exports = { antworte, pickModel };
