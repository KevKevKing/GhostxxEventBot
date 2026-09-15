const { check, finish, ollamaAvailable, section } = require('./lib');
const { askModel, toIntent } = require('../src/model-intent');

// Zwei verschiedene Dinge in einer Datei, und der Unterschied ist wichtig:
//
//  Teil 1 PRUEFT den Code - die Umwandlung einer Modellantwort in eine
//         Absicht. Laeuft ohne Ollama, ist jedes Mal gleich, und rot heisst
//         hier wirklich "kaputt".
//
//  Teil 2 MISST das Modell - wie gut faengt es Saetze auf, die der feste
//         Parser nicht kennt. Ergebnis ist eine Zahl, kein Urteil.
//
// Der feste Parser selbst steht in intent-parser.js und hat seine eigene
// Testdatei. Er erledigt die Saetze aus Teil 2 alle ohne Ollama - das Modell
// ist nur das Netz darunter.

section('Werkzeugaufruf zu Absicht');
const swap = toIntent({ function: { name: 'tausche_teilnehmer', arguments: { event: '40er', raus: 'GhostMuffiin', rein: 'Pascal' } } });
check('Tausch', swap?.action === 'swap' && swap.out === 'GhostMuffiin' && swap.in === 'Pascal', JSON.stringify(swap));
check('  gilt als geraten', swap?.source === 'model');

const add = toIntent({ function: { name: 'trage_ein', arguments: { spieler: 'Max', auswechselspieler: true } } });
check('Eintragen als Ersatz', add?.action === 'add' && add.substitute === true, JSON.stringify(add));
check('  ohne Event -> aus dem Kontext', add?.needsEvent === true);

// Modelle geben gern Platzhalter zurueck, statt das Feld wegzulassen.
const platzhalter = toIntent({ function: { name: 'trage_ein', arguments: { event: 'null', spieler: 'Max' } } });
check('"null" als Event wird verworfen', platzhalter?.needsEvent === true, JSON.stringify(platzhalter));
check('unvollstaendiger Tausch -> null', toIntent({ function: { name: 'tausche_teilnehmer', arguments: { raus: 'A' } } }) === null);
check('unbekanntes Werkzeug -> null', toIntent({ function: { name: 'irgendwas', arguments: {} } }) === null);

const SYSTEM = `Du bist Ghostxx, ein Bot einer deutschen GTA-Roleplay-Community.
Bittet dich jemand, einen Spieler einzutragen, auszutragen oder zu tauschen,
benutze das passende Werkzeug. Namen gibst du genau so weiter, wie sie
geschrieben wurden. Wurde kein Event genannt, lass das Feld leer.
Bei allem anderen antworte einfach kurz auf Deutsch, ohne Werkzeug.`;

(async () => {
  if (!(await ollamaAvailable())) {
    console.log('\nOllama laeuft nicht - Modelltests uebersprungen.');
    finish();
    return;
  }

  // Erst aufwaermen. Wechselt Ollama gerade das Modell, dauert das Laden von
  // mehreren Gigabyte - Anfragen dazwischen laufen in eine Zeitueberschreitung
  // und der Test waere rot, obwohl am Code nichts kaputt ist.
  const { getFreeVramMb, warmUp } = require('../src/ollama');
  const warm = await warmUp();

  if (!warm.ok) {
    // Bei laufendem Spiel bleiben teils unter 300 MiB frei. Dann kann Ollama
    // kein Modell laden und antwortet mit 500 - das ist die Umgebung, nicht
    // der Code. Ein rot blinkender Test dafuer hilft niemandem.
    const frei = await getFreeVramMb();
    console.log(`\nModell nicht ladbar (${frei ?? '?'} MiB frei) - Modelltests uebersprungen.`);
    finish();
    return;
  }

  console.log(`\n(Modell ${warm.model} aufgewaermt)`);

  // ---- Ab hier wird gemessen, nicht geprueft -------------------------------
  //
  // Das Folgende fragt das ECHTE Modell und ist deshalb kein Test im ueblichen
  // Sinn. Es prueft nicht, ob der Code stimmt - der feste Parser in
  // intent-parser.js erledigt genau diese Saetze ohne Ollama und ist eine
  // Zeile weiter oben mitgetestet. Hier geht es nur darum, wie gut das
  // AUFFANGNETZ ist, wenn jemand etwas schreibt, das der Parser nicht kennt.
  //
  // Warum das keine Haken bekommt:
  //
  // Ein Sprachmodell antwortet nicht jedes Mal gleich. Diese Datei wurde
  // dadurch etwa jeden zweiten Lauf rot, ohne dass sich eine Zeile Code
  // geaendert hatte. Ich habe daraufhin einmal so lange wiederholt, bis es
  // gruen war, und das als "beim zweiten Lauf gruen" gemeldet - genau die
  // Gewoehnung, vor der ein flackernder Test schuetzen soll.
  //
  // Rot muss "du hast etwas kaputtgemacht" heissen. Solange es manchmal
  // "das Modell hatte einen schlechten Moment" heisst, klickt man es weg -
  // und irgendwann klickt man auch das echte Rot der 35 anderen Dateien weg.
  //
  // Deshalb steht hier eine Zahl statt eines Urteils. Faellt sie unter die
  // Haelfte, ist wirklich etwas kaputt, und dann wird es doch rot.
  section('Messung: wie gut faengt das Modell auf?');

  const faelle = [
    ['tausch im 40er den GhostMuffiin gegen Pascal', 'swap'],
    ['trag Pascal beim 50er ein', 'add'],
    ['nimm Johannes aus dem Bank-Event raus', 'remove'],
    ['hey wie gehts dir?', null],
  ];

  let richtig = 0;
  let befragt = 0;
  let zeit = 0;

  for (const [text, erwartet] of faelle) {
    // Bei knappem Grafikspeicher entlaedt Ollama zwischendurch und antwortet
    // dann mit 500. Der Bot faengt das mit Wiederholungen ab - hier wird
    // dasselbe getan.
    let r = await askModel({ system: SYSTEM, text });
    if (!r.ok) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      r = await askModel({ system: SYSTEM, text });
    }

    if (!r.ok) {
      console.log(`  ohne Antwort  "${text}" - Ollama nicht ansprechbar (${r.error})`);
      continue;
    }

    befragt += 1;
    zeit += r.ms;

    const got = r.intent?.action || null;
    const passt = got === erwartet;
    if (passt) richtig += 1;

    console.log(`  ${passt ? 'richtig' : 'DANEBEN'}  ${String(r.ms).padStart(6)}ms  `
      + `${(got || 'chat').padEnd(7)} ${passt ? '' : `(erwartet ${erwartet || 'chat'}) `}"${text}"`);
  }

  if (!befragt) {
    console.log('\n  Ollama hat gar nicht geantwortet - nichts zu messen.');
    finish();
    return;
  }

  const schnitt = Math.round(zeit / befragt);
  console.log(`\n  ERGEBNIS: ${richtig} von ${befragt} richtig, im Schnitt ${schnitt} ms.`);
  console.log('  (Das misst das Modell, nicht den Code. Schwankt von Lauf zu Lauf.)');

  // Die einzige Grenze, ab der es wirklich rot wird. Unter der Haelfte ist es
  // kein schlechter Tag mehr - dann ist das Modell weg, falsch eingestellt
  // oder der Prompt zerschossen.
  section('Ist das Auffangnetz noch da?');
  check(`mehr als die Haelfte richtig (${richtig}/${befragt})`, richtig * 2 > befragt);

  finish();
})();
