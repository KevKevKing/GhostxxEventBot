const { ChannelType, OverwriteType } = require('discord.js');
const { check, equal, finish, section } = require('./lib');
const { config } = require('../src/config');
const {
  alleTickets, benutzernameAus, istTicket, personZuTicket, spielernummerAus,
  ticketVonPerson, ticketnummer, zaehltMit,
} = require('../src/logbuch-tickets');
const { zuKanalname } = require('../src/ticket-namen');
const { merkeNamen } = require('../src/namens-gedaechtnis');

// Das Logbuch zieht vom Forum auf Tickets um. Ein Ticket ist ein Textkanal in
// einer der drei Logbuch-Kategorien und durchlaeuft drei Namen:
//
//   frisch:       58-ghost_muffin1           <Ticketnummer>-<Benutzername>
//   uebernommen:  danny-imucupancium-156215  vom Ticketbot umbenannt
//   aufgeraeumt:  𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215   von Ghostxx
//
// Alle drei muessen zur Person fuehren. Der Benutzername aendert sich praktisch
// nie, die Spielernummer nie - der Anzeigename staendig.

const OFFEN = config.logbookTicketCategoryIds[0];
const UEBERNOMMEN = config.logbookClaimedCategoryIds[0];
const GESCHLOSSEN = config.logbookTicketCategoryIds[2];

function kanal(name, { typ = ChannelType.GuildText, parentId = UEBERNOMMEN, rechteFuer = [] } = {}) {
  const eintraege = rechteFuer.map((id) => [id, { id, type: OverwriteType.Member }]);
  return {
    id: `c-${name}`,
    name,
    type: typ,
    parentId,
    permissionOverwrites: { cache: new Map(eintraege) },
  };
}

function member(id, username, displayName, bot = false) {
  return { id, user: { username, bot }, displayName };
}

const MITGLIEDER = [
  member('u1', 'ghost_muffin1', '! Ghost Muffiin | 266391'),
  member('u2', 'fedexwave', 'Fedex Wave I 258761'),
  member('u3', 'jconti', 'Johannes Conti ♡ | 19095'),
  member('u4', 'dannyd5117', 'Danny Imucupancium | 156215'),
  member('u5', 'finn.443', 'Nox Erotica I 265160'),
  member('bot', 'Unknown Bot', 'Unknown Bot', true),
];

const guild = {
  members: { cache: new Map(MITGLIEDER.map((m) => [m.id, m])) },
  channels: {
    cache: new Map([
      kanal('58-ghost_muffin1', { parentId: OFFEN }),
      kanal('59-fedexwave'),
      kanal('danny-imucupancium-156215'),
      kanal('66-ghost_muffin1-fedexwave'),
      kanal(zuKanalname('Johannes Conti ♡ | 19095')),
      kanal('60-unbekannterName'),
      kanal('chat-intern', { parentId: 'andere-kategorie' }),
      kanal('12-irgendwas', { parentId: 'andere-kategorie' }),
      kanal('logbuch-und-event-nachweis', { typ: ChannelType.GuildForum }),
    ].map((k) => [k.id, k])),
  },
};

