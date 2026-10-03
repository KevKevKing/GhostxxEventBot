const fs = require('node:fs');

// Laedt die von Kevin gepflegte Liste startbarer Programme aus einer JSON-
// Datei ({ name, pfad }-Eintraege). Bewusst synchron (kleine Datei, wird bei
// jeder Aeusserung frisch gelesen, damit Aenderungen an der Liste ohne
// Neustart wirken) und bewusst fehlertolerant: eine fehlende Datei fuehrt
// still zu einer leeren Liste (normaler Zustand, z.B. wenn Baustein 2 noch
// nicht eingerichtet ist) - dann matcht nie ein Programmbefehl, die
// Sprachsteuerung faellt einfach auf normalen Chat zurueck (siehe
// programm-parser.js). Eine VORHANDENE, aber kaputte Datei ist dagegen kein
// normaler Zustand und wird per console.warn sichtbar gemacht, sonst wuerde
// Kevin nie erfahren, warum "starte X" ploetzlich nicht mehr funktioniert
// (z.B. bei einer UTF-8-BOM am Dateianfang, wie sie PowerShells Out-File
// standardmaessig schreibt - die BOM wird deshalb vor dem Parsen entfernt).
function ladeProgrammliste(pfad = process.env.PROGRAMMLISTE_PFAD) {
  let inhalt;
  try {
    inhalt = fs.readFileSync(pfad, 'utf8').replace(/^﻿/, '');
  } catch {
    return [];
  }

  try {
    const geparst = JSON.parse(inhalt);
    if (!Array.isArray(geparst)) {
      console.warn(`Programmliste (${pfad}) ist kein Array - wird ignoriert.`);
      return [];
    }
    return geparst.filter(
      (eintrag) => eintrag
        && typeof eintrag === 'object'
        && typeof eintrag.name === 'string'
        && eintrag.name.trim() !== ''
        && typeof eintrag.pfad === 'string',
    );
  } catch (fehler) {
    console.warn(`Programmliste (${pfad}) konnte nicht gelesen werden: ${fehler.message}`);
    return [];
  }
}

module.exports = { ladeProgrammliste };
