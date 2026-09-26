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

// Alle Startwoerter werden per Wortgrenzen-Pruefung gesucht, nicht per
// Substring: 'starte'/'start'/'öffne'/'öffnen'/'mach' kommen haeufig als Teil
// laengerer Woerter oder Beugungen vor ("startet", "gestartet", "geöffnet",
// "starten", "gemacht") - eine reine Substring-Suche wuerde diese faelschlich
// als Programmbefehl werten (Fund aus der Whole-Branch-Review: "Wann startet
// das Event heute?" landete so als 'unbekannt' statt normal bei Ollama).
// JavaScripts eingebautes \b erkennt "ö" nicht als Wortzeichen, daher hier
// Unicode-Property-Escapes (\p{L}, "ist ein Buchstabe") mit Lookaround statt
// \b - das funktioniert auch fuer Umlaute zuverlaessig.
const STARTWORT_MUSTER = /(?<!\p{L})(starte|start|öffne|öffnen|mach)(?!\p{L})/u;

function erkenneProgrammBefehl(text, liste) {
  const klein = text.toLowerCase();
  const hatStartwort = STARTWORT_MUSTER.test(klein);

  if (!hatStartwort) return { art: 'kein_befehl' };

  const treffer = liste.find((eintrag) => klein.includes(eintrag.name.toLowerCase()));
  if (treffer) return { art: 'start', eintrag: treffer };

  return { art: 'unbekannt' };
}

module.exports = { erkenneProgrammBefehl };
