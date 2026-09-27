const https = require('node:https');

// Prototyp/Testbaustein: rein lesende Web-Nachschlage-Funktion fuer
// Coding-Fragen. Bewusst NICHT an src/ (den echten Bot) angeschlossen - siehe
// README.md in diesem Ordner. Keine Anmeldedaten noetig: DuckDuckGos Instant-
// Answer-API ist ohne Konto/Schluessel nutzbar, liefert dafuer nur kurze
// Zusammenfassungen statt vollstaendiger Suchergebnisse.
//
// {ok, grund}-Rueckgabe wie die uebrigen Module in diesem Projekt: darf nie
// werfen, auch nicht bei einem synchronen Fehler in einer injizierten
// abrufen()-Funktion.

const ZEITLIMIT_MS = 5000;

function echtAbrufen(url) {
  return new Promise((resolve, reject) => {
    const anfrage = https.get(url, { timeout: ZEITLIMIT_MS }, (antwort) => {
      let inhalt = '';
      antwort.on('data', (teil) => { inhalt += teil; });
      antwort.on('end', () => resolve({ status: antwort.statusCode, inhalt }));
    });
    anfrage.on('timeout', () => anfrage.destroy(new Error('Zeitlimit ueberschritten')));
    anfrage.on('error', reject);
  });
}

async function sucheCode(anfrage, { abrufen = echtAbrufen } = {}) {
  try {
    if (!anfrage || typeof anfrage !== 'string' || !anfrage.trim()) {
      return { ok: false, grund: 'leere_anfrage' };
    }

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(anfrage)}&format=json&no_html=1&skip_disambig=1`;
    const antwort = await abrufen(url);

    if (!antwort || antwort.status !== 200) {
      return { ok: false, grund: 'abruf_fehlgeschlagen' };
    }

    let daten;
    try {
      daten = JSON.parse(antwort.inhalt);
    } catch {
      return { ok: false, grund: 'antwort_nicht_lesbar' };
    }

    const text = daten.AbstractText || daten.Answer || '';
    if (!text) {
      return { ok: false, grund: 'keine_antwort_gefunden' };
    }

    return {
      ok: true,
      text,
      quelle: daten.AbstractURL || '',
    };
  } catch {
    return { ok: false, grund: 'unerwarteter_fehler' };
  }
}

module.exports = { sucheCode };
