const { config } = require('./config');
const { listEvents, updateEvent } = require('./storage');

// Kurz vor Anmeldeschluss nochmal anstupsen - aber nur, wenn es sich lohnt.
//
// Die Zahlen aus 30 Tagen, 545 gepostete 40er:
//
//    0 Leute  196x (36%)   tote Zeitfenster, meist nachts
//    1-5      195x (36%)   kommt sowieso nicht zustande
//    6-9       95x (17%)   HIER fehlen ein bis vier Leute zum vollen Team
//   10 voll    59x (11%)
//
// Ein "hier fehlen noch Leute" bei jedem Event waere Spam - zwei Drittel sind
// ohnehin leer oder fast leer, da bewirkt kein Anstupsen etwas. Deshalb meldet
// er sich nur im mittleren Band: schon fast voll, aber eben noch nicht.
//
// Das trifft rund dreimal am Tag und nur dort, wo ein einzelner Nachzuegler
// den Unterschied macht. Bei den 25er-Events greift es faktisch nie, weil die
// nie in die Naehe von 60 Prozent kommen - die Regel begrenzt sich selbst.

const AB_ANTEIL = 0.6;
const VORLAUF_MS = 6 * 60 * 1000;

/** Wann schliesst die Anmeldung? */
function schliesstUm(event) {
  if (!event.closeAt) return null;
  const zeit = new Date(event.closeAt).getTime();
  return Number.isFinite(zeit) ? zeit : null;
}

function angemeldet(event) {
  return (event.attendees || []).length;
}

/**
 * Lohnt sich fuer diese Anmeldung eine Erinnerung?
 *
 * @returns {{faellig: boolean, fehlen?: number, dabei?: number, max?: number}}
 */
function istErinnerungFaellig(event, jetzt) {
  if (event.status !== 'open') return { faellig: false };
  if (event.erinnertAm) return { faellig: false };

  const max = Number(event.maxParticipants || 0);
  if (max < 4) return { faellig: false };

  const dabei = angemeldet(event);
  if (dabei >= max) return { faellig: false };
  if (dabei / max < AB_ANTEIL) return { faellig: false };

  const schluss = schliesstUm(event);
  if (schluss === null) return { faellig: false };

  const rest = schluss - jetzt;
  if (rest <= 0 || rest > VORLAUF_MS) return { faellig: false };

  return { faellig: true, fehlen: max - dabei, dabei, max };
}

function baueText(event, { fehlen, dabei, max }) {
  const wen = event.pingRoleId ? `<@&${event.pingRoleId}> ` : '';
  const platz = fehlen === 1 ? 'ein Platz' : `${fehlen} Plätze`;

  return `${wen}**${event.title}** ist gleich voll — ${dabei} von ${max} drin, `
    + `${platz} noch frei. Anmeldung schließt in wenigen Minuten.`;
}

/**
 * Schaut alle offenen Anmeldungen durch und stupst an, wo es knapp ist.
 *
 * Wirft nie: eine fehlgeschlagene Erinnerung darf den Scheduler nicht stoppen -
 * der oeffnet und schliesst danach noch Anmeldungen.
 */
async function erinnereAnKnappeEvents(client, jetzt = Date.now()) {
  const gemeldet = [];

  try {
    const events = await listEvents();

    for (const event of events) {
      const pruefung = istErinnerungFaellig(event, jetzt);
      if (!pruefung.faellig) continue;

      // Erst vermerken, dann senden. Andersherum koennte ein Fehler beim
      // Senden dazu fuehren, dass beim naechsten Durchlauf nochmal gepingt
      // wird - alle 30 Sekunden, bis die Anmeldung schliesst.
      const notiert = await updateEvent(event.id, (stored) => ({
        ...stored,
        erinnertAm: new Date(jetzt).toISOString(),
      }));
      if (!notiert) continue;

      const kanal = await client.channels.fetch(event.channelId).catch(() => null);
      if (!kanal?.isTextBased()) continue;

      await kanal.send({
        content: baueText(event, pruefung),
        allowedMentions: event.pingRoleId ? { roles: [event.pingRoleId] } : { parse: [] },
        ...(event.messageId ? { reply: { messageReference: event.messageId, failIfNotExists: false } } : {}),
      }).catch(() => null);

      gemeldet.push({ id: event.id, titel: event.title, ...pruefung });
      console.log(`Erinnerung: ${event.title} ${pruefung.dabei}/${pruefung.max}`);
    }
  } catch (error) {
    console.error('Erinnerung fehlgeschlagen:', error.message);
  }

  return gemeldet;
}

module.exports = {
  AB_ANTEIL,
  VORLAUF_MS,
  baueText,
  erinnereAnKnappeEvents,
  istErinnerungFaellig,
};
