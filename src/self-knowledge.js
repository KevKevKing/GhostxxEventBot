const { config } = require('./config');
const { listEvents } = require('./storage');
const { isLive } = require('./event-actions');
const { normalizeText } = require('./text-match');

// Was der Bot ueber sich selbst sagt, kommt aus dem Code - nicht aus dem
// Sprachmodell.
//
// Grund: ein kleines Modell erfindet hier zuverlaessig Unsinn. Im ersten Test
// hat es behauptet, es duerfe keine Teilnehmer eintragen - obwohl genau das
// seine Hauptaufgabe ist. Solche Antworten kann man nicht wegtrainieren und
// nicht sicher wegprompten, aber man kann sie deterministisch beantworten.

const CAPABILITY_PATTERNS = [
  /\bwas kannst du\b/,
  /\bwas machst du\b/,
  /\bwer bist du\b/,
  /\bwas bist du\b/,
  // Beide Wortstellungen: "kannst du ... packen?" und "du kannst ... packen?"
  /\b(kannst du|du kannst|kannste)\b.*\b(eintragen|austragen|tauschen|packen|anmelden|abmelden|aendern|machen)\b/,
  /\bdarfst du\b/,
  /\bdu darfst\b/,
  /\bwie (traegst|tragst|machst|schreibst) du\b/,
  /\bhilfe\b/,
  /\bwie funktionierst du\b/,
  /\bwas ist deine aufgabe\b/,
];

// Fragen nach seiner Herkunft. Eigener Topf, weil die Antwort eine andere ist
// als die Befehlsliste.
//
// Zweimal dieselbe Frage, zwei widersprechende Antworten: erst "ueber mich
// geschrieben haben nur Administratoren aus dem Team Unknown", dann "Ja, Ghost
// ist mein Creator". Beides erfunden - dabei steht der Owner in der
// Konfiguration.
const HERKUNFT_PATTERNS = [
  /\bwer hat dich (geschrieben|gebaut|programmiert|erstellt|gemacht)\b/,
  /\bwer ist dein (owner|besitzer|entwickler|ersteller|schoepfer)\b/,
  /\b(dein|deinem) (owner|besitzer|entwickler|ersteller)\b/,
  /\bwem gehoerst du\b/,
  /\bwer betreibt dich\b/,
  /\bbist du (eine )?(ki|ai|bot)\b/,
  /\bwelches modell\b/,
  /\blaeufst du (lokal|auf)\b/,
  /\bwo laeufst du\b/,
];

function isHerkunftQuestion(text) {
  return HERKUNFT_PATTERNS.some((pattern) => pattern.test(normalizeText(text)));
}

function answerHerkunft() {
  return [
    `Gebaut hat mich <@${config.ownerId}>, auf seinem eigenen Rechner läuft ${config.ollamaModel ? 'auch mein Sprachmodell' : 'auch alles andere'}.`,
    `<@${config.adminId}> ist Co-Owner und darf dasselbe wie er.`,
    'Ich bin kein fremder Dienst — nichts von dem, was ihr mir schreibt, verlässt diesen Rechner.',
  ].join(' ');
}

function isCapabilityQuestion(text) {
  const normalized = normalizeText(text);
  return CAPABILITY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildHelpText() {
  return [
    'Ich verwalte die Event-Anmeldungen. Sag es mir einfach normal:',
    '',
    '• `tausche im 40er @A mit @B` — tauscht zwei Leute',
    '• `trag @A beim 50er ein` — trägt jemanden ein',
    '• `trag mich ein` — dich selbst, als Antwort auf die Anmeldung',
    '• `nimm @A aus dem Bank-Event raus` — trägt jemanden aus',
    '• `wer ist alles beim 40er dabei?` — zeigt die Liste',
    '',
    'Den Eventnamen kannst du weglassen, wenn du direkt auf die Anmeldung antwortest.',
    'Auswechselspieler gibt es nur bei selbst erstellten Anmeldungen und bei den',
    'staatlichen Meldungen — die festen Events wie 40er oder BizWar haben keine.',
    'Ändern dürfen nur Leute mit Event-Rechten, ansehen und quatschen darf jeder.',
  ].join('\n');
}

/**
 * Baut eine kurze Lage-Uebersicht aus den echten Daten.
 * Wird dem Modell bei jedem Gespraech mitgegeben, damit es nicht raten muss,
 * was gerade laeuft - das ist echter Kontext, keine erfundene Beschreibung.
 */
async function buildLiveContext(now = new Date()) {
  const events = await listEvents();
  const live = events.filter((event) => isLive(event, now));

  if (!live.length) return 'Gerade läuft keine Anmeldung.';

  const list = live
    .slice(0, 8)
    .map((event) => {
      const count = (event.attendees || []).length;
      const max = event.maxParticipants ? `/${event.maxParticipants}` : '';
      return `${event.title} (${count}${max})`;
    })
    .join(', ');

  return `Gerade offen: ${list}.`;
}

async function answerCapabilityQuestion() {
  return buildHelpText();
}

module.exports = {
  answerCapabilityQuestion,
  answerHerkunft,
  isHerkunftQuestion,
  buildHelpText,
  buildLiveContext,
  isCapabilityQuestion,
};
