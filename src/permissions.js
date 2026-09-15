const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');

const permissionsFile = path.join(config.dataDir, 'permissions.json');

let writeQueue = Promise.resolve();

function normalizeUserId(userId) {
  const match = String(userId || '').match(/\d{17,25}/);
  return match ? match[0] : '';
}

function uniqueIds(ids) {
  return [...new Set((ids || []).map(normalizeUserId).filter(Boolean))];
}

async function ensureStore() {
  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    await fs.access(permissionsFile);
  } catch {
    await fs.writeFile(permissionsFile, JSON.stringify({ admins: [], editors: [] }, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(permissionsFile, 'utf8');

  try {
    const data = JSON.parse(raw);
    return {
      // Aeltere Dateien kennen nur "editors" - dann bleibt die Liste eben leer,
      // statt dass das Einlesen scheitert.
      admins: uniqueIds(data.admins),
      editors: uniqueIds(data.editors),
    };
  } catch {
    return { admins: [], editors: [] };
  }
}

async function writeStore(data) {
  await ensureStore();
  await writeFileAtomic(
    permissionsFile,
    JSON.stringify({ admins: uniqueIds(data.admins), editors: uniqueIds(data.editors) }, null, 2),
  );
}

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

// Vier Stufen, von oben nach unten:
//
//   1. Owner + Co-Owner  aus der .env, nicht aenderbar. Duerfen alles,
//                        inklusive /purge und /admin.
//   2. Admin             per /admin eingetragen. Duerfen alles ausser /purge
//                        und /admin selbst - Loeschen und die Vergabe von
//                        Admin-Rechten bleiben bewusst ganz oben.
//   3. Editor            per /editor eingetragen. Normale Commands, dazu
//                        /say und /embed.
//   4. Befehlsrollen     normale Commands rund um Anmeldungen.

function isOwner(userId) {
  return String(userId) === config.ownerId;
}

function isAdmin(userId) {
  return String(userId) === config.adminId;
}

function isOwnerOrAdmin(userId) {
  return isOwner(userId) || isAdmin(userId);
}

async function listAdmins() {
  const data = await readStore();
  return data.admins;
}

/** Eingetragener Admin - die feste Owner-Ebene zaehlt hier absichtlich mit. */
async function hasAdminRights(userId) {
  if (isOwnerOrAdmin(userId)) return true;
  const admins = await listAdmins();
  return admins.includes(normalizeUserId(userId));
}

async function addAdmin(userId) {
  const adminId = normalizeUserId(userId);
  if (!adminId) return { ok: false, changed: false, admins: await listAdmins() };

  return queueWrite(async () => {
    const data = await readStore();
    const changed = !data.admins.includes(adminId);
    const admins = changed ? [...data.admins, adminId] : data.admins;

    await writeStore({ ...data, admins });
    return { ok: true, changed, admins };
  });
}

async function removeAdmin(userId) {
  const adminId = normalizeUserId(userId);
  if (!adminId) return { ok: false, changed: false, admins: await listAdmins() };

  return queueWrite(async () => {
    const data = await readStore();
    const admins = data.admins.filter((storedId) => storedId !== adminId);
    const changed = admins.length !== data.admins.length;

    await writeStore({ ...data, admins });
    return { ok: true, changed, admins };
  });
}

async function listEditors() {
  const data = await readStore();
  return data.editors;
}

/** Editor-Ebene - wer weiter oben steht, darf das ebenfalls. */
async function isEditor(userId) {
  if (await hasAdminRights(userId)) return true;
  const editors = await listEditors();
  return editors.includes(String(userId));
}

async function addEditor(userId) {
  const editorId = normalizeUserId(userId);
  if (!editorId) return { ok: false, changed: false, editors: await listEditors() };

  return queueWrite(async () => {
    const data = await readStore();
    const changed = !data.editors.includes(editorId);
    const editors = changed ? [...data.editors, editorId] : data.editors;

    await writeStore({ ...data, editors });
    return { ok: true, changed, editors };
  });
}

async function removeEditor(userId) {
  const editorId = normalizeUserId(userId);
  if (!editorId) return { ok: false, changed: false, editors: await listEditors() };

  return queueWrite(async () => {
    const data = await readStore();
    const editors = data.editors.filter((storedId) => storedId !== editorId);
    const changed = editors.length !== data.editors.length;

    await writeStore({ ...data, editors });
    return { ok: true, changed, editors };
  });
}

function getMemberRoleIds(member) {
  const roles = member?.roles;
  if (roles?.cache) return [...roles.cache.keys()];
  if (Array.isArray(roles)) return roles;
  return [];
}

/**
 * Darf dieses Mitglied Anmeldungen verwalten?
 *
 * Die eine Wahrheit fuer beide Wege: Slash-Command und Chat fragen hier.
 * Vorher gab es zwei getrennte Regeln, und dieselbe Person durfte im Chat
 * tauschen, kam aber an /eintragen nicht ran.
 *
 * Erlaubt: beide Owner, eingetragene Admins und Editoren, die Befehlsrollen.
 */
async function canManageSignups(member) {
  const userId = member?.id || member?.user?.id;
  if (!userId) return false;

  // isEditor deckt Owner und Admins mit ab.
  if (await isEditor(userId)) return true;

  const roleIds = getMemberRoleIds(member);
  return config.commandRoleIds.some((roleId) => roleIds.includes(roleId));
}

// Alter Name, damit der Chat-Router unveraendert bleibt.
async function canRunChatCommands(member) {
  return canManageSignups(member);
}

module.exports = {
  addAdmin,
  addEditor,
  canManageSignups,
  canRunChatCommands,
  getMemberRoleIds,
  hasAdminRights,
  isAdmin,
  isEditor,
  isOwner,
  isOwnerOrAdmin,
  listAdmins,
  listEditors,
  removeAdmin,
  removeEditor,
};
