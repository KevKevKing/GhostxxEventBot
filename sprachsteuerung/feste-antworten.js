// Feste, gesprochen-taugliche Saetze fuer jeden Fehlerfall - an einer
// Stelle gesammelt statt in jedem Modul verstreut. Kein Modell erfindet
// hier etwas, das waere bei einer Fehlermeldung fehl am Platz.

const TEXTE = {
  nicht_erreichbar: 'Ich bin gerade nicht erreichbar, mein Sprachmodell antwortet nicht.',
  zeitueberschreitung: 'Das dauert mir gerade zu lange, frag mich gleich nochmal.',
  timeout_ollama: 'Ich brauche gerade zu lange zum Nachdenken, versuch es gleich nochmal.',
  leer: 'Dazu fällt mir gerade nichts ein.',
  fehlgeschlagen: 'Ich habe dich leider nicht verstanden.',
  kein_text: 'Ich habe nichts verstanden, war das leise oder undeutlich?',
  piper_fehlgeschlagen: 'Ich kann das gerade nicht aussprechen.',
  wiedergabe_fehlgeschlagen: 'Ich kann gerade nicht über die Lautsprecher sprechen.',
  unerwarteter_fehler: 'Da ist unterwegs etwas schiefgelaufen.',
};

const STANDARD = 'Da ist etwas schiefgelaufen.';

function textFuer(grund) {
  return TEXTE[grund] || STANDARD;
}

module.exports = { textFuer };
