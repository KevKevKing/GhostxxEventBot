const { config } = require('./config');
const { alleTickets } = require('./logbuch-tickets');
const { logBotEvent } = require('./logger');
const { collectProblems, readEntries, tally } = require('./logbook');
const { EVENTS } = require('./logbook-events');
const {
  markCounted, problemZeile, resolveAttentionEmoji, resolveCheckEmoji, resolveMarkerEmoji,
  verifyEntries,
} = require('./logbook-command');
const { beendeLauf, laufStand, meldeFortschritt, starteLauf } = require('./lauf-stand');

// Sammelauszahlung: alle uebernommenen Logbuch-Tickets auf einmal.
//
// Einzeln waeren das ueber dreissig Befehle. Hier laeuft es in einem Rutsch
// und das Ergebnis landet im Rueckzugskanal - dort stoert es niemanden und
// man hat alles beieinander.
//
// Das dauert: pro Bild sechs bis siebzehn Sekunden. Bei vielen offenen
// Beitraegen sind das schnell zehn Minuten. Discord laesst eine Antwort auf
// einen Befehl nur fuenfzehn Minuten offen, deshalb wird das Ergebnis als
// normale Nachricht gepostet und nicht als Antwort auf den Befehl.

const MAX_NACHRICHT = 1900;

/**
 * Alle Logbuecher, die mitgezaehlt werden.
 *
 * Ausschliesslich die uebernommenen Tickets aus der Kategorie "Logbuch".
 * Nicht die frischen (hat noch niemand angesehen), nicht die geschlossenen
 * (sind bezahlt) - und NICHT mehr die alten Forum-Threads.
 *
 * Die Threads liefen frueher mit, solange dort noch Nachweise lagen. Das war
 * aber die einzige Stelle, an der ein Bild zweimal zaehlen konnte: derselbe
 * Screenshot im alten Thread UND im neuen Ticket faellt nicht auf, weil der
 * Doppel-Abgleich immer nur innerhalb eines Logbuchs laeuft. Gemessen waren
 * neun Threads betroffen. Seit dem Umzug ist das Forum nur noch Archiv.
 *
 * Was dort unterhalb der Linie liegengeblieben ist, muss von Hand mit
 * /logbuch im jeweiligen Thread abgerechnet werden.
 */
async function fetchAllThreads(client) {
  const guild = client.guilds.cache.get(config.guildId)
    || await client.guilds.fetch(config.guildId).catch(() => null);

  return alleTickets(guild, { nurGezaehlte: true });
}

/**
 * Die Abrechnung einer Person - so, wie sie in ihrem eigenen Ticket steht.
 *
 * Das Ticket IST das Logbuch und bleibt dauerhaft offen. Deshalb gehoert die
 * Auswertung dorthin und nicht in eine Sammelliste anderswo: wer wissen will,
 * was gezaehlt wurde, findet es direkt ueber seinen eigenen Nachweisen.
 */
function formatPerson({ thread, zaehler, probleme }, { imTicket = false } = {}) {
  const zeilen = EVENTS
    .filter((event) => zaehler.has(event.key))
    .map((event) => ({ label: event.label, ...zaehler.get(event.key) }));

  if (!zeilen.length && !probleme.length) return '';

  // Im eigenen Ticket weiss jeder, um wen es geht - da waere der Name ueber
  // der Tabelle nur Wiederholung.
  const kopf = imTicket ? '**Auszahlung**' : `**${thread.name}**`;

  // Im Ticket stehen die strittigen Beitraege einzeln mit Sprunglink - dort
  // liegen sie ja. Ein Klick springt hin, statt dass jemand raten muss, welche
  // der fuenfzig Nachrichten gemeint ist.
  const problemListe = imTicket && probleme.length
    ? ['', `**${probleme.length} zum Anschauen:**`, ...probleme.slice(0, 12).map(problemZeile)]
      .concat(probleme.length > 12 ? [`-# … und ${probleme.length - 12} weitere.`] : [])
      .join('\n')
    : '';

  if (!zeilen.length) {
    if (imTicket) {
      return `${kopf}\n-# Nichts Neues zu zählen.${problemListe}`;
    }
    return `${kopf}\n-# nichts zu zählen${probleme.length ? ` · ${probleme.length} zum Anschauen` : ''}`;
  }

  const breite = Math.max(10, ...zeilen.map((z) => z.label.length));
  const tabelle = [
    '```',
    `${'Event'.padEnd(breite)} | Win | Lose`,
    `${'-'.repeat(breite)}-+-----+-----`,
    ...zeilen.map((z) => `${z.label.padEnd(breite)} | ${String(z.win).padStart(3)} | ${String(z.lose).padStart(4)}`),
    '```',
  ].join('\n');

  if (imTicket) return `${kopf}\n${tabelle}${problemListe}`;

  const hinweis = probleme.length ? `\n-# ${probleme.length} Beiträge zum Anschauen` : '';
  return `${kopf}\n${tabelle}${hinweis}`;
}

