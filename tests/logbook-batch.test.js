const { ChannelType } = require('discord.js');
const { check, equal, finish, section } = require('./lib');
const { config } = require('../src/config');
const {
  chunkBlocks, fetchAllThreads, formatGesamt, formatPerson, teileText,
} = require('../src/logbook-batch');

function zaehler(paare) {
  return new Map(Object.entries(paare));
}

section('Eine Person');
const person = formatPerson({
  thread: { name: 'Danny Pepmuckl | 156215' },
  zaehler: zaehler({ '40er': { win: 4, lose: 2 }, bizwar: { win: 0, lose: 2 } }),
  probleme: [],
});
check('Name und ID als Überschrift', person.includes('**Danny Pepmuckl | 156215**'), person);
check('Kopfzeile Event | Win | Lose', /Event\s+\| Win \| Lose/.test(person), person);
check('40er mit 4 Siegen', /40er\s+\|\s+4 \|\s+2/.test(person), person);
check('Bizwar mit 2 Niederlagen', /Bizwar\s+\|\s+0 \|\s+2/.test(person), person);
// Reihenfolge folgt dem Katalog, nicht dem Zufall.
check('40er steht vor Bizwar', person.indexOf('40er') < person.indexOf('Bizwar'));

section('Person mit Problemen');
const mitProblemen = formatPerson({
  thread: { name: 'Lee oogway | 172082' },
  zaehler: zaehler({ sk: { win: 1, lose: 0 } }),
  probleme: [{}, {}, {}],
});
check('Hinweis auf die Anzahl', /3 Beiträge zum Anschauen/.test(mitProblemen), mitProblemen);

section('Person ohne alles');
equal('faellt raus', formatPerson({ thread: { name: 'X' }, zaehler: new Map(), probleme: [] }), '');

const nurProbleme = formatPerson({ thread: { name: 'Y | 1' }, zaehler: new Map(), probleme: [{}] });
check('nur Probleme: kurze Zeile', /nichts zu zählen/.test(nurProbleme), nurProbleme);

section('Gesamtsumme über alle');
const gesamt = formatGesamt([
  { zaehler: zaehler({ '40er': { win: 4, lose: 2 }, sk: { win: 1, lose: 1 } }) },
  { zaehler: zaehler({ '40er': { win: 3, lose: 0 }, bizwar: { win: 0, lose: 5 } }) },
]);
check('40er zusammengezaehlt', /40er\s+\|\s+7 \|\s+2/.test(gesamt), gesamt);
check('SK uebernommen', /SK\s+\|\s+1 \|\s+1/.test(gesamt), gesamt);
check('Bizwar uebernommen', /Bizwar\s+\|\s+0 \|\s+5/.test(gesamt), gesamt);
check('Gesamtzeile', /Gesamt\s+\|\s+8 \|\s+8/.test(gesamt), gesamt);

section('Aufteilung auf mehrere Nachrichten');
// Ueber dreissig Personen passen nicht in eine Discord-Nachricht.
const viele = Array.from({ length: 40 }, (_, i) => formatPerson({
  thread: { name: `Spieler Nummer ${i} | ${100000 + i}` },
  zaehler: zaehler({ '40er': { win: i, lose: 1 }, bizwar: { win: 1, lose: 1 } }),
  probleme: [],
}));

const nachrichten = chunkBlocks(viele, '**Sammelauszahlung**');
check('auf mehrere verteilt', nachrichten.length > 1, `${nachrichten.length}`);
check('keine ueber 2000 Zeichen', nachrichten.every((n) => n.length <= 2000),
  nachrichten.map((n) => n.length).join(', '));
check('Kopfzeile nur in der ersten', nachrichten.filter((n) => n.includes('Sammelauszahlung')).length === 1);

// Nichts darf verlorengehen.
const zusammen = nachrichten.join('\n');
check('alle 40 Personen enthalten',
  viele.every((_, i) => zusammen.includes(`Spieler Nummer ${i} | ${100000 + i}`)));

section('Wenig passt in eine Nachricht');
const wenige = chunkBlocks(viele.slice(0, 2), '**Sammelauszahlung**');
equal('eine Nachricht reicht', wenige.length, 1);

section('Die Abrechnung im eigenen Ticket');
// Das Ticket IST das Logbuch und bleibt dauerhaft offen. Die Auswertung steht
// dort direkt ueber den Nachweisen, auf die sie sich bezieht - deshalb braucht
// sie keinen Namen darueber.
const imTicket = formatPerson({
  thread: { name: '𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215' },
  zaehler: zaehler({ '40er': { win: 4, lose: 2 } }),
  probleme: [],
}, { imTicket: true });
check('heisst Auszahlung', imTicket.startsWith('**Auszahlung**'), imTicket);
check('ohne Namen darueber', !imTicket.includes('𝗗𝗮𝗻𝗻𝘆'), imTicket);
check('Zahlen stehen drin', /40er\s+\|\s+4 \|\s+2/.test(imTicket), imTicket);

const inListe = formatPerson({
  thread: { name: '𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215' },
  zaehler: zaehler({ '40er': { win: 4, lose: 2 } }),
  probleme: [],
});
check('in einer Liste mit Namen', inListe.includes('𝗗𝗮𝗻𝗻𝘆'), inListe);

