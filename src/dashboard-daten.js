const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { listEvents } = require('./storage');
const { alleTickets, personZuTicket } = require('./logbuch-tickets');
const { readEntries } = require('./logbook');
const {
  getFreeVramMb, getFreiOhneEigeneMb, isReachable, letzteAnfragen, rechnetGerade,
} = require('./ollama');
const { systemWerte } = require('./system-werte');
const { offeneFragen } = require('./ghostxx-fragen');
const { alleGelesenen } = require('./bild-gedaechtnis');
const { fortschritt } = require('./bild-vorablesen');
const { letzteAktivitaet, letzteFehler } = require('./logger');
const { laufStand } = require('./lauf-stand');
const { teilnahmenJePerson } = require('./meilenstein');
const { besonderesHeute, schoenerName, MORGENS, ABENDS } = require('./tagesrhythmus');
const { berlinTimeToDate, getBerlinDateStamp } = require('./time');
const { alleSchalter } = require('./steuerung');

// Alles, was das Dashboard anzeigt - an einer Stelle eingesammelt.
//
// Ausschliesslich lesend. Nichts hier darf den Bot beeinflussen: das Dashboard
// ist ein Fenster, kein Hebel. Faellt es aus, merkt der Bot es nicht.

// Der Logbuch-Stand kostet 34 Abrufe von je hundert Nachrichten. Das rechnet er
// nicht bei jedem Blick auf die Seite neu.
const LOGBUCH_CACHE_MS = 10 * 60 * 1000;
let logbuchCache = { at: 0, daten: null, laeuft: false };

/** Woher kommt diese Anmeldung? */
function artVon(event) {
  if (event.kind === 'state') {
    return event.stateType === 'attack' ? 'Angriff' : 'Verteidigung';
  }
  if (event.createdBy === 'scheduler') return 'Geplant';
  return 'Selbst erstellt';
}

function minutenBis(iso) {
  if (!iso) return null;
  const zeit = new Date(iso).getTime();
  if (!Number.isFinite(zeit)) return null;
  return Math.round((zeit - Date.now()) / 60000);
}

/** Die offenen Anmeldungen - geplante, selbst erstellte und staatliche. */
async function offeneAnmeldungen() {
  const events = (await listEvents()).filter((event) => event.status === 'open');

  return events.map((event) => {
    const dabei = (event.attendees || []).length;
    const max = Number(event.maxParticipants || 0);
    const schliesst = minutenBis(event.closeAt);

    return {
      id: event.id,
      art: artVon(event),
      titel: event.title,
      gegner: event.kind === 'state'
        ? (event.reportFields || []).map((f) => f.value).join(' · ')
        : '',
      dabei,
      max,
      ersatz: (event.substitutes || []).length,
      maxErsatz: Number(event.maxSubstitutes || 0),
      anteil: max ? dabei / max : 0,
      schliesstIn: schliesst,
      wann: event.when || '',
      channelId: event.channelId,
      messageId: event.messageId,
      // Seit wann steht die schon offen? Selbst erstellte Anmeldungen ohne
      // closeAt bleiben sonst ewig stehen, ohne dass es jemand merkt.
      offenSeitStunden: event.createdAt
        ? Math.round((Date.now() - new Date(event.createdAt).getTime()) / 3600000)
        : null,
    };
  }).sort((a, b) => {
    // Was gleich schliesst, zuerst.
    if (a.schliesstIn === null) return 1;
    if (b.schliesstIn === null) return -1;
    return a.schliesstIn - b.schliesstIn;
  });
}

