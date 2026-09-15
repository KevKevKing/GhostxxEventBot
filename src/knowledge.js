const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { normalizeText } = require('./text-match');

// Wissen, das ihm jemand beigebracht hat.
//
// Das Gespraechsgedaechtnis (memory.js) haelt nur die letzten Nachrichten und
// verfaellt nach einer Woche. Was hier drin steht, bleibt: Regeln der Familie,
// wer wofuer zustaendig ist, Eigenheiten des Servers.
//
// Bewusst als schlichte Liste von Saetzen statt als Datenbank mit Feldern -
// niemand soll ein Schema lernen muessen, um dem Bot etwas beizubringen.

const knowledgeFile = path.join(config.dataDir, 'knowledge.json');

const MAX_FACTS = 500;
const MAX_LENGTH = 500;
// Bis hierhin bekommt er einfach alles mit. Erst darueber wird ausgewaehlt.
const ALLE_BIS = 25;
const AUSWAHL = 10;

// Woerter, die beim Vergleichen nichts aussagen.
const STOPP = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'und', 'oder', 'aber', 'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'wird',
  'von', 'vom', 'mit', 'bei', 'fuer', 'auf', 'aus', 'zum', 'zur', 'nach', 'im',
  'in', 'an', 'als', 'auch', 'nicht', 'nur', 'noch', 'schon', 'sich', 'man',
  'wir', 'ihr', 'sie', 'er', 'es', 'du', 'ich', 'was', 'wer', 'wie', 'wo',
  'dass', 'wenn', 'weil', 'immer', 'mal', 'so', 'zu', 'am',
]);

let cache = null;
let writeQueue = Promise.resolve();

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

function woerter(text) {
  return normalizeText(text)
    .split(' ')
    .filter((wort) => wort.length >= 3 && !STOPP.has(wort));
}

async function load() {
  if (cache) return cache;

  try {
    const raw = await fs.readFile(knowledgeFile, 'utf8');
    const data = JSON.parse(raw);
    cache = Array.isArray(data.facts) ? data.facts : [];
  } catch {
    cache = [];
  }

  return cache;
}

async function save(facts) {
  return queueWrite(async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    await writeFileAtomic(knowledgeFile, JSON.stringify({ facts }, null, 2));
    cache = facts;
    return facts;
  });
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Merkt sich einen Satz.
 * Gibt zurueck, ob es neu war - doppeltes Wissen bringt nichts.
 */
async function remember(text, addedBy = '') {
  const satz = String(text || '').trim().slice(0, MAX_LENGTH);
  if (satz.length < 3) return { ok: false, reason: 'zu_kurz' };

  const facts = [...(await load())];
  const normalisiert = normalizeText(satz);

  const schonDa = facts.find((fact) => normalizeText(fact.text) === normalisiert);
  if (schonDa) return { ok: false, reason: 'schon_bekannt', fact: schonDa };

  const fact = {
    id: makeId(),
    text: satz,
    addedBy,
    addedAt: new Date().toISOString(),
  };

  facts.push(fact);

  // Aeltestes zuerst wegwerfen, wenn es zu viel wird.
  while (facts.length > MAX_FACTS) facts.shift();

  await save(facts);
  return { ok: true, fact, gesamt: facts.length };
}

/** Vergisst alles, was zur Suche passt. */
async function forget(query) {
  const suche = woerter(query);
  if (!suche.length) return { ok: false, reason: 'zu_unklar', entfernt: [] };

  const facts = await load();
  const treffer = facts.filter((fact) => {
    const inhalt = normalizeText(fact.text);
    return suche.every((wort) => inhalt.includes(wort));
  });

  if (!treffer.length) return { ok: false, reason: 'nichts_gefunden', entfernt: [] };

  const ids = new Set(treffer.map((fact) => fact.id));
  await save(facts.filter((fact) => !ids.has(fact.id)));

  return { ok: true, entfernt: treffer };
}

async function forgetById(id) {
  const facts = await load();
  const treffer = facts.find((fact) => fact.id === id);
  if (!treffer) return { ok: false };

  await save(facts.filter((fact) => fact.id !== id));
  return { ok: true, fact: treffer };
}

/** Wie gut passt ein Satz zur Frage? */
function score(fact, suchWoerter) {
  const inhalt = woerter(fact.text);
  if (!inhalt.length) return 0;

  let punkte = 0;
  for (const wort of suchWoerter) {
    if (inhalt.includes(wort)) punkte += 2;
    else if (inhalt.some((x) => x.startsWith(wort) || wort.startsWith(x))) punkte += 1;
  }

  return punkte;
}

/**
 * Sucht das Wissen heraus, das zur Nachricht passt.
 *
 * Solange es wenig ist, bekommt er einfach alles - das ist zuverlaessiger als
 * jede Auswahl. Erst bei vielen Eintraegen wird nach Stichworten gefiltert,
 * damit der Prompt nicht ausufert.
 */
async function relevant(text, limit = AUSWAHL) {
  const facts = await load();
  if (!facts.length) return [];
  if (facts.length <= ALLE_BIS) return facts;

  const suche = woerter(text);
  if (!suche.length) return facts.slice(-limit);

  const bewertet = facts
    .map((fact) => ({ fact, punkte: score(fact, suche) }))
    .filter((eintrag) => eintrag.punkte > 0)
    .sort((a, b) => b.punkte - a.punkte)
    .slice(0, limit)
    .map((eintrag) => eintrag.fact);

  // Nichts passt? Dann lieber das Neueste als gar nichts.
  return bewertet.length ? bewertet : facts.slice(-3);
}

async function search(query) {
  const suche = woerter(query);
  const facts = await load();
  if (!suche.length) return facts;

  return facts
    .map((fact) => ({ fact, punkte: score(fact, suche) }))
    .filter((eintrag) => eintrag.punkte > 0)
    .sort((a, b) => b.punkte - a.punkte)
    .map((eintrag) => eintrag.fact);
}

async function list() {
  return [...(await load())];
}

async function count() {
  return (await load()).length;
}

function invalidateCache() {
  cache = null;
}

module.exports = {
  ALLE_BIS,
  MAX_FACTS,
  MAX_LENGTH,
  count,
  forget,
  forgetById,
  invalidateCache,
  list,
  relevant,
  remember,
  search,
};
