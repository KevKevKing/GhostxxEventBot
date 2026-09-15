const { config } = require('./config');
const { alleEvents, eventZeit, teilnehmer } = require('./event-history');
const { normalizeText } = require('./text-match');

// Was Ghostxx ueber den Server und die Leute weiss.
//
// Der Anlass: Im Leitungschat wurde er gefragt, wie viele Events er im Archiv
// hat. Antwort: "Ich verwalte keine persoenlichen Archive". Er hat 2354. Auf
// "wer ist Fedex Wave" kam "Der Begriff existiert so nicht" - der Mensch steht
// auf demselben Server.
//
// Er hat nicht gelogen. Er bekam die Zahlen nie zu sehen und hat die Luecke mit
// erfundenen Datenschutzregeln gefuellt. Deshalb dasselbe Vorgehen wie bei
// self-knowledge.js: Fakten kommen aus dem Code, das Modell formuliert nur.
//
// Alles hier wird LIVE aus Discord gelesen - Rollen, Namen, Kanaele. Nichts ist
// abgetippt, damit nichts veraltet, wenn ihr etwas umbenennt.

// Die Raenge tragen ihre Nummer im Namen: "9 Legende", "4 Member", "1 HOTEL".
const RANG_MUSTER = /^(\d+)\s+(.+)$/;

// Rollen, die keine Menschen beschreiben, sondern Technik.
//
// Discord markiert Rollen, die zu einem Bot oder einer Anbindung gehoeren,
// selbst als "managed" - das ist die verlaessliche Erkennung. Die Namensliste
// darunter faengt nur, was Discord nicht markiert (Booster) oder was von Hand
// angelegt wurde. Sie wird ueber normalizeText verglichen, deshalb steht dort
// "carl bot" und nicht "carl-bot".
const KEINE_AUFGABE = new Set([
  'unknown bot', 'lofi radio', 'jockie music', 'delatea', 'ghostxx', 'mee6',
  'sapphire', 'carl bot', 'server booster',
]);

function mitglieder(guild) {
  return guild?.members?.cache ? [...guild.members.cache.values()] : [];
}

function rollenMitAnzahl(guild) {
  const leute = mitglieder(guild);
  const rollen = guild?.roles?.cache ? [...guild.roles.cache.values()] : [];

  return rollen
    .filter((rolle) => rolle.name !== '@everyone')
    .map((rolle) => ({
      id: rolle.id,
      name: rolle.name,
      position: rolle.position,
      managed: Boolean(rolle.managed),
      anzahl: leute.filter((m) => m.roles.cache.has(rolle.id)).length,
    }));
}

/** Die nummerierte Rangleiter der Familie, hoechster Rang zuerst. */
function rangleiter(guild) {
  return rollenMitAnzahl(guild)
    .map((rolle) => {
      const treffer = rolle.name.match(RANG_MUSTER);
      if (!treffer) return null;
      return { ...rolle, stufe: Number(treffer[1]), bezeichnung: treffer[2].trim() };
    })
    .filter(Boolean)
    .sort((a, b) => b.stufe - a.stufe);
}

/**
 * Rollen, die eine Aufgabe beschreiben statt eines Rangs.
 *
 * Was die Rolle bedeutet, steht in ihrem Namen - "Auszahlung", "Beschwerde
 * Leitung", "zustaendig fuers Waffenlager". Das wird bewusst nicht uebersetzt
 * oder ausgeschmueckt: sobald ich eine Bedeutung dazuerfinde, faengt genau das
 * Problem wieder an, das hier geloest werden soll.
 */
function aufgabenRollen(guild) {
  const raenge = new Set(rangleiter(guild).map((r) => r.id));

  return rollenMitAnzahl(guild)
    .filter((rolle) => !raenge.has(rolle.id))
    .filter((rolle) => !rolle.managed)
    .filter((rolle) => rolle.anzahl > 0 && rolle.anzahl <= 40)
    .filter((rolle) => !KEINE_AUFGABE.has(normalizeText(rolle.name)))
    .sort((a, b) => b.position - a.position);
}

