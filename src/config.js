const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');

for (const fileName of ['.env', 'env']) {
  const filePath = path.join(rootDir, fileName);
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: false, quiet: true });
  }
}

function readRawTokenFile() {
  for (const fileName of ['.env', 'env']) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.includes('=')) continue;
      return trimmed;
    }
  }

  return '';
}

function getToken() {
  return (
    process.env.DISCORD_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.TOKEN ||
    readRawTokenFile()
  );
}

function decodeClientIdFromToken(token) {
  const firstPart = token?.split('.')?.[0];
  if (!firstPart) return '';

  try {
    return Buffer.from(firstPart, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const token = getToken();

const config = {
  token,
  clientId:
    process.env.DISCORD_CLIENT_ID ||
    process.env.CLIENT_ID ||
    decodeClientIdFromToken(token),
  guildId: process.env.GUILD_ID || '919258127042510889',
  eventChannelId: process.env.EVENT_CHANNEL_ID || '1503123644321366268',
  eventRoleId: process.env.EVENT_ROLE_ID || '1511343501709676746',
  fortyEventRoleId: process.env.FORTY_EVENT_ROLE_ID || '1511358566248743042',
  stateChannelId: process.env.STATE_CHANNEL_ID || '1478179319980363847',
  ownerId: process.env.OWNER_ID || '1365073743679852687',
  adminId: process.env.ADMIN_ID || '286819354589265920',
  turfLeaderRoleId: process.env.TURF_LEADER_ROLE_ID || '1149789708965122169',
  giveawayEmojiName: process.env.GIVEAWAY_EMOJI_NAME || 'delaTeabesttigt',
  // Gegenstueck zum Haken: damit wird ein Nachweis von Hand abgelehnt. Kommt im
  // Logbuch 79-mal vor und darf nie als Teilnahme zaehlen.
  logbookRejectEmojiName: process.env.LOGBOOK_REJECT_EMOJI_NAME || 'delaTeaabgelehnt',

  // Kommt an jeden Nachweis, den er NICHT werten konnte.
  //
  // Ein Haken heisst "gezaehlt und bezahlt". Wer keinen bekommt, weil das Bild
  // unlesbar war, sah bisher genauso aus wie ein noch nicht angesehener - beim
  // Durchscrollen war nicht zu erkennen, wo es klemmt.
  //
  // Das Achtungszeichen STICHT die Linie: ein so markierter Beitrag wird immer
  // wieder eingesammelt, egal wie weit der Marker darunter schon ist. Vorher
  // war das anders, und 39 Nachweise in 16 Tickets sind dadurch unter die
  // Linie gerutscht und waeren nie wieder angesehen worden.
  logbookAttentionEmojiName: process.env.LOGBOOK_ATTENTION_EMOJI_NAME || 'AttentionAnimated',

  // Ghostxx' eigener Merker: "bis hierher habe ich alles angesehen".
  //
  // Frueher zog der Haken die Linie - der hatte damit zwei Bedeutungen
  // gleichzeitig ("bezahlt" UND "ab hier nicht mehr hinsehen"), und die zweite
  // hat die erste aufgefressen. Jetzt trennt sich das sauber:
  //
  //   AttentionAnimated  offenes Problem, sticht die Linie
  //   delaTeabesttigt    bezahlt - reine Auskunft, zieht KEINE Linie mehr
  //   GTALoading         die Linie, und zwar die einzige
  //
  // Wichtig: der Merker rueckt erst NACH dem Verarbeiten weiter. Stuerzt der
  // Bot mittendrin ab (ist am 16.08. passiert), steht er noch auf dem letzten
  // wirklich fertigen Beitrag - dann wird einer doppelt angesehen statt einer
  // verloren.
  logbookMarkerEmojiName: process.env.LOGBOOK_MARKER_EMOJI_NAME || 'GTALoading',

  // Von Hand gesetzt: "haben wir angerechnet und ausgezahlt".
  //
  // Kevin und Johannes tragen die Auszahlungen selbst ein und markieren, was
  // erledigt ist. Zaehlt wie ein Haken - der Nachweis ist durch, egal was der
  // Bot selbst darueber denkt.
  logbookPaidEmojiName: process.env.LOGBOOK_PAID_EMOJI_NAME || '0acrylic_moneybag',
  giveawayPingRoleId: process.env.GIVEAWAY_PING_ROLE_ID || '1150863456828928130',
  giveawayCleanupDays: Number(process.env.GIVEAWAY_CLEANUP_DAYS || 3),
  // Serveraktivitaet: Kicks, Bans, Channel, Rollen, Aenderungen an Anmeldungen.
  logChannelId: process.env.LOG_CHANNEL_ID || '1535269549417693214',
  // Technisches: Fehler, Aussetzer, Dinge die kaputt sind.
  botLogChannelId: process.env.BOT_LOG_CHANNEL_ID || '1535377104877649980',
  botHomeChannelId: process.env.BOT_HOME_CHANNEL_ID || '1535058479172157520',
  notifyUserId: process.env.NOTIFY_USER_ID || process.env.OWNER_ID || '1365073743679852687',
  eventArchiveDays: Number(process.env.EVENT_ARCHIVE_DAYS || 3),

  giveawayChannelId: process.env.GIVEAWAY_CHANNEL_ID || '1471864685887357061',
  chatChannelId: process.env.CHAT_CHANNEL_ID || '1117011938770157629',
  visaChannelId: process.env.VISA_CHANNEL_ID || '1498033854265557163',
  logbookChannelId: process.env.LOGBOOK_CHANNEL_ID || '1431712636227031130',
  // Familien-Mitgliederliste: wer eine der neun Rangrollen traegt.
  familienListeChannelId: process.env.FAMILIEN_LISTE_CHANNEL_ID || '1538187580359577630',
  familienAbweichungChannelId: process.env.FAMILIEN_ABWEICHUNG_CHANNEL_ID || '1538212891382128740',

  // Das Logbuch zieht vom Forum auf ein Ticketsystem um. Ein Ticket ist ein
  // normaler Textkanal in einer dieser Kategorien und heisst
  // "<Nummer>-<Discord-Benutzername>", zum Beispiel "58-ghost_muffin1".
  //
  // Beide Wege laufen parallel: die alten Forum-Threads bleiben lesbar,
  // solange dort noch Nachweise liegen.
  //
  // Seit dem 16.08.2026 gibt es zwei komplette Saetze ("Logbuch" und
  // "Logbuch 2") - deshalb sechs statt drei IDs. Ghostxx behandelt beide
  // Saetze gleich, es gibt keinen Unterschied zwischen ihnen ausser der Zahl.
  logbookTicketCategoryIds: (process.env.LOGBOOK_TICKET_CATEGORY_IDS
    || '1536410764858892319,1536410766624825459,1536410768793276466,1538562224778645504')
    .split(',').map((id) => id.trim()).filter(Boolean),

  // Von den Kategorien ist je eine pro Satz besonders: "Logbuch" / "Logbuch 2".
  // Dort landen die Tickets, die sich jemand vorgenommen hat.
  //
  //   erstelltes Logbuch    frisch aufgemacht, noch niemand dran
  //   Logbuch               uebernommen  <- nur diese zaehlt die Sammelauszahlung
  //   Geschlossene Logbuch  erledigt
  //
  // Und nur hier raeumt Ghostxx die Kanalnamen auf.
  logbookClaimedCategoryIds: (process.env.LOGBOOK_CLAIMED_CATEGORY_IDS
    || '1536410766624825459,1538562224778645504')
    .split(',').map((id) => id.trim()).filter(Boolean),

  // Wer gerufen wird, wenn eine Abrechnung im Ticket landet. Nicht der
  // Ticketbesitzer, sondern die drei, die auszahlen.
  payoutRoleId: process.env.PAYOUT_ROLE_ID || '1515238275902738443',

  // Das Dashboard laeuft ausschliesslich auf diesem Rechner (127.0.0.1).
  // Auf 0 gesetzt startet es gar nicht.
  dashboardPort: Number(process.env.DASHBOARD_PORT || 8787),

  // In diesen Channels laufen Anmeldungen und staatliche Meldungen. Aenderungen
  // per Chat werden hier vorher bestaetigt, weil ein Fehlgriff echte Listen trifft.
  confirmChannelIds: (process.env.CONFIRM_CHANNEL_IDS || '1503123644321366268,1478179319980363847')
    .split(',').map((id) => id.trim()).filter(Boolean),

  // Rollen, die Aenderungen per Chat ausloesen duerfen (zusaetzlich zu Owner,
  // Admin und den Editoren aus data/permissions.json).
  commandRoleIds: (process.env.COMMAND_ROLE_IDS || '1149789708965122169,1149789730129584129')
    .split(',').map((id) => id.trim()).filter(Boolean),

  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
  ollamaFallbackModel: process.env.OLLAMA_FALLBACK_MODEL || 'qwen3.5:2b',
  ollamaAutoSwitch: process.env.OLLAMA_AUTO_SWITCH !== 'false',
  // Ab wie viel freiem Grafikspeicher (MiB) das grosse Modell benutzt wird.
  ollamaVramThresholdMb: Number(process.env.OLLAMA_VRAM_THRESHOLD_MB || 7500),
  // Gilt auch fuers Bildlesen. Kevin will die 90 Sekunden ausdruecklich
  // behalten - ein Bild, das laenger braucht, stimmt meistens etwas anderes
  // nicht. Ein abgebrochener Versuch wird ohnehin bis zu dreimal wiederholt.
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 90000),
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
  ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX || 8192),

  // Bildpruefung getrennt vom Chat - der Schalter ist da, steht aber auf AUS.
  //
  // Die Idee war, die Bildpruefung auf den Prozessor zu legen: bei einer
  // Auszahlung wartet ja niemand, und die Grafikkarte bliebe fuers Spiel frei.
  //
  // Gemessen faellt sie durch: auf der Grafikkarte braucht ein Bild rund 11
  // Sekunden, auf dem Prozessor lief jeder einzelne Versuch in die
  // Zeitueberschreitung nach 90 Sekunden. Ein Bild zu zerlegen ist etwas
  // anderes als Text zu schreiben - dafuer reichen sechs Kerne nicht.
  //
  // Der Schalter bleibt fuer den Fall, dass mal ein kleineres Bildmodell dazu
  // kommt, bei dem sich das anders rechnet.
  // Eigenes Modell fuers Bildlesen - qwen3.5:9b ist ein Sprachmodell, das
  // Bilder nebenbei kann. Gemessen an 56 Nachweisen: 48 Prozent erkannt gegen
  // 72 Prozent beim VL-Modell. Dafuer braucht es laenger, weil es feiner
  // hinschaut - bei einer Auszahlung wartet aber niemand.
  //
  // Bleibt fuer die Uhrzeit-Erkennung (bild-uhrzeit.js) auf qwen3-vl:8b - das
  // wurde nie gegen glm-ocr gemessen, deshalb ruehrt der Wechsel unten daran
  // nicht.
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:8b',
  // Eventnamen aus dem Logbuch-Screenshot lesen.
  //
  // Seit 17.08. glm-ocr statt qwen3-vl:8b: an neun echten Nachweisen exakt
  // dieselben sechs gefunden, nur 3065ms statt 23700ms im Schnitt (achtmal
  // schneller) - qwen3-vl dachte vor der Antwort lange laut nach, glm-ocr
  // liest stumpf ab. Die Zuordnung zum Eventkatalog macht ohnehin der Code,
  // nicht das Modell (findEventsInImageText) - ein reines Lesemodell passt
  // damit besser als eins, das interpretieren soll.
  //
  // Die Wappen-Erkennung fuer SK WAEHREND des Events (nur zwei Familienwappen,
  // kein lesbarer Eventname) ist neu gebaut, nicht mehr vom Modell selbst
  // beurteilt ("WAPPEN: ja/nein" gab es bei glm-ocr nie, es liest nur ab).
  // Siehe erkenneWappen() in logbook-vision.js - gemessen an Kevins fuenf
  // echten SK-Wappenbildern vom 17.08.
  ollamaEventVisionModel: process.env.OLLAMA_EVENT_VISION_MODEL || 'glm-ocr',
  ollamaVisionOnCpu: process.env.OLLAMA_VISION_ON_CPU === 'true',
  // Nach der Auszahlung soll das Modell den Arbeitsspeicher wieder freigeben.
  ollamaVisionKeepAlive: process.env.OLLAMA_VISION_KEEP_ALIVE || '5m',
  // Paesse immer mit dem grossen Modell lesen. Es geht um Bewerbungen echter
  // Leute, da zaehlt Genauigkeit mehr als die halbe Minute Wartezeit.
  // Mit VISA_FORCE_BIG_MODEL=false wird stattdessen automatisch gewaehlt.
  visaForceBigModel: process.env.VISA_FORCE_BIG_MODEL !== 'false',
  dataDir: process.env.DATA_DIR || path.join(rootDir, 'data'),
};

function assertRuntimeConfig(options = {}) {
  const { requireClientId = true } = options;

  if (!config.token) {
    throw new Error('DISCORD_TOKEN fehlt. Lege ihn in .env oder env ab.');
  }

  if (requireClientId && (!config.clientId || !/^\d+$/.test(config.clientId))) {
    throw new Error('DISCORD_CLIENT_ID fehlt oder konnte nicht aus dem Token gelesen werden.');
  }
}

module.exports = {
  config,
  assertRuntimeConfig,
};