/** Wie viele Nachweise warten in den Tickets auf die Auszahlung? */
async function logbuchStand(client, { frisch = false } = {}) {
  const jetzt = Date.now();
  if (!frisch && logbuchCache.daten && jetzt - logbuchCache.at < LOGBUCH_CACHE_MS) {
    return logbuchCache.daten;
  }
  if (logbuchCache.laeuft) return logbuchCache.daten;

  logbuchCache.laeuft = true;
  try {
    const guild = client.guilds.cache.get(config.guildId)
      || await client.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) return logbuchCache.daten;

    const tickets = await alleTickets(guild, { nurGezaehlte: true });
    const zeilen = [];

    for (const kanal of tickets) {
      const roh = await kanal.messages.fetch({ limit: 100 }).catch(() => null);
      if (!roh) continue;

      const eintraege = readEntries([...roh.values()].reverse(), client.user.id);
      const offen = eintraege.filter((e) => e.images?.length).length;
      if (!offen) continue;

      const person = personZuTicket(guild, kanal);
      zeilen.push({
        name: person?.displayName || kanal.name,
        kanalId: kanal.id,
        offen,
      });
    }

    // Alphabetisch, nicht nach Menge: Ghostxx arbeitet die Tickets von A bis Z
    // ab, und man will in derselben Reihenfolge sehen, wo er gerade steht.
    zeilen.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de'));

    logbuchCache = {
      at: jetzt,
      laeuft: false,
      daten: {
        tickets: tickets.length,
        mitOffenen: zeilen.length,
        bilder: zeilen.reduce((summe, z) => summe + z.offen, 0),
        zeilen,
        standVon: new Date(jetzt).toISOString(),
      },
    };
  } catch {
    logbuchCache.laeuft = false;
  }

  logbuchCache.laeuft = false;
  return logbuchCache.daten;
}

/** Grafikkarte und Sprachmodell. */
async function technik() {
  const erreichbar = await isReachable().catch(() => false);
  if (!erreichbar) return { erreichbar: false, modelle: [], freiMb: null };

  const geladen = await fetch(`${config.ollamaUrl}/api/ps`)
    .then((r) => r.json())
    .catch(() => ({ models: [] }));

  const freiMb = await getFreeVramMb().catch(() => null);

  // Ghostxx' eigene Modelle zaehlen NICHT als "Karte voll" - interessant ist
  // nur, ob etwas ANDERES sie belegt. Also GTA. Die Rechnung steht in
  // ollama.js, weil das Bild-Vorablesen sie genauso braucht; als ich sie dort
  // vergessen hatte, hat es sich selbst blockiert.
  const wirklichFreiMb = await getFreiOhneEigeneMb().catch(() => null);

  return {
    erreichbar: true,
    freiMb,
    wirklichFreiMb: wirklichFreiMb === null ? null : Math.round(wirklichFreiMb),
    knapp: wirklichFreiMb !== null && wirklichFreiMb < config.ollamaVramThresholdMb,
    modelle: (geladen.models || []).map((m) => ({
      name: m.name,
      vramGb: Math.round((m.size_vram || 0) / 1e8) / 10,
      bisIso: m.expires_at || '',
    })),
  };
}

/**
 * Die letzten Zeilen aus dem Terminal.
 *
 * Die Logdatei ist GEMISCHT kodiert, und das sieht man sofort: der Watchdog
 * schreibt seine eigenen Zeilen mit Add-Content als UTF-8, die Ausgabe des
 * Bots laeuft ueber Tee-Object und landet als UTF-16. Gemessen am Dateiende:
 * 1960 von 4000 Bytes sind NUL.
 *
 * Als UTF-8 gelesen steht zwischen jedem Buchstaben ein NUL - im Browser sah
 * das aus wie "A n m e l d u n g   g e s c h l o s s e n". Deshalb fliegen die
 * NUL-Bytes raus, bevor irgendetwas dekodiert wird.
 */
