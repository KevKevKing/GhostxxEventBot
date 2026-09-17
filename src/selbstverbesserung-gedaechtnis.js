const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { getBerlinDateStamp } = require('./time');

// Ghostxx' eigenes Gedaechtnis fuer die Selbstverbesserung: ein JSON pro
// erkanntem Problem, git-versioniert im Projekt-Wurzelverzeichnis - bewusst
// NICHT in data/, das ist Fachdaten (Events, Logbuch). Hier steht Ghostxx'
// eigene Historie: was er an sich selbst bemerkt, versucht und Kevin
// entschieden hat.

const wurzel = process.env.GEDAECHTNIS_ROOT || path.resolve(__dirname, '..');
const ordner = path.join(wurzel, 'Gedächtnis');

function signatur(titel) {
  return String(titel || '').trim().toLowerCase();
}

function slug(titel) {
  return String(titel || 'problem')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'problem';
}

async function alleDateien() {
  await fs.mkdir(ordner, { recursive: true });
  const namen = await fs.readdir(ordner);
  return namen.filter((n) => n.endsWith('.json')).map((n) => path.join(ordner, n));
}

async function ladeAlle() {
  const dateien = await alleDateien();
  const eintraege = [];
  for (const datei of dateien) {
    try {
      eintraege.push(JSON.parse(await fs.readFile(datei, 'utf8')));
    } catch {
      // Kaputte Datei ueberspringen statt den ganzen Lauf abzubrechen.
    }
  }
  return eintraege;
}

async function speichere(eintrag) {
  const datei = path.join(ordner, `${eintrag.id}.json`);
  await fs.mkdir(ordner, { recursive: true });
  await writeFileAtomic(datei, JSON.stringify(eintrag, null, 2));
}

async function istBekannt(sig, { seitTagen = 14 } = {}) {
  const grenze = Date.now() - seitTagen * 24 * 60 * 60 * 1000;
  const eintraege = await ladeAlle();

  return eintraege.some((eintrag) => {
    if (signatur(eintrag.problem?.titel) !== sig) return false;
    const status = eintrag.entscheidung?.status || 'offen';
    if (status !== 'offen' && status !== 'abgelehnt') return false;
    return new Date(eintrag.erkanntAm).getTime() >= grenze;
  });
}

async function neuerEintrag({ titel, belege = [] }) {
  const heute = getBerlinDateStamp();
  const id = `${heute}-${slug(titel)}-${Date.now().toString(36).slice(-4)}`;

  const eintrag = {
    id,
    erkanntAm: new Date().toISOString(),
    problem: { titel, belege },
    session: null,
    entscheidung: { status: 'offen', am: null, grund: '' },
  };

  await speichere(eintrag);
  return { id };
}

async function findeEintrag(id) {
  const dateien = await alleDateien();
  const datei = dateien.find((d) => path.basename(d, '.json') === id);
  if (!datei) return null;
  return JSON.parse(await fs.readFile(datei, 'utf8'));
}

async function vermerkeSession(id, { branch, zusammenfassung, ok, fehler = '' }) {
  const eintrag = await findeEintrag(id);
  if (!eintrag) return;
  eintrag.session = { gestartetAm: new Date().toISOString(), branch, zusammenfassung, ok, fehler };
  await speichere(eintrag);
}

async function vermerkeEntscheidung(id, { status, grund = '' }) {
  const eintrag = await findeEintrag(id);
  if (!eintrag) return;
  eintrag.entscheidung = { status, am: new Date().toISOString(), grund };
  await speichere(eintrag);
}

async function liste(limit = 20) {
  const eintraege = await ladeAlle();
  return eintraege
    .sort((a, b) => new Date(b.erkanntAm) - new Date(a.erkanntAm))
    .slice(0, limit);
}

module.exports = {
  istBekannt,
  liste,
  neuerEintrag,
  signatur,
  vermerkeEntscheidung,
  vermerkeSession,
};