(async () => {
  section('Die Kategorie entscheidet, nicht der Name');
  // Frueher musste der Name mit einer Zahl anfangen. Dann hat der Ticketbot
  // beim Claimen umbenannt - aus "64-dannyd5117" wurde
  // "danny-imucupancium-156215" - und der Bot hielt das Ticket fuer keins mehr.
  check('frisches Ticket', istTicket(kanal('58-ghost_muffin1', { parentId: OFFEN })));
  check('uebernommenes Ticket', istTicket(kanal('danny-imucupancium-156215')));
  check('aufgeraeumtes Ticket', istTicket(kanal('𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215')));
  check('beliebiger Name in der Kategorie', istTicket(kanal('irgendein-name')));

  check('normaler Kanal nicht', !istTicket(kanal('chat-intern', { parentId: 'andere-kategorie' })));
  check('andere Kategorie nicht', !istTicket(kanal('12-irgendwas', { parentId: 'woanders' })));
  check('Forum ist kein Ticket', !istTicket(kanal('58-ghost_muffin1', { typ: ChannelType.GuildForum })));
  check('nichts vertraegt es', !istTicket(null));

  section('Gezaehlt wird nur, was jemand uebernommen hat');
  // Die frischen hat noch niemand angesehen, die geschlossenen sind bezahlt.
  // Wuerden die mitzaehlen, bekaeme jemand seine Events zweimal ausgezahlt.
  check('uebernommenes zaehlt', zaehltMit(kanal('danny-imucupancium-156215')));
  check('frisches nicht', !zaehltMit(kanal('58-ghost_muffin1', { parentId: OFFEN })));
  check('geschlossenes nicht', !zaehltMit(kanal('alt-4711', { parentId: GESCHLOSSEN })));
  check('Fremdkanal nicht', !zaehltMit(kanal('chat-intern', { parentId: 'woanders' })));

  // Seit dem 16.08.2026 gibt es "Logbuch" UND "Logbuch 2" - zwei komplette
  // Kategorien-Saetze, kein Unterschied zwischen ihnen. Ein Ticket in der
  // zweiten muss genauso zaehlen wie eins in der ersten.
  const UEBERNOMMEN_2 = config.logbookClaimedCategoryIds[1];
  check('zweite Logbuch-Kategorie gibt es', Boolean(UEBERNOMMEN_2));
  check('uebernommenes in "Logbuch 2" zaehlt auch',
    zaehltMit(kanal('mona-riese-88214', { parentId: UEBERNOMMEN_2 })));

  section('Name auseinandernehmen');
  equal('Benutzername (frisch)', benutzernameAus('58-ghost_muffin1'), 'ghost_muffin1');
  equal('Ticketnummer', ticketnummer('58-ghost_muffin1'), 58);
  equal('Name mit Bindestrich bleibt ganz', benutzernameAus('7-max-mustermann'), 'max-mustermann');
  equal('Grossbuchstaben werden klein', benutzernameAus('9-GhostMuffin'), 'ghostmuffin');

  equal('Spielernummer (uebernommen)', spielernummerAus('danny-imucupancium-156215'), '156215');
  equal('  auch kurze Nummern', spielernummerAus('johannes-conti-19095'), '19095');
  // Aufgeraeumt steht vor der Nummer kein Bindestrich mehr, sondern ein Strich.
  equal('Spielernummer (aufgeraeumt)', spielernummerAus('𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215'), '156215');
  // Beim frischen Ticket steht vorn die TICKETnummer - die ist nicht gemeint.
  equal('frisches Ticket hat keine Spielernummer', spielernummerAus('58-ghost_muffin1'), '');

  section('Zuordnung: der Besitzer steht in den Kanalrechten');
  // Der echte Fall: Saschas Ticket hiess "66-ghost_muffin1-chrismo_", weil
  // Ghost es sich vorgenommen hatte. Nach dem Namen gelesen waere es Ghosts
  // Logbuch gewesen - und Saschas Nachweise haetten bei Ghost gezaehlt.
  const verdreht = kanal('66-ghost_muffin1-fedexwave', { rechteFuer: ['u2', 'bot'] });
  equal('Rechte schlagen den Namen', personZuTicket(guild, verdreht)?.id, 'u2');

  // Zwei Menschen mit Rechten: dann ist nicht klar, wer gemeint ist.
  const unklar = kanal('58-ghost_muffin1', { rechteFuer: ['u1', 'u2'] });
  equal('bei zweien entscheidet wieder der Name', personZuTicket(guild, unklar)?.id, 'u1');

  section('Zuordnung: Besitzer hat den Server verlassen (25.08.)');
  // Discord loescht die Kanalrechte NICHT, wenn jemand den Server verlaesst -
  // die ID steht weiter da, nur im Mitglieder-Zwischenspeicher (guild.members.cache)
  // taucht sie nicht mehr auf. Vorher blieb so ein Ticket fuer immer "ohne
  // erkennbaren Besitzer" haengen, und "Er fragt" stellte eine Frage, auf die
  // nie eine gute Antwort kommen konnte.
  await merkeNamen('u9', 'Beren Colucci | 171399');
  const verlassen = kanal('81-wermalfrueher', { rechteFuer: ['u9'] });
  const exBesitzer = personZuTicket(guild, verlassen);
  check('trotzdem gefunden', Boolean(exBesitzer), JSON.stringify(exBesitzer));
  equal('  ueber den letzten bekannten Namen', exBesitzer?.displayName, 'Beren Colucci | 171399');
  equal('  richtige ID', exBesitzer?.id, 'u9');
  check('  als "hat verlassen" markiert', exBesitzer?.hatVerlassen === true);

  // Zwei nicht aufloesbare Rechte-Eintraege gleichzeitig: wieder mehrdeutig,
  // genau wie bei zwei echten Mitgliedern oben - nicht raten, welcher gemeint ist.
  await merkeNamen('u10', 'Zweite Person | 999999');
  const zweiVerlassen = kanal('82-zweiweg', { rechteFuer: ['u9', 'u10'] });
  equal('zwei Verlassene: mehrdeutig', personZuTicket(guild, zweiVerlassen), null);

  // Kein Namensgedaechtnis-Eintrag zu der ID: bleibt wie bisher unklar, kein
  // Erfinden eines Namens.
  const ganzUnbekannt = kanal('83-niewasgehabt', { rechteFuer: ['u404'] });
  equal('ganz unbekannte ID: nichts erfunden', personZuTicket(guild, ganzUnbekannt), null);

  // Kevins echter Fall (25.08., ueber die Discord-API nachgeschaut): bei
  // fuenf gemeldeten Tickets stand am Ende gar keine menschliche ID mehr in
  // den Kanalrechten, nur noch der Ticketbot - Discord hatte das Kanalrecht
  // beim Gehen mit entfernt. Die Spielernummer im (aufgeraeumten) Namen war
  // die einzige verbliebene Spur, und das Namensgedaechtnis kannte sie noch.
  //
  // Bewusst eine erfundene Nummer (900001), keine echte aus den Daten:
  // namens-gedaechtnis.js liest data/namen.json, die ECHTEN Produktionsdaten
  // - eine reale Nummer haette hier gegen einen echten Eintrag kollidieren
  // koennen und die "mehrdeutig"-Sicherung faelschlich ausgeloest (ist mir
  // beim ersten Anlauf mit 289911 genau so passiert).
  await merkeNamen('u11', 'Franco Testperson | 900001');
  const nurBot = kanal(zuKanalname('Franco Testperson | 900001'), { rechteFuer: ['bot'] });
  const ueberNummer = personZuTicket(guild, nurBot);
  check('ueber die Nummer im Namen gefunden', Boolean(ueberNummer), JSON.stringify(ueberNummer));
  equal('  richtiger Name', ueberNummer?.displayName, 'Franco Testperson | 900001');
  check('  als "hat verlassen" markiert', ueberNummer?.hatVerlassen === true);

  // Und wenn wir zu der Nummer NIE einen Namen gemerkt haben (Hassan Colucci
  // in Kevins Meldung): bleibt es ehrlich unklar, nichts wird erfunden.
  const nummerUnbekannt = kanal(zuKanalname('Ganz Unbekannt | 900002'), { rechteFuer: ['bot'] });
  equal('unbekannte Nummer: nichts erfunden', personZuTicket(guild, nummerUnbekannt), null);

  section('Zuordnung: frisches Ticket ueber den Benutzernamen');
  // Der Anzeigename ist "! Ghost Muffiin | 266391" - voellig anders als
  // "ghost_muffin1". Ueber den Anzeigenamen waere die Person nicht zu finden.
  const person = personZuTicket(guild, kanal('58-ghost_muffin1', { parentId: OFFEN }));
  equal('findet den Menschen', person?.id, 'u1');
  equal('  trotz ganz anderem Anzeigenamen', person?.displayName, '! Ghost Muffiin | 266391');
  equal('zweites Ticket', personZuTicket(guild, kanal('59-fedexwave'))?.id, 'u2');

  // Beim Uebernehmen schiebt der Ticketbot den Uebernehmer davor:
  // aus "66-fedexwave" wird "66-ghost_muffin1-fedexwave". Das Ticket gehoert
  // weiter Fedex, nicht Ghost - sonst laege der Nachweis beim Falschen.
  const dazwischen = personZuTicket(guild, kanal('66-ghost_muffin1-fedexwave'));
  equal('Besitzer, nicht Uebernehmer', dazwischen?.id, 'u2');

  // Punkte im Benutzernamen laesst Discord im Kanalnamen weg.
  equal('finn.443 -> 77-finn443', personZuTicket(guild, kanal('77-finn443'))?.id, 'u5');

  section('Zuordnung: geclaimtes Ticket ueber die Spielernummer');
  // Der Benutzername ist "dannyd5117", im Kanalnamen steht aber der
  // Anzeigename. Nur die Nummer am Ende passt zu beidem.
  const danny = personZuTicket(guild, kanal('danny-imucupancium-156215'));
  equal('findet den Menschen', danny?.id, 'u4');
  equal('  ueber die Nummer', danny?.displayName, 'Danny Imucupancium | 156215');

  section('Zuordnung: aufgeraeumtes Ticket');
  // Nach dem Aufraeumen steht der Name in mathematischen Buchstaben da. Die
  // Nummer am Ende ist normal geblieben - genau dafuer.
  const johannes = personZuTicket(guild, kanal(zuKanalname('Johannes Conti ♡ | 19095')));
  equal('findet den Menschen', johannes?.id, 'u3');

  equal('unbekannter Name -> nichts', personZuTicket(guild, kanal('60-unbekannterName')), null);
  equal('kein Ticket -> nichts', personZuTicket(guild, kanal('chat-intern', { parentId: 'x' })), null);

  section('Andersherum: Ticket zu einer Person');
  equal('frisches', (await ticketVonPerson(guild, MITGLIEDER[0]))?.name, '58-ghost_muffin1');
  equal('uebernommenes', (await ticketVonPerson(guild, MITGLIEDER[3]))?.name, 'danny-imucupancium-156215');
  equal('aufgeraeumtes', (await ticketVonPerson(guild, MITGLIEDER[2]))?.name, zuKanalname('Johannes Conti ♡ | 19095'));

  section('Alle Tickets einsammeln');
  const alle = await alleTickets(guild);
  equal('sechs Tickets', alle.length, 6);
  check('Chat ist nicht dabei', !alle.some((k) => k.name === 'chat-intern'));

  const gezaehlt = await alleTickets(guild, { nurGezaehlte: true });
  equal('davon fuenf uebernommen', gezaehlt.length, 5);
  check('alle aus der uebernommen-Kategorie', gezaehlt.every((k) => k.parentId === UEBERNOMMEN));

  equal('ohne Server keine Tickets', (await alleTickets(null)).length, 0);

  section('Alphabetisch stellen');
  // Discord sortiert nach Position, nicht nach Namen - neue Tickets landen
  // hinten. Sortiert wird nach dem entfetteten Namen, sonst kaemen alle
  // Grossbuchstaben vor den kleinen.
  const { sortiereTickets } = require('../src/ticket-aufraeumer');

  const reihenfolge = [];
  const sortierGuild = {
    members: guild.members,
    channels: {
      cache: new Map([
        kanal(zuKanalname('Zarti Erotica | 314695')),
        kanal(zuKanalname('Ace Yarrak | 165374')),
        kanal(zuKanalname('Max Kok | 227216')),
        kanal('58-ghost_muffin1', { parentId: OFFEN }),
      ].map((k, i) => [k.id, { ...k, position: i }])),
      setPositions: async (liste) => { reihenfolge.push(...liste); },
    },
  };

  const anzahl = await sortiereTickets(sortierGuild);
  equal('drei Tickets gestellt', anzahl, 3);
  equal('  in einem Aufruf', reihenfolge.length, 3);

  const namen = reihenfolge.map((e) => sortierGuild.channels.cache.get(e.channel).name);
  check('Ace zuerst', namen[0].includes(zuKanalname('Ace Yarrak | 165374')), namen.join(' | '));
  check('Zarti zuletzt', namen[2].includes(zuKanalname('Zarti Erotica | 314695')), namen.join(' | '));
  check('frisches Ticket nicht dabei', !namen.some((n) => n.includes('ghost_muffin1')), namen.join(' | '));

  // Steht schon alles richtig, wird nichts angefasst. Wichtig, seit das jede
  // Minute laeuft: sonst schickt der Bot 1440-mal am Tag dieselbe Sortierung
  // an Discord. Genau das ist im Betrieb passiert - die alte Pruefung
  // verglich gegen die Cache-Reihenfolge und verlangte lueckenlose
  // Positionen ab der ersten, beides trifft im Alltag nie zu.
  const schonSortiert = [];
  const bereitsRichtig = {
    members: guild.members,
    channels: {
      // Absichtlich in FALSCHER Reihenfolge in die Map gelegt und mit
      // Positionsluecken - so sieht es in echt aus. Entscheidend ist allein,
      // dass die Positionen aufsteigend zur alphabetischen Ordnung passen.
      cache: new Map([
        [`c-${zuKanalname('Zarti Erotica | 314695')}`, { ...kanal(zuKanalname('Zarti Erotica | 314695')), position: 12 }],
        [`c-${zuKanalname('Ace Yarrak | 165374')}`, { ...kanal(zuKanalname('Ace Yarrak | 165374')), position: 4 }],
        [`c-${zuKanalname('Max Kok | 227216')}`, { ...kanal(zuKanalname('Max Kok | 227216')), position: 9 }],
      ]),
      setPositions: async (liste) => { schonSortiert.push(...liste); },
    },
  };
  equal('nichts zu tun', await sortiereTickets(bereitsRichtig), 0);
  equal('  und nichts an Discord geschickt', schonSortiert.length, 0);

  section('Zwei Kategorien werden getrennt sortiert');
  // Seit es "Logbuch" und "Logbuch 2" gibt: Discord zaehlt Positionen
  // INNERHALB einer Kategorie. Alle in einen Topf und 0..n zu vergeben, mischt
  // zwei unabhaengige Reihenfolgen durcheinander.
  const UEBERNOMMEN_B = config.logbookClaimedCategoryIds[1];
  const zweiKategorien = [];
  const guildZwei = {
    members: guild.members,
    channels: {
      cache: new Map([
        [`k1-z`, { ...kanal(zuKanalname('Zarti Erotica | 314695')), position: 0 }],
        [`k1-a`, { ...kanal(zuKanalname('Ace Yarrak | 165374')), position: 1 }],
        [`k2-m`, { ...kanal(zuKanalname('Max Kok | 227216'), { parentId: UEBERNOMMEN_B }), position: 0 }],
        [`k2-b`, { ...kanal(zuKanalname('Anna Dakota | 291245'), { parentId: UEBERNOMMEN_B }), position: 1 }],
      ]),
      setPositions: async (liste) => { zweiKategorien.push(...liste); },
    },
  };

  await sortiereTickets(guildZwei);
  const proKanal = new Map(zweiKategorien.map((e) => [e.channel, e.position]));
  const idVon = (name) => `c-${zuKanalname(name)}`;
  // Jede Kategorie fuer sich: Ace vor Zarti, Anna vor Max.
  check('Kategorie 1 alphabetisch',
    proKanal.get(idVon('Ace Yarrak | 165374')) < proKanal.get(idVon('Zarti Erotica | 314695')),
    JSON.stringify([...proKanal]));
  check('Kategorie 2 alphabetisch',
    proKanal.get(idVon('Anna Dakota | 291245')) < proKanal.get(idVon('Max Kok | 227216')),
    JSON.stringify([...proKanal]));
  // Die vorhandenen Plaetze bleiben - der Block wandert nicht durch die Liste.
  check('bleibt bei den vorhandenen Positionen',
    zweiKategorien.every((e) => e.position === 0 || e.position === 1),
    JSON.stringify(zweiKategorien));

  section('Der Minutentakt darf den Bot nicht umbringen');
  // Am 16.08. hat ein Timer mit logBotEvent(...).catch() den Bot gekillt -
  // mitten in Kevins Sammelauszahlung. logBotEvent gibt nichts zurueck, .catch
  // auf undefined ist ein TypeError, und im Timer faengt den niemand.
  const quelle = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'ticket-aufraeumer.js'), 'utf8',
  );
  const codeZeilen = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  check('kein .catch an logBotEvent', !/logBotEvent\([^;]*\)\s*\.catch/.test(codeZeilen));
  check('der Takt faengt seine Fehler selbst', /taktDurchgang\(client\)\s*\.catch/.test(codeZeilen));
  check('und laesst keine zwei Durchgaenge gleichzeitig zu', /laeuftDurchgang/.test(codeZeilen));

  finish();
})();
