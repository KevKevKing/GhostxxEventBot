const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Events } = require('discord.js');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { alleTickets, istTicket, personZuTicket } = require('./logbuch-tickets');
const { readEventFromImage } = require('./logbook-vision');
const { parseClaim } = require('./logbook-events');
const { readEntries } = require('./logbook');
const { leseUhrzeit } = require('./bild-uhrzeit');
const { ladeBildSicher } = require('./bild-laden');
const {
  alleGelesenen, erledigteNachrichten, halteFest, istEndgueltig, merke,
  ungeklaerte, zaehlung,
} = require('./bild-gedaechtnis');
const { entfetten, fuerKonsole } = require('./ticket-namen');
const { entladeModell, getLoadedDetails } = require('./ollama');
const { logBotEvent } = require('./logger');

// Jedes Logbuch-Bild wird gelesen, sobald es hochgeladen wird - nicht erst bei
// der Auszahlung. Warum, steht in bild-gedaechtnis.js.
//
// Hier geht es darum, dass er das DURCHHAELT:
//
// Die Warteschlange lag frueher nur im Arbeitsspeicher. Wird der Rechner
// ausgeschaltet - und das passiert hier jeden Abend - war sie weg. Die
// Ergebnisse blieben zwar erhalten, aber er fing wieder vorne an zu suchen.
//
// Deshalb merkt er sich jetzt seine Stelle: er geht die Tickets von A bis Z
// durch, haelt fest wo er steht, und macht nach einem Neustart genau dort
// weiter. War der letzte Durchgang nicht zu Ende, sagt er das beim Start.
//
// GEHEIM bleibt es trotzdem: keine Reaktion, keine Nachricht im Ticket. Der
// Vermerk geht nur ins Bot-Log und aufs Dashboard.

// Ein Bild alle 45 Sekunden, und nur bei freier Grafikkarte.
//
// Bei 34 Tickets mit zusammen etwa 150 Bildern ist ein voller Durchgang in
// knapp zwei Stunden durch - im Hintergrund, ohne dass jemand wartet. Danach
// kommen nur noch die neuen dazu, also eine Handvoll am Tag.
const TAKT_MS = 45 * 1000;

// Ein fehlgeschlagener Leseversuch ist KEIN Ergebnis.
//
// Beim ersten Lauf ist genau das passiert: der Aufruf schlug fehl, das Bild
// galt trotzdem als erledigt und stand im Dashboard als "nichts erkannt". Es
// waere nie wieder angesehen worden - und beim Auszahlen haette gefehlt, was
// wirklich drauf steht. Fehler werden deshalb wiederholt, aber nicht ewig.
//
// Auf Kevins Wunsch von 3 auf 5 angehoben. Kostet nichts Zusaetzliches an
// echten Lesungen: leseEvents() in logbook-vision.js gibt ab dem zweiten
// Fehlversuch (leerVersuche >= 2) aus dem Gedaechtnis zurueck, ohne das
// Modell nochmal zu fragen - die Versuche 3 bis 5 sind also nur schnelle
// Bestaetigungen "immer noch nichts", keine fuenf echten Grafikkarten-Anfragen.
const MAX_VERSUCHE = 5;

// So viele Nachrichten-Kennungen behaelt er, um nicht zweimal dasselbe Bild
// herunterzuladen. Reicht fuer alle Tickets mit Abstand.
const MAX_ERLEDIGT = 6000;

const datei = path.join(config.dataDir, 'bild-vorablesen.json');

const warteschlange = [];
let laeuft = false;
let stand = null;
// Welches Ticket gerade WIRKLICH gelesen wird.
//
// Nicht zu verwechseln mit stand.stelle: das ist die Stelle, an der er nach
// neuer Arbeit SUCHT. Beides stand als "steht bei" im Dashboard - er suchte
// schon bei Bollywood, waehrend er noch Bilder von Big Migi las.
let imMoment = '';
let imMomentKanal = '';

function leererStand() {
  return {
    stelle: '',
    runde: 0,
    gelesen: 0,
    begonnenAm: '',
    zuletztAm: '',
    fertig: true,
    erledigt: [],
    fehlversuche: {},
    // Von Hand ueber den Knopf im Dashboard gesetzt - nicht die alte
    // Grafikkarten-Grenze (die ist ganz weg, siehe darfLesen). Das hier ist
    // Kevins eigene Entscheidung: kurz Ruhe fuers Bildlesen, waehrend Chat
    // und Events normal weiterlaufen. Ueberlebt einen Neustart absichtlich -
    // wuerde er beim naechsten Absturz-Neustart des Watchdogs verschwinden,
    // laesst sich Ghostxx mitten im Zocken wieder die Karte volldruecken.
    pausiert: false,
  };
}

