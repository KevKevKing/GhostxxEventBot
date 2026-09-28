// Prototyp/Testbaustein: rein lesende Web-Nachschlage-Funktion fuer
// Coding-Fragen. Bewusst NICHT an src/ (den echten Bot) angeschlossen - siehe
// README.md in diesem Ordner.
//
// Tavily statt DuckDuckGo (siehe README fuer den Wechselgrund): braucht einen
// API-Schluessel (TAVILY_API_KEY), aber liefert dafuer auch fuer echte
// Fehlertexte brauchbare Ergebnisse. Kostenloses Kontingent ohne Kreditkarte
// (1.000 Anfragen/Monat, Stand der Recherche).
//
// {ok, grund}-Rueckgabe wie die uebrigen Module in diesem Projekt: darf nie
// werfen, auch nicht bei einem synchronen Fehler in einer injizierten
// abrufen()-Funktion.
//
// Tavily antwortet auf Englisch. Die Antwort wird deshalb ueber das lokale
// Ollama (uebersetzung.js) ins Deutsche uebersetzt, bevor sie zurueckkommt -
// siehe README, offene Frage "englische Antwort uebersetzen oder stehen
// lassen" ist damit beantwortet: uebersetzen. Schlaegt NUR die Uebersetzung
// fehl (Tavily selbst hat funktioniert), kommt trotzdem ein Ergebnis zurueck -
// eben auf Englisch, mit einem Vermerk. Lieber eine englische Antwort als
// gar keine.

const { uebersetzeInsDeutsche } = require('./uebersetzung');

const ENDPUNKT = 'https://api.tavily.com/search';
const ZEITLIMIT_MS = 8000;

async function echtAbrufen(anfrage) {
  const antwort = await fetch(ENDPUNKT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query: anfrage, include_answer: true, max_results: 3 }),
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  });
  const daten = await antwort.json().catch(() => null);
  return { status: antwort.status, daten };
}

async function sucheCode(anfrage, { abrufen = echtAbrufen, uebersetzen = uebersetzeInsDeutsche } = {}) {
  try {
    if (!anfrage || typeof anfrage !== 'string' || !anfrage.trim()) {
      return { ok: false, grund: 'leere_anfrage' };
    }

    if (!process.env.TAVILY_API_KEY) {
      return { ok: false, grund: 'kein_api_schluessel' };
    }

    const { status, daten } = await abrufen(anfrage);

    if (status !== 200 || !daten) {
      return { ok: false, grund: 'abruf_fehlgeschlagen' };
    }

    const ersterTreffer = Array.isArray(daten.results) ? daten.results[0] : null;
    const text = daten.answer || ersterTreffer?.content || '';
    if (!text) {
      return { ok: false, grund: 'keine_antwort_gefunden' };
    }

    const uebersetzt = await uebersetzen(text).catch(() => null);

    return {
      ok: true,
      text: uebersetzt?.ok ? uebersetzt.text : text,
      quelle: ersterTreffer?.url || '',
      original: uebersetzt?.ok ? text : undefined,
    };
  } catch {
    return { ok: false, grund: 'unerwarteter_fehler' };
  }
}

module.exports = { sucheCode };
