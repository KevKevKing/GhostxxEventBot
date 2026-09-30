const { check, finish, section } = require('./lib');
const { AuditLogEvent } = require('discord.js');
const { config } = require('../src/config');
const { handleAuditEntry } = require('../src/audit-log');
const { letzteAktivitaet } = require('../src/logger');

// Kein echter Discord-Client noetig: logEvent() merkt sich die Felder fuers
// Dashboard (letzteAktivitaet), bevor es versucht, sie zu senden - ohne
// gesetzten Client scheitert nur das Senden selbst, lautlos abgefangen.

function letzterEintrag() {
  return letzteAktivitaet()[0];
}

(async () => {
  section('Einzeln geloeschte Nachricht zeigt jetzt auch den Kanal');
  handleAuditEntry({
    id: '1', action: AuditLogEvent.MessageDelete,
    executor: { id: '1', tag: 'Ghost#0000' },
    target: { id: '2', tag: 'Nutzer#0000' },
    targetId: '2',
    extra: { count: 1, channel: { id: '999' } },
    changes: [],
  }, { id: config.guildId });

  check('Eintrag geloggt', letzterEintrag()?.titel === 'Nachricht gelöscht');
  check('Kanal-Feld drin', letzterEintrag()?.text.includes('Kanal: <#999>'));
  check('Anzahl-Feld weiterhin drin', letzterEintrag()?.text.includes('Anzahl: 1'));

  section('Ohne Kanal im extra-Feld bleibt es wie bisher');
  handleAuditEntry({
    id: '2', action: AuditLogEvent.MessageDelete,
    executor: { id: '1', tag: 'Ghost#0000' },
    target: { id: '3', tag: 'Anderer#0000' },
    targetId: '3',
    extra: { count: 1 },
    changes: [],
  }, { id: config.guildId });

  check('kein Kanal-Feld ohne extra.channel', !letzterEintrag()?.text.includes('Kanal:'));

  section('MessageBulkDelete unveraendert (Kanal steht dort schon im target)');
  handleAuditEntry({
    id: '3', action: AuditLogEvent.MessageBulkDelete,
    executor: { id: '1', tag: 'Ghost#0000' },
    target: { id: '999', name: 'allgemein' },
    targetId: '999',
    extra: { count: 5 },
    changes: [],
  }, { id: config.guildId });

  check('zeigt den Kanal ueber Betroffen', letzterEintrag()?.text.includes('Betroffen: <#999> (allgemein)'));
  check('kein zusaetzliches Kanal-Feld noetig', !letzterEintrag()?.text.includes('Kanal: <#'));

  finish();
})();
