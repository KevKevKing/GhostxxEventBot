const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Die Werte fuer die Statusleiste am unteren Rand.
//
// Alles echt gemessen. Nichts hier ist geschaetzt oder ausgedacht - was sich
// nicht auslesen laesst, steht auch nicht da.
//
// Die Verlaeufe fuer die kleinen Kurven liegen im Arbeitsspeicher, hoechstens
// sechzig Messpunkte. Nach einem Neustart sind sie weg, das ist in Ordnung -
// sie zeigen die letzten Minuten, nicht die Geschichte.

const VERLAUF_LAENGE = 60;
const DISK_TAKT_MS = 60 * 1000;

const verlauf = { cpu: [], ram: [], gpu: [], vram: [] };

let letzteCpu = null;
let diskCache = { at: 0, wert: null };

/** CPU-Auslastung aus der Differenz zweier Messungen. */
function cpuAuslastung() {
  const kerne = os.cpus();
  const summe = kerne.reduce((acc, kern) => {
    for (const [art, wert] of Object.entries(kern.times)) {
      acc[art] = (acc[art] || 0) + wert;
    }
    return acc;
  }, {});

  const gesamt = Object.values(summe).reduce((a, c) => a + c, 0);
  const untaetig = summe.idle || 0;

  if (!letzteCpu) {
    letzteCpu = { gesamt, untaetig };
    return null;
  }

  const dGesamt = gesamt - letzteCpu.gesamt;
  const dUntaetig = untaetig - letzteCpu.untaetig;
  letzteCpu = { gesamt, untaetig };

  if (dGesamt <= 0) return null;
  return Math.round((1 - dUntaetig / dGesamt) * 100);
}

/** Grafikkarte per nvidia-smi. Ohne Karte oder Treiber gibt es eben nichts. */
function grafikkarte() {
  return new Promise((fertig) => {
    let ausgabe = '';
    const p = spawn('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { windowsHide: true });

    p.stdout.on('data', (d) => { ausgabe += d; });
    p.on('error', () => fertig(null));
    p.on('close', () => {
      const teile = ausgabe.trim().split('\n')[0]?.split(',').map((t) => Number(t.trim()));
      if (!teile || teile.length < 4 || teile.some((n) => !Number.isFinite(n))) return fertig(null);
      fertig({ last: teile[0], vramMb: teile[1], vramGesamtMb: teile[2], grad: teile[3] });
    });

    setTimeout(() => { p.kill(); fertig(null); }, 3000).unref?.();
  });
}

/** Festplatte. Aendert sich langsam, deshalb nur jede Minute. */
function platte(jetzt = Date.now()) {
  if (diskCache.wert && jetzt - diskCache.at < DISK_TAKT_MS) return diskCache.wert;

  try {
    const s = fs.statfsSync(process.cwd());
    const gesamtGb = (s.blocks * s.bsize) / 1e9;
    const freiGb = (s.bfree * s.bsize) / 1e9;
    diskCache = {
      at: jetzt,
      wert: { gesamtGb: Math.round(gesamtGb), freiGb: Math.round(freiGb), belegtGb: Math.round(gesamtGb - freiGb) },
    };
  } catch {
    diskCache = { at: jetzt, wert: null };
  }

  return diskCache.wert;
}

function merke(schluessel, wert) {
  if (wert === null || wert === undefined) return;
  const reihe = verlauf[schluessel];
  reihe.push(Math.round(wert));
  while (reihe.length > VERLAUF_LAENGE) reihe.shift();
}

function laufzeitText(sekunden) {
  const tage = Math.floor(sekunden / 86400);
  const stunden = Math.floor((sekunden % 86400) / 3600);
  const minuten = Math.floor((sekunden % 3600) / 60);
  if (tage) return `${tage}d ${stunden}h ${minuten}m`;
  if (stunden) return `${stunden}h ${minuten}m`;
  return `${minuten}m`;
}

/** Ein Messpunkt. Wird bei jedem Blick aufs Dashboard geholt. */
async function systemWerte(client = null) {
  const cpu = cpuAuslastung();
  const ramGesamt = os.totalmem();
  const ramFrei = os.freemem();
  const ramBelegtGb = (ramGesamt - ramFrei) / 1e9;
  const gpu = await grafikkarte();
  const disk = platte();

  merke('cpu', cpu);
  merke('ram', (ramBelegtGb / (ramGesamt / 1e9)) * 100);
  if (gpu) {
    merke('gpu', gpu.last);
    merke('vram', (gpu.vramMb / gpu.vramGesamtMb) * 100);
  }

  return {
    cpu,
    kerne: os.cpus().length,
    ramBelegtGb: Math.round(ramBelegtGb * 10) / 10,
    ramGesamtGb: Math.round(ramGesamt / 1e9),
    gpu,
    disk,
    // Der Draht nach Discord - fuer einen Bot aussagekraeftiger als eine
    // Netzwerkkurve. Unter 100 ms ist gut, ueber 500 hakt es.
    pingMs: client?.ws?.ping >= 0 ? Math.round(client.ws.ping) : null,
    laufzeit: laufzeitText(Math.round(process.uptime())),
    verlauf: {
      cpu: [...verlauf.cpu],
      ram: [...verlauf.ram],
      gpu: [...verlauf.gpu],
      vram: [...verlauf.vram],
    },
  };
}

module.exports = { VERLAUF_LAENGE, cpuAuslastung, grafikkarte, laufzeitText, platte, systemWerte };
