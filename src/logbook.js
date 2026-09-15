const { config } = require('./config');
const { EVENTS, parseClaim } = require('./logbook-events');

// Liest einen Logbuch-Thread und zaehlt, wer wie oft bei welchem Event dabei war.
//
// Aufbau eines Beitrags: kurzer Text ("40er win") plus ein Screenshot als
// Nachweis. Der Text sagt, was gespielt wurde - das Bild belegt es. Gezaehlt
// wird pro Beitrag, nicht pro Bild: ein Beitrag ist eine Teilnahme.

const MAX_MESSAGES = 500;

// Wie viele Bilder eines Beitrags angesehen werden.
//
// Frueher genau eins - das erste. Wer zwei Screenshots anhaengt und das
// schwaechere zuerst, fiel damit durch: Kevins Fall war die Spielmeldung als
// erstes Bild und der Abschlussbildschirm als zweites, auf dem
// RESSOURCENKRIEG und GEWINNENDE FAMILIE UNKNOWN gross dastehen. Das zweite
// hat nie jemand geoeffnet.
//
// Steht hier und nicht bei der Auszahlung, weil beide Seiten dieselbe Zahl
// brauchen: die eine oeffnet so viele, die andere meldet alles darueber.
const MAX_BILDER_JE_BEITRAG = 3;