/**
 * Teilt einen langen Text an Zeilengrenzen auf.
 *
 * Tabelle plus zwoelf Problemzeilen mit Sprunglinks sprengt Discords Grenze von
 * 2000 Zeichen. Hart abschneiden ginge nicht: ein halber Markdown-Link wird zu
 * sichtbarem Kauderwelsch, und genau die Zeile waere die wichtigste.
 */
function teileText(text, grenze = MAX_NACHRICHT) {
  if (text.length <= grenze) return [text];

  const teile = [];
  let aktuell = '';

  for (const zeile of text.split('\n')) {
    if (aktuell && aktuell.length + zeile.length + 1 > grenze) {
      teile.push(aktuell);
      aktuell = '';
    }
    aktuell = aktuell ? `${aktuell}\n${zeile}` : zeile;
  }

  if (aktuell) teile.push(aktuell);
  return teile;
}

/** Teilt die Bloecke auf mehrere Nachrichten auf, damit nichts abgeschnitten wird. */
function chunkBlocks(bloecke, kopfzeile) {
  const nachrichten = [];
  let aktuell = kopfzeile ? [kopfzeile] : [];
  let laenge = kopfzeile ? kopfzeile.length : 0;

  for (const block of bloecke) {
    if (laenge + block.length + 2 > MAX_NACHRICHT && aktuell.length) {
      nachrichten.push(aktuell.join('\n\n'));
      aktuell = [];
      laenge = 0;
    }
    aktuell.push(block);
    laenge += block.length + 2;
  }

  if (aktuell.length) nachrichten.push(aktuell.join('\n\n'));
  return nachrichten;
}

function formatGesamt(ergebnisse) {
  const summe = new Map();

  for (const { zaehler } of ergebnisse) {
    for (const [key, werte] of zaehler) {
      if (!summe.has(key)) summe.set(key, { win: 0, lose: 0 });
      summe.get(key).win += werte.win;
      summe.get(key).lose += werte.lose;
    }
  }

  const zeilen = EVENTS
    .filter((event) => summe.has(event.key))
    .map((event) => ({ label: event.label, ...summe.get(event.key) }));

  if (!zeilen.length) return 'Insgesamt nichts zu zählen.';

  const breite = Math.max(10, ...zeilen.map((z) => z.label.length));
  const gesamtWin = zeilen.reduce((s, z) => s + z.win, 0);
  const gesamtLose = zeilen.reduce((s, z) => s + z.lose, 0);

  return [
    '```',
    `${'Event'.padEnd(breite)} | Win | Lose`,
    `${'-'.repeat(breite)}-+-----+-----`,
    ...zeilen.map((z) => `${z.label.padEnd(breite)} | ${String(z.win).padStart(3)} | ${String(z.lose).padStart(4)}`),
    `${'-'.repeat(breite)}-+-----+-----`,
    `${'Gesamt'.padEnd(breite)} | ${String(gesamtWin).padStart(3)} | ${String(gesamtLose).padStart(4)}`,
    '```',
  ].join('\n');
}

/**
 * Die Abrechnung ins eigene Ticket. Das Ticket ist das dauerhafte Logbuch
 * dieser Person - dort steht die Auswertung direkt ueber den Nachweisen, auf
 * die sie sich bezieht.
 */
