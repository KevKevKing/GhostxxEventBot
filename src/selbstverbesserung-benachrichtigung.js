const fs = require('node:fs/promises');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { istNachtruhe } = require('./selbstverbesserung-limit');

// Persoenliche DM an Kevin statt Discord-Kanal - passt zu "wie ein Kollege,
// der sich meldet". Waehrend der bestehenden Nachtruhe (02-10 Uhr, siehe
// tagesrhythmus.js) wird nicht sofort zugestellt, sondern zurueckgehalten.
//
// Die Warteschlange liegt auf der Platte, nicht nur im Arbeitsspeicher: ein
// Absturz zwischen 2 und 10 Uhr haette sonst jede wartende DM fuer immer
// verloren - und der Gedaechtnis-Eintrag bleibt dabei 14 Tage lang auf
// 'offen' und blockt jede Neuerkennung desselben Problems. Kevin wuesste
// also nichts und wuerde auch nie wieder erinnert. Gleiches Muster wie in
// selbstverbesserung-limit.js: JSON, atomar geschrieben.

const datei = path.join(config.dataDir, 'selbstverbesserung-warteschlange.json');

let clientRef = null;
let warteschlange = [];
let geladen = false;

async function ladeWarteschlange() {
  if (geladen) return warteschlange;
  try {
    const roh = JSON.parse(await fs.readFile(datei, 'utf8'));
    warteschlange = Array.isArray(roh.eintraege) ? roh.eintraege : [];
  } catch {
    // Keine oder kaputte Datei - dann ist eben nichts vorgemerkt.
    warteschlange = [];
  }
  geladen = true;
  return warteschlange;
}

async function speichereWarteschlange() {
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    await writeFileAtomic(datei, JSON.stringify({ eintraege: warteschlange }, null, 2));
  } catch (error) {
    // Eine DM ist es nicht wert, die Kette abzubrechen - im Speicher steht
    // sie ja noch.
    console.error('Selbstverbesserungs-Warteschlange konnte nicht gespeichert werden:', error.message);
  }
}

function setBenachrichtigungClient(client) {
  clientRef = client;
}

// Der eine Fehlerfall, der nicht wie die anderen aussehen darf: die Session
// hat ausserhalb ihres Worktrees geschrieben (siehe pruefeWurzel in
// selbstverbesserung-session.js). Das trifft den laufenden Bot sofort.
const EINBRUCH = 'Session hat den echten Checkout veraendert!';

function baueEmbed({ problem, ergebnis }) {
  const einbruch = String(ergebnis.fehler || '').startsWith(EINBRUCH);

  const embed = new EmbedBuilder()
    .setColor(ergebnis.ok ? 0x57f287 : 0xed4245)
    .setTitle(einbruch
      ? '🚨 ACHTUNG: Selbstverbesserung hat den echten Checkout verändert'
      : (ergebnis.ok ? 'Ich hab einen Vorschlag' : 'Ich hab was untersucht, aber nichts brauchbares'))
    .setDescription(problem.titel)
    .setTimestamp(new Date());

  const felder = [];
  if (ergebnis.zusammenfassung) felder.push({ name: 'Zusammenfassung', value: ergebnis.zusammenfassung.slice(0, 1024) });
  if (ergebnis.ok) felder.push({ name: 'Branch', value: ergebnis.branch });
  if (ergebnis.fehler) felder.push({ name: 'Warum nichts kam', value: ergebnis.fehler.slice(0, 1024) });

  if (felder.length) embed.addFields(felder);
  return embed;
}

async function sendeJetzt(eintrag) {
  if (!clientRef) return false;
  const user = await clientRef.users.fetch(config.ownerId).catch(() => null);
  if (!user) return false;

  try {
    await user.send({ embeds: [baueEmbed(eintrag)] });
    return true;
  } catch (error) {
    console.error('Selbstverbesserungs-DM konnte nicht gesendet werden:', error.message);
    return false;
  }
}

async function benachrichtige(eintrag, { now = new Date() } = {}) {
  // Ein veraenderter echter Checkout wartet nicht bis 10 Uhr. Das ist der
  // einzige Fall, der die Nachtruhe durchbricht.
  if (String(eintrag?.ergebnis?.fehler || '').startsWith(EINBRUCH)) {
    return sendeJetzt(eintrag);
  }
  if (istNachtruhe(now)) {
    await ladeWarteschlange();
    warteschlange.push(eintrag);
    await speichereWarteschlange();
    return false;
  }
  return sendeJetzt(eintrag);
}

async function sendeAusstehende({ now = new Date() } = {}) {
  if (istNachtruhe(now)) return 0;
  await ladeWarteschlange();
  if (!warteschlange.length) return 0;

  let erfolgreich = 0;
  while (warteschlange.length) {
    const eintrag = warteschlange.shift();
    // Nach JEDER Entnahme schreiben, nicht erst am Ende: stuerzt der Bot
    // mitten in der Zustellung ab, sollen die schon verschickten nicht
    // nochmal rausgehen und die uebrigen nicht verloren sein.
    await speichereWarteschlange();
    const ok = await sendeJetzt(eintrag);
    if (ok) erfolgreich += 1;
  }
  return erfolgreich;
}

/** Nur fuer Tests: Zustand vergessen und beim naechsten Zugriff neu laden. */
function vergisWarteschlange() {
  warteschlange = [];
  geladen = false;
}

module.exports = {
  benachrichtige,
  ladeWarteschlange,
  sendeAusstehende,
  setBenachrichtigungClient,
  vergisWarteschlange,
};