async function terminal(zeilen = 40) {
  try {
    const datei = path.join(path.dirname(config.dataDir), 'logs', 'bot.log');
    const roh = await fs.readFile(datei);

    // Nur das Ende lesen - die Datei ist ueber ein Megabyte gross.
    const ende = roh.subarray(Math.max(0, roh.length - 24000));
    const ohneNull = ende.filter((byte) => byte !== 0);

    return Buffer.from(ohneNull).toString('utf8')
      .split(/\r?\n/)
      .map((z) => z
        .trim()
        // Reihen von Ersatzzeichen zusammenfassen.
        //
        // In den Logzeilen stehen Ticketnamen in mathematischen
        // Fettbuchstaben. PowerShell kann die nicht darstellen und schreibt
        // fuer jeden ein Fragezeichen - im Terminal stand dann eine Wand aus
        // "������������". Neue Zeilen sind sauber, die alten werden hier
        // lesbar gemacht.
        .replace(/[�?]{4,}/g, '…')
        .replace(/…(\s*[|│,]\s*)?(\d{4,7})/g, '… $2'))
      .filter(Boolean)
      .slice(-zeilen)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Was er als Naechstes von sich aus tun wird.
 *
 * Nicht nur die festen Uhrzeiten, sondern auch: welche Anmeldung als naechstes
 * aufgeht, wer kurz vor einem Meilenstein steht. Das ist der Teil, den man
 * sonst nirgends sehen kann - er weiss es, aber niemand fragt ihn.
 */
/**
 * Macht aus <@123> den Anzeigenamen.
 *
 * Ohne das steht im Dashboard "@1348728022177550387 raus, @286819354589265920
 * rein" - technisch richtig und vollkommen unlesbar.
 */
function mitNamen(text, guild) {
  if (!text || !guild?.members?.cache) return text || '';
  return String(text)
    .replace(/<@!?(\d{17,25})>/g, (ganz, id) => guild.members.cache.get(id)?.displayName || ganz)
    .replace(/<@&(\d{17,25})>/g, (ganz, id) => `@${guild.roles.cache.get(id)?.name || 'Rolle'}`)
    .replace(/<#(\d{17,25})>/g, (ganz, id) => `#${guild.channels.cache.get(id)?.name || 'Kanal'}`);
}

async function geplantes(now = Date.now(), guild = null) {
  const heute = getBerlinDateStamp(new Date(now));
  const naechste = [];

  for (const [was, uhrzeit] of [['Ausblick', MORGENS], ['Rückblick', ABENDS]]) {
    const zeit = berlinTimeToDate(heute, uhrzeit).getTime();
    naechste.push({
      was,
      uhrzeit,
      inMin: zeit > now ? Math.round((zeit - now) / 60000) : null,
    });
  }

  // Wer steht kurz davor? Genau die Meldungen kommen als Naechstes.
  let anwaerter = [];
  try {
    const zaehler = await teilnahmenJePerson(now);
    anwaerter = [...zaehler.entries()]
      .map(([id, n]) => {
        const naechsterStand = n < 10 ? 10 : (n < 25 ? 25 : (Math.floor(n / 50) + 1) * 50);
        return {
          id,
          name: guild?.members?.cache?.get(id)?.displayName || 'Unbekannt',
          jetzt: n,
          ziel: naechsterStand,
          fehlt: naechsterStand - n,
        };
      })
      .filter((a) => a.fehlt <= 3)
      .sort((a, b) => a.fehlt - b.fehlt || b.ziel - a.ziel)
      .slice(0, 6);
  } catch {
    anwaerter = [];
  }

  return {
    morgens: MORGENS,
    abends: ABENDS,
    naechste,
    anwaerter,
    heuteBesonders: besonderesHeute(heute).map((e) => `${schoenerName(e.titel)} ${e.zeiten.join(', ')} Uhr`),
  };
}

/**
 * Was gerade nicht stimmt.
 *
 * Bewusst wenige und harte Regeln - eine Warnliste, die immer voll ist,
 * schaut sich nach drei Tagen niemand mehr an.
 */
async function warnungen(client, { anmeldungen, technikStand }) {
  const liste = [];

  if (!technikStand.erreichbar) {
    liste.push({ stufe: 'rot', text: 'Ollama antwortet nicht — Chat, Passprüfung und Bilderkennung fallen aus.' });
  } else if (technikStand.knapp) {
    liste.push({
      stufe: 'gelb',
      text: 'Etwas anderes belegt die Grafikkarte (vermutlich GTA) — er weicht aufs kleine Modell aus und antwortet knapper.',
    });
  }

  for (const a of anmeldungen) {
    if (a.schliesstIn !== null && a.schliesstIn <= 6 && a.schliesstIn > 0 && a.max && a.dabei < a.max && a.anteil >= 0.6) {
      liste.push({ stufe: 'gelb', text: `${a.titel} schließt in ${a.schliesstIn} Min — ${a.max - a.dabei} fehlen noch.` });
    }
  }

  // Selbst erstellte Anmeldungen haben kein closeAt und bleiben stehen, bis
  // jemand sie schliesst. Fuenf FamWars standen so bis zu zwoelf Tage offen.
  //
  // Zusammengefasst, nicht einzeln: fuenfmal derselbe Satz untereinander hat
  // im ersten Anlauf den halben Bildschirm gefuellt und alles andere nach
  // unten geschoben.
  const vergessen = anmeldungen.filter((a) => (
    a.schliesstIn === null && a.offenSeitStunden !== null && a.offenSeitStunden > 48
  ));
  if (vergessen.length === 1) {
    const a = vergessen[0];
    liste.push({
      stufe: 'gelb',
      text: `"${a.titel}" steht seit ${Math.round(a.offenSeitStunden / 24)} Tagen offen — vergessen zu schließen?`,
    });
  } else if (vergessen.length > 1) {
    const aeltester = Math.max(...vergessen.map((a) => a.offenSeitStunden));
    const namen = [...new Set(vergessen.map((a) => a.titel))].join(', ');
    liste.push({
      stufe: 'gelb',
      text: `${vergessen.length} Anmeldungen stehen seit bis zu ${Math.round(aeltester / 24)} Tagen offen (${namen}) — vergessen zu schließen?`,
    });
  }

  const guild = client.guilds.cache.get(config.guildId);
  if (guild) {
    const tickets = await alleTickets(guild, { nurGezaehlte: true });
    const ohneBesitzer = tickets.filter((k) => !personZuTicket(guild, k));
    if (ohneBesitzer.length) {
      liste.push({
        stufe: 'rot',
        text: `${ohneBesitzer.length} Ticket(s) ohne erkennbaren Besitzer: ${ohneBesitzer.map((k) => k.name).join(', ')}`,
      });
    }
  }

  return liste;
}

/** Der komplette Stand fuer die Seite. */
async function stand(client) {
  const anmeldungen = await offeneAnmeldungen();
  const technikStand = await technik();
  const guild = client.guilds.cache.get(config.guildId) || null;

  return {
    zeit: new Date().toISOString(),
    // Fuer die Sprunglinks zu einzelnen Nachrichten.
    guildId: config.guildId,
    anmeldungen,
    technik: technikStand,
    geplant: await geplantes(Date.now(), guild),
    lauf: laufStand(),
    logbuch: await logbuchStand(client),
    fehler: letzteFehler(),
    aktivitaet: letzteAktivitaet().map((a) => ({ ...a, text: mitNamen(a.text, guild) })),
    terminal: await terminal(),
    system: await systemWerte(client),
    anfragen: letzteAnfragen(),
    rechnet: rechnetGerade(),
    fragen: await offeneFragen(client).catch(() => []),
    kontext: config.ollamaNumCtx,
    bilder: {
      ...(await fortschritt().catch(() => ({ wartend: 0, gelesen: 0, gescheitert: 0 }))),
      liste: await alleGelesenen(25).catch(() => []),
    },
    warnungen: await warnungen(client, { anmeldungen, technikStand }),
    schalter: alleSchalter(),
  };
}

module.exports = {
  artVon, geplantes, logbuchStand, mitNamen, offeneAnmeldungen, stand, technik, terminal, warnungen,
};
