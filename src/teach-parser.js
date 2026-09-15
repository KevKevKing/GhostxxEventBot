const { normalizeText } = require('./text-match');

// Erkennt, ob jemand dem Bot etwas beibringen, ihn etwas vergessen lassen oder
// sein Wissen abfragen will.
//
// Deterministisch und nicht ueber das Sprachmodell: "merk dir X" muss ankommen,
// auch wenn Ollama gerade traege ist oder das Modell den Satz missversteht.

// Reihenfolge zaehlt: laengere Einleitungen zuerst, damit "merk dir bitte, dass"
// nicht schon bei "merk dir" abgeschnitten wird.
// "dir" kann von Komma oder Doppelpunkt gefolgt sein: "merk dir: X".
const LERNEN = [
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?merk(?:e)?\s+dir\s*[,:]?\s*(?:bitte\s*[,:]?\s*)?(?:auch\s+)?(?:dass\s+|das\s+|folgendes\s*[:,]?\s*)?/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?merk(?:e)?\s*[,:]?\s*(?:bitte\s+)?/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?(?:lern(?:e)?|notier(?:e)?|speicher(?:e)?)\s+(?:dir\s*[,:]?\s*)?(?:bitte\s+)?(?:dass\s+)?/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?(?:behalte?|denk)\s+(?:dir\s*[,:]?\s*)?(?:bitte\s+)?(?:dass\s+)?/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?wissen\s*[:+]\s*/i,
];

const VERGESSEN = [
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?vergiss\s+(?:bitte\s+)?(?:alles\s+)?(?:was\s+du\s+)?(?:ueber\s+|über\s+|zu\s+)?/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?(?:loesch(?:e)?|lösch(?:e)?)\s+(?:bitte\s+)?(?:das\s+wissen\s+)?(?:ueber\s+|über\s+|zu\s+)?/i,
];

// "vergiss was du ueber Pascal weisst" - das Verb am Ende gehoert nicht zur Suche.
const NACHKLAPP = /\s+(?:wei(?:ss|ß)t|wei(?:ss|ß)|kennst|hast|gespeichert|gemerkt)\s*$/i;

const ABFRAGEN = [
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?was\s+wei(?:ss|ß)t\s+du\s+(?:ueber|über|von|zu)\s+/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?was\s+wei(?:ss|ß)t\s+du\s*\??$/i,
  /^(?:ghost(?:xx|y|i)?\s*[,:]?\s*)?(?:zeig|liste)\s+(?:mir\s+)?(?:dein\s+)?wissen/i,
];

function passt(text, muster) {
  for (const regex of muster) {
    const treffer = text.match(regex);
    if (treffer) return { rest: text.slice(treffer[0].length).trim() };
  }
  return null;
}

/**
 * @returns {null | {art: 'lernen'|'vergessen'|'abfragen', inhalt: string}}
 */
function parseTeach(text) {
  const roh = String(text || '').trim();
  if (!roh) return null;

  const vergessen = passt(roh, VERGESSEN);
  if (vergessen) {
    const inhalt = vergessen.rest.replace(/[?!.]+$/, '').replace(NACHKLAPP, '').trim();
    return { art: 'vergessen', inhalt };
  }

  const abfragen = passt(roh, ABFRAGEN);
  if (abfragen) {
    const inhalt = abfragen.rest.replace(/[?!.]+$/, '').replace(NACHKLAPP, '').trim();
    return { art: 'abfragen', inhalt };
  }

  const lernen = passt(roh, LERNEN);
  if (lernen && lernen.rest.length >= 3) {
    return { art: 'lernen', inhalt: lernen.rest };
  }

  return null;
}

/** Nur zum Anzeigen: kurze Fassung eines gemerkten Satzes. */
function kurz(text, max = 80) {
  const sauber = String(text || '').replace(/\n/g, ' ').trim();
  return sauber.length <= max ? sauber : `${sauber.slice(0, max - 1)}…`;
}

module.exports = {
  kurz,
  parseTeach,
};