/** Was in welchem Kanal passiert. Kommt aus der Konfiguration. */
function kanalKarte() {
  return [
    [config.eventChannelId, 'Event-Anmeldungen, die der Bot selbst postet'],
    [config.stateChannelId, 'SK-Meldungen (Angriff und Verteidigung)'],
    [config.logbookChannelId, 'Logbuch: Nachweise und Auszahlung'],
    [config.visaChannelId, 'Abstimmung ueber Aufnahmen, Bot prueft die Paesse'],
    [config.giveawayChannelId, 'Verlosungen'],
    [config.chatChannelId, 'normaler Chat'],
    [config.botHomeChannelId, 'Ghostxx sein eigener Kanal'],
  ].filter(([id]) => id);
}

/** Wer ist diese Person? Rang, Aufgaben, seit wann dabei, wie oft dabei. */
async function personProfil(guild, member) {
  if (!member) return null;

  const rollenIds = new Set(member.roles?.cache ? [...member.roles.cache.keys()] : []);
  const rang = rangleiter(guild).find((r) => rollenIds.has(r.id));
  const aufgaben = aufgabenRollen(guild).filter((r) => rollenIds.has(r.id));

  const events = await alleEvents();
  const dabei = events.filter((e) => teilnehmer(e).includes(member.id));
  const letzte = dabei
    .map((e) => ({ titel: e.title, zeit: eventZeit(e) }))
    .filter((e) => e.zeit)
    .sort((a, b) => b.zeit - a.zeit)[0];

  return {
    id: member.id,
    name: member.displayName || member.user?.username || member.id,
    rang: rang ? `${rang.stufe} ${rang.bezeichnung}` : null,
    aufgaben: aufgaben.map((r) => r.name),
    dabeiSeit: member.joinedTimestamp ? new Date(member.joinedTimestamp) : null,
    teilnahmen: dabei.length,
    letztesEvent: letzte ? { titel: letzte.titel, zeit: new Date(letzte.zeit) } : null,
  };
}

