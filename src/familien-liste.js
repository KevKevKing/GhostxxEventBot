const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logBotEvent } = require('./logger');

// Die Familien-Mitgliederliste: wer traegt gerade eine der neun Rangrollen.
//
// Bis 15.08.2026 kam die Wahrheit aus einem Video, das jemand von Hand
// durchs Spiel gescrollt hat - einmalig, mit allen Problemen, die das
// mitbringt (Grafikkarten-Zeitueberschreitungen, Tippfehler beim Ablesen).
// Seit dem grossen Aufraeumen ist Discord selbst die Quelle: jeder mit einer
// Rangrolle IST Mitglied, jeder ohne ist es nicht. Kein Video mehr noetig.
//
// Zwei Takte, aus gutem Grund unterschiedlich schnell:
//   - Die Liste selbst: jede Minute. Sie ist das Aushaengeschild, und wer
//     gerade rausgeflogen ist, soll das schnell sehen.
//   - Die Abweichungen (doppelte Rangrolle, Name ohne lesbare Spielernummer):
//     stuendlich. Das sind Sonderfaelle, die sich selten aendern - jede
//     Minute nachsehen waere reine Verschwendung.
//
// Bewusst NIE neue Nachrichten fuer die Liste selbst: die vorhandenen werden
// bearbeitet. Sonst waechst der Kanal jede Minute um eine Nachricht und ist
// nach einem Tag unlesbar. Nur der Abgang bekommt eine neue, sichtbare
// Nachricht - das ist Absicht, kein Vergessen.

const RANG_LABEL = {
  9: '9 Legende', 8: '8 Turf Leader', 7: '7 BIG HOMIE', 6: '6 Turfer', 5: '5 Elite Member',
  4: '4 Member', 3: '3 Probe', 2: '2 Sanktion', 1: '1 HOTEL',
};
const RAENGE_ABSTEIGEND = [9, 8, 7, 6, 5, 4, 3, 2, 1];

const TAKT_LISTE_MS = 60 * 1000;
const TAKT_ABWEICHUNG_MS = 60 * 60 * 1000;
const MAX_NACHRICHT = 1900;

const datei = path.join(config.dataDir, 'familien-liste.json');

function leererStand() {
  return { mitglieder: {}, listeNachrichtenIds: [], abweichungNachrichtenIds: [] };
}

async function standLaden() {
  try {
    const roh = await fs.readFile(datei, 'utf8');
    return { ...leererStand(), ...JSON.parse(roh) };
  } catch {
    return leererStand();
  }
}

async function standSichern(stand) {
  await writeFileAtomic(datei, JSON.stringify(stand, null, 2));
}

// "Name | 266391", "Name I 266391", "Name 266391", "Name / 266391" - alles,
// was in echten Discord-Namen vorkommt.
//
// Die Zahl muss durch Leerzeichen oder ein Trennzeichen vom Rest abgesetzt
// sein - sonst waere "Casablanca420" eine Spielernummer "420". Bei "Paul
// Ultra 155716" steht davor ein Leerzeichen, bei "Casablanca420" klebt die
// Zahl am Wort. Genau dieser Unterschied trennt die echten Faelle vom
// Zufallstreffer.
function spielerNummer(name) {
  const treffer = /(?:^|[\s|/I])(\d{2,7})\s*$/.exec(String(name || '').trim());
  return treffer ? treffer[1] : '';
}

/**
 * Wer traegt gerade eine Rangrolle - direkt aus Discord.
 *
 * Der Bot laedt beim Start einmal alle Mitglieder und haelt sie ueber die
 * Ereignisse aktuell. Deshalb reicht hier der Zwischenspeicher, und ein
 * Netzwerkhaenger legt nichts lahm.
 *
 * Vorher stand hier ein `guild.members.fetch()` bei JEDEM Minutentakt. Am
 * 16.08. lief das waehrend eines kurzen Netzwerkausfalls in die
 * Zeitueberschreitung ("Members didn't arrive in time") - der Anfang der
 * Kette, die den Bot mitten in Kevins Sammelauszahlung abstuerzen liess.
 */
