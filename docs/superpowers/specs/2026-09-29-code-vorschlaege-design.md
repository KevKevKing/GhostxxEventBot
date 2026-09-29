# Ghost schlägt selbst Code-Verbesserungen vor — Design

## Zusammenfassung

Die Selbstverbesserung (`src/selbstverbesserung*.js`) reagiert bisher nur auf
echte, gemessene Probleme (Absturzschleifen, Fehler-Logs, Parser-
Fehlschläge). Kevin möchte zusätzlich, dass Ghost **von sich aus**, ohne
einen erkannten Fehler, eigenen Code anschaut und ehrliche
Verbesserungsvorschläge macht — die Vorschläge sollen echt von Ghost selbst
kommen, nicht vorgegeben oder simuliert sein.

**Überarbeitet gegenüber der ersten Fassung dieser Spec** (nach Rücksprache
mit Kevin): kein fester Zeitplan, kein 1x/Tag-Limit, kein Zwang auf genau
eine Datei — Ghost darf jederzeit von sich aus schauen wollen und dabei so
viel vom Repo lesen, wie er für den Kontext braucht. Zur Sicherheit dafür
im Gegenzug ein **zweistufiges Ja/Nein statt einem**: Ghost fragt zuerst
**bevor** er überhaupt eine Session startet ("darf ich mir X anschauen?"),
erst nach einem "Ja" darauf läuft die eigentliche, lesende Session, und der
fertige Vorschlag bekommt danach nochmal ein eigenes Ja/Nein. Nichts wird
automatisch umgesetzt — bei beiden Ja/Nein-Schritten geht es nur um
Zustimmung, nie um eine ausgeführte Code-Änderung.

Der Grund für das zweistufige Vorgehen: das ist die erste Fähigkeit, bei
der Ghost selbst der Ideengeber ist, ganz ohne einen echten Anlass
dahinter. Ohne die erste Zustimmungsstufe könnte Ghost beliebig oft am Tag
eine mehrere Minuten laufende Claude-Code-Session starten (teilt sich die
GPU mit GTA, siehe CLAUDE.md) — die erste Frage macht daraus etwas, das
nur passiert, wenn Kevin gerade wirklich will.

## Ziel

- Ghost entscheidet selbst, **wann** er etwas anschauen möchte — kein
  fester Zeitplan, keine Tagesobergrenze.
- **Bevor** er dafür eine Session startet, fragt er Kevin per DM um
  Erlaubnis ("darf ich mir X anschauen?").
- Nur nach einem "Ja" läuft eine isolierte, rein lesende Claude-Code-
  Session, die frei im Repo lesen darf (nicht nur eine einzelne Datei) und
  **nur einen Text**-Vorschlag schreibt — keine Code-Änderung, kein
  Commit, keine Tests.
- Der fertige Vorschlag kommt per DM, Kevin sagt nochmal ja/nein dazu. Das
  Ergebnis wird vermerkt — mehr nicht.
- Eine kleine Mindestpause zwischen zwei "darf ich schauen?"-Anfragen
  verhindert DM-Spam, falls Kevin ablehnt oder nicht antwortet (siehe
  Abschnitt 2) — das ist eine technische Notwendigkeit, keine inhaltliche
  Einschränkung von "jederzeit".

## Nicht-Ziele (bewusst für später zurückgestellt)

- **Keine automatische Umsetzung, auf keiner der beiden Zustimmungsstufen.**
  Weder "ja, schau dir das an" noch "ja, guter Vorschlag" lösen eine
  code-ändernde Session aus. Die Umsetzung eines angenommenen Vorschlags
  ist ein bewusster, separater, späterer Schritt (durch Kevin oder mich).
- **Kein Dashboard-Eintrag.** Nur die DM. Eine Dashboard-Kachel für
  offene/angenommene Vorschläge ist ein sinnvoller späterer Ausbau.
- **Kein Text-Ähnlichkeits-Check gegen frühere Vorschläge.** Fällt erstmal
  Kevin selbst auf (er sieht ja jede einzelne DM).
- **Keine Änderung an der bestehenden Selbstverbesserung** (Absturz-/
  Fehler-/Parser-Erkennung, 5/Tag-Limit, Tabu-Pfade). Läuft komplett
  unverändert weiter, parallel zu diesem neuen, separaten Mechanismus.