function datum(d) {
  return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

function beschreibePerson(p) {
  const teile = [`**${p.name}**`];
  if (p.rang) teile.push(`Rang ${p.rang}`);
  if (p.aufgaben.length) teile.push(`Aufgaben: ${p.aufgaben.join(', ')}`);
  if (p.dabeiSeit) teile.push(`auf dem Discord seit ${datum(p.dabeiSeit)}`);
  teile.push(p.teilnahmen ? `${p.teilnahmen} Event-Anmeldungen` : 'noch bei keinem Event angemeldet');
  if (p.letztesEvent) teile.push(`zuletzt ${p.letztesEvent.titel} am ${datum(p.letztesEvent.zeit)}`);
  return teile.join(', ') + '.';
}

/** Harte Zahlen zum Betrieb - die, die er zuletzt erfunden hat. */
async function zahlen(guild) {
  const events = await alleEvents();
  const { EVENT_SLOTS } = require('./schedule-data');
  const { listEventLabels } = require('./logbook-events');

  const jetzt = Date.now();
  const monat = events.filter((e) => {
    const z = eventZeit(e);
    return z && jetzt - z < 30 * 24 * 60 * 60 * 1000;
  });

  return {
    imArchiv: events.length,
    letzte30Tage: monat.length,
    proTag: EVENT_SLOTS.length,
    eventArten: listEventLabels().length,
    mitglieder: mitglieder(guild).length,
  };
}

/**
 * Stellt zusammen, was zur Frage passt.
 *
 * Bewusst nach Stichwort ausgewaehlt und nicht alles auf einmal: Steht der
 * ganze Serverzustand bei jeder Nachricht im Prompt, zieht er ihn ins
 * Gespraech. Auf "wer war Napoleon" kam frueher ein Hinweis auf laufende
 * Familienprojekte - er konnte gar nicht anders, die Info lag vor ihm.
 */
async function buildServerContext(text, guild) {
  if (!guild) return '';

  const t = normalizeText(text);
  const teile = [];

  const fragtNachZahlen = /\b(wie viele|anzahl|archiv|gespeichert|insgesamt|statistik|events? hast du|events? habt ihr|quote)\b/.test(t);
  const fragtNachLeuten = /\b(wer ist wer|wer sind|wie viele leute|wie viele mitglieder|raenge|rang|rangliste|leitung|hierarchie)\b/.test(t);
  const fragtNachAufgaben = /\b(wer macht|aufgabe|aufgaben|zustaendig|verantwortlich|kuemmert sich|wer darf)\b/.test(t);
  const fragtNachOrten = /\b(wo |welcher kanal|welchen kanal|channel|kanal)\b/.test(t);

  if (fragtNachZahlen) {
    const z = await zahlen(guild);
    teile.push(
      `Zahlen, die stimmen: ${z.imArchiv} Anmeldungen im Archiv, davon ${z.letzte30Tage} in den letzten 30 Tagen. `
      + `${z.proTag} Termine am Tag im Plan, ${z.eventArten} Eventarten im Logbuch, ${z.mitglieder} Leute auf dem Discord.`,
    );
  }

  if (fragtNachLeuten) {
    const leiter = rangleiter(guild);
    if (leiter.length) {
      teile.push(
        'Die Raenge der Familie, von oben nach unten: '
        + leiter.map((r) => `${r.stufe} ${r.bezeichnung} (${r.anzahl})`).join(', ') + '.',
      );
    }
  }

  if (fragtNachAufgaben) {
    const alle = aufgabenRollen(guild);

    // Wird eine Rolle namentlich gesucht ("wer ist fuer die AUSZAHLUNG
    // zustaendig"), gehoert sie nach vorn. Sonst steht die Antwort an Position
    // vierzehn einer Aufzaehlung und geht unter.
    // Woerter, die in der Frage UND in Rollennamen vorkommen, ohne etwas zu
    // bedeuten. Ohne sie traf "wer ist fuer die Auszahlung zustaendig" auch
    // "zustaendig fuers Waffenlager".
    const FUELLWORT = new Set(['zustaendig', 'verantwortlich', 'leitung', 'verwaltung', 'erlaubnis']);

    const frageWorte = t.split(' ').filter((w) => w.length >= 5 && !FUELLWORT.has(w));

    const gemeint = alle.filter((r) => {
      const rollenWorte = normalizeText(r.name).split(' ').filter((w) => w.length >= 5 && !FUELLWORT.has(w));
      // In beide Richtungen: "ausbildung" in der Frage soll auch
      // "ausbildungsleitung" finden, nicht nur umgekehrt.
      return rollenWorte.some((rw) => frageWorte.some((fw) => rw.includes(fw) || fw.includes(rw)));
    });

    const auswahl = [...gemeint, ...alle.filter((r) => !gemeint.includes(r))].slice(0, 18);

    if (auswahl.length) {
      teile.push(
        (gemeint.length ? `Passt zur Frage: ${gemeint.map((r) => `${r.name} (${r.anzahl} Leute)`).join(', ')}. Weitere Rollen: ` : 'Rollen mit einer Aufgabe: ')
        + auswahl.filter((r) => !gemeint.includes(r)).map((r) => `${r.name} (${r.anzahl})`).join(', ')
        + '. Was die Rolle bedeutet, steht in ihrem Namen - denk dir nichts dazu.',
      );
    }
  }

  if (fragtNachOrten) {
    teile.push('Was wo passiert: ' + kanalKarte().map(([id, was]) => `<#${id}> ${was}`).join('; ') + '.');
  }

  return teile.join('\n');
}

module.exports = {
  aufgabenRollen,
  beschreibePerson,
  buildServerContext,
  kanalKarte,
  personProfil,
  rangleiter,
  zahlen,
};