async function leseMitglieder(guild) {
  const rollen = guild.roles.cache.filter((r) => /^[1-9]\s/.test(r.name));
  const rangNachRolleId = new Map([...rollen.values()].map((r) => [r.id, Number(r.name.match(/^(\d)/)[1])]));

  // Nur nachladen, wenn der Zwischenspeicher wirklich leer ist - und auch
  // dann darf ein Fehlschlag nur diesen einen Durchgang kosten.
  const alle = guild.members.cache?.size
    ? guild.members.cache
    : await guild.members.fetch().catch(() => null);
  if (!alle) return null;

  const mitglieder = {};

  for (const [userId, member] of alle) {
    const raenge = [...member.roles.cache.keys()]
      .map((rid) => rangNachRolleId.get(rid))
      .filter(Boolean);
    if (!raenge.length) continue;

    const anzeigename = member.nickname || member.user.globalName || member.user.username;
    mitglieder[userId] = { anzeigename, raenge, nummer: spielerNummer(anzeigename) };
  }

  return mitglieder;
}

// Ein Discord-Name in diesem Server enthielt einen rassistischen Begriff -
// der wird nicht mitgepostet, auch nicht automatisch. Wer selbst nachsehen
// will, wer hinter der ID steckt, kann das ueber Discord tun.
const ANSTOESSIG = /nigg/i;
function anzeigeSicher(name) {
  return ANSTOESSIG.test(name) ? '(Name wird hier nicht angezeigt)' : name;
}

function teile(zeilen) {
  const nachrichten = [];
  let aktuell = '';
  for (const zeile of zeilen) {
    const dazu = (aktuell ? `${aktuell}\n` : '') + zeile;
    if (dazu.length > MAX_NACHRICHT) {
      if (aktuell) nachrichten.push(aktuell);
      aktuell = zeile;
    } else {
      aktuell = dazu;
    }
  }
  if (aktuell) nachrichten.push(aktuell);
  return nachrichten;
}

function baueListenText(mitglieder) {
  const zeilen = [];
  zeilen.push('📋 **Familien-Mitgliederliste**');
  zeilen.push(`Direkt aus Discord, automatisch aktuell. Stand ${new Date().toLocaleString('de-DE')}.`);
  zeilen.push('');

  for (const rang of RAENGE_ABSTEIGEND) {
    const leute = Object.entries(mitglieder)
      .filter(([, m]) => m.raenge.includes(rang))
      .sort((a, b) => a[1].anzeigename.localeCompare(b[1].anzeigename, 'de'));

    zeilen.push(`**${RANG_LABEL[rang]} (${leute.length})**`);
    if (!leute.length) zeilen.push('_niemand_');
    else for (const [userId, m] of leute) zeilen.push(`• <@${userId}> (${anzeigeSicher(m.anzeigename)})`);
    zeilen.push('');
  }

  return zeilen;
}

function baueAbweichungText(mitglieder) {
  const mehrereRaenge = Object.entries(mitglieder).filter(([, m]) => m.raenge.length > 1);
  const ohneNummer = Object.entries(mitglieder).filter(([, m]) => !m.nummer);

  const zeilen = [];
  zeilen.push('⚠️ **Familien-Abweichungen**');
  zeilen.push(`Automatisch aus Discord, stuendlich geprueft. Stand ${new Date().toLocaleString('de-DE')}.`);
  zeilen.push('');

  zeilen.push(`🔶 **Mehrere Rangrollen gleichzeitig (${mehrereRaenge.length})**`);
  if (!mehrereRaenge.length) zeilen.push('_niemand_');
  else for (const [userId, m] of mehrereRaenge) {
    zeilen.push(`• <@${userId}> — ${m.raenge.map((r) => RANG_LABEL[r]).join(', ')}`);
  }
  zeilen.push('');

  zeilen.push(`🔶 **Name ohne lesbare Spielernummer (${ohneNummer.length})**`);
  zeilen.push('_Hat eine Rangrolle, aber am Namen laesst sich die Spielernummer nicht ablesen._');
  if (!ohneNummer.length) zeilen.push('_niemand_');
  else for (const [userId, m] of ohneNummer) {
    zeilen.push(`• <@${userId}> — ${m.raenge.map((r) => RANG_LABEL[r]).join(', ')}`);
  }

  return zeilen;
}

/**
 * Die Nachrichten eines Bereichs auf den gewuenschten Text bringen.
 *
 * Bearbeitet vorhandene, legt neue an wenn der Text gewachsen ist, loescht
 * ueberzaehlige wenn er geschrumpft ist. Nur wer sich wirklich geaendert hat,
 * wird angefasst - Discord bearbeiten kostet auch ein Ratenlimit.
 */
