const { REST, Routes } = require('discord.js');
const { buildCommands } = require('./commands');
const { assertRuntimeConfig, config } = require('./config');

async function resolveClientId(rest, clientIdOverride) {
  if (clientIdOverride && /^\d+$/.test(clientIdOverride)) return clientIdOverride;
  if (config.clientId && /^\d+$/.test(config.clientId)) return config.clientId;

  const currentUser = await rest.get(Routes.user());
  return currentUser.id;
}

async function registerCommands(clientIdOverride = '') {
  assertRuntimeConfig({ requireClientId: false });

  const rest = new REST({ version: '10' }).setToken(config.token);
  const clientId = await resolveClientId(rest, clientIdOverride);
  const body = buildCommands().map((command) => command.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(clientId, config.guildId),
    { body },
  );

  return body.length;
}

module.exports = {
  registerCommands,
};
