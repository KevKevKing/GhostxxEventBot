const { check, equal, finish, section } = require('./lib');
const { artVon, warnungen } = require('../src/dashboard-daten');
const { beendeLauf, laufStand, meldeFortschritt, starteLauf } = require('../src/lauf-stand');
const { seite } = require('../src/dashboard-seite');
const { laufzeitText, systemWerte } = require('../src/system-werte');

// Das Dashboard ist ein Fenster, kein Hebel: es liest nur. Deshalb wird hier
// geprueft, dass es die Lage richtig LIEST - nicht, dass es etwas tut.

section('Woher eine Anmeldung kommt');
// Drei Wege, drei Aussehen: der Zeitplaner, ein Mensch mit /event erstellen,
// und die staatlichen Meldungen.
equal('geplant', artVon({ createdBy: 'scheduler', title: '40er' }), 'Geplant');
equal('selbst erstellt', artVon({ createdBy: '286819354589265920', title: 'FamWar' }), 'Selbst erstellt');
equal('Angriff', artVon({ kind: 'state', stateType: 'attack' }), 'Angriff');
equal('Verteidigung', artVon({ kind: 'state', stateType: 'defense' }), 'Verteidigung');

section('Der Stand eines Laufs');
starteLauf(34);
let s = laufStand();
check('laeuft', s.laeuft);
equal('gesamt', s.gesamt, 34);
equal('noch nichts fertig', s.fertig, 0);
equal('keine Hochrechnung ohne Fortschritt', s.restSek, null);

meldeFortschritt({ fertig: 17, bilder: 80, zugestellt: 9 });
s = laufStand();
equal('die Haelfte', s.fertig, 17);
equal('Bilder', s.bilder, 80);
check('Restzeit wird geschaetzt', s.restSek !== null);

beendeLauf();
s = laufStand();
check('nicht mehr am Laufen', !s.laeuft);
check('Ende vermerkt', Boolean(s.beendet));
equal('keine Restzeit mehr', s.restSek, null);

section('Wovor gewarnt wird');
const stiller = { guilds: { cache: new Map() } };

