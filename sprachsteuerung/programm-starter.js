const { spawn } = require('node:child_process');
const path = require('node:path');

// Startet ein Programm/Spiel aus der Programmliste - entweder einen echten
// Datei-Pfad (.exe) direkt, oder eine URI (z.B. "steam://rungameid/...",
// fuer Spiele die ueber einen Launcher/Anti-Cheat starten muessen statt
// direkt per .exe) ueber Windows' eingebauten "start"-Befehl, der jede
// registrierte URI an das richtige Programm weiterreicht.
function istUri(pfad) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pfad);
}

// Eine .lnk-Verknuepfung (Windows-Verknuepfungsdatei) laesst sich nicht per
// spawn() direkt starten - Windows kann eine .lnk nur ueber den "start"-
// Befehl oder den Explorer richtig aufloesen, genau wie eine URI.
function brauchtStart(pfad) {
  return istUri(pfad) || pfad.toLowerCase().endsWith('.lnk');
}

// echtAusfuehren wartet auf das 'spawn'-Event statt sofort zu resolven. Node.js
// kann einen Start-Fehler (z.B. ENOENT wenn die .exe nicht existiert) erst
// asynchron im 'error'-Handler melden - sofortiges Resolven wuerde das verpassen.
// spawnOptions wird durchgereicht (z.B. fuer cwd bei einem direkten Datei-Pfad).
function echtAusfuehren(cmd, args, spawnOptions = {}) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore', ...spawnOptions });
      p.on('error', () => resolve({ ok: false }));
      p.on('spawn', () => {
        p.unref();
        resolve({ ok: true });
      });
    } catch {
      resolve({ ok: false });
    }
  });
}

// try/catch um die ganze Funktion: ausfuehren() ist von aussen injizierbar
// und darf - wie die uebrigen Module dieser Art - nie werfen, auch wenn die
// injizierte Funktion selbst synchron wirft.
async function starteProgramm(eintrag, { ausfuehren = echtAusfuehren } = {}) {
  try {
    // Bei einem direkten Datei-Pfad wird das Arbeitsverzeichnis (cwd) auf den
    // Ordner der .exe gesetzt - manche Spiele/Programme suchen relative
    // Ressourcen neben ihrer eigenen .exe und finden sie ohne passendes cwd
    // nicht. Bei URI/.lnk gibt es kein sinnvolles cwd, dort startet "cmd /c
    // start" das Ziel ohnehin ueber Windows selbst.
    const ergebnis = brauchtStart(eintrag.pfad)
      ? await ausfuehren('cmd', ['/c', 'start', '""', eintrag.pfad])
      : await ausfuehren(eintrag.pfad, [], { cwd: path.dirname(eintrag.pfad) });

    if (!ergebnis || !ergebnis.ok) {
      return { ok: false, grund: 'programm_fehlgeschlagen' };
    }
    return { ok: true };
  } catch {
    return { ok: false, grund: 'programm_fehlgeschlagen' };
  }
}

module.exports = { starteProgramm, istUri, brauchtStart };