async function gleiche(kanal, nachrichtenIds, gewuenschteTexte) {
  const neueIds = [...nachrichtenIds];
  const mentionsAlle = { parse: [] };

  for (let i = 0; i < gewuenschteTexte.length; i += 1) {
    const text = gewuenschteTexte[i];
    const ids = [...text.matchAll(/<@(\d+)>/g)].map((m) => m[1]);
    const optionen = { content: text, allowed_mentions: { ...mentionsAlle, users: ids } };

    if (i < neueIds.length) {
      const vorhandene = await kanal.messages.fetch(neueIds[i]).catch(() => null);
      if (vorhandene) {
        if (vorhandene.content !== text) await vorhandene.edit(optionen);
        continue;
      }
    }

    const neu = await kanal.send(optionen);
    neueIds[i] = neu.id;
  }

  // Text ist geschrumpft - ueberzaehlige alte Nachrichten weg.
  while (neueIds.length > gewuenschteTexte.length) {
    const zuLoeschen = neueIds.pop();
    await kanal.messages.delete(zuLoeschen).catch(() => null);
  }

  return neueIds;
}

/**
 * Wer eine Rangrolle hatte und jetzt keine mehr (oder den Server verlassen
 * hat), bekommt eine eigene, gut sichtbare Nachricht - eine Bearbeitung waere
 * lautlos, und genau das soll es hier nicht sein.
 */
async function meldeAbgaenge(kanal, vorher, nachher) {
  for (const [userId, altesMitglied] of Object.entries(vorher)) {
    if (nachher[userId]) continue; // hat noch eine Rangrolle - kein Abgang

    await kanal.send({
      content: `🔴 **HAT VERLASSEN** — <@${userId}> (war in Discord: „${anzeigeSicher(altesMitglied.anzeigename)}")\n`
        + `Rang war: ${altesMitglied.raenge.map((r) => RANG_LABEL[r]).join(', ')} — bitte pruefen, ob ingame noch dabei.`,
      allowed_mentions: { parse: [], users: [userId] },
    }).catch((error) => {
      console.warn('Abgangs-Meldung fehlgeschlagen:', error.message);
    });
  }
}

// Ab wie viel Schwund ein Durchgang misstrauisch macht statt ihm zu glauben.
//
// Gemessen am 23.08.: leseMitglieder() lieferte ploetzlich nur noch eine
// Handvoll Namen statt 269 - kein Fehler, kein null, also griff die
// bestehende Sicherung ("konnte nicht gelesen werden") nicht. Das Ergebnis
// war trotzdem falsch, nur eben still falsch: fast der ganze Server wurde
// als "hat verlassen" gemeldet, darunter Johannes selbst. Vermutlich ein
// veralteter/unvollstaendiger Discord-Zwischenspeicher, nicht 260 echte
// Abgaenge auf einen Schlag - sowas passiert im echten Betrieb nicht.
const MAX_SCHWUND_ANTEIL = 0.3;
// Unter dieser Anzahl greift die Schwund-Pruefung nicht - bei einer
// Kleinfamilie waere ein Drittel schnell mal zwei, drei echte Abgaenge.
const MIN_ANZAHL_FUER_SCHWUNDPRUEFUNG = 20;

/**
 * Ist der Sprung von "vorher" auf "jetzt" ein verdaechtiger Schwund?
 *
 * Gemessen am 23.08.: leseMitglieder() lieferte ploetzlich nur noch eine
 * Handvoll Namen statt 269 - kein Fehler, kein null, also griff die
 * bestehende Sicherung ("konnte nicht gelesen werden") nicht. Das Ergebnis
 * war trotzdem falsch, nur eben still falsch: fast der ganze Server wurde
 * als "hat verlassen" gemeldet, darunter Johannes selbst. Vermutlich ein
 * veralteter/unvollstaendiger Discord-Zwischenspeicher, nicht 260 echte
 * Abgaenge auf einen Schlag - sowas passiert im echten Betrieb nicht.
 */
function istVerdaechtigerSchwund(vorherAnzahl, jetztAnzahl) {
  return vorherAnzahl >= MIN_ANZAHL_FUER_SCHWUNDPRUEFUNG
    && jetztAnzahl < vorherAnzahl * (1 - MAX_SCHWUND_ANTEIL);
}