async function stelleZu(ergebnis) {
  const text = formatPerson(ergebnis, { imTicket: true });
  if (!text) return false;

  // Die Auszahlungsrolle wird gerufen, nicht der Ticketbesitzer: der sieht
  // seine Zahlen sowieso, wenn er reinschaut. Gebraucht werden die drei, die
  // das Geld rausgeben.
  const ruf = config.payoutRoleId ? `<@&${config.payoutRoleId}>` : '';
  const teile = teileText(ruf ? `${ruf}\n${text}` : text);

  for (const [i, teil] of teile.entries()) {
    const ok = await ergebnis.thread.send({
      content: teil,
      // Nur beim ersten Stueck rufen - sonst dreimal fuer dieselbe Abrechnung.
      allowedMentions: i === 0 && config.payoutRoleId
        ? { roles: [config.payoutRoleId] }
        : { parse: [] },
    }).then(() => true).catch(() => false);
    if (!ok) return false;
  }

  return true;
}

function dauerText(sekunden) {
  if (sekunden === null || sekunden === undefined) return '';
  const min = Math.round(sekunden / 60);
  if (min < 1) return 'unter einer Minute';
  if (min < 60) return `${min} Min`;
  return `${Math.floor(min / 60)} Std ${min % 60} Min`;
}

