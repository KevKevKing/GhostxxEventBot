const fs = require('node:fs');

// Laedt die von Kevin gepflegte Liste startbarer Programme aus einer JSON-
// Datei ({ name, pfad }-Eintraege). Bewusst synchron (kleine Datei, wird bei
// jeder Aeusserung frisch gelesen, damit Aenderungen an der Liste ohne
// Neustart wirken) und bewusst fehlertolerant: eine fehlende oder kaputte
// Datei fuehrt zu einer leeren Liste statt zu einem Absturz - dann matcht
// nie ein Programmbefehl, die Sprachsteuerung faellt einfach auf normalen
// Chat zurueck (siehe programm-parser.js).
function ladeProgrammliste(pfad = process.env.PROGRAMMLISTE_PFAD) {
  try {
    const inhalt = fs.readFileSync(pfad, 'utf8');
    const geparst = JSON.parse(inhalt);
    if (!Array.isArray(geparst)) return [];
    return geparst.filter(
      (eintrag) => eintrag
        && typeof eintrag === 'object'
        && typeof eintrag.name === 'string'
        && typeof eintrag.pfad === 'string',
    );
  } catch {
    return [];
  }
}

module.exports = { ladeProgrammliste };
