const { registerCommands } = require('./register-commands');

registerCommands()
  .then((count) => {
    console.log(`${count} Slash-Commands registriert.`);
  })
  .catch((error) => {
    console.error('Slash-Command-Registrierung fehlgeschlagen:');
    console.error(error.message);
    process.exit(1);
  });

