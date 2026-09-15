const { ChannelType } = require('discord.js');
const { config } = require('./config');
const { askOwner } = require('./ask-owner');
const { logBotEvent } = require('./logger');
const {
  MAX_BILDER_JE_BEITRAG,
  collectProblems,
  fetchThreadMessages,
  formatTable,
  hatReaktion,
  istGewertet,
  markiereZeitDoppel,
  readEntries,
  tally,
} = require('./logbook');
const { readEventFromImage, verifyImage } = require('./logbook-vision');
const { fremdeSiegerFamilie } = require('./logbook-events');
const { formatiere, rechne } = require('./auszahlung-saetze');
const { istTicket } = require('./logbuch-tickets');
const { leseUhrzeit } = require('./bild-uhrzeit');
const { ladeBildSicher } = require('./bild-laden');
const { reiheEin } = require('./bild-vorablesen');

// /auszahlen - zaehlt einen Logbuch-Thread aus.
//
// Laeuft nur auf Zuruf, nie von allein: bei ueber hundert Bildern am Tag waere
// staendiges Mitlesen sinnlos teuer. Ein Bild braucht rund 6 bis 17 Sekunden,
// deshalb wird zwischendurch der Fortschritt gemeldet.

const MAX_BILDER = 60;

function isThread(channel) {
  return [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(channel?.type);
}

/**
 * Wo /auszahlen laufen darf.
 *
 * Frueher nur in Forum-Threads. Seit der Umstellung ist ein Logbuch auch ein
 * Ticket - ein normaler Textkanal namens "<Nummer>-<Benutzername>" in einer der
 * Logbuch-Kategorien. Beide Wege bleiben erlaubt, solange im Forum noch alte
 * Nachweise liegen.
 */
function istLogbuchOrt(channel) {
  return isThread(channel) || istTicket(channel);
}

async function ladeBild(anhang) {
  // Prueft die Content-Length gegen die tatsaechlich angekommene Groesse und
  // laedt bei Abweichung einmal neu - ein abgeschnittener Download durch
  // einen kurzen Netzwerkhaenger sah bisher aus wie ein extrem schwer
  // lesbares Bild. Siehe bild-laden.js.
  const buffer = await ladeBildSicher(anhang.url);
  return buffer ? buffer.toString('base64') : null;
}

// Die Grenze steht in logbook.js - dort wird auch gemeldet, was darueber
// hinausgeht. Zwei Zahlen koennen nicht auseinanderlaufen, wenn es nur eine gibt.
const MAX_PRO_BEITRAG = MAX_BILDER_JE_BEITRAG;

/**
 * Taugt dieses Urteil, oder lohnt sich ein Blick aufs naechste Bild?
 *
 * true  = bestaetigt, besser wird es nicht
 * false = Widerspruch, ist ebenfalls eine Aussage
 * null  = nichts erkennbar; da darf das naechste Bild ran
 */
function istKlar(verified) {
  return verified === true || verified === false;
}

/**
 * Einen Beitrag pruefen - notfalls ueber mehrere Bilder hinweg.
 *
 * Das Bildlesen kommt von aussen herein, damit die Entscheidungslogik ohne
 * Grafikkarte und ohne Discord pruefbar ist. Wie gut das Modell LIEST, laesst
 * sich nur messen; was der Bot mit dem Gelesenen MACHT, gehoert in Tests.
 */
async function pruefeEintrag(eintrag, werkzeug = {}) {
  const holeBild = werkzeug.ladeBild || ladeBild;
  const pruefeBild = werkzeug.verifyImage || verifyImage;
  const leseEvent = werkzeug.readEventFromImage || readEventFromImage;
  const uhrzeit = werkzeug.leseUhrzeit || leseUhrzeit;
  // Nur bei /sammelauszahlung: nicht selbst die Grafikkarte anwerfen, nur
  // vorlesen, was schon im Gedaechtnis steht. Kevins Ansage: "er schickt
  // seinen Stand und holt den Rest im Hintergrund nach" - damit er und
  // Johannes sofort eintragen koennen, statt auf frische Bilder zu warten.
  const nurGedaechtnis = Boolean(werkzeug.nurGedaechtnis);

  eintrag.verified = null;
  eintrag.verifyReason = 'Bild konnte nicht geladen werden';
  eintrag.nachzuholendeBilder = [];

  const bilder = eintrag.images.slice(0, MAX_PRO_BEITRAG);
  let angesehen = 0;

  for (const anhang of bilder) {
    const bild = await holeBild(anhang);
    if (!bild) continue;
    angesehen += 1;

    let gesehen = null;

    if (eintrag.claim.needsEventFromImage) {
      const gelesen = await leseEvent(bild, { nurGedaechtnis });
      if (gelesen.nichtGelesen) {
        eintrag.nachzuholendeBilder.push(anhang);
        if (!istKlar(eintrag.verified)) eintrag.verifyReason = gelesen.reason;
        continue;
      }
      gesehen = gelesen.details;
      // Aus dem Bild gelesen heisst: es steht dort, also stimmt es auch.
      if (gelesen.ok) {
        eintrag.eventFromImage = gelesen.event;
        eintrag.eventFromImageReason = gelesen.reason;
        eintrag.verified = true;
      } else if (!eintrag.eventFromImageReason) {
        eintrag.eventFromImageReason = gelesen.reason;
      }
    } else {
      const ergebnis = await pruefeBild(bild, eintrag.claim.event, { nurGedaechtnis });
      if (ergebnis.nichtGelesen) {
        eintrag.nachzuholendeBilder.push(anhang);
        if (!istKlar(eintrag.verified)) eintrag.verifyReason = ergebnis.reason;
        continue;
      }
      gesehen = ergebnis.details;
      // Ein spaeteres Bild darf ein unklares Urteil verbessern, aber ein
      // bestaetigtes nicht wieder einreissen.
      if (istKlar(ergebnis.verified) || !istKlar(eintrag.verified)) {
        eintrag.verified = ergebnis.verified;
        eintrag.verifyReason = ergebnis.reason;
        eintrag.verifyDetails = ergebnis.details;
      }
    }

    // Wer steht auf dem Abschlussbildschirm als Sieger?
    //
    // Das Feld wurde bisher abgefragt, ausgelesen - und dann weggeworfen. Es
    // hat nie jemand benutzt. Verwertbar ist nur die fremde Familie, warum,
    // steht bei fremdeSiegerFamilie().
    const fremd = fremdeSiegerFamilie(gesehen?.gewinner);
    if (fremd && !eintrag.fremderSieger) eintrag.fremderSieger = fremd;

    // Uhrzeit aus der unteren rechten Ecke. Das Bild ist ohnehin geladen, und
    // der Ausschnitt ist so klein, dass es nur 4 bis 6 Sekunden kostet.
    //
    // Damit lassen sich zwei Aufnahmen desselben Durchgangs erkennen - der
    // Fall aus dem Logbuch: zwei "40er lose", vier Sekunden auseinander, beide
    // 20:46 am 09.08. Verschiedene Dateien, also fuer den Fingerabdruck
    // unsichtbar.
    //
    // Nur vom ersten Bild: die Uhrzeit soll den Beitrag kennzeichnen, und
    // zwei Aufnahmen desselben Durchgangs liegen Sekunden auseinander.
    if (!eintrag.zeitpunkt) {
      eintrag.zeitpunkt = await uhrzeit(Buffer.from(String(bild), 'base64')).catch(() => null);
    }

    if (eintrag.verified === true) break;
  }

  // Wie viele wirklich geoeffnet wurden - im Normalfall eins. Steht im
  // Ticket dabei, sonst wundert sich jemand ueber die laengere Wartezeit.
  eintrag.bilderAngesehen = angesehen;

  // "win" behauptet, aber im Bild gewinnt eine andere Familie. Das ist kein
  // Urteil, sondern eine Vorlage fuer Menschenaugen: der Screenshot koennte
  // auch mitten im Event entstanden sein, als noch jemand anders vorne lag.
  // Deshalb wird nicht abgelehnt, sondern markiert.
  if (eintrag.fremderSieger && eintrag.claim.result === 'win') {
    eintrag.verified = null;
    eintrag.verifyReason = `Im Bild gewinnt ${eintrag.fremderSieger}, angegeben war ein Sieg`
      + ' — muss angeschaut werden';
  }
}

/**
 * Schaut sich die Screenshots an.
 *
 * Zwei Faelle:
 *  - Text nennt das Event ("40er win") -> Bild bestaetigt es nur
 *  - Text nennt nur das Ergebnis ("WIN") -> Event kommt aus dem Bild
 */
/**
 * @param {object} [optionen]
 * @param {boolean} [optionen.nurGedaechtnis] - nicht selbst lesen, nur was
 *   schon im Gedaechtnis steht. Fuer /sammelauszahlung: Kevin bekommt sofort
 *   seinen Stand, alles Ungelesene wandert priorisiert in die
 *   Hintergrundschleife statt die Grafikkarte mitten im Befehl zu belegen.
 * @param {object} [optionen.kanal] - noetig, um Ungelesenes vorzumerken.
 *   Ohne Kanal (z.B. in Tests) wird nichts vorgemerkt, nur markiert.
 */
async function verifyEntries(eintraege, onFortschritt, optionen = {}) {
  const { nurGedaechtnis = false, kanal = null } = optionen;

  // Doppelposts gar nicht erst anschauen - sie zaehlen ohnehin nicht, und
  // jedes Bild kostet Rechenzeit auf der Grafikkarte.
  const zuPruefen = eintraege.filter((e) => (
    e.images.length && !e.doppelVon && (e.claim.ok || e.claim.needsEventFromImage)
  ));

  let fertig = 0;
  let vorgemerkt = 0;

  for (const eintrag of zuPruefen.slice(0, MAX_BILDER)) {
    await pruefeEintrag(eintrag, { nurGedaechtnis });
    fertig += 1;

    // Ungelesenes geht vorn in die Hintergrundschleife - Kevin und Johannes
    // warten gerade auf genau diese Bilder, das darf nicht hinter dem
    // gewoehnlichen A-Z-Durchgang anstehen.
    if (nurGedaechtnis && kanal) {
      for (const anhang of eintrag.nachzuholendeBilder || []) {
        const eingereiht = reiheEin(
          { id: eintrag.messageId, channelId: kanal.id, channel: kanal },
          anhang,
          { vorn: true },
        );
        if (eingereiht) vorgemerkt += 1;
      }
    }

    if (onFortschritt && fertig % 5 === 0) {
      await onFortschritt(fertig, Math.min(zuPruefen.length, MAX_BILDER));
    }
  }

  // Erst jetzt moeglich - vorher gab es keine Uhrzeiten zum Vergleichen.
  const zeitDoppel = markiereZeitDoppel(eintraege);

  return {
    geprueft: Math.min(zuPruefen.length, MAX_BILDER),
    gesamt: zuPruefen.length,
    zeitDoppel,
    vorgemerkt,
  };
}

/**
 * Setzt das Bestaetigungshaekchen auf die gezaehlten Beitraege.
 *
 * Damit ist beim naechsten Durchlauf klar, was schon abgerechnet wurde -
 * und niemand bekommt dieselbe Teilnahme zweimal bezahlt.
 */
async function resolveCheckEmoji(guild) {
  if (!guild) return null;

  const ausCache = guild.emojis.cache.find((emoji) => emoji.name === config.giveawayEmojiName);
  if (ausCache) return ausCache;

  const alle = await guild.emojis.fetch().catch(() => null);
  return alle?.find((emoji) => emoji.name === config.giveawayEmojiName) || null;
}

/**
 * Wurde dieser Nachweis wirklich gewertet?
 *
 * Ein Haken heisst "gezaehlt und bezahlt". Deshalb ist das hier DIESELBE
 * Regel, nach der auch die Tabelle zaehlt - istGewertet() in logbook.js.
 *
 * Vorher standen hier zwei Regeln nebeneinander, und sie widersprachen sich:
 * die Tabelle nahm alles ausser dem Widerlegten, der Haken nur das
 * Bestaetigte. Ein ungepruefter Nachweis stand damit in der Auszahlung, bekam
 * aber keinen Haken - und zaehlte beim naechsten Lauf ein zweites Mal.
 */
const wurdeGewertet = istGewertet;

/**
 * Haken auf das Gewertete, Achtungszeichen auf den Rest, Marker ans Ende.
 *
 * Drei Zeichen, drei klar getrennte Bedeutungen:
 *
 *   delaTeabesttigt   gezaehlt und bezahlt - reine Auskunft, KEINE Linie
 *   AttentionAnimated offenes Problem, sticht die Linie
 *   GTALoading        die Linie: bis hierher ist alles angesehen
 *
 * Der Marker kommt ZULETZT und nur, wenn alles davor durch ist. Stuerzt der
 * Bot mittendrin ab - am 16.08. genau so passiert -, steht er noch auf der
 * alten Stelle, und der angefangene Beitrag wird beim naechsten Mal nochmal
 * angesehen statt uebersprungen. Doppelt ansehen kostet Sekunden, ueberspringen
 * kostet Geld.
 */
async function markCounted(channel, eintraege, emoji, achtung = null, marker = null) {
  if (!emoji && !achtung && !marker) return 0;
  let gesetzt = 0;
  let letzteVerarbeitete = null;

  for (const eintrag of eintraege) {
    const message = await channel.messages.fetch(eintrag.messageId).catch(() => null);
    if (!message) continue;

    if (wurdeGewertet(eintrag)) {
      if (emoji) {
        const ok = await message.react(emoji).then(() => true).catch(() => false);
        if (ok) gesetzt += 1;
      }

      // Hing vorher ein Achtungszeichen dran und der Fall ist jetzt geklaert,
      // muss es weg. Sonst haengen am selben Beitrag Haken UND Warnung, und
      // niemand weiss, was gilt.
      if (hatReaktion(message, config.logbookAttentionEmojiName)) {
        await message.reactions.cache
          .find((r) => r.emoji?.name === config.logbookAttentionEmojiName)
          ?.users.remove(channel.client.user.id).catch(() => null);
      }

      letzteVerarbeitete = message;
      continue;
    }

    // Nicht gewertet. Nur markieren, wenn ueberhaupt ein Bild dranhaengt -
    // reine Textnachrichten sind kein Nachweis und brauchen keine Warnung.
    if (achtung && eintrag.images.length
      && !hatReaktion(message, config.logbookAttentionEmojiName)) {
      await message.react(achtung).catch(() => null);
    }

    letzteVerarbeitete = message;
  }

  // Erst jetzt, wo wirklich alles durch ist: die Linie nachziehen.
  if (marker && letzteVerarbeitete) {
    await setzeMarker(channel, letzteVerarbeitete, marker);
  }

  return gesetzt;
}

/**
 * Die Linie auf diesen Beitrag setzen und die alte wegnehmen.
 *
 * Erst setzen, dann alte entfernen: reisst die Verbindung dazwischen ab,
 * stehen kurz zwei Marker da. readEntries nimmt dann den unteren - also den
 * neuen, richtigen. Andersherum waere die Linie einen Moment lang ganz weg,
 * und ein Durchlauf in genau diesem Moment wuerde das komplette Ticket von
 * vorne aufrollen.
 */
async function setzeMarker(channel, message, marker) {
  if (hatReaktion(message, config.logbookMarkerEmojiName)) return;

  const gesetzt = await message.react(marker).then(() => true).catch(() => false);
  if (!gesetzt) return;

  // Alte Marker weiter oben wegnehmen - es soll genau einer dastehen.
  const frueher = await channel.messages
    .fetch({ limit: 100, before: message.id })
    .catch(() => null);
  if (!frueher) return;

  for (const alt of frueher.values()) {
    const reaktion = alt.reactions.cache.find((r) => r.emoji?.name === config.logbookMarkerEmojiName);
    if (!reaktion) continue;
    await reaktion.users.remove(channel.client.user.id).catch(() => null);
  }
}

/** Das Achtungszeichen des Servers. */
async function resolveAttentionEmoji(guild) {
  if (!guild) return null;

  const ausCache = guild.emojis.cache.find((e) => e.name === config.logbookAttentionEmojiName);
  if (ausCache) return ausCache;

  const alle = await guild.emojis.fetch().catch(() => null);
  return alle?.find((e) => e.name === config.logbookAttentionEmojiName) || null;
}

/** Ghostxx' eigener Merker - die Linie. */
async function resolveMarkerEmoji(guild) {
  if (!guild) return null;

  const ausCache = guild.emojis.cache.find((e) => e.name === config.logbookMarkerEmojiName);
  if (ausCache) return ausCache;

  const alle = await guild.emojis.fetch().catch(() => null);
  return alle?.find((e) => e.name === config.logbookMarkerEmojiName) || null;
}

// Discord nimmt hoechstens 2000 Zeichen pro Nachricht. Mit Links wird jede
// Problemzeile lang, deshalb wird die Liste bei Bedarf gekuerzt statt die
// ganze Auszaehlung an der Laengengrenze scheitern zu lassen.
const MAX_LAENGE = 1900;

function problemZeile({ eintrag, grund }) {
  const text = eintrag.text ? eintrag.text.replace(/\n/g, ' ').slice(0, 40) : '(kein Text)';

  // Der Beitragstext wird zum Link - ein Klick springt direkt hin. Besser als
  // die Person anzuschreiben: wer nachsehen will, tut es, und niemand wird
  // oeffentlich ermahnt.
  const beschriftung = eintrag.url
    ? `[${text.replace(/[[\]]/g, '')}](${eintrag.url})`
    : `"${text}"`;

  return `• ${beschriftung} — ${grund}`;
}

function buildSummary({ thread, eintraege, zaehler, probleme, geprueft, markiert = 0, zeitDoppel = 0 }) {
  const gezaehlt = [...zaehler.values()].reduce((s, z) => s + z.win + z.lose, 0);

  // Die Betraege stehen im Kanal auszahlung-info. Ohne sie muss jemand die
  // Tabelle danebenlegen und selbst rechnen.
  const geld = formatiere(rechne(zaehler));

  const kopf = [
    `**Auszählung — ${thread.name}**`,
    '',
    formatTable(zaehler),
    ...(geld ? ['', geld] : []),
  ];
  const fuss = [
    '',
    [
      `-# ${gezaehlt} gezählt aus ${eintraege.length} offenen Beiträgen`,
      eintraege.bereitsAusgezahlt ? `${eintraege.bereitsAusgezahlt} waren schon abgehakt` : '',
      eintraege.abgelehnt ? `${eintraege.abgelehnt} abgelehnt übersprungen` : '',
      eintraege.doppelt ? `${eintraege.doppelt} Doppelposting${eintraege.doppelt > 1 ? 's' : ''}` : '',
      zeitDoppel ? `${zeitDoppel}x selber Durchgang` : '',
      geprueft ? `${geprueft} Bilder geprüft` : 'ohne Bildprüfung',
      markiert ? `${markiert} neu abgehakt` : 'nichts abgehakt',
    ].filter(Boolean).join(' · '),
  ];

  if (!probleme.length) return [...kopf, ...fuss].join('\n');

  // So viele Problemzeilen aufnehmen, wie in die Nachricht passen.
  const grundlaenge = [...kopf, ...fuss].join('\n').length;
  const zeilen = [];
  let laenge = grundlaenge + 40;

  for (const problem of probleme) {
    const zeile = problemZeile(problem);
    if (laenge + zeile.length > MAX_LAENGE) break;
    zeilen.push(zeile);
    laenge += zeile.length + 1;
  }

  const rest = probleme.length - zeilen.length;

  return [
    ...kopf,
    '',
    `**${probleme.length} Beiträge zum Anschauen:**`,
    ...zeilen,
    ...(rest > 0 ? [`• …und ${rest} weitere`] : []),
    ...fuss,
  ].join('\n');
}

// Frueher hat der Bot hier jeden strittigen Beitrag beantwortet und die Person
// angepingt. Das war unangenehm und - solange die Bilderkennung nicht perfekt
// ist - auch ungerecht: vier Leute bekamen eine Ermahnung fuer Screenshots,
// auf denen das Event sehr wohl stand.
//
// Stattdessen steht jetzt in der Zusammenfassung ein Link zum Beitrag. Wer
// nachsehen will, klickt drauf.

async function handleAuszahlenCommand(interaction) {
  if (!istLogbuchOrt(interaction.channel)) {
    await interaction.reply({
      content: 'Das geht nur in einem Logbuch — also im Ticket der Person oder in ihrem alten Forum-Thread.',
      ephemeral: true,
    });
    return;
  }

  const bilderPruefen = interaction.options.getBoolean('bilder_pruefen') ?? true;
  await interaction.deferReply();

  const geladen = await fetchThreadMessages(interaction.client, interaction.channelId);
  if (!geladen) {
    await interaction.editReply('Ich komme an diesen Thread nicht ran.');
    return;
  }

  const eintraege = readEntries(geladen.messages, interaction.client.user.id);
  if (!eintraege.length) {
    await interaction.editReply('In diesem Thread finde ich keine Beiträge.');
    return;
  }

  let geprueft = 0;
  let zeitDoppel = 0;

  if (bilderPruefen) {
    const mitBild = eintraege.filter((e) => e.claim.ok && e.images.length).length;
    await interaction.editReply(`Prüfe ${Math.min(mitBild, MAX_BILDER)} Screenshots… das dauert einen Moment.`);

    const ergebnis = await verifyEntries(eintraege, async (fertig, gesamt) => {
      await interaction.editReply(`Prüfe Screenshots… ${fertig}/${gesamt}`).catch(() => null);
    });

    geprueft = ergebnis.geprueft;
    zeitDoppel = ergebnis.zeitDoppel;
  }

  const zaehler = tally(eintraege);
  const probleme = collectProblems(eintraege);

  // Haekchen setzen ist nicht zurueckzunehmen - wer erst schauen will, was
  // gezaehlt wuerde, setzt abhaken:false.
  const abhaken = interaction.options.getBoolean('abhaken') ?? true;
  const emoji = abhaken ? await resolveCheckEmoji(interaction.guild) : null;
  // Das Achtungszeichen kommt auch dann, wenn nicht abgehakt wird: es ist
  // keine Abrechnung, sondern ein Hinweis zum Wiederfinden.
  const achtung = await resolveAttentionEmoji(interaction.guild);
  // Der Marker nur beim echten Abhaken: wer mit abhaken:false nur schauen
  // will, was gezaehlt WUERDE, darf die Linie nicht verschieben.
  const marker = abhaken ? await resolveMarkerEmoji(interaction.guild) : null;
  const markiert = await markCounted(geladen.channel, eintraege, emoji, achtung, marker);

  if (abhaken && !emoji) {
    console.warn(`Emoji :${config.giveawayEmojiName}: nicht gefunden - nichts abgehakt.`);
  }

  await interaction.editReply(buildSummary({
    thread: geladen.channel,
    eintraege,
    zaehler,
    probleme,
    geprueft,
    markiert,
    zeitDoppel,
  }));


  // Kevin bekommt Bescheid, wenn etwas nicht zusammenpasst.
  const widersprueche = probleme.filter((p) => p.eintrag.verified === false);
  if (widersprueche.length) {
    await askOwner({
      question: `${widersprueche.length} Nachweise passen nicht zur Angabe.`,
      detail: [
        `Thread: ${geladen.channel.name}`,
        ...widersprueche.slice(0, 8).map((p) => `• [${p.eintrag.text || 'Beitrag'}](${p.eintrag.url}) — ${p.grund}`),
      ].join('\n'),
      key: `logbuch:${interaction.channelId}:${Date.now()}`,
    }).catch(() => null);
  }

  logBotEvent({
    title: 'Logbuch ausgezählt',
    color: 'info',
    fields: [
      { name: 'Thread', value: geladen.channel.name, inline: true },
      { name: 'Von', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Beiträge', value: String(eintraege.length), inline: true },
      { name: 'Bilder geprüft', value: String(geprueft), inline: true },
      { name: 'Widersprüche', value: String(widersprueche.length), inline: true },
      { name: 'Abgehakt', value: String(markiert), inline: true },
    ],
  });
}

module.exports = {
  buildSummary,
  markCounted,
  problemZeile,
  resolveCheckEmoji,
  handleAuszahlenCommand,
  isThread,
  pruefeEintrag,
  resolveAttentionEmoji,
  resolveMarkerEmoji,
  setzeMarker,
  verifyEntries,
  wurdeGewertet,
};