async function ladeStand() {
  if (stand) return stand;

  try {
    const roh = await fsp.readFile(datei, 'utf8');
    stand = { ...leererStand(), ...JSON.parse(roh) };
  } catch {
    stand = leererStand();
  }

  stand.erledigtSet = new Set(stand.erledigt || []);

  // Den Merkzettel aus dem Bildgedaechtnis auffuellen.
  //
  // Was ein Leseergebnis hat, ist erledigt - egal ob es zufaellig auf dem
  // Merkzettel steht. Ohne das laeuft er nach jedem Verlust der Liste alle
  // Tickets neu ab, laedt jedes Bild nochmal herunter und sieht von aussen aus,
  // als wuerde er alles neu auswerten. Genau das ist passiert, nachdem ich die
  // Liste von Hand geleert hatte.
  for (const id of await erledigteNachrichten().catch(() => [])) {
    stand.erledigtSet.add(id);
  }

  return stand;
}

async function sichereStand() {
  if (!stand) return;
  const erledigt = [...stand.erledigtSet].slice(-MAX_ERLEDIGT);
  await writeFileAtomic(datei, JSON.stringify({
    stelle: stand.stelle,
    runde: stand.runde,
    gelesen: stand.gelesen,
    begonnenAm: stand.begonnenAm,
    zuletztAm: stand.zuletztAm,
    fertig: stand.fertig,
    erledigt,
    fehlversuche: stand.fehlversuche,
    // War schon einmal vergessen: diese Liste ist eine feste Aufzaehlung,
    // kein "alles speichern". Ein neues Feld im Stand muss hier von Hand
    // dazu, sonst ueberlebt es keinen Neustart - genau das ist "pausiert"
    // beim ersten Anlauf passiert.
    pausiert: stand.pausiert,
  }, null, 2)).catch(() => null);
}

function istBild(anhang) {
  return (anhang.contentType || '').startsWith('image/');
}

function inWarteschlange(id) {
  return warteschlange.some((e) => e.messageId === id);
}

/** Ein Bild einreihen. Neue Bilder kommen nach vorn - sie sind das Aktuelle. */
function reiheEin(message, anhang, { vorn = false } = {}) {
  if (inWarteschlange(message.id)) return false;

  const eintrag = {
    messageId: message.id,
    kanalId: message.channelId,
    kanalName: message.channel?.name || '',
    url: anhang.url,
    text: (message.content || '').slice(0, 120),
  };

  if (vorn) warteschlange.unshift(eintrag);
  else warteschlange.push(eintrag);

  // Der Bestand ist damit veraltet.
  //
  // Ohne das standen zwei verschiedene Zahlen fuer dieselbe Schlange im
  // Dashboard - "2 in der Schlange" aus der Bestandsaufnahme von vor drei
  // Minuten und "3 in der Schlange" aus dem Merkzettel von jetzt. Genau die
  // Sorte Widerspruch, wegen der die Uebersicht ueberhaupt gebaut wurde.
  if (bestand) bestand.standAm = 0;
  return true;
}

/**
 * Er liest immer.
 *
 * Hier stand eine Sperre: nicht lesen, solange die Grafikkarte beschaeftigt
 * ist. Gut gemeint, im Alltag aber Mist - jedes Mal, wenn Kevin kurz einen
 * Stream aufmachte oder etwas anderes tat, blieb die Warteschlange stehen.
 * Und beim Lesen selbst half sie gar nichts: kaputt gingen die Bilder an der
 * ZEITGRENZE von 90 Sekunden, nicht an der Auslastung.
 *
 * Kevins Ansage: "mach diese Grenze weg, dann drueckt meine Karte halt den
 * Stream runter oder das Modell braucht laenger, ist dann so."
 *
 * Genau so ist es jetzt. Statt abzuwarten bekommt das Bildlesen fuenf Minuten
 * Zeit (ollamaVisionTimeoutMs) - dann rutscht das Modell notfalls halb in den
 * Arbeitsspeicher, wird langsamer, liest aber zu Ende. Lieber langsam als
 * falsch: an jedem Bild haengt Geld.
 */
