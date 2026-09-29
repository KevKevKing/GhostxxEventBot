# Ghost schlägt selbst Code-Verbesserungen vor — Design

## Zusammenfassung

Die Selbstverbesserung (`src/selbstverbesserung*.js`) reagiert bisher nur auf
echte, gemessene Probleme (Absturzschleifen, Fehler-Logs, Parser-
Fehlschläge). Kevin möchte zusätzlich, dass Ghost **von sich aus**, ohne
einen erkannten Fehler, eigenen Code anschaut und ehrliche
Verbesserungsvorschläge macht — die Vorschläge sollen echt von Ghost selbst
kommen, nicht vorgegeben oder simuliert sein.

Bewusst als **kleinster, sicherster erster Schritt**: einmal am Tag eine
Datei ansehen, **nur einen Text-Vorschlag** schreiben (keine Code-Änderung),
per DM zustellen, Kevin sagt ja/nein. Bei "ja" wird das nur vermerkt — es
löst **keine** automatische Umsetzung aus. Der Grund: das ist die erste
Fähigkeit, bei der Ghost selbst der Ideengeber ist, ganz ohne einen echten
Anlass dahinter — bevor sowas automatisch Code ändern darf, will Kevin erst
eine Weile echte Vorschläge sehen und einschätzen können, wie gut sie sind.
Der Umstieg auf "ja = automatisch umsetzen" ist danach eine kleine,
spätere Änderung, kein Neubau.

## Ziel

- Einmal am Tag: eine Datei aus `src/` ansehen (alphabetisch der Reihe
  nach, ähnliches Rotationsprinzip wie das bestehende Bild-Vorablesen
  "A-Z"), eine isolierte Claude-Code-Session lesen und **nur einen Text**
  mit einem konkreten Verbesserungsvorschlag schreiben lassen — keine
  Code-Änderung, kein Commit, keine Tests.
- Den Vorschlag per echter Discord-DM an Kevin zustellen (gleiches Prinzip
  wie `frage-erinnerung.js`).
- Kevin antwortet direkt in der DM mit ja/nein. Das Ergebnis wird
  vermerkt — mehr nicht.

## Nicht-Ziele (bewusst für später zurückgestellt)

- **Keine automatische Umsetzung bei "ja".** Das ist der wichtigste
  Unterschied zur bestehenden Selbstverbesserung: dort startet ein
  erkanntes Problem sofort eine echte, code-ändernde Session. Hier läuft
  die code-ändernde Session **nie** automatisch — "ja" heißt nur "gute
  Idee", nicht "jetzt umsetzen". Die Umsetzung ist ein bewusster,
  separater, späterer Schritt (durch Kevin oder mich).
- **Kein Dashboard-Eintrag.** Nur die DM. Eine Dashboard-Kachel für
  offene/angenommene Vorschläge ist ein sinnvoller späterer Ausbau, sobald
  sich zeigt, dass sich Vorschläge häufen.
- **Kein Text-Ähnlichkeits-Check gegen frühere Vorschläge.** Falls Ghost
  wiederholt Ähnliches vorschlägt, fällt das erstmal Kevin selbst auf
  (er sieht ja jede einzelne DM) — automatische Erkennung ist ein
  möglicher späterer Schritt, kein Teil von Version 1.
- **Keine Änderung an der bestehenden Selbstverbesserung** (Absturz-/
  Fehler-/Parser-Erkennung, 5/Tag-Limit, Tabu-Pfade). Läuft komplett
  unverändert weiter, parallel zu diesem neuen, separaten Mechanismus.
