const { app, BrowserWindow, shell, screen } = require('electron');
const path = require('node:path');

// Ein eigenes Fenster fuer das Dashboard - sonst nichts.
//
// Diese App ruehrt den Bot selbst nicht an. Sie zeigt nur die Seite, die es
// schon gibt (localhost:8787), ohne Adressleiste und mit eigenem Symbol in
// der Taskleiste. Der ganze Programmcode des Bots bleibt unberuehrt.
//
// Bewusst UNABHAENGIG vom Bot-Prozess gestartet (siehe run-bot.ps1): stuerzt
// der Bot ab und der Watchdog startet ihn neu, bleibt dieses Fenster einfach
// stehen und laedt die Seite automatisch neu, sobald der Bot wieder da ist.
// Ohne das wuerde bei jedem Absturz ein neues Fenster aufpoppen.

const ZIEL = 'http://localhost:8787';

// Discord-Sprunglinks direkt in die Discord-App schicken statt in einen
// Browser-Umweg.
//
// Die Sprunglinks im Dashboard zeigen auf https://discord.com/channels/...
// mit target="_blank". Ohne Eingriff macht Electron daraus ein zweites,
// unstyled Fenster mit der Standard-Menueleiste (File/Edit/View/Window/Help) -
// darin laedt dann die Discord-WEBSEITE, und die fragt erst "in App
// oeffnen?", bevor es weitergeht. Ein Klick zu viel.
//
// Die Discord-Desktop-App registriert bei der Installation das Protokoll
// "discord://" bei Windows. Ruft man das direkt auf, startet Windows sofort
// die App - ganz ohne Zwischenseite, weil gar kein Browser mehr im Spiel ist.
function alsDiscordProtokoll(url) {
  const treffer = /^https?:\/\/(?:www\.)?discord\.com\/channels\/(.+)$/i.exec(url);
  return treffer ? `discord://-/channels/${treffer[1]}` : null;
}

// Bereits offen? Dann nicht noch ein zweites Fenster - das kann passieren,
// wenn jemand die exe von Hand doppelklickt, waehrend der Autostart sie
// schon gestartet hat.
const einzigeInstanz = app.requestSingleInstanceLock();
if (!einzigeInstanz) {
  app.quit();
} else {
  let fenster = null;
  let wartezeitMs = 2000;
  const WARTEZEIT_MAX_MS = 15000;

  function ladeSeite() {
    if (!fenster) return;
    fenster.loadURL(ZIEL).catch(() => {});
  }

  function nochmalVersuchen() {
    if (!fenster) return;
    setTimeout(ladeSeite, wartezeitMs);
    // Naechstes Mal etwas laenger warten, aber nicht ewig - der Bot startet
    // ueblicherweise innerhalb weniger Sekunden.
    wartezeitMs = Math.min(wartezeitMs * 2, WARTEZEIT_MAX_MS);
  }

  /**
   * Auf welchem Bildschirm das Fenster aufgehen soll.
   *
   * Gibt es einen zweiten, kommt der dran - Kevin will das Dashboard auf dem
   * Nebenbildschirm haben, nicht auf dem, auf dem er arbeitet oder spielt.
   * Haengt gerade nur einer dran (oder das Kabel ist ab), faellt es von
   * selbst auf den Hauptbildschirm zurueck - ohne Nachfrage, ohne Absturz.
   */
  function zielBildschirm() {
    const alle = screen.getAllDisplays();
    const haupt = screen.getPrimaryDisplay();
    return alle.find((d) => d.id !== haupt.id) || haupt;
  }

  function fensterErstellen() {
    const bildschirm = zielBildschirm();

    fenster = new BrowserWindow({
      // Oben links auf dem Zielbildschirm platzieren, bevor maximiert wird -
      // sonst maximiert Windows auf dem Bildschirm, auf dem der groessere
      // Teil des Fensters gerade zufaellig liegt.
      x: bildschirm.bounds.x + 40,
      y: bildschirm.bounds.y + 40,
      width: 1600,
      height: 900,
      show: false,
      autoHideMenuBar: true,
      title: 'Ghostxx',
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      backgroundColor: '#05030c',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    fenster.once('ready-to-show', () => {
      fenster.maximize();
      fenster.show();
    });

    // Kein Adressfeld, also auch kein "Seite nicht erreichbar" von Chromium -
    // stattdessen leise weiterprobieren. Der Bot braucht nach einem Neustart
    // ein paar Sekunden, bis das Dashboard antwortet.
    fenster.webContents.on('did-fail-load', () => {
      nochmalVersuchen();
    });

    fenster.webContents.on('did-finish-load', () => {
      wartezeitMs = 2000;
    });

    // Jeder Link mit target="_blank" (die Sprunglinks) landet hier statt in
    // einem neuen Electron-Fenster. Discord-Links gehen direkt an die App,
    // alles andere an den normalen Standardbrowser - beides ausserhalb
    // dieses Fensters, das Dashboard bleibt unberuehrt stehen.
    fenster.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(alsDiscordProtokoll(url) || url);
      return { action: 'deny' };
    });

    fenster.on('closed', () => {
      fenster = null;
    });

    ladeSeite();
  }

  // Jemand startet die exe ein zweites Mal - statt eines zweiten Fensters
  // wird das vorhandene nach vorne geholt.
  app.on('second-instance', () => {
    if (!fenster) return;
    if (fenster.isMinimized()) fenster.restore();
    fenster.focus();
  });

  app.whenReady().then(fensterErstellen);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