section('Strittige Beitraege mit Sprunglink');
// Im Ticket liegen die Beitraege ja - ein Klick springt hin, statt dass jemand
// raten muss, welche der fuenfzig Nachrichten gemeint ist.
function problem(text, url, grund) {
  return { eintrag: { text, url }, grund };
}

const strittig = formatPerson({
  thread: { name: 'X' },
  zaehler: zaehler({ '40er': { win: 1, lose: 0 } }),
  probleme: [
    problem('Bizwar Win', 'https://discord.com/channels/1/2/3', 'Im Bild steht 40er'),
    problem('40er Win', 'https://discord.com/channels/1/2/4', 'Kein Event im Bild'),
  ],
}, { imTicket: true });

check('Ueberschrift', strittig.includes('**2 zum Anschauen:**'), strittig);
check('erster Link', strittig.includes('[Bizwar Win](https://discord.com/channels/1/2/3)'), strittig);
check('zweiter Link', strittig.includes('(https://discord.com/channels/1/2/4)'), strittig);
check('mit Begruendung', strittig.includes('Im Bild steht 40er'), strittig);

// Auch wenn nichts zu zaehlen war, sollen die strittigen Beitraege auftauchen -
// sonst weiss die Person nicht, warum bei ihr null steht.
const ohneZaehlung = formatPerson({
  thread: { name: 'X' },
  zaehler: zaehler({}),
  probleme: [problem('40er Win', 'https://discord.com/channels/1/2/5', 'Kein Event im Bild')],
}, { imTicket: true });
check('auch ohne Zaehlung', ohneZaehlung.includes('(https://discord.com/channels/1/2/5)'), ohneZaehlung);

// In der Sammelliste bleibt es bei der Anzahl - dort waeren fuenfzig Links Brei.
const listeMitProblemen = formatPerson({
  thread: { name: 'X' },
  zaehler: zaehler({ '40er': { win: 1, lose: 0 } }),
  probleme: [problem('Bizwar Win', 'https://discord.com/channels/1/2/3', 'Im Bild steht 40er')],
});
check('Liste nur mit Anzahl', !listeMitProblemen.includes('https://'), listeMitProblemen);

section('Zu lange Nachrichten aufteilen');
// Tabelle plus zwoelf Links sprengt Discords 2000 Zeichen. Hart abschneiden
// wuerde einen Markdown-Link zerreissen - dann steht da Kauderwelsch.
const lang = Array.from({ length: 60 }, (_, i) => `• [Beitrag ${i}](https://discord.com/channels/1/2/${i}) — ein ziemlich langer Grund`).join('\n');
const teile = teileText(lang);
check('wird aufgeteilt', teile.length > 1, `${teile.length}`);
check('jedes Stueck passt', teile.every((t) => t.length <= 1900));
check('keine Zeile zerrissen', teile.every((t) => t.split('\n').every((z) => !z.startsWith('• [') || z.includes(')'))));
equal('nichts verloren', teile.join('\n'), lang);
equal('kurzes bleibt eins', teileText('kurz').length, 1);

section('Woher die Sammelauszahlung ihre Logbuecher nimmt');
// Nur die uebernommenen Tickets. Die alten Forum-Threads liefen frueher mit -
// und waren die einzige Stelle, an der ein Bild zweimal zaehlen konnte:
// derselbe Screenshot im alten Thread UND im neuen Ticket faellt nicht auf,
// weil der Doppel-Abgleich nur innerhalb eines Logbuchs laeuft.
const UEBERNOMMEN = config.logbookClaimedCategoryIds[0];
const OFFEN = config.logbookTicketCategoryIds.find((id) => !config.logbookClaimedCategoryIds.includes(id));

function kanal(name, parentId) {
  return { id: `c-${name}`, name, type: ChannelType.GuildText, parentId };
}

const forumThread = {
  id: 't1',
  name: 'Yoshi Dakota | 217498',
  type: ChannelType.PublicThread,
  parentId: config.logbookChannelId,
};

const guild = {
  channels: {
    cache: new Map([
      kanal('uebernommen-1', UEBERNOMMEN),
      kanal('uebernommen-2', UEBERNOMMEN),
      kanal('noch-frisch', OFFEN),
      kanal('chat-intern', 'ganz-woanders'),
      forumThread,
    ].map((k) => [k.id, k])),
  },
};

const client = { guilds: { cache: new Map([[config.guildId, guild]]) } };

(async () => {
  const gefunden = await fetchAllThreads(client);
  const namen = gefunden.map((k) => k.name).sort();

  equal('zwei Logbuecher', gefunden.length, 2);
  equal('  beide uebernommen', namen.join(), 'uebernommen-1,uebernommen-2');
  check('kein Forum-Thread dabei', !gefunden.some((k) => k.id === 't1'));
  check('kein frisches Ticket dabei', !gefunden.some((k) => k.name === 'noch-frisch'));
  check('kein fremder Kanal dabei', !gefunden.some((k) => k.name === 'chat-intern'));

  finish();
})();
