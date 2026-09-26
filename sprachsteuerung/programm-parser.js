// Erkennt einen Programm-Startbefehl direkt aus dem erkannten Text - kein
// Sprachmodell noetig, ein Programmname ist eindeutig ablesbar (siehe
// CLAUDE.md: "erst ablesen, dann raten"). Liefert eines von drei
// Ergebnissen: 'start' (Startwort + bekannter Name), 'unbekannt' (Startwort
// da, aber kein bekannter Name) oder 'kein_befehl' (kein Startwort - Text
// soll normal an Ollama gehen).
//
// Bekannter, bewusst akzeptierter Sonderfall (siehe Spec): ein Satz, der
// zufaellig ein Startwort enthaelt, aber keinen Programmbefehl meint (z.B.
// "wie starte ich am besten in den tag?"), wird faelschlich als 'unbekannt'
// gewertet statt normal beantwortet. Selten genug, um hinzunehmen.

// 'starte', 'start ', 'öffne', 'öffnen' werden als einfache Substring-Pruefung
// gesucht - sie treten nicht als Ableitungsteile auf. 'mach' dagegen kommt haeufig
// als Teil von Ableitungen vor (z.B. "gemacht", "macht"), daher mit Wortgrenzen.
const STARTWOERTER = ['starte', 'start ', 'öffne', 'öffnen'];
const MACH_WORT = /\bmach\b/;

function erkenneProgrammBefehl(text, liste) {
  const klein = text.toLowerCase();
  const hatStartwort = STARTWOERTER.some((wort) => klein.includes(wort)) || MACH_WORT.test(klein);

  if (!hatStartwort) return { art: 'kein_befehl' };

  const treffer = liste.find((eintrag) => klein.includes(eintrag.name.toLowerCase()));
  if (treffer) return { art: 'start', eintrag: treffer };

  return { art: 'unbekannt' };
}

module.exports = { erkenneProgrammBefehl };
