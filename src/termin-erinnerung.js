const { config } = require('./config');
const { listEvents, updateEvent } = require('./storage');
const { berlinTimeToDate, getBerlinDateStamp, addDaysToStamp } = require('./time');
const { logBotEvent } = require('./logger');
const { pruefeVolle } = require('./voll-kommentar');
const { istAn } = require('./steuerung');

// Selbst erstellte Anmeldungen (/event erstellen) bekommen einen Termin.
//
// Bisher hatten sie bewusst kein Ende - sie schloss nur ein Mensch. Praktisch
// hiess das: fuenf FamWars standen bis zu zwoelf Tage offen, weil es niemand
// gemacht hat. Und wer sich am Tag der Ankuendigung eingetragen hat, wurde am
// Eventtag nie wieder erinnert.
//
// Zwei Dinge, beide aus dem Text im Feld "wann":
//   1. 25 Minuten vorher nochmal rufen
//   2. closeAt setzen - schliessen tut dann der bestehende Zeitplaner, an dem
//      hier nichts geaendert wird
//
// Steht keine Uhrzeit drin, passiert gar nichts. Dann bleibt es wie frueher.

const VORLAUF_MIN = 25;
const TAKT_MS = 60 * 1000;

const DATUM = /(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/;
const UHRZEIT = /(\d{1,2})[:.](\d{2})\s*(?:uhr)?/i;

/**
 * Liest Datum und Uhrzeit aus einem freien Text.
 *
 * "13.08.2026 21:00" -> Donnerstag 21 Uhr
 * "21:00"            -> heute 21 Uhr, oder morgen wenn heute schon vorbei
 *
 * Das Datum wird ZUERST gesucht und dann herausgeschnitten: sonst liest die
 * Uhrzeit-Suche in "13.08.2026" die 13.08 als 13:08.
 */
function leseTermin(text, jetzt = new Date()) {
  const roh = String(text || '').trim();
  if (!roh) return null;

  const datum = roh.match(DATUM);
  const rest = datum ? roh.replace(datum[0], ' ') : roh;

  const zeit = rest.match(UHRZEIT);
  if (!zeit) return null;

  const stunde = Number(zeit[1]);
  const minute = Number(zeit[2]);
  if (stunde > 23 || minute > 59) return null;

  const uhrzeit = `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (datum) {
    const tag = Number(datum[1]);
    const monat = Number(datum[2]);
    if (tag > 31 || monat > 12) return null;

    const jahrRoh = datum[3];
    const jahr = jahrRoh
      ? (jahrRoh.length === 2 ? `20${jahrRoh}` : jahrRoh)
      : getBerlinDateStamp(jetzt).slice(0, 4);

    const stempel = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
    return berlinTimeToDate(stempel, uhrzeit);
  }

  // Nur eine Uhrzeit: heute, und wenn die schon vorbei ist, morgen.
  const heute = getBerlinDateStamp(jetzt);
  const anHeute = berlinTimeToDate(heute, uhrzeit);
  if (anHeute.getTime() > jetzt.getTime()) return anHeute;
  return berlinTimeToDate(addDaysToStamp(heute, 1), uhrzeit);
}

/** Anmeldungen, die ein Mensch selbst angelegt hat. */
function istSelbstErstellt(event) {
  return event.status === 'open'
    && event.kind !== 'state'
    && event.createdBy !== 'scheduler';
}

function baueRuf(event, start) {
  const wen = event.pingRoleId ? `<@&${event.pingRoleId}> ` : '';
  const dabei = (event.attendees || []).length;
  const max = Number(event.maxParticipants || 0);
  const uhr = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  }).format(start);

  const platz = max && dabei < max
    ? ` — ${dabei}/${max} dabei, ${max - dabei} ${max - dabei === 1 ? 'Platz' : 'Plätze'} noch frei`
    : ` — ${dabei}/${max || '?'} dabei`;

  return `${wen}**${event.title}** geht um ${uhr} Uhr los${platz}.`;
}

/**
 * Ein Durchgang. Wirft nie - eine fehlgeschlagene Erinnerung darf nichts
 * anderes anhalten.
 */
async function pruefeTermine(client, jetzt = Date.now()) {
  if (!istAn('terminErinnerungen')) return [];
  const getan = [];

  try {
    for (const event of (await listEvents()).filter(istSelbstErstellt)) {
      const start = leseTermin(event.when, new Date(jetzt));
      if (!start) continue;

      // Das Ende eintragen, damit der bestehende Zeitplaner sie schliesst.
      if (!event.closeAt) {
        await updateEvent(event.id, (gespeichert) => ({
          ...gespeichert,
          closeAt: start.toISOString(),
          startAt: gespeichert.startAt || start.toISOString(),
        }));
        getan.push(`ende:${event.id}`);
      }

      if (event.terminErinnertAm) continue;

      const bisStart = start.getTime() - jetzt;
      if (bisStart <= 0 || bisStart > VORLAUF_MIN * 60 * 1000) continue;

      // Erst vermerken, dann rufen: andersherum wuerde ein Fehler beim Senden
      // jede Minute einen neuen Ping ausloesen.
      const notiert = await updateEvent(event.id, (gespeichert) => ({
        ...gespeichert,
        terminErinnertAm: new Date(jetzt).toISOString(),
      }));
      if (!notiert) continue;

      const kanal = await client.channels.fetch(event.channelId).catch(() => null);
      if (!kanal?.isTextBased()) continue;

      await kanal.send({
        content: baueRuf(event, start),
        allowedMentions: event.pingRoleId ? { roles: [event.pingRoleId] } : { parse: [] },
        ...(event.messageId
          ? { reply: { messageReference: event.messageId, failIfNotExists: false } }
          : {}),
      });

      logBotEvent({
        title: 'Termin-Erinnerung',
        color: 'update',
        fields: [
          { name: 'Event', value: event.title, inline: true },
          { name: 'Start', value: `<t:${Math.round(start.getTime() / 1000)}:R>`, inline: true },
        ],
      });

      getan.push(`ruf:${event.id}`);
    }
  } catch (error) {
    console.warn('Termin-Erinnerung:', error.message);
  }

  return getan;
}

function startTerminErinnerung(client) {
  const takt = setInterval(() => {
    pruefeTermine(client).catch(() => null);
    // Derselbe Minutentakt: eine Minute Ungenauigkeit spielt bei "das ging
    // schnell" keine Rolle, und es spart einen zweiten Zeitgeber.
    pruefeVolle(client).catch(() => null);
  }, TAKT_MS);

  takt.unref?.();
  console.log('Termin-Erinnerung laeuft (mit Voll-Kommentar).');
  return takt;
}

module.exports = { VORLAUF_MIN, baueRuf, istSelbstErstellt, leseTermin, pruefeTermine, startTerminErinnerung };
