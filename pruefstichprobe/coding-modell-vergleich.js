// Vergleicht drei lokale Coding-Modelle an zwei echten Aufgaben aus diesem
// Projekt - Kevins Frage (16.09.): welches Modell passt neben 9b+OCR.
//
// Sequentiell, nicht parallel - GPU-Nebenlaeufigkeit verfaelscht die Zeiten
// (dasselbe Prinzip wie bei jedem anderen Modellvergleich in diesem Ordner).
// Laeuft waehrend der echte Bot mitlaeuft - kurze GPU-Konkurrenz moeglich,
// bewusst in Kauf genommen und hier vermerkt.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const OLLAMA = 'http://127.0.0.1:11434';
const MODELLE = ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'codellama:latest'];

const AUFGABE_VERSTEHEN = `Hier ist eine Funktion aus einem echten Discord-Bot-Projekt (JavaScript). Erklaere in maximal 4 Saetzen auf Deutsch, was der Unterschied zwischen den Rueckgabewerten undefined, null und true/false bei eintrag.verified fuer die Funktion istGewertet() bedeutet - speziell: warum zaehlt "null" NICHT, obwohl das Bild geprueft wurde?

function istGewertet(eintrag) {
  if (!eintrag.images.length) return false;
  if (eintrag.doppelVon) return false;
  if (eintrag.zeitDoppelVon) return false;
  const event = eintrag.claim.event || eintrag.eventFromImage;
  if (!event || !eintrag.claim.result) return false;
  // eintrag.verified: undefined = nicht geprueft, gilt Text.
  //                   null = geprueft, aber kein Urteil (unlesbar).
  //                   true = bestaetigt, false = widerlegt.
  if (eintrag.verified === false) return false;
  if (eintrag.verified === null) return true; // zaehlt trotzdem, als unklar markiert
  return true;
}`;

const AUFGABE_SCHREIBEN = `Schreibe eine JavaScript-Funktion "nurMenschen(overwrites, guild)".
overwrites ist eine Map von Discord-Kanalrechten (jeder Eintrag hat .type und .id).
guild.members.cache ist eine Map von Mitgliedern (jedes Mitglied hat .user.bot als Boolean).
Die Funktion soll nur die IDs zurueckgeben, die: Typ "member" sind (OverwriteType.Member = 1),
sich im guild.members.cache aufloesen lassen, UND kein Bot sind (m.user.bot === false).
Nur die Funktion, kein Text drumherum, kein Markdown-Codeblock.`;

async function frage(modell, prompt) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(180000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modell,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - t0, fehler: `HTTP ${res.status}` };
    const d = await res.json();
    return { ok: true, ms: Date.now() - t0, text: d.message?.content || '' };
  } catch (error) {
    return { ok: false, ms: Date.now() - t0, fehler: error.message };
  }
}

(async () => {
  for (const modell of MODELLE) {
    console.log(`\n============================================================`);
    console.log(`${modell}`);
    console.log(`============================================================`);

    const gpu1 = await fetch(`${OLLAMA}/api/ps`).then((r) => r.json()).catch(() => null);
    console.log('VRAM vor dem Test:', JSON.stringify((gpu1?.models || []).map((m) => `${m.name}: ${Math.round(m.size_vram / 1e6)}MB`)));

    console.log('\n--- Aufgabe 1: Verstehen ---');
    const a1 = await frage(modell, AUFGABE_VERSTEHEN);
    console.log(`${a1.ms}ms`, a1.ok ? '' : a1.fehler);
    if (a1.ok) console.log(a1.text.trim());

    console.log('\n--- Aufgabe 2: Schreiben ---');
    const a2 = await frage(modell, AUFGABE_SCHREIBEN);
    console.log(`${a2.ms}ms`, a2.ok ? '' : a2.fehler);
    if (a2.ok) console.log(a2.text.trim());
  }
  console.log('\nFertig.');
})();