- **Kein Bezug zur Sprachsteuerung** (PR #5). Die DM-Zustellung hier ist
  Text, wie bei `frage-erinnerung.js` — Sprache ist eine spätere,
  eigenständige Richtung (siehe Gedächtnis-Eintrag zur Jarvis-Vision).

## Architektur-Überblick

```
tick() (neuer Scheduler, alle 10 Min)
        |
        v
schalterAn('selbstverbesserung')?  <- dieselbe Freigabe wie die echte
        |  (nein -> nichts tun)       Selbstverbesserung, kein neuer Schalter
        v
liegt schon eine unbeantwortete Anfrage ODER ein unbeantworteter
Vorschlag vor (ausstehend != null)?
        |  (ja -> nichts tun, erst Kevins Antwort abwarten)
        v
laeuft schon eine echte Fix-Session (aktuellerLauf().laeuft)?
        |  (ja -> nichts tun)
        v
seit der letzten Anfrage genug Zeit vergangen (Mindestpause)?
        |  (nein -> nichts tun)
        v
naechsteDatei()     <- einfache Rotation als Vorschlag, WAS er sich anschaut
        |
        v
sendeAnfrage(datei)   neue DM: "darf ich mir X anschauen?"
   ausstehend = { art: 'anfrage', datei, gesendetAm }
        |
        v
Kevin antwortet ja/nein (message-handler.js)
        |
   nein -> ausstehend = null, fertig (naechste Anfrage erst nach der Mindestpause)
        |
   ja
        v
starteVorschlagsSession(datei)   neu, in selbstverbesserung-session.js
  - git clone main (KEIN eigener Branch, kein npm ci, kein Commit)
  - schreibt CODE_VORSCHLAG_AUFGABE.md, startet claude -p ... bypassPermissions
  - darf im Klon frei lesen, nicht nur die eine Datei
  - liest NUR CODE_VORSCHLAG.md zurueck
  - loescht den kompletten Klon danach, unabhaengig davon, was darin geschah
        |
        v
sendeVorschlag(vorschlag)   zweite DM
   ausstehend = { art: 'vorschlag', datei, vorschlag, gesendetAm }
        |
        v
Kevin antwortet ja/nein
        |
        v
vermerkeEntscheidung(...)   -> nur Protokoll, KEINE weitere Aktion
   ausstehend = null
```

## 1) Was Ghost als Nächstes vorschlägt anzuschauen

Neues, kleines Modul `src/code-vorschlag.js` schlägt selbst vor, was als
Nächstes drankommt — technisch per einfacher Rotation (kein Zufall, damit
garantiert irgendwann alles einmal drankommt, nicht dieselbe Datei mehrfach
hintereinander):

```js
async function naechsteDatei() {
  const dateien = (await fs.readdir(path.join(__dirname)))
    .filter((name) => name.endsWith('.js'))
    .sort();
  // Naechste nach der zuletzt VORGESCHLAGENEN (nicht: zuletzt vom Modell
  // gelesenen - die Session darf beim eigentlichen Lesen ja querlesen,
  // das hier ist nur der Ausgangspunkt fuer die Anfrage-DM).
}
```

Die Rotation entscheidet nur, **worüber die Anfrage-DM redet** ("darf ich
mir `src/xyz.js` anschauen?"). Sagt Kevin ja, darf die eigentliche Session
danach frei im Repo lesen, was sie für den Kontext braucht (siehe
Abschnitt 3) — die eine Datei ist der Ausgangspunkt, keine Einschränkung.

- Liste: alle `.js`-Dateien direkt in `src/` (nicht rekursiv — passt zu
  "63 Module in `src/`, ein Thema pro Datei" aus CLAUDE.md), alphabetisch
  sortiert.
- Ist die zuletzt vorgeschlagene Datei nicht mehr in der Liste (umbenannt/
  gelöscht), wird wieder bei der ersten Datei alphabetisch begonnen.

## 2) Wann darf Ghost (wieder) fragen?

Kein fester Zeitplan, keine Tagesobergrenze — aber drei Bedingungen, rein
technisch nötig, keine inhaltliche Einschränkung:

1. **Kein Zustand gerade offen.** Es gibt höchstens EINE unbeantwortete
   Sache gleichzeitig — entweder eine offene "darf ich schauen?"-Anfrage
   oder einen offenen fertigen Vorschlag, nie beides gleichzeitig, nie
   mehrere Anfragen gestapelt. Erst wenn Kevin geantwortet hat, kann die
   nächste Anfrage kommen.
2. **Keine echte Fix-Session läuft gerade** (`selbstverbesserung.
   aktuellerLauf().laeuft`) — teilt sich sonst unnötig die GPU.
3. **Mindestpause seit der letzten Anfrage** (Vorschlag: 3 Stunden,
   `ANFRAGE_ABSTAND_MS`) — reine Anti-Spam-Bremse für den Fall, dass Kevin
   ablehnt oder nicht antwortet. Ohne diese Bremse würde jeder folgende
   10-Minuten-Tick sofort wieder eine neue Anfrage schicken.

```js
async function darfFragen() {
  const stand = await ladeStand();
  if (stand.ausstehend) return false;
  const seit = Date.now() - new Date(stand.letzteAnfrageAm || 0).getTime();
  return seit >= ANFRAGE_ABSTAND_MS;
}
```

Zusätzlich gilt dieselbe Freigabe wie für die echte Selbstverbesserung:
`schalterAn('selbstverbesserung')` muss an sein (kein neuer, eigener
Schalter — beide Mechanismen starten Claude-Code-Sessions und sollen
zusammen an- und ausgeschaltet werden, siehe Dashboard).

## 3) Die Session: `starteVorschlagsSession(dateiPfad)`

Neue Funktion in `src/selbstverbesserung-session.js`, **deutlich einfacher**
als die bestehende `starteSession()`, weil hier nichts committet oder
gepusht wird:

- Nutzt dieselben bestehenden Bausteine: `bereinigteUmgebung()`,
  `echtAusfuehren()`/`passeBefehlFuerPlattformAn()` (für den
  `claude`-Aufruf unter Windows), `pruefeWurzel()` als Sicherheitsnetz
  (bleibt der echte Checkout unverändert, siehe unten).
- **Kein** `git checkout -b` (kein Branch nötig, es wird nie gepusht).
- **Kein** `npm ci` (die Session soll nichts ausführen/testen, nur lesen
  und schreiben — keine Abhängigkeiten nötig).
- **Keine** Tabu-Pfad-Prüfung, **kein** `git diff`-Vergleich im Klon —
  beides ist bei der bestehenden Selbstverbesserung dazu da, eine
  committete/gepushte Änderung abzusichern. Hier gibt es nie eine
  committete Änderung: der komplette Klon wird nach dem Lesen des
  Ergebnisses gelöscht, unabhängig davon, was darin geschah.
- **Vorher/Nachher-Vergleich am echten Checkout bleibt** (`pruefeWurzel()`,
  wie bei `starteSession()`) — billiges, zusätzliches Sicherheitsnetz,
  dass die Session wirklich nur im Klon gearbeitet hat.
- Aufgaben-Text (`baueVorschlagsAufgabe(dateiPfad)`, neu, analog zu
  `baueAufgabe()`) nennt `dateiPfad` als Ausgangspunkt, erlaubt
  ausdrücklich das Lesen verwandter Dateien für den Kontext:

  ```
  # Code-Vorschlag: ${dateiPfad}

  Lies dir `${dateiPfad}` in diesem Projekt an - und alles andere im
  Projekt, was du zum Verstehen brauchst (verwandte Module, Tests,
  CLAUDE.md). Du darfst frei im Projekt lesen, nicht nur diese eine Datei.

  ## Aufgabe

  Schreibe GENAU EINEN konkreten, ehrlichen Verbesserungsvorschlag in
  `CODE_VORSCHLAG.md` im Projekt-Root. Sei konkret (Datei, ungefähre
  Stelle, was genau du ändern würdest und warum) - kein allgemeines
  "könnte sauberer sein". Fällt dir nichts Nennenswertes auf, schreibe
  stattdessen genau `(nichts Nennenswertes)` hinein.

  WICHTIG: Ändere KEINE Datei, committe nichts, führe keine Tests aus - du
  sollst nur lesen und EINEN Vorschlag aufschreiben, nichts umsetzen.

  Halte dich an CLAUDE.md in diesem Projekt (Sprache, "messen nicht
  vermuten").
  ```

- Ergebnis-Datei: `CODE_VORSCHLAG.md` wird nach Sessionende gelesen
  (gleiches Muster wie `leseZusammenfassungStandard()`), dann wird der
  **gesamte Klon-Ordner** gelöscht
  (`fs.rm(klonPfad, {recursive:true, force:true})`).
- Rückgabe: `{ok:true, vorschlag}` oder `{ok:false, fehler}` (z.B.
  Timeout, Klon fehlgeschlagen) — wirft nie.

## 4) Zwei Arten von DM

Beide im selben neuen Modul `src/code-vorschlag.js`, Muster wie
`frage-erinnerung.js`:

**Anfrage-DM** (Gate 1):
```
Ich würde mir gerne ${dateiPfad} anschauen und dir vielleicht einen
Verbesserungsvorschlag machen. Ok?

Antworte mit "ja" oder "nein".
```

**Vorschlags-DM** (Gate 2, nur nach einem "Ja" auf die Anfrage):
```
${vorschlag}

_Vorschlag zu ${dateiPfad}_

Antworte mit "ja" oder "nein" - "ja" heisst nur "gute Idee, merken", ich
aendere dadurch noch nichts automatisch.
```

Beide merken einen **ausstehenden Zustand** (`art: 'anfrage' | 'vorschlag'`,
Datei, ggf. Vorschlagstext, Zeitpunkt) in `data/code-vorschlaege.json` —
siehe Abschnitt 6.

## 5) Kevins Antwort verarbeiten

Neuer Abschnitt in `message-handler.js`, **vor** dem bestehenden
Frage-Erinnerung-Antwort-Block, nach demselben Muster (nur DM, nur der
Owner):

```js
if (isDm && text && message.author.id === config.ownerId) {
  const ausstehend = await holeAusstehend();
  if (ausstehend) {
    const antwort = text.trim().toLowerCase();
    const istJa = antwort.startsWith('ja');
    const istNein = antwort.startsWith('nein');

    if (!istJa && !istNein) {
      await reply(message, 'Verstehe nur "ja" oder "nein" dazu.');
      return;
    }

    if (ausstehend.art === 'anfrage') {
      if (istNein) {
        await vermerkeAbgelehnteAnfrage();
        await reply(message, 'Alles klar, dann nicht.');
        return;
      }
      await reply(message, 'Alles klar, ich schau mir das an und melde mich.');
      // Laeuft im Hintergrund weiter (bis zu 20 Min) - die DM-Antwort
      // darf darauf nicht warten. Fehler darin werden dort selbst
      // geloggt, siehe Fehlerbehandlung.
      starteUndSendeVorschlag(client, ausstehend.datei).catch(() => null);
      return;
    }

    // ausstehend.art === 'vorschlag'
    await vermerkeEntscheidung(istJa ? 'angenommen' : 'abgelehnt');
    await reply(message, istJa ? 'Gemerkt, danke.' : 'Auch gut, verworfen.');
    return;
  }
}
```

Reihenfolge bewusst: **vor** dem bestehenden Frage-Erinnerung-Block. Beide
Zustände sind selten und überschneiden sich in der Praxis kaum — bei einem
theoretischen Zusammentreffen gewinnt der Code-Vorschlag, das ist eine
bewusste, einfache Festlegung, keine echte Sorge.

## 6) Protokoll und Zustand

`data/code-vorschlaege.json`:

```json
{
  "rotation": { "zuletztVorgeschlagen": "src/xyz.js" },
  "letzteAnfrageAm": "2026-09-29T09:00:00.000Z",
  "ausstehend": {
    "art": "anfrage",
    "datei": "src/xyz.js",
    "vorschlag": null,
    "gesendetAm": "2026-09-29T09:00:00.000Z"
  },
  "verlauf": [
    { "datei": "src/abc.js", "vorschlag": "...", "status": "angenommen", "entschiedenAm": "..." }
  ]
}
```

`ausstehend` ist `null`, wenn nichts offen ist. `verlauf` wird wie die
bestehenden Verlaufsdateien gekappt (z.B. 100 Einträge) — reine Historie,
kein Bestandteil der Ablauflogik. Eine abgelehnte **Anfrage** (Gate 1)
landet nicht im `verlauf` — dort stehen nur echte, tatsächlich gemachte
Vorschläge samt Entscheidung.

## Fehlerbehandlung

- Jeder Schritt (Rotation, Session, DM-Versand) wirft nie nach außen —
  schlägt einer fehl (z.B. `claude`-Aufruf schlägt fehl, DM kann nicht
  gesendet werden), wird geloggt (`logError`), `ausstehend` wird wieder auf
  `null` gesetzt (damit das Feature nicht dauerhaft blockiert bleibt), und
  `letzteAnfrageAm` bleibt stehen (die Mindestpause gilt weiter ab dem
  Zeitpunkt der ursprünglichen Anfrage).
- Schlägt die Session nach einem "Ja" auf die Anfrage fehl, bekommt Kevin
  eine kurze DM darüber ("Hat leider nicht geklappt: ...") — anders als
  bei der Anfrage selbst hat er hier schon "Ja" gesagt und wartet auf eine
  Antwort, ein stilles Verschwinden wäre verwirrend.
- Bleibt eine DM unbeantwortet, bleibt `ausstehend` stehen — es kommt
  keine neue Anfrage, bis Kevin reagiert (siehe Abschnitt 2, Bedingung 1).
  Kein Stau von mehreren offenen Vorgängen gleichzeitig, aber auch kein
  automatisches Aufgeben — das ist für Version 1 bewusst so (Kevin
  antwortet, wenn er Zeit hat).
- **Nachtrag (Fix-Runde nach Review):** weil zwischen der Anfrage-DM und
  Kevins "ja" mehrere Stunden liegen können, kann die Mindestpause
  (`ANFRAGE_ABSTAND_MS`) während eine Vorschlags-Session noch läuft schon
  wieder abgelaufen sein — ohne Schutz würde `tick()` dann eine zweite,
  andere Anfrage lostreten und Kevins spätes "ja" bezöge sich auf die
  falsche Datei. Ein in-memory Merker `vorschlagLaeuft` in
  `code-vorschlag.js` verhindert das: gesetzt direkt vor dem Start der
  Session, in einem `finally` wieder gelöscht, von `tick()` genauso geprüft
  wie `aktuellerLauf().laeuft`. Zusätzlich prüft `message-handler.js` beim
  "ja" auf die Anfrage `aktuellerLauf().laeuft` (die echte
  Reparatur-Session) noch einmal frisch — läuft die gerade, bekommt Kevin
  eine kurze Absage und `ausstehend` bleibt stehen, sein "ja" lässt sich
  also einfach wiederholen.
- Diese Selbst-Vorschlags-Fehler dürfen nie selbst eine echte
  Reparatur-Session auslösen: die Titel `Fehler beim Code-Vorschlag` und
  `Fehler beim Code-Vorschlag (Session)` stehen deshalb in `EIGENE_FEHLER`
  (`selbstbeobachtung.js`), analog zu den beiden bestehenden Titeln der
  echten Selbstverbesserung.
- Beide DM-Texte (fertiger Vorschlag, Fehlermeldung) werden vor dem Senden
  gekappt (1800 bzw. 1200 Zeichen, mit "… (gekürzt)"-Hinweis) — Discord
  lehnt Nachrichten über ~2000 Zeichen komplett ab, und ohne Kappung wäre
  ein angenommener, aber zu langer Vorschlag sonst nie angekommen.
- Suggestion-Sessions respektieren dieselbe Nachtruhe wie die übrigen
  proaktiven Module: `tick()` prüft `istNachtruhe()` und tut zwischen 2 und
  10 Uhr nichts.

## Tests

- `naechsteDatei()`: rotiert korrekt durch eine (in Tests gemockte) Liste
  von Dateinamen, springt am Ende wieder zum Anfang, fängt bei einer nicht
  mehr existierenden zuletzt-vorgeschlagenen Datei wieder von vorne an.
- `darfFragen()`: `false` wenn `ausstehend` gesetzt ist (unabhängig von der
  Mindestpause), `false` innerhalb der Mindestpause nach der letzten
  Anfrage, `true` danach.
- `starteVorschlagsSession()`: mit injiziertem `ausfuehren()` (wie bei den
  bestehenden `starteSession()`-Tests) — liest `CODE_VORSCHLAG.md`
  korrekt, löscht den Klon-Ordner danach, liefert `{ok:false}` bei einem
  fehlgeschlagenen Klon, ohne zu werfen.
- DM-Antwort-Verarbeitung: "ja"/"Ja"/"JA " wird als Zustimmung erkannt,
  "nein" als Ablehnung, alles andere führt zu einer Rückfrage statt einer
  stillen Fehlinterpretation — für **beide** `ausstehend.art`-Werte
  getrennt geprüft (Anfrage-Ja startet die Session, Vorschlags-Ja
  vermerkt nur).

## Offene Punkte für die Umsetzungsplanung

- Exakter Wert für `ANFRAGE_ABSTAND_MS` (3 Stunden ist ein Vorschlag, kein
  Muss — Kevin hat ausdrücklich "keine Vorgabe wann" gesagt, die Bremse
  ist eine technische Notwendigkeit gegen DM-Spam, kein inhaltliches
  Limit).
- Exakter Name/Ort der neuen Module (`code-vorschlag.js` als Vorschlag)
  und ob `starteVorschlagsSession()` in `selbstverbesserung-session.js`
  landet (Wiederverwendung der Klon-Hilfsfunktionen) — Detail für die
  Implementierung.
- Genauer Scheduler-Anschluss (eigener `setInterval` wie
  `frage-erinnerung.js`, oder Teil eines bestehenden Takts) — reine
  Verdrahtungsfrage.
