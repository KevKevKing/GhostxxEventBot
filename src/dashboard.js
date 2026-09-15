const http = require('node:http');
const path = require('node:path');
const { config } = require('./config');
const { stand } = require('./dashboard-daten');
const { beantworte } = require('./ghostxx-fragen');
const { seite } = require('./dashboard-seite');
const { setzePause } = require('./bild-vorablesen');
const { istAn, setzeSchalter } = require('./steuerung');
const { chat } = require('./ollama');
const { writeFileAtomic } = require('./atomic-write');

// Wo der Watchdog (run-bot.ps1) nachsieht, ob er nach dem Beenden neu
// starten soll. Ein PowerShell-Skript, kein Node-Modul - deshalb reines JSON,
// keine gemeinsame Bibliothek. Siehe AUS_KNOPF weiter unten.
const ausDatei = path.join(config.dataDir, 'bot-aus.json');

// Ein Fenster in Ghostxx' Kopf.
//
// Alles, was hier steht, weiss der Bot laengst - es lag nur an fuenf
// verschiedenen Stellen: die Anmeldungen in events.json, die Nachweise in den
// Tickets, die Grafikkarte bei Ollama, die Fehler im Log-Kanal.
//
// NUR AUF DIESEM RECHNER. Gebunden an 127.0.0.1, nicht an alle Netzwerkkarten.
// In den Daten stehen Kanal-IDs, Anzeigenamen und Spielernummern - das gehoert
// nicht ins Netz, schon gar nicht ohne Passwort. Wer die Seite sehen will,
// sitzt vor dem Rechner, auf dem der Bot laeuft.
const HOST = '127.0.0.1';

let server = null;