(async () => {
  const ollamaWeg = await warnungen(stiller, {
    anmeldungen: [],
    technikStand: { erreichbar: false, knapp: false, modelle: [] },
  });
  check('Ollama weg ist rot', ollamaWeg.some((w) => w.stufe === 'rot' && /Ollama/.test(w.text)));

  // Wichtig: gemeint ist NUR, wenn etwas anderes die Karte belegt. Ghostxx'
  // eigenes Modell zaehlt nicht - genau den Fehler hatte ich schon einmal
  // gemacht und behauptet, seine Grafikkarte sei blockiert.
  const kartevoll = await warnungen(stiller, {
    anmeldungen: [],
    technikStand: { erreichbar: true, knapp: true, modelle: [] },
  });
  check('fremd belegte Grafikkarte ist gelb', kartevoll.some((w) => w.stufe === 'gelb' && /Grafikkarte/.test(w.text)));
  check('  nennt GTA als Grund', kartevoll.some((w) => /GTA/.test(w.text)), JSON.stringify(kartevoll));

  const eigenesModell = await warnungen(stiller, {
    anmeldungen: [],
    technikStand: { erreichbar: true, knapp: false, modelle: [{ name: 'qwen3.5:9b', vramGb: 6.6 }] },
  });
  equal('eigenes Modell ist keine Warnung', eigenesModell.length, 0);

  // Fast voll und schliesst gleich - genau der Fall, in dem ein Nachzuegler
  // den Unterschied macht.
  const knapp = await warnungen(stiller, {
    anmeldungen: [{ titel: '40er', dabei: 8, max: 10, anteil: 0.8, schliesstIn: 4, offenSeitStunden: 0 }],
    technikStand: { erreichbar: true, knapp: false, modelle: [] },
  });
  check('knappe Anmeldung', knapp.some((w) => /2 fehlen noch/.test(w.text)), JSON.stringify(knapp));

  // Eine halb leere Anmeldung ist kein Notfall - da bewirkt Anstupsen nichts.
  const leer = await warnungen(stiller, {
    anmeldungen: [{ titel: '40er', dabei: 2, max: 10, anteil: 0.2, schliesstIn: 4, offenSeitStunden: 0 }],
    technikStand: { erreichbar: true, knapp: false, modelle: [] },
  });
  equal('leere Anmeldung nicht', leer.length, 0);

  // Selbst erstellte Anmeldungen haben kein closeAt. Fuenf davon standen
  // wochenlang offen, ohne dass es jemand gemerkt hat.
  const vergessen = await warnungen(stiller, {
    anmeldungen: [{ titel: 'FamWar', dabei: 9, max: 15, anteil: 0.6, schliesstIn: null, offenSeitStunden: 200 }],
    technikStand: { erreichbar: true, knapp: false, modelle: [] },
  });
  check('vergessene Anmeldung', vergessen.some((w) => /offen/.test(w.text)), JSON.stringify(vergessen));

  const frisch = await warnungen(stiller, {
    anmeldungen: [{ titel: 'FamWar', dabei: 9, max: 15, anteil: 0.6, schliesstIn: null, offenSeitStunden: 3 }],
    technikStand: { erreichbar: true, knapp: false, modelle: [] },
  });
  equal('frische nicht', frisch.length, 0);

  section('Fuenf gleiche Warnungen werden eine');
  // Im ersten Anlauf standen fuenf FamWar-Zeilen untereinander und haben den
  // halben Bildschirm gefuellt.
  const fuenfOffen = Array.from({ length: 5 }, (_, i) => ({
    titel: 'FamWar', dabei: 9, max: 15, anteil: 0.6, schliesstIn: null, offenSeitStunden: 72 + i * 48,
  }));
  const zusammen = await warnungen(stiller, {
    anmeldungen: fuenfOffen,
    technikStand: { erreichbar: true, knapp: false, modelle: [] },
  });
  equal('nur eine Zeile', zusammen.length, 1);
  check('nennt die Anzahl', /5 Anmeldungen/.test(zusammen[0].text), zusammen[0].text);
  check('nennt den aeltesten', /11 Tagen/.test(zusammen[0].text), zusammen[0].text);

  section('Die Seite');
  const html = seite();
  check('ist HTML', html.startsWith('<!doctype html>'));
  // Kevins vier Bereiche: Terminal, Discord, Kopf, Laeufe - dazu Logbuch,
  // Fehler und Warnungen. Zwei davon hatte ich beim ersten Mal vergessen.
  check('hat alle Bereiche', ['anmeldungen', 'logbuch', 'lauf', 'fehler', 'warnungen', 'steuerung',
    'terminal', 'aktivitaet', 'bilder', 'leiste', 'ring']
    .every((id) => html.includes(`id="${id}"`)));

  section('Pause-Knopf fuers Bildlesen');
  // Kevins eigener Knopf: nur das Bildlesen haelt an, Chat und Events nicht.
  check('ruft den eigenen Weg auf, nicht /api/antwort', html.includes('/api/bilder-pause'));
  check('Knopf-Text sagt, was ein Klick als naechstes tut', html.includes('Bildlesen pausieren') && html.includes('Bildlesen fortsetzen'));

  section('Bestand und Chronik sind zweierlei');
  // Kevins Rechnung ging nicht auf: 80 Bilder in den Tickets, aber 82 gelesen,
  // 4 unlesbar und 8 in der Schlange. Drei Toepfe unter einer Ueberschrift.
  // Jetzt steht der Bestand oben - alles andere ist eine Teilmenge davon - und
  // die Chronik darunter, mit dazugeschriebenem "seit es ihn gibt".
  check('Bestand in Tickets', html.includes('unbezahlte Nachweise in'));
  check('  als Teilmengen', html.includes('ausgewertet') && html.includes('noch nicht angesehen'));
  check('Chronik getrennt benannt', html.includes('seit es ihn gibt'));

  section('Ruhebildschirm');
  // Seit 20.08.: Kevins eigenes Waldfoto (ChatGPT) als Daten-URI statt
  // Sternenhimmel - immer noch eine einzige Datei, laedt nichts nach.
  // Der Regen wird einmal gestreut und danach nur von CSS bewegt, kein
  // Zeitgeber, keine Schleife.
  check('gibt es', html.includes('id="ruhe"'));
  check('mit echtem Waldfoto', html.includes("const WALDFOTO = 'data:image/webp;base64,"));
  check('und dem Gruss', html.includes('HELLO GHOST MUFFIN'));
  check('Regen nur einmal gestreut', html.includes('regenStreuen'));
  check('Regen mit Tiefenschaerfe', html.includes('const tiefe = Math.random()'));
  check('Regen faellt', html.includes('@keyframes fallen'));
  // Kevins ausdruecklicher Wunsch (19./20.08.): der Regen ist der Zweck der
  // Szene und bleibt auch bei reduzierter Bewegung an - anders als der Rest
  // der Seite, siehe unten "Rücksicht auf reduzierte Bewegung".
  check('Regen ignoriert reduzierte Bewegung', !/prefers-reduced-motion[\s\S]{0,200}\.tropfen/.test(html));
  check('Uhr', html.includes('id="ruheuhr"'));
  check('schläft nach 10 Minuten wieder ein', html.includes('10 * 60 * 1000'));

  // Kein Knopf auf dem Ruhebildschirm: ein Klick irgendwohin weckt ihn.
  // Zurueck in den Schlaf geht es ueber den Kern - nirgends angeschrieben.
  check('kein Weckknopf', !html.includes('id="wecken"'));
  check('Klick irgendwohin weckt', html.includes("$('ruhe').addEventListener('click', aufwachen)"));
  check('Kern schickt schlafen', html.includes("$('ring').addEventListener('click', schlafen)"));

  section('Hintergrund');
  // Der Ruhebildschirm hat seit 20.08. ein echtes Foto, als Daten-URI direkt
  // im Skript - die Seite bleibt trotzdem eine einzige Datei und laedt
  // nichts uebers Netz nach. Der Rest (Dashboard-Nebel, Raster) ist CSS.
  check('Nebelschleier', html.includes('@keyframes nebel'));
  check('Raster', html.includes('background-size: 32px 32px'));
  check('kein externer Netzwerk-Ladepfad', !/url\(\s*['"]?https?:/i.test(html));
  check('Rücksicht auf reduzierte Bewegung', html.includes('prefers-reduced-motion'));

  section('Echte Messwerte');
  // Nichts in der Statusleiste ist geschaetzt - was sich nicht auslesen
  // laesst, steht auch nicht da.
  const werte = await systemWerte(null);
  check('CPU-Kerne', werte.kerne > 0, String(werte.kerne));
  check('RAM gemessen', werte.ramGesamtGb > 0 && werte.ramBelegtGb > 0, JSON.stringify(werte.ramBelegtGb));
  check('Laufzeit', /\d/.test(werte.laufzeit), werte.laufzeit);
  check('ohne Client kein Ping', werte.pingMs === null);
  check('Verlauf wird gefuehrt', Array.isArray(werte.verlauf.cpu));

  // Die Grafikkarte kann fehlen - dann steht sie eben nicht da, statt einer
  // ausgedachten Zahl.
  check('Grafikkarte oder ehrlich nichts',
    werte.gpu === null || (werte.gpu.vramGesamtMb > 0 && werte.gpu.last >= 0),
    JSON.stringify(werte.gpu));
  check('Platte oder ehrlich nichts',
    werte.disk === null || werte.disk.gesamtGb > 0, JSON.stringify(werte.disk));

  equal('Laufzeit in Minuten', laufzeitText(90), '1m');
  equal('  in Stunden', laufzeitText(3700), '1h 1m');
  equal('  in Tagen', laufzeitText(90000), '1d 1h 0m');
  // Namen und Spielernummern kommen aus Discord - die duerfen nicht als HTML
  // ausgefuehrt werden, nur angezeigt.
  check('maskiert fremden Text', html.includes('replace(/[<>&]/g'));

  finish();
})();
