const { check, finish, section } = require('./lib');
const { erkenneProgrammBefehl } = require('../programm-parser');

const LISTE = [
  { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
  { name: 'Minecraft', pfad: 'C:/Spiele/Minecraft.exe' },
];

section('erkennt einen klaren Startbefehl');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte valorant', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Valorant');
})();

section('Gross-/Kleinschreibung spielt keine Rolle');
(() => {
  const ergebnis = erkenneProgrammBefehl('STARTE VALORANT', LISTE);
  check('art ist start', ergebnis.art === 'start');
})();

section('andere Formulierung mit demselben Startwort und Namen');
(() => {
  const ergebnis = erkenneProgrammBefehl('mach mal valorant an bitte', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Valorant');
})();

section('anderes Startwort ("oeffne")');
(() => {
  const ergebnis = erkenneProgrammBefehl('öffne minecraft', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Minecraft');
})();

section('Startwort da, aber Name nicht auf der Liste -> unbekannt');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte firefox', LISTE);
  check('art ist unbekannt', ergebnis.art === 'unbekannt');
})();

section('kein Startwort -> kein_befehl (normaler Chat)');
(() => {
  const ergebnis = erkenneProgrammBefehl('wie geht es dir?', LISTE);
  check('art ist kein_befehl', ergebnis.art === 'kein_befehl');
})();

section('bekannter Sonderfall: Startwort zufaellig im Satz, kein echter Befehl -> unbekannt (siehe Spec)');
(() => {
  // Bewusst akzeptierter Sonderfall aus der Spec - dieser Test dokumentiert
  // das Verhalten, ist kein Bugreport.
  const ergebnis = erkenneProgrammBefehl('wie starte ich am besten in den tag?', LISTE);
  check('art ist unbekannt (dokumentierter Sonderfall)', ergebnis.art === 'unbekannt');
})();

section('leere Liste -> nie start, aber Startwort fuehrt zu unbekannt');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte valorant', []);
  check('art ist unbekannt', ergebnis.art === 'unbekannt');
})();

section('"mach" als Wortbestandteil (z.B. "gemacht") ist KEIN Startwort');
(() => {
  const ergebnis = erkenneProgrammBefehl('das habe ich schon gemacht', LISTE);
  check('art ist kein_befehl', ergebnis.art === 'kein_befehl');
})();

section('"mach" als eigenstaendiges Wort ist weiterhin ein Startwort');
(() => {
  const ergebnis = erkenneProgrammBefehl('mach mal valorant an', LISTE);
  check('art ist start', ergebnis.art === 'start');
})();

section('Startwort "start " (mit Leerzeichen) wird erkannt');
(() => {
  const ergebnis = erkenneProgrammBefehl('start valorant bitte', LISTE);
  check('art ist start', ergebnis.art === 'start');
})();

section('Beugungen von Startwoertern sind KEIN Startwort (Regression zu Finding 1 der Whole-Branch-Review)');
(() => {
  check('"startet" in normaler Frage', erkenneProgrammBefehl('Wann startet das Event heute?', LISTE).art === 'kein_befehl');
  check('"gestartet"', erkenneProgrammBefehl('Hast du das Spiel schon gestartet?', LISTE).art === 'kein_befehl');
  check('"geöffnet"', erkenneProgrammBefehl('Hat der Laden noch geöffnet?', LISTE).art === 'kein_befehl');
  check('"starten" als Verb', erkenneProgrammBefehl('Wann starten wir morgen?', LISTE).art === 'kein_befehl');
})();

section('Eigenstaendige Startwoerter funktionieren weiterhin');
(() => {
  check('"starte"', erkenneProgrammBefehl('starte valorant', LISTE).art === 'start');
  check('"start" mit Leerzeichen', erkenneProgrammBefehl('start valorant bitte', LISTE).art === 'start');
  check('"öffne"', erkenneProgrammBefehl('öffne minecraft', LISTE).art === 'start');
  check('"mach ... an"', erkenneProgrammBefehl('mach mal valorant an', LISTE).art === 'start');
})();

finish();
