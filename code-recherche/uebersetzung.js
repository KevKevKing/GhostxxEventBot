// Uebersetzt einen englischen Text ins Deutsche - ueber dasselbe lokale
// Ollama wie der Discord-Bot (kein externer Dienst, keine neuen Kosten).
//
// Bewusst NICHT src/ollama.js importiert, obwohl das dieselbe Aufgabe koennte:
// dieser Ordner ist isoliert wie sprachsteuerung/ (siehe README.md), kein
// Import von/nach src/. Der HTTP-Aufruf hier ist deshalb eine eigene,
// minimale Kopie desselben Musters (POST an /api/chat), nicht eine
// Abhaengigkeit auf den echten Bot-Code.
//
// {ok, grund}-Rueckgabe wie ueberall in diesem Projekt: darf nie werfen.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODELL = process.env.OLLAMA_MODELL || 'qwen3.5:9b';
const ZEITLIMIT_MS = 15000;

async function echtAbrufen(text) {
  const antwort = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODELL,
      stream: false,
      think: false,
      messages: [
        {
          role: 'system',
          content: 'Uebersetze den folgenden englischen Text ins Deutsche. '
            + 'Antworte NUR mit der Uebersetzung, ohne Einleitung, ohne Anfuehrungszeichen.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  });
  const daten = await antwort.json().catch(() => null);
  return { status: antwort.status, daten };
}

async function uebersetzeInsDeutsche(text, { abrufen = echtAbrufen } = {}) {
  try {
    const eingabe = String(text || '').trim();
    if (!eingabe) return { ok: false, grund: 'leerer_text' };

    const { status, daten } = await abrufen(eingabe);
    if (status !== 200 || !daten) {
      return { ok: false, grund: 'ollama_nicht_erreichbar' };
    }

    const uebersetzt = String(daten?.message?.content || '').trim();
    if (!uebersetzt) {
      return { ok: false, grund: 'keine_antwort' };
    }

    return { ok: true, text: uebersetzt };
  } catch {
    return { ok: false, grund: 'unerwarteter_fehler' };
  }
}

module.exports = { uebersetzeInsDeutsche };