async function fetchThreadMessages(client, threadId) {
  const channel = await client.channels.fetch(threadId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const alle = [];
  let before;

  while (alle.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    alle.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
  }

  return { channel, messages: alle.reverse() };
}

function getImages(message) {
  return [...(message.attachments?.values() || [])]
    .filter((anhang) => (anhang.contentType || '').startsWith('image/'));
}

/**
 * Fingerabdruck eines Bildes: Dateigroesse und Abmessungen.
 *
 * Discord liefert beides mit der Nachricht mit - das Bild muss dafuer nicht
 * heruntergeladen werden. Zwei Uploads derselben Datei haben denselben
 * Abdruck, zwei verschiedene Screenshots praktisch nie: die Bildpunkte sind
 * zwar oft gleich gross, die Byte-Zahl aber nicht.
 *
 * Absichtlich kein Vergleich ueber mehrere Threads hinweg. Wenn mehrere aus
 * der Familie im selben 40er waren, darf jeder denselben Screenshot einreichen -
 * einer macht das Bild, die anderen waren mit drauf. Nur derselbe Mensch, der
 * dasselbe Bild zweimal in seinen eigenen Thread stellt, ist ein Doppelposting.
 */
function bildAbdruck(anhang) {
  const groesse = Number(anhang?.size || 0);
  if (!groesse) return '';
  return `${groesse}:${anhang.width || '?'}x${anhang.height || '?'}`;
}

/**
 * Traegt der Beitrag schon das Bestaetigungshaekchen?
 *
 * Das Haekchen ist die Grenze: was markiert ist, wurde bereits ausgezahlt.
 * Gezaehlt wird nur, was darunter noch unmarkiert steht - sonst bekaeme
 * jemand dieselbe Teilnahme zweimal verguetet.
 */
function hatReaktion(message, emojiName) {
  const reaktionen = message.reactions?.cache;
  if (!reaktionen?.size) return false;

  return [...reaktionen.values()].some((reaktion) => reaktion.emoji?.name === emojiName);
}

function isMarkedDone(message) {
  // Zwei Wege zu "erledigt": Ghostxx' eigener Haken, oder der Geldsack, den
  // Kevin und Johannes von Hand setzen, wenn sie eine Auszahlung eingetragen
  // haben. Beides heisst dasselbe - dieser Nachweis ist durch.
  return hatReaktion(message, config.giveawayEmojiName)
    || hatReaktion(message, config.logbookPaidEmojiName);
}

/** Ghostxx' eigener Merker: bis hierher ist alles angesehen. */
function istMarker(message) {
  return hatReaktion(message, config.logbookMarkerEmojiName);
}

/**
 * Ein offenes Problem - konnte nicht gewertet werden.
 *
 * Sticht die Linie: so ein Beitrag wird IMMER wieder eingesammelt, auch wenn
 * der Marker laengst darunter steht. Er ist erst erledigt, wenn er einen
 * Haken (bezahlt) oder eine Ablehnung bekommt.
 */
function istOffenesProblem(message) {
  if (!hatReaktion(message, config.logbookAttentionEmojiName)) return false;
  return !isMarkedDone(message) && !isRejected(message);
}

/**
 * Wurde der Nachweis von Hand abgelehnt?
 *
 * Das Gegenstueck zum Haken. Es wurde bisher gar nicht gelesen: stand ein
 * abgelehnter Beitrag unterhalb des letzten Hakens, hat die Linie ihn wieder
 * eingesammelt und er wurde doch bezahlt. Im Thread "Felix Crackhead" war das
 * genau so - ein abgelehntes Bild direkt unter dem Haken.
 *
 * Eine Ablehnung gilt immer, egal wo sie steht.
 */
function isRejected(message) {
  return hatReaktion(message, config.logbookRejectEmojiName);
}

// Haken, die nicht der Haken der Familie sind. Kommen im Logbuch 17-mal vor.
const FREMDE_HAKEN = ['✅', '☑️', '✔️', '✔', '✅️'];

/** Reagiert wurde mit irgendeinem Haken - nur nicht mit dem richtigen. */
function fremderHaken(message) {
  const reaktionen = message.reactions?.cache;
  if (!reaktionen?.size) return '';

  const namen = [...reaktionen.values()].map((reaktion) => reaktion.emoji?.name);
  if (namen.includes(config.giveawayEmojiName)) return '';

  return namen.find((name) => FREMDE_HAKEN.includes(name)) || '';
}

/**
 * Wertet die Beitraege eines Threads aus - nur anhand des Textes.
 * Die Bildpruefung ist ein eigener Schritt, weil sie Rechenzeit kostet.
 */
function readEntries(messages, botId) {
  const eintraege = [];

  // Die Linie ist Ghostxx' eigener Merker, NICHT mehr das Haekchen.
  //
  // Der Haken hatte zwei Bedeutungen gleichzeitig: "bezahlt" und "ab hier
  // nicht mehr hinsehen". Die zweite hat die erste aufgefressen - stand ein
  // Problem-Beitrag oberhalb eines spaeteren Hakens, war er fuer immer weg.
  // Gezaehlt: 39 Nachweise in 16 Tickets, alle mit echtem Text und Bild.
  //
  // Jetzt zieht nur noch der Marker die Linie, und ein offenes Problem
  // sticht sie sowieso.
  let linie = -1;
  for (const [index, message] of messages.entries()) {
    if (istMarker(message)) linie = index;
  }

  // Noch kein Marker gesetzt (alle Tickets vor dieser Umstellung): dann
  // gilt uebergangsweise das letzte Haekchen wie frueher. Ohne das wuerde
  // er beim ersten Lauf jedes Ticket komplett von vorne durchgehen.
  if (linie === -1) {
    for (const [index, message] of messages.entries()) {
      if (isMarkedDone(message)) linie = index;
    }
  }

  const bereitsAusgezahlt = linie + 1;
  let abgelehnt = 0;
  let doppelt = 0;

  // Welches Bild wurde in diesem Thread schon einmal gepostet?
  //
  // Bewusst ueber ALLE Nachrichten, auch die laengst abgehakten. Wer einen
  // Screenshot von letzter Woche nochmal hochlaedt, waere sonst nicht zu
  // fassen - der alte liegt ja oberhalb der Linie und wird gar nicht mehr
  // angeschaut.
  const schonGesehen = new Map();

  for (const [index, message] of messages.entries()) {
    const bilder = getImages(message);

    // Erst merken, dann pruefen: so gilt immer der FRUEHERE Beitrag als das
    // Original und der spaetere als Doppelposting.
    const abdruecke = bilder.map(bildAbdruck).filter(Boolean);
    const bekannt = abdruecke
      .map((abdruck) => schonGesehen.get(abdruck))
      .find(Boolean);

    for (const abdruck of abdruecke) {
      if (!schonGesehen.has(abdruck)) schonGesehen.set(abdruck, message);
    }

    // Oberhalb der Linie wird normalerweise nichts mehr angesehen - AUSSER
    // es haengt ein offenes Problem dran. Das ist der ganze Sinn des
    // Achtungszeichens: "hier fehlt noch was". Solange es dranhaengt und
    // weder Haken noch Ablehnung dazugekommen ist, bleibt der Beitrag im
    // Rennen, egal wie weit die Linie darunter schon steht.
    if (index <= linie && !istOffenesProblem(message)) continue;
    if (message.author?.id === botId) continue;

    // Ein einzeln markierter Beitrag zaehlt nie mit - egal, wo er steht.
    // Die Linie sagt "bis hierher erledigt", die Marke am Beitrag selbst sagt
    // "dieser hier ist entschieden". Beides muss gelten, sonst faengt die
    // Linie einen abgelehnten Nachweis wieder ein.
    if (isRejected(message)) {
      abgelehnt += 1;
      continue;
    }
    if (isMarkedDone(message)) continue;

    const text = (message.content || '').trim();
    if (!text && !bilder.length) continue;

    if (bekannt) doppelt += 1;

    eintraege.push({
      messageId: message.id,
      authorId: message.author?.id || '',
      url: message.url,
      text,
      images: bilder,
      claim: parseClaim(text),
      // Mehrere Bilder waren frueher ein Grund zur Nachfrage, weil nur das
      // erste angesehen wurde. Inzwischen werden sie alle gelesen - gemeldet
      // wird nur, was ueber MAX_BILDER_JE_BEITRAG hinausgeht.
      mehrereBilder: bilder.length > 1,
      fremderHaken: fremderHaken(message),
      // Dasselbe Bild stand weiter oben im Thread schon einmal.
      doppelVon: bekannt ? { messageId: bekannt.id, url: bekannt.url } : null,
    });
  }

  eintraege.bereitsAusgezahlt = bereitsAusgezahlt;
  eintraege.abgelehnt = abgelehnt;
  eintraege.doppelt = doppelt;
  return eintraege;
}

/**
 * Markiert Nachweise, die denselben Durchgang zeigen.
 *
 * Ein Event laeuft nie zweimal in derselben Stunde - der 40er zur vollen
 * Stunde plus vierzig, die anderen noch seltener. Zwei Nachweise fuer dasselbe
 * Event mit derselben Spielstunde sind also derselbe Durchgang, auch wenn es
 * zwei verschiedene Aufnahmen sind.
 *
 * Genau so ein Fall lag im Logbuch: zwei "40er lose", vier Sekunden
 * auseinander, beide 20:46 am 09.08. Verschiedene Dateien, deshalb hat der
 * Fingerabdruck sie durchgelassen.
 *
 * Laeuft erst NACH der Bildpruefung, weil die Uhrzeit aus dem Bild kommt.
 */
function markiereZeitDoppel(eintraege) {
  const gesehen = new Map();
  let doppelt = 0;

  for (const eintrag of eintraege) {
    if (eintrag.doppelVon) continue;
    if (!eintrag.zeitpunkt?.stundenSchluessel) continue;

    const event = eintrag.claim?.event || eintrag.eventFromImage;
    if (!event) continue;

    const schluessel = `${event.key}@${eintrag.zeitpunkt.stundenSchluessel}`;
    const vorher = gesehen.get(schluessel);

    if (vorher) {
      eintrag.zeitDoppelVon = { messageId: vorher.messageId, url: vorher.url, zeit: vorher.zeitpunkt.text };
      doppelt += 1;
      continue;
    }

    gesehen.set(schluessel, eintrag);
  }

  return doppelt;
}

/** Zaehlt je Event, wie oft gewonnen und verloren wurde. */
/**
 * Zaehlt dieser Nachweis - und bekommt damit auch den Haken?
 *
 * EINE Regel fuer beides. Vorher waren es zwei, und sie widersprachen sich:
 * gezaehlt wurde alles ausser dem Widerlegten (verified !== false), abgehakt
 * nur das Bestaetigte (verified === true). Ein ungeprueftes Bild landete also
 * in der Auszahlungstabelle, bekam aber kein Haekchen - und wurde beim
 * naechsten Lauf ein ZWEITES Mal gezaehlt.
 *
 * Kevin hat es an seinem eigenen Ticket gesehen: "RP-Fabrik | 1 | 0" in der
 * Tabelle, und drei Zeilen darunter "RP-Fabrik WIn - noch nicht gelesen -
 * wird nachgeholt". Beides ueber denselben Nachweis.
 *
 * Seit die Sammelauszahlung ungelesene Bilder nur noch vormerkt statt auf sie
 * zu warten, war das kein Randfall mehr, sondern der Normalfall.
 *
 * Jetzt gilt: Was nicht abgehakt wird, wird auch nicht gezaehlt. Lieber beim
 * naechsten Lauf zaehlen als jetzt doppelt.
 */
function istGewertet(eintrag) {
  if (!eintrag.images.length) return false;
  // Dasselbe Bild wurde in diesem Thread schon eingereicht. Zaehlt einmal,
  // nicht zweimal - der erste Beitrag hat es ja bereits abgedeckt.
  if (eintrag.doppelVon) return false;
  // Zwei Aufnahmen desselben Durchgangs - zaehlt einmal.
  if (eintrag.zeitDoppelVon) return false;

  // Das Event kann aus dem Text kommen oder aus dem Bild gelesen worden sein.
  const event = eintrag.claim.event || eintrag.eventFromImage;
  if (!event || !eintrag.claim.result) return false;

  // Vier Zustaende, und der Unterschied zwischen den ersten beiden ist der
  // ganze Punkt:
  //
  //   undefined  gar nicht geprueft - die Bildpruefung war abgeschaltet
  //              (/auszahlen bilder_pruefen:false). Dann gilt der Text, das
  //              ist ja der Sinn der Einstellung.
  //   null       geprueft, aber kein Urteil moeglich: unlesbar, zwei Events
  //              im Bild, oder "noch nicht gelesen - wird nachgeholt".
  //   true       bestaetigt
  //   false      widerlegt
  //
  // null ist kein Ja. Genau daran hing Kevins Doppelzaehlung.
  return eintrag.verified === true || eintrag.verified === undefined;
}

function tally(eintraege) {
  const zaehler = new Map();

  for (const eintrag of eintraege) {
    if (!istGewertet(eintrag)) continue;

    const event = eintrag.claim.event || eintrag.eventFromImage;
    const result = eintrag.claim.result;

    if (!zaehler.has(event.key)) zaehler.set(event.key, { win: 0, lose: 0 });
    zaehler.get(event.key)[result] += 1;
  }

  return zaehler;
}

/**
 * Tabelle im Format:
 *   Event         | Lose | Win
 * Nur Events mit mindestens einem Eintrag, in der Reihenfolge des Katalogs.
 */
function formatTable(zaehler) {
  const zeilen = EVENTS
    .filter((event) => zaehler.has(event.key))
    .map((event) => ({ label: event.label, ...zaehler.get(event.key) }));

  if (!zeilen.length) return 'Noch nichts gezählt.';

  const breite = Math.max(11, ...zeilen.map((z) => z.label.length));
  const kopf = `${'Event'.padEnd(breite)} | Lose | Win`;
  const trenner = `${'-'.repeat(breite)}-+------+-----`;

  const body = zeilen.map((z) => (
    `${z.label.padEnd(breite)} | ${String(z.lose).padStart(4)} | ${String(z.win).padStart(3)}`
  ));

  const summeLose = zeilen.reduce((s, z) => s + z.lose, 0);
  const summeWin = zeilen.reduce((s, z) => s + z.win, 0);
  const summe = `${'Gesamt'.padEnd(breite)} | ${String(summeLose).padStart(4)} | ${String(summeWin).padStart(3)}`;

  return ['```', kopf, trenner, ...body, trenner, summe, '```'].join('\n');
}

/** Beitraege, die jemand anschauen sollte. */
function collectProblems(eintraege) {
  const probleme = [];

  for (const eintrag of eintraege) {
    // Dasselbe Bild stand weiter oben im Thread schon einmal. Das kommt nicht
    // aus Versehen - deshalb mit Link auf das Original, damit es nachprüfbar
    // ist und niemand auf Verdacht beschuldigt wird.
    if (eintrag.zeitDoppelVon) {
      probleme.push({
        eintrag,
        grund: `Selber Durchgang wie ${eintrag.zeitDoppelVon.url} (beide ${eintrag.zeitDoppelVon.zeit}) — zählt nur einmal`,
      });
      continue;
    }

    if (eintrag.doppelVon) {
      probleme.push({
        eintrag,
        grund: `Dasselbe Bild wurde hier schon eingereicht: ${eintrag.doppelVon.url} — zählt nur einmal`,
      });
      continue;
    }

    // Jemand hat mit einem normalen Haken reagiert statt mit dem der Familie.
    // Der Bot kann nicht wissen, ob das "schon erledigt" heissen sollte oder
    // nur ein beilaeufiges Daumenhoch war - deshalb wird gefragt statt geraten.
    // Im Logbuch stand so ein Beitrag, der dadurch ein zweites Mal drankam.
    if (eintrag.fremderHaken) {
      probleme.push({
        eintrag,
        grund: `Mit ${eintrag.fremderHaken} markiert statt mit :${config.giveawayEmojiName}: — schon abgerechnet?`,
      });
    }

    // Nur "WIN" im Text ist erlaubt - dann kommt das Event aus dem Bild.
    if (eintrag.claim.needsEventFromImage) {
      if (!eintrag.eventFromImage) {
        probleme.push({
          eintrag,
          grund: eintrag.eventFromImageReason || 'Kein Event im Text und keins im Bild erkannt',
        });
      }
      continue;
    }

    if (!eintrag.claim.ok) {
      // Ohne Bild und ohne erkennbares Event ist das einfach Geplauder im
      // Thread ("hahahha", "sry bro") - das ist kein fehlerhafter Nachweis
      // und hat in der Liste nichts verloren.
      if (!eintrag.images.length && eintrag.claim.reason === 'kein_event') continue;

      probleme.push({
        eintrag,
        grund: eintrag.claim.reason === 'kein_event'
          ? 'Kein bekanntes Event im Text'
          : 'Kein win/lose im Text',
      });
      continue;
    }

    if (!eintrag.images.length) {
      probleme.push({ eintrag, grund: 'Kein Bild als Nachweis' });
      continue;
    }

    // Mehrere Bilder sind kein Fehler mehr.
    //
    // Frueher schon: es wurde nur das erste angesehen, alles weitere fiel
    // unter den Tisch. Inzwischen werden bis zu MAX_BILDER_JE_BEITRAG
    // geoeffnet, bis eins ein Urteil hergibt - zwei Screenshots sind der
    // Normalfall, nicht die Ausnahme. Gemeldet wird nur, was darueber
    // hinausgeht, denn das sieht sich wirklich niemand an.
    if (eintrag.images.length > MAX_BILDER_JE_BEITRAG) {
      probleme.push({
        eintrag,
        grund: `${eintrag.images.length} Bilder in einem Beitrag — angesehen werden die ersten ${MAX_BILDER_JE_BEITRAG}`,
      });
    }

    if (eintrag.verified === false) {
      probleme.push({ eintrag, grund: eintrag.verifyReason || 'Bild passt nicht zum Text' });
      continue;
    }

    // Angesehen, aber kein Urteil moeglich.
    //
    // Das stand bisher nirgends: der Beitrag bekam kein Haekchen und sonst
    // passierte nichts - wer die Liste las, konnte ihn nicht von einem sauber
    // bezahlten unterscheiden. Kevins Vorgabe: lieber "konnte nicht gefunden
    // werden" schreiben als so tun, als waere alles in Ordnung.
    //
    // `undefined` ist etwas anderes als `null`: undefined heisst, dass gar
    // nicht hingesehen wurde (etwa oberhalb der Bildergrenze eines Laufs).
    // Das darf nicht wie eine Fehlanzeige aussehen.
    if (eintrag.verified === null && eintrag.verifyReason) {
      probleme.push({ eintrag, grund: eintrag.verifyReason });
    }
  }

  return probleme;
}

module.exports = {
  MAX_BILDER_JE_BEITRAG,
  collectProblems,
  hatReaktion,
  isMarkedDone,
  isRejected,
  istGewertet,
  istMarker,
  istOffenesProblem,
  markiereZeitDoppel,
  fetchThreadMessages,
  formatTable,
  getImages,
  readEntries,
  tally,
};