async function aktualisiereListe(guild) {
  const stand = await standLaden();
  const mitglieder = await leseMitglieder(guild);

  // Konnte gerade nicht gelesen werden: diesen Durchgang auslassen, nicht
  // die Liste leeren. Sonst wuerde ein Netzwerkhaenger als "alle haben
  // verlassen" gemeldet - 200 Abgangsmeldungen auf einen Schlag.
  if (!mitglieder) return false;

  // Zweite Sicherung, diesmal gegen eine verdaechtig KLEINE statt einer
  // FEHLENDEN Liste. Lieber diesen einen Durchgang auslassen als 260
  // falsche Meldungen posten.
  const vorherAnzahl = Object.keys(stand.mitglieder).length;
  const jetztAnzahl = Object.keys(mitglieder).length;
  if (istVerdaechtigerSchwund(vorherAnzahl, jetztAnzahl)) {
    console.warn(
      `Familien-Liste: verdaechtiger Schwund (${vorherAnzahl} -> ${jetztAnzahl}) - `
      + 'Durchgang uebersprungen statt Massenabgang zu melden.',
    );
    logBotEvent({
      title: 'Familien-Liste: verdaechtiger Schwund uebersprungen',
      color: 'fehler',
      fields: [
        { name: 'Vorher', value: String(vorherAnzahl), inline: true },
        { name: 'Jetzt gelesen', value: String(jetztAnzahl), inline: true },
      ],
    });
    return false;
  }

  const geaendert = JSON.stringify(mitglieder) !== JSON.stringify(stand.mitglieder);
  if (!geaendert) return false;

  const kanal = await guild.channels.fetch(config.familienListeChannelId).catch(() => null);
  if (!kanal) return false;

  await meldeAbgaenge(kanal, stand.mitglieder, mitglieder);

  const texte = teile(baueListenText(mitglieder));
  stand.listeNachrichtenIds = await gleiche(kanal, stand.listeNachrichtenIds, texte);
  stand.mitglieder = mitglieder;
  await standSichern(stand);

  return true;
}

async function aktualisiereAbweichungen(guild) {
  const stand = await standLaden();
  const mitglieder = await leseMitglieder(guild);
  if (!mitglieder) return false;

  const kanal = await guild.channels.fetch(config.familienAbweichungChannelId).catch(() => null);
  if (!kanal) return false;

  const texte = teile(baueAbweichungText(mitglieder));
  stand.abweichungNachrichtenIds = await gleiche(kanal, stand.abweichungNachrichtenIds, texte);
  await standSichern(stand);

  return true;
}

function registerFamilienListe(client) {
  // Bremse gegen sich selbst: haengt ein Durchlauf laenger als eine Minute
  // (z.B. bei einem Netzwerkausfall in guild.channels.fetch()/kanal.send()),
  // darf der naechste Takt NICHT parallel lostraben. Sonst lesen mehrere
  // Durchlaeufe gleichzeitig denselben alten Stand von der Platte, sehen alle
  // dieselben Abgaenge und melden sie alle gleichzeitig - genau das ist am
  // 19.08. passiert: ein DNS-Ausfall liess mehrere Takte aufstauen, und als
  // die Verbindung zurueckkam, sind alle auf einmal losgelaufen und haben
  // "HAT VERLASSEN" fuer dieselben Leute dutzendfach innerhalb von Sekunden
  // gepostet. Derselbe Fehlertyp wie vorher bei bild-vorablesen.js.
  let laeuft = false;
  const takt1 = setInterval(async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      const guild = client.guilds.cache.get(config.guildId);
      if (guild) await aktualisiereListe(guild);
    } catch (error) {
      // KEIN .catch() an logBotEvent - die Funktion gibt nichts zurueck.
      //
      // Genau daran ist der Bot am 16.08. um 23:59 gestorben: ein kurzer
      // Netzwerkhaenger liess members.fetch() in die Zeitueberschreitung
      // laufen, der catch-Block hier rief logBotEvent(...).catch() auf, und
      // .catch auf undefined ist ein TypeError - mitten im Timer, also
      // unfangbar. Der Watchdog startete neu und riss Kevins laufende
      // Sammelauszahlung bei 34 von 66 Tickets mit.
      //
      // Ein Fehlerpfad darf nie selbst der Fehler sein.
      console.warn('Familien-Liste:', error.message);
      logBotEvent({ title: 'Familien-Liste fehlgeschlagen', description: error.message, color: 'fehler' });
    } finally {
      laeuft = false;
    }
  }, TAKT_LISTE_MS);
  takt1.unref?.();

  const takt2 = setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(config.guildId);
      if (guild) await aktualisiereAbweichungen(guild);
    } catch (error) {
      console.warn('Familien-Abweichungen:', error.message);
    }
  }, TAKT_ABWEICHUNG_MS);
  takt2.unref?.();

  console.log('Familien-Liste laeuft (Liste jede Minute, Abweichungen stuendlich).');
}

module.exports = {
  RANG_LABEL,
  aktualisiereAbweichungen,
  aktualisiereListe,
  baueAbweichungText,
  baueListenText,
  istVerdaechtigerSchwund,
  leseMitglieder,
  meldeAbgaenge,
  registerFamilienListe,
  spielerNummer,
  teile,
};
