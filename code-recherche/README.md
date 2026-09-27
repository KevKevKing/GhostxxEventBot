# Code-Recherche (Prototyp)

Kleiner, isolierter Testbaustein: kann Ghostxx bei Coding-Fragen echte
Infos aus dem Web nachschlagen? **Nicht an den Bot angeschlossen** — kein
Import von/nach `src/`, nirgendwo in `message-handler.js` oder `ollama.js`
verdrahtet. Ein Fehler hier kann den produktiven Bot nicht beruehren.

## Warum das existiert

Ghostxx hat bereits ein Selbstverbesserungs-System (`src/selbstverbesserung*.js`),
das eigene Fehler erkennt und automatisch eine Claude-Code-Session zum Fixen
anstoesst. Die hier getestete Idee geht weiter: koennte Ghostxx (im Chat oder
in einer solchen Session) auch aktiv im Web nachschlagen, statt nur zu raten?
Dieser Prototyp klaert nur die technische Machbarkeit, nichts davon ist
bereits angebunden.

## Was es tut

`sucheCode(anfrage)` fragt die Tavily-Such-API ab (`websuche.js`, braucht
`TAVILY_API_KEY` in `.env`).

**Wechsel-Historie:** zuerst mit DuckDuckGos Instant-Answer-API gebaut (kein
Konto noetig) - gemessener Befund: gut fuer Lexikon-Begriffe ("Node.js"), aber
**keine Antwort** auf einen echten Fehlertext ("TypeError cannot read
properties of undefined"). Genau das ist aber der Hauptfall fuer eine
Coding-Hilfe. Brave Search API kam als naechstes in Frage, verlangt seit
Februar 2026 aber eine Kreditkarte (Startguthaben, danach automatische
Abbuchung) - abgelehnt. Tavily (extra fuer KI-Agenten gebaut) hat ein
kostenloses Kontingent **ohne Kreditkarte** (1.000 Anfragen/Monat, Stand der
Recherche 2026-09-27) - dabei geblieben.

Nur lesend. Kein Ausfuehren von Code, kein Zugriff auf GitHub-Schreibrechte,
kein eigener Speicher.

## Einrichten

1. Kostenloses Konto auf [tavily.com](https://www.tavily.com) anlegen (Mail +
   Passwort, keine Kreditkarte noetig)
2. API-Key im Dashboard erzeugen
3. In `code-recherche/.env` eintragen: `TAVILY_API_KEY=tvly-...`
   (`.env` ist gitignored wie bei `sprachsteuerung/`)

## Testen

```bash
npm test -- code-recherche
```

Ohne `TAVILY_API_KEY` gibt `sucheCode()` sauber `{ok:false, grund:
'kein_api_schluessel'}` zurueck, statt zu werfen oder gegen Tavily zu laufen.

## Gemessener Befund: Tavily beantwortet den Fehlertext

Dieselbe Anfrage, an der DuckDuckGo gescheitert ist, echt gegen Tavily
getestet (nicht gemockt):

`"TypeError cannot read properties of undefined"` → eine kurze, inhaltlich
richtige Erklaerung der Fehlerursache (Zugriff auf eine Eigenschaft eines
`undefined`-Werts) mit zwei brauchbaren Gegenmassnahmen (Optional Chaining,
Variablen vor Gebrauch initialisieren), plus Quelle:
`rollbar.com/blog/javascript-typeerror-cannot-read-property-of-undefined`.

**Damit ist die technische Machbarkeit gezeigt** - Tavily beantwortet genau
den Fall, an dem die schluessellose Variante gescheitert ist.

## Offene Fragen, bevor daraus mehr wird

- Wo waere der feste Parser ("erst ablesen, dann raten"), der entscheidet,
  wann ueberhaupt nachgeschlagen wird?
- Soll das in den normalen Chat (`ollama.js`) oder nur in
  Selbstverbesserungs-Sessions einfliessen?
- Wie wird eine englische Tavily-Antwort im deutschsprachigen Chat
  eingebaut - uebersetzen lassen, oder als Zitat stehen lassen?

Das sind Kevins Entscheidungen, keine technischen.