function startDashboard(client) {
  if (!config.dashboardPort) return null;

  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/stand') {
        const daten = await stand(client);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(daten));
        return;
      }

      // Der einzige Weg, auf dem etwas ZURUECK geht. Nur von diesem Rechner
      // erreichbar, und er kann genau eins: eine Antwort ins Gedaechtnis legen.
      if (req.url === '/api/antwort' && req.method === 'POST') {
        const roh = await new Promise((fertig) => {
          let daten = '';
          req.on('data', (stueck) => {
            daten += stueck;
            if (daten.length > 4000) req.destroy();
          });
          req.on('end', () => fertig(daten));
        });

        const { frage, antwort, id } = JSON.parse(roh || '{}');
        const ergebnis = await beantworte(frage, antwort, config.ownerId, id);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(ergebnis));
        return;
      }

      // Zweiter schreibender Weg, ganz bewusst neben /api/antwort: hier kann
      // NUR das Bildlesen an- oder ausgeschaltet werden, Chat und Events
      // haengen nicht dran. Kein Text, kein Freitext - ein Knopf, ein Zustand.
      if (req.url === '/api/bilder-pause' && req.method === 'POST') {
        const roh = await new Promise((fertig) => {
          let daten = '';
          req.on('data', (stueck) => { daten += stueck; });
          req.on('end', () => fertig(daten));
        });
        const { an } = JSON.parse(roh || '{}');
        const pausiert = await setzePause(Boolean(an));

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ pausiert }));
        return;
      }

      // Die restlichen Bereiche der Steuerzentrale. Erlaubt sind nur bekannte
      // Schalter und ein echter Wahrheitswert - kein Freitext, keine Befehle.
      if (req.url === '/api/schalter' && req.method === 'POST') {
        const roh = await new Promise((fertig) => {
          let daten = '';
          req.on('data', (stueck) => { daten += stueck; if (daten.length > 2000) req.destroy(); });
          req.on('end', () => fertig(daten));
        });
        const { key, an } = JSON.parse(roh || '{}');
        const schalter = await setzeSchalter(String(key || ''), Boolean(an));
        if (!schalter) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, schalter }));
        return;
      }

      // Der Dashboard-Chat kann nur reden. Er bekommt keine Werkzeuge und
      // kann damit weder Events noch Dateien oder Discord veraendern.
      if (req.url === '/api/chat' && req.method === 'POST') {
        const roh = await new Promise((fertig) => {
          let daten = '';
          req.on('data', (stueck) => { daten += stueck; if (daten.length > 3000) req.destroy(); });
          req.on('end', () => fertig(daten));
        });
        if (!istAn('chat')) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, text: 'Der Ghostxx-Chat ist gerade pausiert.' }));
          return;
        }
        const { text } = JSON.parse(roh || '{}');
        const frage = String(text || '').trim().slice(0, 1200);
        if (!frage) throw new Error('Keine Nachricht eingegeben.');
        const antwort = await chat({
          messages: [
            { role: 'system', content: 'Du bist Ghostxx aus der Familie Unknown. Antworte kurz, direkt und auf Deutsch. Du bist im Dashboard und kannst hier nur reden, keine Aktionen ausfuehren.' },
            { role: 'user', content: frage },
          ],
          temperature: 0.4,
          numPredict: 280,
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(antwort.ok
          ? { ok: true, text: antwort.content || 'Dazu faellt mir gerade nichts ein.' }
          : { ok: false, text: antwort.timedOut ? 'Ich brauche gerade zu lange zum Denken.' : 'Mein Kopf streikt gerade.' }));
        return;
      }

      // Dritter schreibender Weg, so eng wie die anderen beiden: kein Text,
      // keine Optionen - beendet den Prozess sauber, der Watchdog
      // (run-bot.ps1) startet ihn danach von selbst neu. Laeuft der Bot
      // schon laenger als 60s (praktisch immer bei einem Klick von Hand),
      // wartet der Watchdog dafuer nur die kurze Mindestzeit, nicht die
      // anwachsende Absturz-Backoff-Pause - siehe run-bot.ps1.
      if (req.url === '/api/neustart' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        // Erst antworten, dann beenden - sonst sieht der Klick im Dashboard
        // wie ein Fehlschlag aus, obwohl der Neustart laengst laeuft.
        setTimeout(() => process.exit(0), 300);
        return;
      }

      // Vierter schreibender Weg: den ganzen Bot fuer eine Weile stilllegen.
      //
      // Kevins Wunsch (30.08.): ein Aus, das auch den Windows-Autostart und
      // den Watchdog umgeht - sonst laeuft er beim naechsten Rechnerneustart
      // oder Absturz-Neuversuch einfach wieder an.
      //
      // Die Datei ist die einzige Bruecke zu run-bot.ps1 (PowerShell, kein
      // Node) - der Watchdog prueft sie VOR jedem Start. Steht "aus:true"
      // drin, startet er den Bot nicht, sondern haelt stattdessen selbst eine
      // kleine Seite auf demselben Port offen (siehe run-bot.ps1), auf der man
      // ihn wieder einschalten kann - genau dort, wo sonst das Dashboard waere.
      //
      // Zurueck an geht deshalb NICHT hier: waehrend der Bot aus ist, laeuft
      // dieser Node-Prozess ja gar nicht erst.
      if (req.url === '/api/aus' && req.method === 'POST') {
        await writeFileAtomic(ausDatei, JSON.stringify({ aus: true, seit: new Date().toISOString() }, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(() => process.exit(0), 300);
        return;
      }

      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(seite());
        return;
      }

      res.writeHead(404).end('gibt es nicht');
    } catch (error) {
      // Das Dashboard ist ein Fenster, kein Hebel: geht es kaputt, merkt der
      // Bot davon nichts.
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Fehler: ${error.message}`);
    }
  });

  server.on('error', (error) => {
    console.warn(`Dashboard konnte nicht starten: ${error.message}`);
  });

  server.listen(config.dashboardPort, HOST, () => {
    console.log(`Dashboard: http://localhost:${config.dashboardPort}`);
  });

  server.unref?.();
  return server;
}

module.exports = { startDashboard };