async function darfLesen() {
  const s = await ladeStand();
  return !s.pausiert;
}

/**
 * Der Knopf im Dashboard: Bildlesen an- oder ausschalten, sonst nichts.
 *
 * Nur diese eine Sache haelt an - Chat, Events und alles andere merken davon
 * nichts, die haengen nicht an dieser Schleife.
 *
 * Beim Pausieren wird das Modell sofort aus dem Speicher geworfen statt auf
 * das natuerliche Verfallen zu warten - Kevin will in dem Moment die
 * Grafikkarte frei haben, nicht erst in fuenf Minuten.
 */
async function setzePause(an) {
  const s = await ladeStand();
  s.pausiert = Boolean(an);
  await sichereStand();

  if (s.pausiert) {
    // Beide Modelle: ollamaEventVisionModel (glm-ocr) liest seit 17.08. sowohl
    // Events als auch die Uhrzeit - ollamaVisionModel (qwen3-vl:8b) bleibt nur
    // noch fuer bild-kommentar.js im Einsatz (das BESCHREIBT Bilder im Chat,
    // das kann ein reines OCR-Modell nicht). Ist der Chat gerade aktiv
    // gewesen, kann das auch noch geladen sein - beide werden deshalb
    // vorsorglich entladen.
    await Promise.all([
      entladeModell(config.ollamaVisionModel).catch(() => null),
      entladeModell(config.ollamaEventVisionModel).catch(() => null),
    ]);
  }

  return s.pausiert;
}


