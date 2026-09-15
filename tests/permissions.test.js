const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const { buildCommands } = require('../src/commands');
const { assertCommandPermission } = require('../src/handlers');
const { canManageSignups } = require('../src/permissions');

const OWNER = config.ownerId;
const CO_OWNER = config.adminId;
const FREMD = '999000000000000003';
const MIT_ROLLE_1 = '999000000000000001';
const MIT_ROLLE_2 = '999000000000000002';
const ADMIN = '999000000000000004';
const EDITOR = '999000000000000005';

function member(id, roleIds = []) {
  return { id, roles: { cache: new Map(roleIds.map((r) => [r, {}])) } };
}

async function darf(command, id, roleIds = []) {
  return assertCommandPermission({
    commandName: command,
    user: { id },
    member: member(id, roleIds),
    reply: async () => {},
  });
}

(async () => {
  section('Beide Owner duerfen alles');
  for (const name of buildCommands().map((c) => c.toJSON().name)) {
    check(`/${name.padEnd(14)} Owner`, await darf(name, OWNER));
    check(`/${name.padEnd(14)} Co-Owner`, await darf(name, CO_OWNER));
  }

  section('purge bleibt bei den Ownern');
  // Loescht bis zu 100 Nachrichten und ist nicht rueckgaengig zu machen.
  check('Editor darf nicht', !(await darf('purge', FREMD)));
  check('Turf-Leader darf nicht', !(await darf('purge', MIT_ROLLE_1, [config.turfLeaderRoleId])));
  check('zweite Rolle darf nicht', !(await darf('purge', MIT_ROLLE_2, ['1149789730129584129'])));

  section('Verlosung und Editorrechte nicht fuer Rollen');
  check('verlosung', !(await darf('verlosung', MIT_ROLLE_1, [config.turfLeaderRoleId])));
  check('editor', !(await darf('editor', MIT_ROLLE_1, [config.turfLeaderRoleId])));

  section('Eingetragener Admin');
  // /admin vergibt Rechte, /purge loescht unwiderruflich - beides bleibt ganz
  // oben, auch fuer Admins.
  const { addAdmin, removeAdmin } = require('../src/permissions');
  await addAdmin(ADMIN);
  for (const name of ['verlosung', 'editor', 'auszahlen', 'sammelauszahlung', 'say', 'embed', 'eintragen', 'event']) {
    check(`/${name.padEnd(16)} darf`, await darf(name, ADMIN));
  }
  check('/purge            darf NICHT', !(await darf('purge', ADMIN)));
  check('/admin            darf NICHT', !(await darf('admin', ADMIN)));
  check('zaehlt im Chat', await canManageSignups(member(ADMIN)));

  section('Admin entfernen wirkt sofort');
  await removeAdmin(ADMIN);
  check('/verlosung gesperrt', !(await darf('verlosung', ADMIN)));
  check('/eintragen gesperrt', !(await darf('eintragen', ADMIN)));

  section('Admin- und Editorliste stoeren sich nicht');
  // Beide liegen in derselben Datei - ein Schreibvorgang darf die andere Liste
  // nicht ueberbuegeln.
  const { addEditor, listAdmins, listEditors } = require('../src/permissions');
  await addAdmin(ADMIN);
  await addEditor(EDITOR);
  check('Admin noch da', (await listAdmins()).includes(ADMIN));
  check('Editor noch da', (await listEditors()).includes(EDITOR));
  await removeAdmin(ADMIN);
  check('Editor ueberlebt Admin-Entzug', (await listEditors()).includes(EDITOR));
  check('Admin ist weg', !(await listAdmins()).includes(ADMIN));

  section('say und embed nicht fuer Rollen');
  check('Turf-Leader darf nicht', !(await darf('say', MIT_ROLLE_1, [config.turfLeaderRoleId])));
  check('zweite Rolle darf nicht', !(await darf('embed', MIT_ROLLE_2, ['1149789730129584129'])));

  section('Anmeldungen: Rollen duerfen');
  for (const roleId of config.commandRoleIds) {
    check(`/eintragen mit Rolle ${roleId.slice(-4)}`, await darf('eintragen', MIT_ROLLE_1, [roleId]));
    check(`/austragen mit Rolle ${roleId.slice(-4)}`, await darf('austragen', MIT_ROLLE_1, [roleId]));
    check(`/event mit Rolle ${roleId.slice(-4)}`, await darf('event', MIT_ROLLE_1, [roleId]));
  }

  section('Ohne Rechte geht nichts');
  for (const name of ['event', 'eintragen', 'austragen', 'purge', 'say', 'verlosung']) {
    check(`/${name}`, !(await darf(name, FREMD)));
  }

  section('Chat und Slash-Commands sind sich einig');
  // Vorher gab es zwei getrennte Regeln: dieselbe Person durfte im Chat
  // tauschen, kam aber an /eintragen nicht ran.
  for (const roleId of config.commandRoleIds) {
    const imChat = await canManageSignups(member(MIT_ROLLE_1, [roleId]));
    const perSlash = await darf('eintragen', MIT_ROLLE_1, [roleId]);
    check(`Rolle ${roleId.slice(-4)}: gleich`, imChat === perSlash, `Chat ${imChat}, Slash ${perSlash}`);
  }
  const fremdChat = await canManageSignups(member(FREMD));
  const fremdSlash = await darf('eintragen', FREMD);
  check('Fremder: gleich', fremdChat === fremdSlash, `Chat ${fremdChat}, Slash ${fremdSlash}`);

  temp.cleanup();
  finish();
})();