- **Kein Bezug zur Sprachsteuerung** (PR #5). Kevins Erwähnung, dass Ghost
  "irgendwann von selbst mit ihm reden" soll, ist die langfristige
  Richtung (siehe Gedächtnis-Eintrag zur Jarvis-Vision), aber nicht Teil
  dieser Spec — die DM-Zustellung hier ist Text, wie bei
  `frage-erinnerung.js`.

## Architektur-Überblick

```
tick() (neuer Scheduler, alle 10 Min wie selbstverbesserung.js)
        |
        v
darfHeuteLaufen()?  <- eigener Tages-Zaehler, getrennt vom 5/Tag-Limit
        |  (nein -> nichts tun)
        v
laeuft schon eine echte Fix-Session (aktuellerLauf().laeuft)?
        |  (ja -> nichts tun, naechster Tick versucht's wieder)
        v
naechsteDatei()     <- Rotationszeiger, A-Z durch src/*.js
        |
        v
starteVorschlagsSession(datei)   neu, in selbstverbesserung-session.js
  - git clone main (KEIN eigener Branch, kein npm ci, kein Commit)
  - schreibt CODE_VORSCHLAG_AUFGABE.md, startet claude -p ... bypassPermissions
  - liest NUR CODE_VORSCHLAG.md zurueck
  - loescht den kompletten Klon danach, unabhaengig davon, was darin geschah
        |
        v
sendeVorschlag(vorschlag)   neue DM an Kevin, wie frage-erinnerung.js
        |
        v
Kevin antwortet ja/nein in der DM (message-handler.js, neuer Abschnitt)
        |
        v
vermerkeEntscheidung(...)   -> nur Protokoll, KEINE weitere Aktion
```

## 1) Rotation: welche Datei ist als Nächstes dran?

Neues, kleines Modul `src/code-vorschlag.js` haelt einen Rotationszeiger
(`zuletztDatei`) in einer eigenen Datei (`data/code-vorschlaege.json`).

```js
async function naechsteDatei() {
  const dateien = (await fs.readdir(path.join(__dirname)))
    .filter((name) => name.endsWith('.js'))
    .sort();
  // ...
}
```

- Liste: alle `.js`-Dateien direkt in `src/` (nicht rekursiv — passt zu
  "63 Module in `src/`, ein Thema pro Datei" aus CLAUDE.md), alphabetisch
  sortiert.
- Nach der zuletzt angesehenen Datei kommt die naechste in der Liste; am
  Ende der Liste geht es wieder bei der ersten los.
- Ist die zuletzt gemerkte Datei nicht mehr in der Liste (umbenannt/
  geloescht), wird wieder bei der ersten Datei alphabetisch begonnen.

## 2) Der Tages-Zaehler

Eigene, von `selbstverbesserung-limit.js` komplett getrennte Zaehlung
(gleiches Muster: Datumsstempel in Berliner Zeit, `getBerlinDateStamp()`),
weil das hier ein anderer Mechanismus mit anderer Bremse ist (1/Tag, nicht
5/Tag) und nicht mit dem Limit der echten Fix-Sessions vermischt werden
soll.

```js
async function darfHeuteLaufen() {
  const stand = await ladeStand(); // { datum, gelaufenAm: iso|null }
  const heute = getBerlinDateStamp();
  if (stand.datum === heute && stand.gelaufenAm) return false;
  return true;
}
```

Zusaetzlich: laeuft gerade eine echte Fix-Session
(`selbstverbesserung.aktuellerLauf().laeuft`), wird dieser Tick
uebersprungen, OHNE den Tages-Zaehler zu verbrauchen — der naechste Tick
(10 Min spaeter) versucht es erneut, solange noch derselbe Tag ist.

## 3) Die Session: `starteVorschlagsSession(dateiPfad)`

Neue Funktion in `src/selbstverbesserung-session.js`, **deutlich einfacher**
als die bestehende `starteSession()`, weil hier nichts committet oder
gepusht wird:

- Nutzt dieselben bestehenden Bausteine: `bereinigteUmgebung()`,
  `echtAusfuehren()`/`passeBefehlFuerPlattformAn()` (fuer den
  `claude`-Aufruf unter Windows).
- **Kein** `git checkout -b` (kein Branch noetig, es wird nie gepusht).
- **Kein** `npm ci` (die Session soll nichts ausfuehren/testen, nur lesen
  und schreiben - keine Abhaengigkeiten noetig).
- **Keine** Tabu-Pfad-Pruefung, **kein** `git diff`-Vorher/Nachher-Vergleich
  am echten Checkout — beides ist bei der bestehenden Selbstverbesserung
  dazu da, eine committete/gepushte Aenderung abzusichern. Hier gibt es
  nie eine committete Aenderung: der komplette Klon wird nach dem Lesen
  des Ergebnisses geloescht, unabhaengig davon, was die Session darin
  angestellt hat.
- Aufgaben-Text (`baueVorschlagsAufgabe(dateiPfad)`, neu, analog zu
  `baueAufgabe()`):

  ```
  # Code-Vorschlag: ${dateiPfad}

  Lies dir `${dateiPfad}` in diesem Projekt an (und alles, was du zum
  Verstehen brauchst, z.B. verwandte Dateien).

  ## Aufgabe

  Schreibe GENAU EINEN konkreten, ehrlichen Verbesserungsvorschlag fuer
  diese Datei in `CODE_VORSCHLAG.md` im Projekt-Root. Sei konkret (Datei,
  ungefaehre Stelle, was genau du aendern wuerdest und warum) - kein
  allgemeines "koennte sauberer sein". Faellt dir nichts Nennenswertes auf,
  schreibe stattdessen genau `(nichts Nennenswertes)` hinein.

  WICHTIG: Aendere KEINE Datei, committe nichts, fuehre keine Tests aus -
  du sollst nur lesen und EINEN Vorschlag aufschreiben, nichts umsetzen.

  Halte dich an CLAUDE.md in diesem Projekt (Sprache, "messen nicht
  vermuten").
  ```

- Ergebnis-Datei: `CODE_VORSCHLAG.md` wird nach Sessionende gelesen
  (gleiches Muster wie `leseZusammenfassungStandard()` fuer
  `SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md`), dann wird der **gesamte
  Klon-Ordner** geloescht (`fs.rm(klonPfad, {recursive:true, force:true})`).
- Rueckgabe: `{ok:true, vorschlag}` oder `{ok:false, fehler}` (z.B. Timeout,
  Klon fehlgeschlagen) — wirft nie, wie alle Funktionen in diesem Modul.

## 4) Zustellung per DM

Neues, kleines Modul (`code-vorschlag.js`, gleiche Datei wie die Rotation/
den Tages-Zaehler — die Funktionen gehoeren eng zusammen und sind zu klein
fuer eine eigene weitere Datei), Muster wie `frage-erinnerung.js`:

```
${vorschlag}

_Vorschlag zu ${dateiPfad}_

Antworte mit "ja" oder "nein" - "ja" heisst nur "gute Idee, merken", ich
aendere dadurch noch nichts automatisch.
```

Der Versand merkt sich einen **ausstehenden Vorschlag** (Datei + Text +
Zeitpunkt) in derselben `data/code-vorschlaege.json` — analog zu
`holeGestellte()`/`merkeGestellt()` in `ghostxx-fragen.js`, aber als
eigener, kleiner State (kein Zusammenspiel mit den offenen operativen
Fragen dort).

## 5) Kevins Antwort verarbeiten

Neuer Abschnitt in `message-handler.js`, **vor** dem bestehenden
Frage-Erinnerung-Antwort-Block (Zeile ~651), nach demselben Muster (nur
DM, nur der Owner):

```js
if (isDm && text && message.author.id === config.ownerId) {
  const ausstehenderVorschlag = holeAusstehendenVorschlag(message.author.id);
  if (ausstehenderVorschlag) {
    const antwort = text.trim().toLowerCase();
    if (antwort.startsWith('ja') || antwort.startsWith('nein')) {
      await vermerkeEntscheidung(ausstehenderVorschlag, antwort.startsWith('ja') ? 'angenommen' : 'abgelehnt');
      loescheAusstehendenVorschlag(message.author.id);
      await reply(message, antwort.startsWith('ja') ? 'Gemerkt, danke.' : 'Auch gut, verworfen.');
      return;
    }
    await reply(message, 'Verstehe nur "ja" oder "nein" dazu.');
    return;
  }
}
```

Reihenfolge bewusst: **vor** dem bestehenden Frage-Erinnerung-Block. Beide
Zustaende sind selten (je hoechstens 1/Tag) und ueberschneiden sich in der
Praxis kaum — bei einem theoretischen Zusammentreffen gewinnt der
Vorschlag, das ist eine bewusste, einfache Festlegung, keine echte Sorge.

## 6) Protokoll vergangener Vorschläge

`data/code-vorschlaege.json`:

```json
{
  "rotation": { "zuletztDatei": "src/xyz.js" },
  "tagesZaehler": { "datum": "2026-09-29", "gelaufenAm": "2026-09-29T09:00:00.000Z" },
  "ausstehend": { "datei": "src/xyz.js", "vorschlag": "...", "gesendetAm": "..." },
  "verlauf": [
    { "datei": "src/abc.js", "vorschlag": "...", "status": "angenommen", "entschiedenAm": "..." }
  ]
}
```

`verlauf` wird wie die bestehenden Verlaufsdateien gekappt (z.B. 100
Eintraege) — reine Historie, kein Bestandteil der Erkennungslogik.

## Fehlerbehandlung

- Jeder Schritt (Rotation, Session, DM-Versand) wirft nie nach außen —
  schlägt einer fehl (z.B. `claude`-Aufruf schlägt fehl, DM kann nicht
  gesendet werden, weil Kevin keine DMs von Servermitgliedern erlaubt),
  wird geloggt (`logError`), der Tages-Zähler wird **nicht** verbraucht
  (damit der nächste Tick es nochmal versucht), und der Scheduler läuft
  unverändert weiter.
- Schlägt die Session fehl, gibt es keinen Vorschlag, also auch keine DM —
  kein Fehlertext an Kevin nötig, das wäre nur Rauschen für ein Feature,
  das ohnehin nicht kritisch ist.
- Bleibt eine DM unbeantwortet (Kevin antwortet nie), bleibt der Eintrag
  in `ausstehend` stehen. Das blockiert **nicht** den nächsten Tag —
  `darfHeuteLaufen()` prüft nur das Datum, nicht ob die letzte Antwort da
  ist. Am nächsten Tag würde also ein neuer Vorschlag gesendet, während
  der alte noch unbeantwortet in `ausstehend` liegt und überschrieben
  wird. Für Version 1 akzeptiert (siehe Nicht-Ziele) — kein Stau von
  mehreren offenen Vorschlägen gleichzeitig.

## Tests

- `naechsteDatei()`: rotiert korrekt durch eine (in Tests gemockte) Liste
  von Dateinamen, springt am Ende wieder zum Anfang, faengt bei einer
  nicht mehr existierenden zuletzt-Datei wieder von vorne an.
- `darfHeuteLaufen()`: `true` am ersten Aufruf eines Tages, `false` nach
  einem vermerkten Lauf am selben Tag, wieder `true` am naechsten Tag.
- `starteVorschlagsSession()`: mit injiziertem `ausfuehren()` (wie bei den
  bestehenden `starteSession()`-Tests) - liest `CODE_VORSCHLAG.md`
  korrekt, loescht den Klon-Ordner danach, liefert `{ok:false}` bei einem
  fehlgeschlagenen Klon, ohne zu werfen.
- DM-Antwort-Verarbeitung: "ja"/"Ja"/"JA " wird als angenommen erkannt,
  "nein" als abgelehnt, alles andere fuehrt zu einer Rueckfrage statt
  einer stillen Fehlinterpretation.

## Offene Punkte für die Umsetzungsplanung

- Exakter Name/Ort der neuen Module (`code-vorschlag.js` als Vorschlag,
  kein Muss) und ob Rotation/Tages-Zaehler/DM-Versand in einer oder
  mehreren Dateien landen.
- Ob `starteVorschlagsSession()` in `selbstverbesserung-session.js` landet
  (Wiederverwendung der Klon-Hilfsfunktionen) oder ob diese Hilfsfunktionen
  zuerst in ein gemeinsames, kleines Hilfsmodul extrahiert werden — Detail
  fuer die Implementierung, nicht fuer dieses Design.
- Genauer Scheduler-Anschluss (eigener `setInterval` wie
  `frage-erinnerung.js`, oder Teil des bestehenden 10-Minuten-Takts in
  `index.js`) — funktional gleichwertig, reine Verdrahtungsfrage.