/** Wie beschaeftigt ist die Grafikkarte gerade? In Prozent. */
function gpuLast() {
  return new Promise((fertig) => {
    let ausgabe = '';
    const p = spawn('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true });

    p.stdout.on('data', (d) => { ausgabe += d; });
    p.on('error', () => fertig(null));
    p.on('close', () => {
      const wert = Number(ausgabe.trim().split('\n')[0]);
      fertig(Number.isFinite(wert) ? wert : null);
    });

    setTimeout(() => { p.kill(); fertig(null); }, 3000).unref?.();
  });
}

/** Ein Bild lesen. Wirft nie - ein kaputtes Bild haelt die Schlange nicht an. */
async function lies(client, eintrag) {
  const s = await ladeStand();

  try {
    // Prueft die Content-Length gegen die tatsaechlich angekommene Groesse
    // und laedt bei Abweichung einmal neu - siehe bild-laden.js.
    const buffer = await ladeBildSicher(eintrag.url);
    if (!buffer) {
      // Abgelaufener Anhang oder Download wiederholt unvollstaendig. Nicht
      // wieder versuchen, sonst haengt er ewig dran.
      s.erledigtSet.add(eintrag.messageId);
      return false;
    }

    const base64 = buffer.toString('base64');

    const bekannt = await merke(base64);

    // Erst lesen, dann urteilen: erledigt ist ein Bild erst, wenn ein Fund
    // drinsteht - oder eine Fehlanzeige zweimal bestaetigt wurde.
    let gelungen = istEndgueltig(bekannt);
    let zeitAbgelaufen = false;
    if (!gelungen) {
      // KEIN gezielter TEXT-Hinweis im Prompt - der dritte Anlauf in
      // leseEventsFrisch ist abgeschaltet. Gemessen: ein falscher Hinweis
      // kam als Echo zurueck und waere als Fund durchgegangen. Siehe die
      // Warnung in logbook-vision.js bei gezielterPrompt().
      //
      // Ein reiner ZUSCHNITT ist etwas anderes (23.08.): er sagt dem Modell
      // nicht, WAS es sehen soll, nur WOHIN es schauen soll - der Text selbst
      // geht nie in den Prompt, es kann also nichts zurueckpapageien. Der
      // behauptete Typ aus dem Nachrichtentext lenkt deshalb nur den
      // Zuschnitt, siehe schnittFuerTyp() in logbook-vision.js.
      const vermuteterTyp = parseClaim(eintrag.text || '')?.event?.key;
      const ergebnis = await readEventFromImage(base64, { vermuteterTyp });
      zeitAbgelaufen = Boolean(ergebnis?.timedOut);
      gelungen = istEndgueltig(await merke(base64));
    }

    if (!bekannt || !('zeitpunkt' in bekannt)) await leseUhrzeit(buffer);

    const kanal = await client.channels.fetch(eintrag.kanalId).catch(() => null);
    const person = kanal?.guild ? personZuTicket(kanal.guild, kanal) : null;

    await halteFest(base64, {
      wo: kanal?.name || eintrag.kanalName || eintrag.kanalId,
      werName: person?.displayName || '',
      messageId: eintrag.messageId,
      kanalId: eintrag.kanalId,
      angegeben: eintrag.text,
      gelesen: gelungen,
    });

    if (!gelungen) {
      // Eine Zeitueberschreitung ist KEIN Urteil ueber das Bild.
      //
      // Gemessen bei laufendem Spiel: die Karte auf 100 %, das Modell komplett
      // im Grafikspeicher - eine kurze Frage geht in 17 Sekunden, der volle
      // Leseauftrag reisst die 90 Sekunden, weil das Modell erst nachdenkt.
      // Wuerde das als Versuch zaehlen, waeren nach drei Streams gute Bilder
      // fuer immer abgehakt.
      //
      // Solche Bilder bleiben einfach liegen und werden gelesen, wenn die
      // Karte frei ist.
      if (zeitAbgelaufen) {
        warteschlange.push(eintrag);
        return false;
      }

      // Alles andere zaehlt - aber nicht endlos.
      const versuche = (s.fehlversuche[eintrag.messageId] || 0) + 1;
      s.fehlversuche[eintrag.messageId] = versuche;
      if (versuche >= MAX_VERSUCHE) s.erledigtSet.add(eintrag.messageId);
      return false;
    }

    delete s.fehlversuche[eintrag.messageId];
    s.erledigtSet.add(eintrag.messageId);
    s.gelesen += 1;
    return true;
  } catch {
    return false;
  } finally {
    s.zuletztAm = new Date().toISOString();
    await sichereStand();
  }
}

/**
 * Die naechsten ungelesenen Bilder suchen - streng von A bis Z.
 *
 * Er merkt sich den Namen des Tickets, bei dem er steht, und faengt beim
 * naechsten Mal dahinter an. Am Ende der Liste beginnt eine neue Runde.
 */
async function fuelleNach(guild, wieViele = 5, botId = '') {
  const s = await ladeStand();

  const tickets = (await alleTickets(guild, { nurGezaehlte: true }).catch(() => []))
    .sort((a, b) => entfetten(a.name).toLowerCase().localeCompare(entfetten(b.name).toLowerCase(), 'de'));

  if (!tickets.length) return 0;

  const start = s.stelle
    ? Math.max(0, tickets.findIndex((k) => k.name === s.stelle))
    : 0;

  let eingereiht = 0;

  for (let i = 0; i < tickets.length && eingereiht < wieViele; i += 1) {
    const kanal = tickets[(start + i) % tickets.length];

    // Neue Runde begonnen?
    if (i > 0 && (start + i) % tickets.length === 0) {
      s.runde += 1;
      s.begonnenAm = new Date().toISOString();
    }

    s.stelle = kanal.name;

    const nachrichten = await kanal.messages.fetch({ limit: 100 }).catch(() => null);
    if (!nachrichten) continue;

    const sortiert = [...nachrichten.values()].reverse();

    // NUR was unterhalb des Haekchens liegt.
    //
    // Alles darueber ist abgerechnet und bezahlt - die Auszahlung schaut es
    // nie wieder an, also braucht er es auch nicht zu lesen. Vorher hat er
    // stumpf die letzten 50 Nachrichten genommen und Wochen alte, laengst
    // bezahlte Bilder durch die Grafikkarte gejagt.
    const offeneIds = new Set(
      readEntries(sortiert, botId)
        .filter((e) => e.images?.length)
        .map((e) => e.messageId),
    );

    for (const message of sortiert) {
      if (eingereiht >= wieViele) break;
      if (s.erledigtSet.has(message.id)) continue;
      if (inWarteschlange(message.id)) continue;

      const anhang = [...message.attachments.values()].find(istBild);

      // Kein Bild, oder schon abgerechnet: abhaken, ohne es anzusehen.
      if (!anhang || !offeneIds.has(message.id)) {
        s.erledigtSet.add(message.id);
        continue;
      }

      reiheEin({ ...message, channel: kanal }, anhang);
      eingereiht += 1;
    }
  }

  // Einmal komplett durch und nichts mehr gefunden? Dann ist er durch.
  //
  // Vorher zaehlte er stur Runden hoch und stand ewig bei irgendeinem Namen,
  // obwohl es dort nichts mehr zu tun gab.
  if (eingereiht === 0) {
    s.fertig = true;
    s.stelle = '';
    s.durchAm = new Date().toISOString();
  } else {
    s.fertig = false;
  }

  await sichereStand();
  return eingereiht;
}

/** Ein Durchgang: hoechstens ein Bild. */
async function arbeite(client) {
  if (laeuft || !warteschlange.length) return null;
  if (!(await darfLesen())) return null;

  laeuft = true;
  try {
    const s = await ladeStand();
    s.fertig = false;
    const eintrag = warteschlange.shift();
    imMoment = eintrag.kanalName || '';
    imMomentKanal = eintrag.kanalId || '';
    const ok = await lies(client, eintrag);
    imMoment = '';
    imMomentKanal = '';

    // Hinter sich aufraeumen. Ollama laesst die Bildmodelle sonst fuenf
    // Minuten liegen - startet Kevin in der Zeit ein Spiel, fehlt ihm der
    // Speicher. Beide: glm-ocr fuer Events, qwen3-vl:8b fuer die Uhrzeit.
    //
    // Nur wenn nichts mehr wartet: kommen gleich noch Bilder, waere das
    // Entladen und Neuladen reine Zeitverschwendung.
    if (!warteschlange.length) {
      await Promise.all([
        entladeModell(config.ollamaVisionModel).catch(() => null),
        entladeModell(config.ollamaEventVisionModel).catch(() => null),
      ]);
    }

    return { ...eintrag, ok };
  } finally {
    laeuft = false;
  }
}

/**
 * Warum passiert gerade nichts?
 *
 * "5 wartend" und dann minutenlang Stillstand sieht aus wie kaputt. Meistens
 * ist es das nicht - er wartet auf eine ruhige Grafikkarte. Das gehoert
 * hingeschrieben, sonst raet man.
 */
async function zustand() {
  if (laeuft) {
    return {
      was: 'liest',
      text: imMoment ? `liest gerade ein Bild von ${imMoment}` : 'liest gerade ein Bild',
    };
  }

  // Zuerst pruefen, sonst stuende bei einer vollen Schlange "liest gleich
  // weiter" da, obwohl er das gerade bewusst nicht tut.
  const s = await ladeStand();
  if (s.pausiert) {
    return {
      was: 'pausiert',
      text: warteschlange.length
        ? `Bildlesen pausiert — ${warteschlange.length} warten, bis es weitergeht`
        : 'Bildlesen pausiert',
    };
  }

  if (!warteschlange.length) return { was: 'leer', text: 'alles durch — nichts zu tun' };

  const last = await gpuLast().catch(() => null);
  return {
    was: 'gleich',
    text: `${warteschlange.length} in der Schlange, liest gleich weiter`
      + (last !== null ? ` · Grafikkarte bei ${last} %` : ''),
  };
}

/**
 * Das Bildmodell aus dem Speicher werfen, wenn es gerade nicht gebraucht wird.
 *
 * Nur wenn es wirklich geladen ist - ein Entladebefehl ins Leere laedt es bei
 * manchen Ollama-Fassungen erst recht.
 */
async function raeumeBildmodellWeg() {
  const geladen = await getLoadedDetails().catch(() => []);
  const namen = geladen.map((m) => m.name);
  const gefunden = namen.includes(config.ollamaVisionModel) || namen.includes(config.ollamaEventVisionModel);
  if (!gefunden) return false;

  await Promise.all([
    entladeModell(config.ollamaVisionModel).catch(() => null),
    entladeModell(config.ollamaEventVisionModel).catch(() => null),
  ]);
  return true;
}

// ---- Bestandsaufnahme ------------------------------------------------------
//
// Kevin hat vorgerechnet, dass die Zahlen im Dashboard nicht aufgingen: 80
// Bilder in den Tickets, aber 82 gelesen, 4 unlesbar und 8 in der Schlange.
//
// Er hatte recht, und der Grund war, dass drei verschiedene Toepfe unter einer
// Ueberschrift standen:
//
//   - "gelesen/gescheitert" kam aus dem Bildgedaechtnis. Das ist eine CHRONIK,
//     kein Bestand: alles, was je geoeffnet wurde, auch Bilder aus geloeschten
//     Nachrichten und aus Tickets, die die Kategorie verlassen haben. Sie
//     schrumpft nie.
//   - "in der Schlange" kam aus dem Merkzettel im Arbeitsspeicher - eine
//     TEILMENGE der Bilder in den Tickets, nicht etwas daneben.
//   - Die 80 hatte Kevin in Discord gezaehlt. Diese Zahl kannte der Bot gar
//     nicht.
//
// Deshalb wird sie jetzt erhoben: einmal alle Tickets abgehen und zaehlen, was
// unterhalb des letzten Haekchens wirklich liegt. Das kostet nur Discord-
// Abfragen, keine Grafikkarte. Alles andere ist danach eine Teilmenge davon,
// und die Rechnung geht auf.
const BESTAND_FRISCH_MS = 5 * 60 * 1000;

let bestand = null;

async function bestandAufnehmen(guild, botId = '') {
  const tickets = await alleTickets(guild, { nurGezaehlte: true }).catch(() => []);
  const bilder = [];
  let mitBildern = 0;

  for (const kanal of tickets) {
    const nachrichten = await kanal.messages.fetch({ limit: 100 }).catch(() => null);
    if (!nachrichten) continue;

    const sortiert = [...nachrichten.values()].reverse();

    // Dieselbe Sicht wie beim Lesen und beim Auszahlen: NUR was unterhalb des
    // letzten Haekchens liegt. Alles darueber ist bezahlt.
    const offene = readEntries(sortiert, botId).filter((e) => e.images?.length);
    if (!offene.length) continue;

    mitBildern += 1;
    for (const eintrag of offene) {
      for (const bild of eintrag.images) {
        bilder.push({ messageId: eintrag.messageId, kanalId: kanal.id, name: kanal.name, url: bild.url });
      }
    }
  }

  bestand = { standAm: Date.now(), tickets: tickets.length, mitBildern, bilder };
  return bestand;
}

/**
 * Die Uebersicht, wie Kevin sie lesen wollte:
 *
 *   80 Bilder in 18 von 34 Tickets - davon 5 nicht lesbar, 8 in der Schlange
 *
 * Jede Teilzahl ist eine Teilmenge der Gesamtzahl. Was nicht aufgeht, ist ein
 * Fehler und keine Auslegungssache.
 */
async function uebersicht() {
  if (!bestand) return null;

  const nachId = new Map();
  for (const eintrag of await alleGelesenen(5000)) {
    if (eintrag.messageId) nachId.set(eintrag.messageId, eintrag);
  }

  const zahl = { gelesen: 0, ohneEvent: 0, unlesbar: 0, wartend: 0, offen: 0 };
  const unlesbareTickets = new Map();

  // Ein Bild pro Nachricht wird gelesen - mehr Bilder an derselben Nachricht
  // haengen am selben Urteil.
  const nachrichten = new Map();
  for (const b of bestand.bilder) if (!nachrichten.has(b.messageId)) nachrichten.set(b.messageId, b);

  for (const [messageId, b] of nachrichten) {
    const gemerkt = nachId.get(messageId);

    if (inWarteschlange(messageId)) zahl.wartend += 1;
    else if (!gemerkt) zahl.offen += 1;
    else if (!gemerkt.antwort) {
      zahl.unlesbar += 1;
      unlesbareTickets.set(b.name, (unlesbareTickets.get(b.name) || 0) + 1);
    } else if ((gemerkt.labels || []).length || gemerkt.antwort.wappen) zahl.gelesen += 1;
    else zahl.ohneEvent += 1;
  }

  // Was seit der letzten Zaehlung dazugekommen ist, gehoert mitgezaehlt.
  //
  // Sonst zeigt die Uebersicht "2 in der Schlange" und die Zeile darunter
  // "3 in der Schlange" - beide haetten recht, weil sie zu verschiedenen
  // Zeitpunkten gehoeren. Fuer den, der davorsitzt, ist es trotzdem ein
  // Widerspruch. Diese Bilder liegen ebenfalls in Tickets, zaehlen also auch
  // zur Gesamtzahl.
  let dazu = 0;
  for (const e of warteschlange) {
    if (nachrichten.has(e.messageId)) continue;
    nachrichten.set(e.messageId, { name: e.kanalName });
    zahl.wartend += 1;
    dazu += 1;
  }

  return {
    standAm: bestand.standAm,
    bilder: bestand.bilder.length + dazu,
    beitraege: nachrichten.size,
    tickets: bestand.tickets,
    mitBildern: bestand.mitBildern,
    ...zahl,
    // Die fuenf unlesbaren lagen alle in EINEM Ticket. So etwas ist kein
    // Streuverlust, sondern ein Hinweis - deshalb steht es dabei.
    unlesbarJeTicket: [...unlesbareTickets.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .map(([name, n]) => ({ name: fuerKonsole(name), n })),
  };
}

function bestandVeraltet() {
  return !bestand || Date.now() - bestand.standAm > BESTAND_FRISCH_MS;
}

/** Fuers Dashboard: wo steht er gerade? */
async function fortschritt() {
  const s = await ladeStand();
  const zahlen = await zaehlung().catch(() => ({ gelesen: 0, gescheitert: 0 }));

  return {
    wartend: warteschlange.length,
    // Zwei verschiedene Orte, deshalb zwei Felder: wo er GERADE liest, und wo
    // er nach neuer Arbeit sucht. Als ein Feld sah es aus wie ein Widerspruch.
    aktuellKanal: imMomentKanal,
    aktuell: imMoment,
    sucht: s.stelle,
    runde: s.runde,
    // Die Zahlen kommen aus dem Bildgedaechtnis, nicht aus einem eigenen
    // Zaehler - sonst laufen sie auseinander.
    gelesen: zahlen.gelesen,
    gescheitert: zahlen.gescheitert,
    zuletztAm: s.zuletztAm,
    unterbrochen: Boolean(s.unterbrochen),
    pausiert: Boolean(s.pausiert),
    zustand: await zustand(),
    // Die Zahlen oben sind die Chronik, die hier ist der Bestand. Beides steht
    // im Dashboard, aber getrennt und mit verschiedenen Ueberschriften - genau
    // die Vermischung war der Fehler.
    bestand: await uebersicht().catch(() => null),
  };
}

function offen() {
  return warteschlange.length;
}

// Wie lange ein ungeklaertes Bild in Ruhe gelassen wird, bevor er es nochmal
// versucht.
//
// War eine Stunde, Kevins Ansage: hat er sonst nichts zu tun, soll er die
// Leerlaufzeit nutzen und die Problemfaelle haeufiger durchgehen, nicht eine
// Stunde liegen lassen. Eine Minute passt zum 45-Sekunden-Takt (TAKT_MS) -
// kuerzer haette keinen Effekt, der Takt selbst laeuft nicht oefter.
//
// Kostet nichts Zusaetzliches an echten Lesungen: leseEvents() in
// logbook-vision.js gibt ab dem zweiten Fehlversuch (leerVersuche >= 2) aus
// dem Gedaechtnis zurueck, ohne das Modell nochmal zu fragen. Schneller
// wiederholt heisst also nur: schneller aufgeben (MAX_VERSUCHE), nicht
// oefter wirklich lesen.
const WIEDERVORLAGE_MS = 60 * 1000;

/**
 * Nichts Neues zu tun? Dann die ungeklaerten nochmal.
 *
 * Kevins Frage war genau die richtige: "und wenn er dann kein Foto hat, guckt
 * er die sich nochmal an?" Vorher nicht - nach zwei Fehlanzeigen war Schluss,
 * fuer immer. Dabei ist die Grafikkarte in so einem Moment frei, und unter den
 * ungeklaerten sind Bilder, an denen echtes Geld haengt.
 *
 * Die Nachricht wird dabei FRISCH geholt: Discord-Anhangslinks laufen ab, der
 * alte Link waere womoeglich tot.
 */
async function holeUngeklaerte(client) {
  const offene = await ungeklaerte(WIEDERVORLAGE_MS).catch(() => []);
  let eingereiht = 0;

  for (const eintrag of offene.slice(0, 3)) {
    if (inWarteschlange(eintrag.messageId)) continue;

    const kanal = await client.channels.fetch(eintrag.kanalId).catch(() => null);
    const message = await kanal?.messages.fetch(eintrag.messageId).catch(() => null);
    if (!message) continue;

    const anhang = [...message.attachments.values()].find(istBild);
    if (!anhang) continue;

    reiheEin({ ...message, channel: kanal }, anhang);
    eingereiht += 1;
  }

  return eingereiht;
}

/**
 * Beim Start: war der letzte Durchgang zu Ende, oder wurde der Rechner
 * mittendrin ausgeschaltet?
 */
async function meldeUnterbrechung() {
  const s = await ladeStand();
  if (!s.zuletztAm || s.fertig) return null;

  s.unterbrochen = true;
  const her = Math.round((Date.now() - new Date(s.zuletztAm).getTime()) / 60000);

  const zahlen = await zaehlung().catch(() => ({ gelesen: 0 }));
  const text = `Beim Bildlesen unterbrochen — zuletzt bei "${s.stelle}" vor ${her} Minuten. `
    + `Ich mache dort weiter. Bisher gelesen: ${zahlen.gelesen}.`;

  console.log(fuerKonsole(text));
  logBotEvent({
    title: 'Bildlesen wird fortgesetzt',
    color: 'update',
    fields: [
      { name: 'Zuletzt bei', value: s.stelle || 'unbekannt', inline: true },
      { name: 'Vor', value: `${her} Minuten`, inline: true },
      { name: 'Bisher gelesen', value: String(zahlen.gelesen), inline: true },
    ],
  });

  return text;
}

function registerBildVorablesen(client) {
  // Neue Bilder kommen sofort dran, vor dem Nachholen alter.
  client.on(Events.MessageCreate, (message) => {
    try {
      if (message.author?.bot) return;
      if (!istTicket(message.channel)) return;
      const anhang = [...(message.attachments?.values() || [])].find(istBild);
      if (anhang) reiheEin(message, anhang, { vorn: true });
    } catch {
      // Ein Fehler beim Einreihen darf keine Nachricht verschlucken.
    }
  });

  meldeUnterbrechung().catch(() => null);

  const takt = setInterval(async () => {
    try {
      // Ein vorheriger Takt arbeitet noch die Warteschlange ab (siehe unten) -
      // dann hier nichts Doppeltes anstossen.
      if (laeuft) return;

      // ZURUECKGEBAUT (18.08.) - das hier hat den Bot lahmgelegt.
      //
      // Der Gedanke war: bei vollem Rueckstand durcharbeiten statt 45
      // Sekunden Pause zwischen jedem Bild. Der Fehler: laeuft die
      // Grafikkarte gerade voll (GTA, oder Ollama selbst beschaeftigt),
      // schiebt lies() das Bild bei einer Zeitueberschreitung OHNE Pause
      // zurueck in die Warteschlange und gibt false zurueck - kein null.
      // Die Schleife brach nur bei null ab, lief also sofort wieder auf
      // GENAU DASSELBE Bild, wieder Zeitueberschreitung, wieder zurueck in
      // die Schlange - eine Dauerschleife ohne jede Pause, solange die Karte
      // belegt blieb. Der Bot wurde komplett unresponsiv, das Dashboard
      // antwortete nicht mehr.
      //
      // Ein Bild pro Takt ist bewaehrt und sicher. Schneller durcharbeiten
      // bei vollem Rueckstand ist eine gute Idee, aber sie braucht eine
      // echte Ausnahme fuer genau diesen Zeitueberschreitungs-Fall, bevor
      // sie wieder scharf geht.
      await arbeite(client);

      const guild = client.guilds.cache.get(config.guildId);

      // Bestand alle fuenf Minuten neu zaehlen. Kostet nur Discord-Abfragen,
      // keine Grafikkarte - deshalb laeuft es unabhaengig davon, ob er gerade
      // liest.
      if (guild && bestandVeraltet()) {
        await bestandAufnehmen(guild, client.user.id).catch(() => null);
      }

      if (!warteschlange.length) {
        // Erst neue Bilder suchen. Findet er keine, die ungeklaerten nochmal.
        const neue = guild ? await fuelleNach(guild, 5, client.user.id) : 0;
        if (!neue) await holeUngeklaerte(client);
      }
    } catch {
      // still weiter
    }
  }, TAKT_MS);

  takt.unref?.();
  console.log('Bild-Vorablesen laeuft (A-Z, still, nur fuers Dashboard).');
  return takt;
}

module.exports = {
  MAX_VERSUCHE,
  TAKT_MS,
  WIEDERVORLAGE_MS,
  gpuLast,
  arbeite,
  bestandAufnehmen,
  darfLesen,
  fortschritt,
  uebersicht,
  fuelleNach,
  holeUngeklaerte,
  meldeUnterbrechung,
  offen,
  raeumeBildmodellWeg,
  registerBildVorablesen,
  reiheEin,
  setzePause,
  zustand,
};
