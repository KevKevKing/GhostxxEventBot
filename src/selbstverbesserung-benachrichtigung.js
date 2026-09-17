const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');
const { istNachtruhe } = require('./selbstverbesserung-limit');

// Persoenliche DM an Kevin statt Discord-Kanal - passt zu "wie ein Kollege,
// der sich meldet". Waehrend der bestehenden Nachtruhe (02-10 Uhr, siehe
// tagesrhythmus.js) wird nicht sofort zugestellt, sondern zurueckgehalten.

let clientRef = null;
const warteschlange = [];

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
    warteschlange.push(eintrag);
    return false;
  }
  return sendeJetzt(eintrag);
}

async function sendeAusstehende({ now = new Date() } = {}) {
  if (istNachtruhe(now) || !warteschlange.length) return 0;

  let erfolgreich = 0;
  while (warteschlange.length) {
    const eintrag = warteschlange.shift();
    const ok = await sendeJetzt(eintrag);
    if (ok) erfolgreich += 1;
  }
  return erfolgreich;
}

module.exports = {
  benachrichtige,
  sendeAusstehende,
  setBenachrichtigungClient,
};
