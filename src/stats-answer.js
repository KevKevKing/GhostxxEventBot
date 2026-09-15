const { resolveMember } = require('./member-resolver');
const { bestenliste, eventUebersicht, letzteTeilnahmen, teilnahmen } = require('./stats');
const { beschreibePerson, personProfil } = require('./server-wissen');
const { threadVonPerson } = require('./logbuch-zahlen');
const { frühereNamen } = require('./namens-gedaechtnis');

// Formuliert die Antworten auf Nachfragen zu den Anmeldungen.
//
// Absichtlich knapp und ohne Sprachmodell: eine Zahl aus den Daten braucht
// keine Formulierungshilfe, und so kommt die Antwort auch dann, wenn die
// Grafikkarte gerade voll ist.

const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function datum(zeit) {
  const d = new Date(zeit);
  const tag = TAGE[d.getDay()];
  return `${tag}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Wen meint die Frage? Loest "ich", Erwaehnungen und freie Namen auf. */
async function findeUserId(spieler, context) {
  if (!spieler) return { ok: true, userId: context.authorId, selbst: true };
  if (spieler.userId) return { ok: true, userId: spieler.userId, selbst: spieler.userId === context.authorId };
  if (spieler.selbst || !spieler.name) return { ok: true, userId: context.authorId, selbst: true };

  const treffer = await resolveMember(context.guild, spieler.name);
  if (treffer.ok) return { ok: true, userId: treffer.member.id, selbst: false };

  if (treffer.reason === 'ambiguous') {
    const namen = (treffer.candidates || []).slice(0, 5).map((m) => m.displayName || m.user?.username).join(', ');
    return { ok: false, text: `Wen meinst du? Passen würde: ${namen}` };
  }

  return { ok: false, text: `"${spieler.name}" finde ich nicht auf dem Server.` };
}

function wer(userId, selbst) {
  return selbst ? 'Du' : `<@${userId}>`;
}

function warst(selbst) {
  return selbst ? 'warst' : 'war';
}

async function antworteTeilnahmen(frage, context) {
  const ziel = await findeUserId(frage.spieler, context);
  if (!ziel.ok) return ziel.text;

  const daten = await teilnahmen(ziel.userId, { zeitraum: frage.zeitraum, event: frage.event });
  const zeit = daten.zeitraumText;
  const name = wer(ziel.userId, ziel.selbst);

  if (!daten.gesamt) {
    return frage.event
      ? `${name} ${warst(ziel.selbst)} ${zeit} bei keinem ${frage.event} dabei.`
      : `${name} ${warst(ziel.selbst)} ${zeit} bei keiner Anmeldung dabei.`;
  }

  if (frage.event) {
    return `${name} ${warst(ziel.selbst)} ${zeit} bei **${daten.gesamt}** von ${daten.moeglich} ${frage.event} dabei.`;
  }

  // Die drei haeufigsten dazu - eine nackte Zahl sagt wenig darueber, wo
  // jemand eigentlich mitspielt.
  const top = daten.proEvent.slice(0, 3).map((e) => `${e.name} ${e.anzahl}×`).join(', ');
  const rest = daten.proEvent.length > 3 ? `, +${daten.proEvent.length - 3} weitere` : '';

  return `${name} ${warst(ziel.selbst)} ${zeit} bei **${daten.gesamt}** Anmeldungen dabei — ${top}${rest}.`;
}

async function antworteLetzte(frage, context) {
  const ziel = await findeUserId(frage.spieler, context);
  if (!ziel.ok) return ziel.text;

  const liste = await letzteTeilnahmen(ziel.userId, 5, { event: frage.event });
  const name = wer(ziel.userId, ziel.selbst);

  if (!liste.length) {
    return frage.event
      ? `${name} ${warst(ziel.selbst)} bei keinem ${frage.event} dabei.`
      : `Zu ${ziel.selbst ? 'dir' : name} finde ich keine Anmeldung.`;
  }

  const zeilen = liste.map((e) => `• ${datum(e.zeit)} — ${e.name}${e.ersatz ? ' *(Ersatz)*' : ''}`);
  return [`Zuletzt ${ziel.selbst ? 'warst du' : `war ${name}`} dabei:`, ...zeilen].join('\n');
}

async function antworteBestenliste(frage, context) {
  const daten = await bestenliste({ zeitraum: frage.zeitraum, event: frage.event }, 5);

  if (!daten.liste.length) {
    return `${frage.event ? `Zu ${frage.event} ` : ''}${daten.zeitraumText} finde ich keine Anmeldungen.`;
  }

  const was = frage.event ? `bei ${frage.event} ` : '';
  const zeilen = daten.liste.map((e, i) => `${i + 1}. <@${e.userId}> — **${e.anzahl}**`);

  return [`Am häufigsten dabei ${was}${daten.zeitraumText} (aus ${daten.events} Anmeldungen):`, ...zeilen].join('\n');
}

async function antworteUebersicht(frage) {
  const daten = await eventUebersicht({ zeitraum: frage.zeitraum, event: frage.event });

  if (!daten.gesamt) return `${daten.zeitraumText} finde ich keine Anmeldungen.`;

  const zeilen = daten.liste
    .slice(0, 8)
    .map((e) => {
      const schnitt = e.schnitt === 1 ? '1 Person' : `${e.schnitt} Leute`;
      return `• **${e.name}** — ${e.anzahl}×, im Schnitt ${schnitt}${e.leer ? `, ${e.leer} leer` : ''}`;
    });

  return [`${daten.gesamt} Anmeldungen ${daten.zeitraumText}:`, ...zeilen].join('\n');
}

/**
 * "Wer ist X?" - aus Discord und dem Archiv, nicht aus dem Sprachmodell.
 *
 * Das Modell hatte darauf geantwortet, der Name existiere nicht, oder es
 * duerfe aus Datenschutzgruenden nichts sagen. Beides frei erfunden - die
 * Person steht auf demselben Server.
 */
async function antwortePerson(frage, context) {
  const ziel = await findeUserId(frage.spieler, context);
  if (!ziel.ok) return ziel.text;

  const member = await context.guild?.members?.fetch(ziel.userId).catch(() => null);
  if (!member) return `<@${ziel.userId}> finde ich auf dem Server nicht.`;

  const profil = await personProfil(context.guild, member);
  if (!profil) return `Zu <@${ziel.userId}> finde ich nichts.`;

  const zeilen = [beschreibePerson(profil)];

  // Frueher hiess der Mensch vielleicht anders - im Logbuch und in alten
  // Nachrichten steht dann noch der alte Name.
  const alteNamen = await frühereNamen(ziel.userId).catch(() => []);
  if (alteNamen.length) {
    zeilen.push(`Hieß vorher: ${alteNamen.slice(0, 3).join(', ')}.`);
  }

  // Nachweise im Logbuch - aber nur, wenn die Zahlen schon vorliegen. Sie erst
  // einzulesen wuerde die Antwort um eine halbe Minute verzoegern, und danach
  // gefragt hat ja niemand.
  if (context.client) {
    const thread = await threadVonPerson(context.client, member, { nurAusCache: true }).catch(() => null);
    if (thread) zeilen.push(`${thread.nachweise} Nachweise im Logbuch.`);
  }

  return zeilen.join(' ');
}

/**
 * Beantwortet eine erkannte Nachfrage. Gibt null zurueck, wenn die Frageart
 * unbekannt ist - dann uebernimmt der normale Weg.
 */
/** "Wie viele Logs hat X?" - gezaehlt aus seinem Logbuch-Thread. */
async function antworteLogs(frage, context) {
  if (!context.client) return null;

  const ziel = await findeUserId(frage.spieler, context);
  if (!ziel.ok) return ziel.text;

  const member = await context.guild?.members?.fetch(ziel.userId).catch(() => null);
  if (!member) return `<@${ziel.userId}> finde ich auf dem Server nicht.`;

  const thread = await threadVonPerson(context.client, member);
  const name = wer(ziel.userId, ziel.selbst);

  if (!thread) {
    return `${name} ${ziel.selbst ? 'hast' : 'hat'} noch keinen Logbuch-Thread.`;
  }

  const zuletzt = thread.letzterAm ? `, zuletzt am ${datum(thread.letzterAm).split(',')[1]?.trim() || datum(thread.letzterAm)}` : '';
  return `${name} ${ziel.selbst ? 'hast' : 'hat'} **${thread.nachweise}** Nachweise im Logbuch${zuletzt}.`;
}

async function beantworteStatsFrage(frage, context) {
  if (frage.art === 'logs') return antworteLogs(frage, context);
  if (frage.art === 'person') return antwortePerson(frage, context);
  if (frage.art === 'teilnahmen') return antworteTeilnahmen(frage, context);
  if (frage.art === 'letzte') return antworteLetzte(frage, context);
  if (frage.art === 'bestenliste') return antworteBestenliste(frage, context);
  if (frage.art === 'uebersicht') return antworteUebersicht(frage);
  return null;
}

module.exports = {
  beantworteStatsFrage,
  datum,
};
