const { config } = require('./config');
const { listEvents, updateEvent } = require('./storage');
const { vollMoment } = require('./beitritts-log');

// "Der 40er war in drei Minuten voll."
//
// Ghostxx sieht jede Anmeldung fuellen und hat dazu nie etwas gesagt. Dabei
// ist es das Einzige, was im Chat sowieso jeder kommentiert.
//
// Bewusst OHNE Eingriff in die Anmeldung selbst: hier wird nur jede Minute
// nachgeschaut, welche Anmeldung inzwischen voll ist. Die Eventlogik bleibt
// unberuehrt - eine Minute Ungenauigkeit spielt bei "das ging schnell" keine
// Rolle.

// Ab wann es bemerkenswert ist.
//
// Ehrlich geraten, nicht gemessen: wie lange eine Anmeldung bis zum Vollsein
// braucht, wurde bisher nirgends festgehalten. Ab jetzt schon (Feld vollNach),
// und in einer Woche laesst sich die Grenze an echten Zahlen nachziehen.
const SCHNELL_MS = 5 * 60 * 1000;

// Voll ist nicht selten: gemessen an 545 geposteten 40ern in 30 Tagen waren
// 59 voll, also etwa zwei am Tag. Mit der Schnell-Grenze bleibt weniger uebrig.
const PRO_TAG = 3;

let heute = { tag: '', anzahl: 0 };

function tagesStempel(jetzt = Date.now()) {
  return new Date(jetzt).toISOString().slice(0, 10);
}

function offenSeit(event) {
  const roh = event.openAt || event.createdAt;
  const zeit = roh ? new Date(roh).getTime() : NaN;
  return Number.isFinite(zeit) ? zeit : null;
}

function istVoll(event) {
  const max = Number(event.maxParticipants || 0);
  return max > 0 && (event.attendees || []).length >= max;
}

function satz(event, dauerMs) {
  const max = event.maxParticipants;

  // Unter einer Minute: auf die Millisekunde genau, aus dem echten
  // Beitrittsprotokoll (beitritts-log.js) - nicht mehr geschaetzt aus dem
  // Minutentakt, der bis zu einer Minute danebenlag.
  if (dauerMs < 60000) {
    return `**${event.title}** war in ${(dauerMs / 1000).toFixed(3)} Sekunden voll. ${max} Leute, zack.`;
  }

  const minuten = Math.round(dauerMs / 60000);
  if (minuten <= 5) return `**${event.title}** war nach ${minuten} Minuten voll — das ging schnell heute.`;
  return `**${event.title}** ist voll, ${max}/${max}.`;
}

/**
 * Schaut, welche Anmeldung gerade voll geworden ist.
 *
 * Wirft nie - ein Spruch im Chat darf nichts anderes anhalten.
 */
async function pruefeVolle(client, jetzt = Date.now()) {
  const gesagt = [];

  try {
    const tag = tagesStempel(jetzt);
    if (heute.tag !== tag) heute = { tag, anzahl: 0 };

    for (const event of await listEvents()) {
      if (event.status !== 'open') continue;
      if (event.vollAm) continue;
      if (!istVoll(event)) continue;

      const seit = offenSeit(event);

      // Der genaue Moment aus dem Beitrittsprotokoll - der wirkliche
      // Zeitpunkt des letzten Beitritts, nicht der naechste Minutentakt
      // danach. Kevins Ansage: die Zahl muss zu 1000% stimmen.
      //
      // Nur alte Anmeldungen von vor dieser Umstellung haben kein Protokoll -
      // dort bleibt die alte, grobe Schaetzung als Rueckfall.
      const exaktesEnde = vollMoment(event);
      const dauer = seit === null
        ? null
        : (exaktesEnde ? new Date(exaktesEnde).getTime() : jetzt) - seit;

      // Erst vermerken, dann reden: sonst kommt der Spruch jede Minute neu.
      const notiert = await updateEvent(event.id, (gespeichert) => ({
        ...gespeichert,
        vollAm: new Date(jetzt).toISOString(),
        vollNach: dauer,
      }));
      if (!notiert) continue;

      // Nur das Schnelle ist eine Bemerkung wert. Dass eine Anmeldung
      // irgendwann voll wird, sieht jeder selbst.
      if (dauer === null || dauer > SCHNELL_MS) continue;
      if (heute.anzahl >= PRO_TAG) continue;

      const kanal = await client.channels.fetch(config.chatChannelId).catch(() => null);
      if (!kanal?.isTextBased()) continue;

      await kanal.send({ content: satz(event, dauer), allowedMentions: { parse: [] } });
      heute.anzahl += 1;
      gesagt.push(event.id);
    }
  } catch (error) {
    console.warn('Voll-Kommentar:', error.message);
  }

  return gesagt;
}

function zuruecksetzen() {
  heute = { tag: '', anzahl: 0 };
}

module.exports = { PRO_TAG, SCHNELL_MS, istVoll, pruefeVolle, satz, zuruecksetzen };