/** Der Fortschrittsbalken in der laufenden Nachricht. */
async function aktualisiereAnzeige(nachricht, gesamt, artName = 'Sammelauszahlung') {
  if (!nachricht) return;

  const s = laufStand();
  const anteil = gesamt ? s.fertig / gesamt : 0;
  const voll = Math.round(anteil * 20);
  const balken = `${'█'.repeat(voll)}${'░'.repeat(20 - voll)}`;

  // Ohne Bildpruefung ist "0 Bilder geprueft" keine Auskunft, sondern
  // verwirrend - dann steht dort, wonach wirklich gezaehlt wurde.
  const nurText = artName === 'Sammelauswertung';
  const geprueft = nurText ? 'nur nach Text' : `${s.bilder} Bilder geprüft`;

  const zeilen = s.laeuft
    ? [
      `**${artName} läuft** — ${s.fertig}/${gesamt} Tickets`,
      `\`${balken}\` ${Math.round(anteil * 100)} %`,
      `-# ${geprueft} · ${s.zugestellt} Abrechnungen raus · läuft seit ${dauerText(s.dauerSek)}`
      + `${s.restSek !== null ? ` · noch etwa ${dauerText(s.restSek)}` : ''}`,
      s.aktuell ? `-# gerade: ${s.aktuell}` : '',
    ]
    : [
      `**${artName} fertig** — ${s.fertig}/${gesamt} Tickets in ${dauerText(s.dauerSek)}`,
      `\`${'█'.repeat(20)}\` 100 %`,
      `-# ${geprueft} · ${s.zugestellt} Abrechnungen zugestellt · ${s.abgehakt} abgehakt`,
    ];

  await nachricht.edit({
    content: zeilen.filter(Boolean).join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

/**
 * @param {object} [optionen]
 * @param {boolean} [optionen.nurText] - /sammelauswertung: keine Bilder
 *   ansehen, allein nach dem Text im Beitrag zaehlen. Schnell, weil die
 *   Grafikkarte gar nicht erst gebraucht wird.
 */
async function handleSammelauszahlungCommand(interaction, { nurText = false } = {}) {
  if (interaction.channelId !== config.botHomeChannelId) {
    await interaction.reply({
      content: `Das läuft nur in <#${config.botHomeChannelId}> — dort stört es niemanden und alles steht beieinander.`,
      ephemeral: true,
    });
    return;
  }

  // Kevins Meldung (25.08.): zwei fast gleichzeitige Aufrufe liefen parallel
  // und schickten jedem Ticket seine Auszahlung doppelt. starteLauf() prueft
  // selbst nicht nach, ob schon ein Lauf steht - das muss hier vorher passieren.
  if (laufStand().laeuft) {
    await interaction.reply({
      content: 'Es läuft schon eine Sammelauszahlung — erst die abwarten, bevor die nächste startet.',
      ephemeral: true,
    });
    return;
  }

  // /sammelauswertung ist derselbe Ablauf ohne Bildpruefung. Dort gibt es die
  // Einstellung gar nicht erst - der Befehlsname sagt schon, was er tut.
  const bilderPruefen = nurText ? false : (interaction.options.getBoolean('bilder_pruefen') ?? true);
  const abhaken = interaction.options.getBoolean('abhaken') ?? true;

  await interaction.deferReply();

  const threads = await fetchAllThreads(interaction.client);
  if (!threads.length) {
    await interaction.editReply('Ich finde keine übernommenen Logbuch-Tickets.');
    return;
  }

  const artName = nurText ? 'Sammelauswertung' : 'Sammelauszahlung';

  await interaction.editReply(`${threads.length} übernommene Tickets gefunden — der Fortschritt steht unten.`
    + (nurText ? '\n-# Nur nach Text, die Bilder sieht er sich dabei nicht an.' : ''));

  // Der Fortschritt haengt an einer NORMALEN Nachricht, nicht an der Antwort
  // auf den Befehl. Discord schliesst die Befehlsantwort nach 15 Minuten - bei
  // einem Lauf ueber anderthalb Stunden lief danach jede Aktualisierung ins
  // Leere, und der Fehler wurde still verschluckt. Man sah eineinhalb Stunden
  // lang nichts.
  const anzeige = await interaction.channel.send({
    content: `**${artName} läuft** — 0/${threads.length} Tickets`,
    allowedMentions: { parse: [] },
  }).catch(() => null);

  starteLauf(threads.length);

  const emoji = abhaken ? await resolveCheckEmoji(interaction.guild) : null;
  // Auch ohne Abhaken: was nicht gewertet werden konnte, wird markiert.
  const achtung = await resolveAttentionEmoji(interaction.guild);
  // Die Linie nur beim echten Abhaken verschieben - ein Probelauf darf sie
  // nicht anfassen.
  const marker = abhaken ? await resolveMarkerEmoji(interaction.guild) : null;
  const ergebnisse = [];
  let bilderGesamt = 0;
  let vorgemerktGesamt = 0;
  let markiertGesamt = 0;
  let fertig = 0;
  let zugestellt = 0;
  const nichtZugestellt = [];

  // try/finally: beendeLauf() muss auch bei einem Fehler mitten in der
  // Schleife laufen. Sonst bliebe laeuft dauerhaft auf true stehen und die
  // Sperre oben wuerde jede weitere Sammelauszahlung fuer immer blockieren.
  try {
    for (const thread of threads) {
      fertig += 1;
      meldeFortschritt({ fertig, aktuell: thread.name });

      const messages = await thread.messages.fetch({ limit: 100 }).catch(() => null);
      if (!messages?.size) continue;

      const eintraege = readEntries([...messages.values()].reverse(), interaction.client.user.id);
      if (!eintraege.length) continue;

      if (bilderPruefen) {
        // nurGedaechtnis: nicht selbst die Grafikkarte anwerfen. Was noch nicht
        // im Gedaechtnis steht, kommt priorisiert in die Hintergrundschleife -
        // Kevins Ansage: "er schickt seinen Stand und holt den Rest im
        // Hintergrund nach", damit sofort eingetragen werden kann.
        const ergebnis = await verifyEntries(eintraege, undefined, { nurGedaechtnis: true, kanal: thread });
        bilderGesamt += ergebnis.geprueft;
        vorgemerktGesamt += ergebnis.vorgemerkt;
      }

      const zaehler = tally(eintraege);
      const probleme = collectProblems(eintraege);

      markiertGesamt += await markCounted(thread, eintraege, emoji, achtung, marker);

      if (zaehler.size || probleme.length) {
        const ergebnis = { thread, zaehler, probleme, eintraege };
        ergebnisse.push(ergebnis);

        // Sofort zustellen, nicht erst am Ende. Wer sein Ticket offen hat, sieht
        // seine Abrechnung, waehrend der Rest noch laeuft.
        if (await stelleZu(ergebnis)) zugestellt += 1;
        else nichtZugestellt.push(thread.name);
      }

      meldeFortschritt({ bilder: bilderGesamt, zugestellt, abgehakt: markiertGesamt });

      // Nicht bei jedem Ticket melden - das waere nur Flackern.
      if (fertig % 2 === 0 || fertig === threads.length) {
        await aktualisiereAnzeige(anzeige, threads.length, artName);
      }
    }
  } finally {
    beendeLauf();
  }

  await aktualisiereAnzeige(anzeige, threads.length, artName);

  // Kevin bekommt keine Liste mehr, sondern nur noch den Stand: er sieht die
  // Zahlen im jeweiligen Ticket. Was hier steht, ist alles, was er nicht
  // ohnehin dort findet.
  const bericht = [
    `**${artName} fertig**`,
    `${zugestellt} Abrechnungen in die Tickets geschrieben`
    + ` · ${ergebnisse.length} von ${threads.length} Tickets hatten offene Beiträge`,
    // Bei /sammelauswertung muss dranstehen, worauf die Zahlen beruhen -
    // sonst sieht die Tabelle aus wie eine geprüfte, ist es aber nicht.
    `-# ${nurText ? '**nur nach Text gezählt, keine Bilder angesehen**'
      : (bilderGesamt ? `${bilderGesamt} Bilder geprüft` : 'ohne Bildprüfung')}`
    + `${abhaken ? ` · ${markiertGesamt} abgehakt` : ' · nichts abgehakt'}`
    // Nicht verschwiegen: was jetzt als "muss angeschaut werden" markiert ist,
    // wird gerade im Hintergrund nachgelesen - kein Grund, gleich nochmal
    // /sammelauszahlung zu starten, das holt sich von selbst nach.
    + (vorgemerktGesamt ? ` · ${vorgemerktGesamt} noch ungelesen, wird im Hintergrund nachgeholt` : ''),
  ];

  const mitProblemen = ergebnisse.filter((e) => e.probleme.length);
  if (mitProblemen.length) {
    bericht.push('');
    bericht.push(`**${mitProblemen.length} zum Anschauen:**`);
    for (const e of mitProblemen.slice(0, 15)) {
      bericht.push(`• <#${e.thread.id}> — ${e.probleme.length} Beiträge`);
    }
    if (mitProblemen.length > 15) bericht.push(`… und ${mitProblemen.length - 15} weitere.`);
  }

  if (nichtZugestellt.length) {
    bericht.push('');
    bericht.push(`**Nicht zugestellt (${nichtZugestellt.length}):** ${nichtZugestellt.slice(0, 15).join(', ')}`
      + (nichtZugestellt.length > 15 ? ` … und ${nichtZugestellt.length - 15} weitere.` : ''));
  }

  // Als normale Nachricht posten, nicht als Antwort auf den Befehl: bei vielen
  // Tickets laeuft die Frist der Befehlsantwort ab.
  //
  // Frueher stand hier ein hartes .slice(0, 1900) - bei vielen "zum Anschauen"-
  // oder "Nicht zugestellt"-Eintraegen wurde der Bericht dadurch STILL
  // abgeschnitten, ausgerechnet an der Stelle, die am wichtigsten ist: welche
  // Tickets Aufmerksamkeit brauchen. teileText() (siehe stelleZu() oben) teilt
  // stattdessen sauber an Zeilengrenzen auf mehrere Nachrichten auf - nichts
  // geht mehr verloren.
  for (const teil of teileText(bericht.join('\n'))) {
    await interaction.channel.send({
      content: teil,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  await interaction.editReply(`Fertig — ${zugestellt} Abrechnungen zugestellt.`).catch(() => null);

  logBotEvent({
    title: artName,
    color: 'info',
    fields: [
      { name: 'Von', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Threads', value: `${ergebnisse.length}/${threads.length}`, inline: true },
      { name: 'Bilder geprüft', value: nurText ? 'keine (nur Text)' : String(bilderGesamt), inline: true },
      { name: 'Abgehakt', value: String(markiertGesamt), inline: true },
      { name: 'Nachgeholt im Hintergrund', value: String(vorgemerktGesamt), inline: true },
    ],
  });
}

module.exports = {
  chunkBlocks,
  fetchAllThreads,
  formatGesamt,
  formatPerson,
  handleSammelauszahlungCommand,
  teileText,
};
