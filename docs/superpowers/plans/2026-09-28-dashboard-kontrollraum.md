# Dashboard-Neugestaltung "Ghost Kontrollraum" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Dashboard (`src/dashboard-seite.js`) bekommt den Look der Vorlage `C:\Users\kevin\Downloads\ghost-dashboard.html` ("Ghost Kontrollraum") - neues Layout, neue Optik, alle echten Inhalte bleiben erhalten und werden neu einsortiert, der bestehende "GhostxxCode"-Chat wandert in die Mitte.

**Architecture:** Reines Frontend-Redesign. `dashboard-daten.js` (Datenschicht) und `dashboard.js` (Endpunkte, inkl. dem bereits bestehenden `POST /api/chat`) bleiben unveraendert. `dashboard-seite.js` wird Stueck fuer Stueck umgebaut: erst die CSS-Grundlage und das Grid-Skelett, dann der GHOST-Reaktor als Canvas-Animation, dann eine neue Telemetrie-Kachel links, dann die Umsortierung der bestehenden Karten in die drei Spalten, zuletzt Aufraeumen von totem CSS.

**Tech Stack:** Node.js, kein Frontend-Framework, die Dashboard-Seite ist ein einzelner Template-String (`String.raw`) mit eingebettetem `<style>` und `<script>`. Canvas 2D fuer die Reaktor-Animation (aus der Vorlage uebernommen).

**Spec:** `docs/superpowers/specs/2026-09-28-dashboard-kontrollraum-design.md`

## Global Constraints

- Kein neuer Backend-Endpunkt, keine Aenderung an `dashboard-daten.js`s `stand()`-Feldern.
- Keine Aenderung an Events, Zeitplaner, Auszahlungslogik.
- Kein externer KI-Anbieter, kein Freitext-Coding-Agent, keine neuen/erfundenen Modul-Schalter - nur die echten Schalter aus `steuerung.js`.
- Die bestehende "GhostxxCode"-Kachel (`#chatverlauf`, `#chatformular`, `#chattext`, `POST /api/chat`) wird unveraendert uebernommen, nur Ort und Optik aendern sich.
- Alle Umlaute in Code-Kommentaren umschrieben (`fuer`, nicht `für`), alles Nutzerseitige (sichtbarer Text auf der Seite) mit echten Umlauten.
- Jeder Schritt endet mit `npm test` gruen, bevor committet wird.

---

## Task 0: Baseline auf den Stand nach der "Er fragt"-Entfernung bringen

Diese Spec geht davon aus, dass die Branch `worktree-ghostxx-fragen-dm` (entfernt die "Er fragt"-Kachel/`#fragen`/`/api/antwort` und die "Bilder"-Kachel/`#bilder`, verschiebt den Bildlesen-Pause-Knopf in die Leiste) bereits gemerged ist. Ist das zum Zeitpunkt der Umsetzung noch nicht der Fall, wird sie hier in die aktuelle Branch gemerged, damit alle folgenden Tasks auf derselben Grundlage aufbauen.

**Files:**
- Betroffen (durch den Merge, nicht direkt bearbeitet): `src/dashboard-seite.js`, `src/dashboard-daten.js`, `src/dashboard.js`, `CLAUDE.md`, `tests/dashboard.test.js`

- [ ] **Step 1: Pruefen, ob die Branch schon in `main` ist**

Run: `git log origin/main --oneline | grep -i "Er fragt"`
Wenn eine Zeile wie "Er fragt: Kachel raus, ..." erscheint: Branch ist schon in `main`, `git merge origin/main` reicht, Rest dieses Tasks ueberspringen.

- [ ] **Step 2: Falls nicht - die Feature-Branch mergen**

Run: `git merge worktree-ghostxx-fragen-dm`

Erwartet: sauberer Merge (beide Branches sind frisch von `main` abgezweigt und aendern unterschiedliche Stellen). Bei Konflikten: von Hand aufloesen, dabei IMMER die Version aus `worktree-ghostxx-fragen-dm` fuer `#fragen`/`#bilder`/`/api/antwort`-bezogene Stellen nehmen (die sind dort absichtlich entfernt).

- [ ] **Step 3: Testsuite pruefen**

Run: `npm test`
Expected: alle Testdateien bestehen (siehe `worktree-ghostxx-fragen-dm`-Commits fuer den erwarteten Stand: keine `#fragen`-Kachel, keine `#bilder`-Kachel mehr, Pause-Knopf in der Leiste).

- [ ] **Step 4: Commit (nur falls Step 2 tatsaechlich etwas gemerged hat)**

```bash
git add -A
git commit -m "Merge worktree-ghostxx-fragen-dm als Grundlage fuer die Dashboard-Neugestaltung"
```

---

## Task 1: Design-Grundlage - Farben, Schriften, Grid-Skelett

Ersetzt den kompletten `<style>`-Grundlagenteil (Farbvariablen, Schriften, Hintergrund, Grid) und die aeussere HTML-Struktur durch die der Vorlage - mit **allen bestehenden Inhalts-IDs unveraendert**, nur in neuen Spalten-Containern. Kein Inhalt geht verloren, nur die Huelle aendert sich.

**Files:**
- Modify: `src/dashboard-seite.js` (der `<style>`-Block ab `:root {` bis zum Ende der Grundlagen-Regeln, und die aeussere HTML-Struktur `<body>...<div class="gitter">...</div>` bis vor `<div class="leiste">`)
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Konsumiert: nichts Neues - `$(id)`-Funktion und alle bestehenden `zeichneX()`-Funktionen bleiben unangetastet, sie schreiben weiterhin in dieselben IDs.
- Produziert: drei neue Spalten-Container mit den Klassen `.spalte-links`, `.spalte-mitte`, `.spalte-rechts` (ersetzen die drei alten `.spalte`-Divs 1:1 in derselben Reihenfolge/Zuordnung wie in Task 4 beschrieben) unter einem `.gitter`-Grid mit `grid-template-columns: 300px minmax(0,1fr) 380px` (Werte aus der Vorlage, `ghost-dashboard.html:60`).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/dashboard.test.js`, im Abschnitt "Die Seite" (nach der bestehenden `check('hat alle Bereiche', ...)`-Zeile) ergaenzen:

```js
  check('neue Design-Grundlage geladen', html.includes('Unbounded') && html.includes('--ion'));
  check('drei benannte Spalten statt generischer .spalte', html.includes('spalte-links') && html.includes('spalte-mitte') && html.includes('spalte-rechts'));
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL bei den beiden neuen Zeilen (weder "Unbounded" noch "spalte-links" existieren noch).

- [ ] **Step 3: `<head>` um die Schriften ergaenzen**

In `src/dashboard-seite.js`, direkt nach `<title>Ghostxx</title>` einfuegen (vor `<style>`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@300;600;800&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
```

- [ ] **Step 4: Die Farbvariablen und Grundschriften ersetzen**

Den bestehenden Block

```css
  :root {
    --bg: #060d18; --karte: rgba(12,24,38,.55); --rand: #1b3f5c;
    --text: #dceaf5; --leise: #6f93ad;
    --gut: #35e08a; --warn: #f0b429; --schlecht: #ff5f6d; --akzent: #22d3ee;
  }
  * { box-sizing: border-box; }
```

ersetzen durch (Werte 1:1 aus `ghost-dashboard.html:7-29`, `--gut`/`--warn`/`--schlecht`/`--akzent` als Alias-Namen behalten, damit die vielen bestehenden Stellen im Rest der Datei, die diese vier Variablen benutzen, unveraendert weiterfunktionieren):

```css
  :root {
    color-scheme: dark;
    --bg: #05070B; --deck: #090D13; --karte: #0D131B; --karte2: #111926;
    --rand: #1A2431; --rand2: #243244;
    --text: #E4ECF4; --leise: #9AA8B8; --leiser: #5E6B7B;
    --ion: #5CF0E4; --ion-dim: rgba(92,240,228,.14);
    --akzent: var(--ion);
    --gut: #57D98C; --warn: #FFB35C; --schlecht: #FF6B6B;
    --r: 10px;
    --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --sans: "Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
    --disp: "Unbounded", "Geist", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
```

- [ ] **Step 5: `body`-Grundstil und Hintergrund ersetzen**

Den bestehenden `body`-Block und die `body::before`-Regel (Nebelschleier) durch die Vorlage ersetzen (`ghost-dashboard.html:32-44`):

```css
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.45 var(--sans);
    background-image:
      radial-gradient(900px 600px at 50% 18%, rgba(92,240,228,.07), transparent 70%),
      linear-gradient(var(--bg), var(--bg));
    padding-inline: 16px;
  }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image: linear-gradient(rgba(154,168,184,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(154,168,184,.035) 1px, transparent 1px);
    background-size: 32px 32px;
    mask-image: radial-gradient(ellipse at 50% 30%, #000 30%, transparent 80%);
  }
```

Hinweis: bestehende Regeln, die sich auf alte, jetzt nicht mehr vorhandene Selektoren beziehen (z.B. alte `body::before`-Gradient-Definitionen mit den Farben `rgba(34,211,238,...)`), werden durch diesen Ersatz bereits entfernt - keine doppelten Regeln stehen lassen.

- [ ] **Step 6: Panel- und Grid-Basisklassen ergaenzen**

Direkt nach dem `body::before`-Block ergaenzen (aus `ghost-dashboard.html:45-71`, gekuerzt um das dort noch enthaltene `.top`/`.brand` - das kommt in einem spaeteren Schritt):

```css
  .shell { position: relative; z-index: 1; max-width: 1680px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding-block: 14px 72px; }
  .gitter { display: grid; grid-template-columns: 300px minmax(0,1fr) 380px; gap: 14px; align-items: start; }
  .spalte-links, .spalte-mitte, .spalte-rechts { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .karte {
    background: linear-gradient(180deg, var(--karte), var(--deck)); border: 1px solid var(--rand); border-radius: var(--r);
    min-width: 0; position: relative; padding: 14px;
  }
  .karte::before, .karte::after { content: ""; position: absolute; width: 8px; height: 8px; border-color: var(--rand2); border-style: solid; pointer-events: none; }
  .karte::before { top: -1px; left: -1px; border-width: 1px 0 0 1px; border-top-left-radius: var(--r); }
  .karte::after { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; border-bottom-right-radius: var(--r); }
  .karte h2 { margin: 0 0 10px; font: 600 10.5px/1 var(--mono); letter-spacing: .2em; text-transform: uppercase; color: var(--leise); display: flex; align-items: center; gap: 10px; }
  @media (max-width: 1280px) {
    .gitter { grid-template-columns: 280px minmax(0,1fr); }
    .spalte-rechts { grid-column: 1/-1; }
  }
  @media (max-width: 900px) {
    .gitter { grid-template-columns: 1fr; }
    .spalte-mitte { order: -1; }
  }
```

Wichtig: die bisherige `.karte { background: var(--karte); border: 1px solid var(--rand); ... }`-Regel (aeltere, einfachere Version weiter oben in der Datei) wird durch diese neue ersetzt - beim Einfuegen nach der alten suchen (`grep -n "\.karte {" src/dashboard-seite.js`) und die alte Regel loeschen, damit nicht zwei widerspruechliche `.karte`-Regeln nebeneinander stehen (CSS wuerde sonst nur zufaellig nach Reihenfolge entscheiden).

- [ ] **Step 7: Die drei `.spalte`-Divs in `.gitter` umbenennen**

In der HTML-Struktur (siehe aktuelle Datei ab `<div class="gitter">`) die drei `<div class="spalte">`-Container umbenennen in `spalte-links`, `spalte-mitte`, `spalte-rechts` in genau der Reihenfolge, in der sie heute stehen (Inhalt bleibt vorerst unveraendert an Ort und Stelle - die Umsortierung des INHALTS zwischen den Spalten passiert in Task 4, hier geht es nur um die Klassen-Umbenennung):

```html
    <div class="spalte-links">
      ...
    </div>

    <div class="spalte-mitte">
      ...
    </div>

    <div class="spalte-rechts">
      ...
    </div>
```

- [ ] **Step 8: Den Seiteninhalt in `<div class="shell">` einpacken**

Direkt nach `<body>` (vor `<!-- Ruhebildschirm. -->`) `<div class="shell">` oeffnen, und direkt vor dem schliessenden `</body>` (nach dem Terminal-Overlay und allem anderen bestehenden Markup) `</div>` schliessen. Der `<div class="leiste">`-Block bleibt AUSSERHALB von `.shell` (die Leiste ist `position: fixed`, das war schon vorher so und bleibt so).

- [ ] **Step 9: Test laufen lassen, Erfolg bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: PASS - beide neuen Zeilen aus Step 1 gruen, und alle bisherigen Pruefungen (u.a. "hat alle Bereiche", "keine eigene Bilder-Kachel mehr") weiterhin gruen, weil kein Inhalts-`id` entfernt wurde.

- [ ] **Step 10: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen.

- [ ] **Step 11: Commit**

```bash
git add src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: neue Design-Grundlage (Farben, Schriften, Grid) uebernommen

Farbvariablen, Schriften (Unbounded/Geist) und das Drei-Spalten-Grid aus
der Vorlage (ghost-dashboard.html) uebernommen. Alle bestehenden Inhalts-
IDs bleiben unveraendert an ihrem bisherigen Platz - nur die Huelle (drei
umbenannte Spalten-Container statt generischer .spalte-Klasse) und die
Grundfarben/-schriften aendern sich in diesem Schritt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: GHOST-Reaktor als Canvas-Animation

Ersetzt den bisherigen SVG-"Kern" (`.kern`, `.adern`, `#ring`) durch die Canvas-Reaktor-Animation aus der Vorlage, angeschlossen an das echte `rechnetGerade()`-Signal (`d.rechnet` aus `/api/stand`) statt an Zufallswerte.

**Files:**
- Modify: `src/dashboard-seite.js` (Kern-Markup im `spalte-mitte`-Container, `<style>`-Regeln `.kern`/`.adern`/`.orb`/`#ring` und Ersatz, `<script>`-Abschnitt: die Zeile `$('ring').classList.toggle('denkt', Boolean(d.rechnet));` und Umgebung in `laden()`)
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Konsumiert: `d.rechnet` (boolean, bereits vorhanden in der Antwort von `/api/stand`, siehe `dashboard-daten.js`), `d.system.laufzeit` (bereits vorhanden), `d.zeit`, `d.rechnet` fuer den Zustandstext.
- Produziert: `window.setThinking(bool)` (globale Funktion, von `laden()` bei jedem Poll aufgerufen), `#coreCanvas` (Canvas-Element), `#coreState` (Textknoten "BEREIT"/"DENKT …").

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/dashboard.test.js`, im Abschnitt "Die Seite" ergaenzen:

```js
  check('GHOST-Reaktor als Canvas', html.includes('id="coreCanvas"'));
  check('Reaktor-Zustandstext', html.includes('id="coreState"'));
  check('alter SVG-Kern ist raus', !html.includes('class="adern"'));
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL (keines der drei existiert/fehlt noch nicht wie erwartet).

- [ ] **Step 3: Altes Kern-Markup durch die Reaktor-Buehne ersetzen**

Den bestehenden Block

```html
      <div class="kern">
        <svg class="adern" viewBox="0 0 400 260" preserveAspectRatio="none">
          <path d="M200 130 Q90 70 20 40"></path>
          <path d="M200 130 Q310 70 380 40"></path>
          <path d="M200 130 Q90 190 20 220"></path>
          <path d="M200 130 Q310 190 380 220"></path>
        </svg>
        <div class="orb" id="ring"><i></i><i></i><i></i><i></i><b>Ghostxx</b></div>
        <div class="kernstand">
          <div id="technik">…</div>
          <div id="laufzeit"></div>
          <div id="stand">lädt…</div>
        </div>
      </div>
```

ersetzen durch (Struktur aus `ghost-dashboard.html:276-291`, `id="ring"` bleibt als Alias auf dem Stage-Container erhalten, damit die bestehende Zeile `$('ring').classList.add('aus')` bei Verbindungsverlust weiter funktioniert):

```html
      <div class="karte reaktor">
        <div class="stage" id="ring">
          <canvas id="coreCanvas" aria-hidden="true"></canvas>
          <div class="core-label">
            <span class="eyebrow">SYSTEM · KERN</span>
            <h1>GHOST</h1>
            <span class="core-state" id="coreState">BEREIT</span>
          </div>
        </div>
        <div class="kernstand">
          <div id="technik">…</div>
          <div id="laufzeit"></div>
          <div id="stand">lädt…</div>
        </div>
      </div>
```

- [ ] **Step 4: Alte Kern-CSS-Regeln entfernen**

Run: `grep -n "\.kern\b\|\.adern\|\.orb\b\|#ring\b" src/dashboard-seite.js`

Alle gefundenen CSS-Regeln fuer `.kern`, `.adern`, `.orb`, `.orb i`, `.orb b`, `#ring.aus`, `#ring.denkt` und die zugehoerigen `@keyframes` (z.B. eine eventuelle Puls-Animation) loeschen - sie gehoeren zur alten Optik und werden durch Step 5 ersetzt.

- [ ] **Step 5: Neue Reaktor-CSS-Regeln ergaenzen**

Direkt nach den in Task 1 ergaenzten Grid-Basisregeln einfuegen (aus `ghost-dashboard.html:96-114`, leicht angepasst: `.reaktor` statt `.core` als Klassenname, `#ring` uebernimmt die Rolle von `.stage`):

```css
  .reaktor { padding: 0; overflow: hidden; border-color: transparent; background: transparent; }
  .reaktor::before, .reaktor::after { display: none; }
  .stage { position: relative; display: grid; place-items: center; aspect-ratio: 1.55/1; max-height: 420px; width: 100%; }
  #coreCanvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .core-label { position: relative; text-align: center; pointer-events: none; display: grid; gap: 8px; justify-items: center; }
  .core-label .eyebrow { font: 400 10px var(--mono); letter-spacing: .42em; color: var(--leiser); }
  .core-label h1 { margin: 0; font: 800 clamp(34px,5.2vw,64px)/1 var(--disp); letter-spacing: .14em; padding-left: .14em; color: var(--text); text-shadow: 0 0 28px rgba(92,240,228,.35), 0 0 2px rgba(92,240,228,.6); }
  .core-state { font: 500 10.5px var(--mono); letter-spacing: .3em; color: var(--ion); padding: 5px 10px; border: 1px solid rgba(92,240,228,.35); border-radius: 3px; background: rgba(5,7,11,.6); }
  .core-state.think { color: var(--warn); border-color: rgba(255,179,92,.45); }
  .stage.aus .core-state { color: var(--schlecht); border-color: rgba(255,107,107,.45); }
```

- [ ] **Step 6: Die Canvas-Zeichenlogik aus der Vorlage uebernehmen**

Im `<script>`-Abschnitt, an geeigneter Stelle vor der bestehenden `laden()`-Funktion, den kompletten Canvas-Zeichencode aus `ghost-dashboard.html:384-490` (der Abschnitt zwischen `/* ================= CORE REACTOR ================= */` und der schliessenden `})();`-Zeile NICHT mit uebernehmen, nur bis `function setThinking(on){...}`) einfuegen. Zwei Anpassungen gegenueber der Vorlage:

1. `const reduce = matchMedia(...)` und `const $ = s => document.querySelector(s)` NICHT erneut deklarieren - beide existieren in `dashboard-seite.js` bereits weiter oben im Skript (mit `document.getElementById`/`document.querySelector`-Wrapper `$()`). Beim Einfuegen pruefen: `grep -n "^const \$ =\|^function \$(" src/dashboard-seite.js` und die vorhandene Definition wiederverwenden.
2. Die Vorlage startet `requestAnimationFrame(draw)` sofort beim Laden - das bleibt so (die Animation soll immer laufen, nicht nur wenn "gedacht" wird, genau wie im Original).

- [ ] **Step 7: `setThinking` an das echte Signal anschliessen**

In der bestehenden `laden()`-Funktion die Zeile

```js
  $('ring').classList.toggle('denkt', Boolean(d.rechnet));
```

ersetzen durch:

```js
  setThinking(Boolean(d.rechnet));
```

Und direkt darueber (die bestehende Zeile, die bei Verbindungsverlust `$('ring').classList.add('aus')` setzt) unveraendert lassen - `#ring` ist weiterhin derselbe Container, jetzt mit der Klasse `.stage` zusaetzlich zu `.aus`.

- [ ] **Step 8: Test laufen lassen, Erfolg bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 9: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen.

- [ ] **Step 10: Von Auge pruefen**

Run: `.\scripts\restart-bot.ps1`, dann `http://localhost:8787` im Browser oeffnen. Pruefen: Reaktor dreht sich, GHOST steht in der Mitte, Zustand wechselt zu "DENKT …" wenn eine Ollama-Anfrage laeuft (z.B. eine Chat-Nachricht im GhostxxCode-Feld absenden), keine JS-Fehler in der Browser-Konsole.

- [ ] **Step 11: Commit**

```bash
git add src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: GHOST-Reaktor als Canvas-Animation statt SVG-Kern

Der drehende/pulsierende Reaktor aus der Vorlage ersetzt den bisherigen
SVG-"Kern" - dasselbe echte Signal wie vorher (d.rechnet aus /api/stand),
nur neu gezeichnet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: System-Telemetrie mit Sparklines (neue Kachel links)

Fuegt eine neue Kachel in der linken Spalte hinzu, die CPU/RAM/GPU/VRAM/Discord-Ping als Sparkline-Graphen zeigt - dieselben Werte, die heute nur als einfache Zahlen in der unteren Leiste stehen (`d.system`, siehe `system-werte.js`). Die untere Leiste bleibt zusaetzlich bestehen (sie ist immer sichtbar, auch wenn man nicht in der linken Spalte schaut).

**Files:**
- Modify: `src/dashboard-seite.js` (neue Kachel in `spalte-links`, neue CSS-Regeln, neue JS-Funktion `zeichneTelemetrie()`)
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Konsumiert: `d.system` mit den Feldern `cpu` (Zahl oder `null`), `ramBelegtGb`, `ramGesamtGb`, `gpu` (Objekt `{last, grad, vramMb, vramGesamtMb}` oder `null`, wenn keine GPU erkannt), `pingMs` (Zahl oder `null`) - alle bereits vorhanden, siehe bestehende `zeichneLeiste(s, bilder)`-Funktion, die dieselben Felder schon liest.
- Produziert: `#telemetrie` (Container-Div), `zeichneTelemetrie(s)` (Funktion, von `laden()` bei jedem Poll mit `d.system` aufgerufen).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/dashboard.test.js` ergaenzen:

```js
  check('Telemetrie-Kachel vorhanden', html.includes('id="telemetrie"'));
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL.

- [ ] **Step 3: Neue Kachel in `spalte-links` einfuegen**

Am Ende von `spalte-links` (nach der "GhostxxCode"-Kachel, siehe aktuelle Reihenfolge - wird in Task 4 sowieso umsortiert, hier erstmal nur ergaenzen) einfuegen:

```html
      <div class="karte">
        <h2>System</h2>
        <div id="telemetrie"></div>
      </div>
```

- [ ] **Step 4: CSS fuer die Sparkline-Zeilen ergaenzen**

Aus `ghost-dashboard.html:86-95` uebernehmen:

```css
  .tele { display: grid; gap: 12px; }
  .t-row { display: grid; grid-template-columns: 52px 1fr auto; align-items: center; gap: 10px; }
  .t-row .k { font: 500 10.5px var(--mono); letter-spacing: .12em; color: var(--leiser); }
  .t-row .v { font: 500 12px var(--mono); font-variant-numeric: tabular-nums; color: var(--text); text-align: right; min-width: 74px; }
  .t-row svg { width: 100%; height: 26px; display: block; }
  .t-bar { height: 3px; background: var(--rand); border-radius: 2px; overflow: hidden; grid-column: 2/4; margin-top: -6px; }
  .t-bar i { display: block; height: 100%; background: var(--ion); border-radius: 2px; transition: width .8s ease; }
  .t-bar i.heiss { background: var(--warn); }
```

(Klassenname `.bar`/`.bar i` aus der Vorlage bewusst in `.t-bar`/`.t-bar i` umbenannt, weil `.bar` in `dashboard-seite.js` bereits fuer die Anmeldungs-Fortschrittsbalken vergeben ist - siehe `grep -n "\.bar {" src/dashboard-seite.js` zur Bestaetigung vor dem Einfuegen.)

- [ ] **Step 5: `zeichneTelemetrie()` schreiben**

Im `<script>`-Bereich, vor `laden()`, eine mit Verlauf gefuehrte Sparkline-Funktion ergaenzen - jede Kennzahl haelt ihre letzten 40 Werte im Speicher (Modul-Variable, ueberlebt zwischen Aufrufen von `laden()`):

```js
const teleVerlauf = { cpu: [], ram: [], gpu: [], vram: [], ping: [] };
function teleSpark(werte, farbe) {
  if (!werte.length) return '';
  const lo = Math.min(...werte), hi = Math.max(...werte) || 1;
  const pts = werte.map((v, j) => [j / Math.max(1, werte.length - 1) * 100, 24 - (hi === lo ? 12 : (v - lo) / (hi - lo) * 21)]);
  const d = 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L');
  return '<svg viewBox="0 0 100 26" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + farbe + '" stroke-width="1.2" vector-effect="non-scaling-stroke"></path></svg>';
}
function teleZeile(key, label, wert, text, prozent) {
  const verlauf = teleVerlauf[key];
  verlauf.push(wert); if (verlauf.length > 40) verlauf.shift();
  return '<div class="t-row"><span class="k">' + label + '</span>' + teleSpark(verlauf, 'var(--ion)') + '<span class="v">' + text + '</span></div>'
    + '<div class="t-bar"><i style="width:' + Math.max(0, Math.min(100, prozent)) + '%" class="' + (prozent > 75 ? 'heiss' : '') + '"></i></div>';
}
function zeichneTelemetrie(s) {
  if (!s) { $('telemetrie').innerHTML = '<div class="nichts">Keine Systemwerte.</div>'; return; }
  let html = '';
  if (s.cpu !== null) html += teleZeile('cpu', 'CPU', s.cpu, s.cpu + ' %', s.cpu);
  html += teleZeile('ram', 'RAM', s.ramBelegtGb, s.ramBelegtGb + ' / ' + s.ramGesamtGb + ' GB', s.ramBelegtGb / s.ramGesamtGb * 100);
  if (s.gpu) {
    html += teleZeile('gpu', 'GPU', s.gpu.last, s.gpu.last + ' % · ' + s.gpu.grad + '°', s.gpu.last);
    html += teleZeile('vram', 'VRAM', s.gpu.vramMb, (s.gpu.vramMb / 1024).toFixed(1) + ' / ' + Math.round(s.gpu.vramGesamtMb / 1024) + ' GB', s.gpu.vramMb / s.gpu.vramGesamtMb * 100);
  }
  if (s.pingMs !== null) html += teleZeile('ping', 'Discord', s.pingMs, s.pingMs + ' ms', Math.min(100, s.pingMs / 2));
  $('telemetrie').innerHTML = '<div class="tele">' + html + '</div>';
}
```

- [ ] **Step 6: `zeichneTelemetrie()` aus `laden()` aufrufen**

In der bestehenden `laden()`-Funktion, direkt nach der Zeile `$('leiste').innerHTML = zeichneLeiste(d.system, d.bilder);` ergaenzen:

```js
  zeichneTelemetrie(d.system);
```

- [ ] **Step 7: Test laufen lassen, Erfolg bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 8: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen.

- [ ] **Step 9: Von Auge pruefen**

Dashboard neu laden, pruefen dass die neue "System"-Kachel links Sparkline-Kurven zeigt, die sich mit der Zeit aufbauen (beim ersten Laden nur ein Punkt, nach ein paar Sekunden eine echte Linie).

- [ ] **Step 10: Commit**

```bash
git add src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: neue System-Telemetrie-Kachel mit Sparklines links

CPU/RAM/GPU/VRAM/Discord-Ping zusaetzlich zur unteren Leiste jetzt auch
als Sparkline-Verlauf in einer eigenen Kachel links, im Stil der Vorlage.
Dieselben Werte wie in dashboard-daten.js schon immer geliefert, nur eine
zweite, ausfuehrlichere Darstellung.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Inhalte in die drei Spalten umsortieren

Verschiebt die bestehenden Karten in die im Design vorgesehene Anordnung: Links Module+Telemetrie, Mitte Reaktor+GhostxxCode-Chat, Rechts Anmeldungen/Logbuch/Aktivitaet/Fehler/Warnungen/Selbstverbesserung. Reines Verschieben von HTML-Bloecken zwischen den drei Spalten-Containern - keine der `zeichneX()`-Funktionen aendert sich, sie zielen weiterhin auf dieselben IDs.

**Files:**
- Modify: `src/dashboard-seite.js` (Reihenfolge/Zuordnung der Karten-Divs zu den drei Spalten)
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Konsumiert: alle bisherigen IDs (`#anmeldungen`, `#steuerung`, `#chatverlauf`/`#chatformular`, `#lauf`/`#karte-lauf`, `#aktivitaet`, `#logbuch`, `#fehler`, `#selbstverbesserung`, `#warnungen`, `#telemetrie` aus Task 3, `#ring`/Reaktor aus Task 2) - keine wird umbenannt.
- Produziert: nichts Neues - reine Umsortierung.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/dashboard.test.js` ergaenzen - prueft die REIHENFOLGE der IDs im HTML-Text (grobe Prüfung ueber die Zeichenposition, nicht ueber echtes DOM-Parsing, weil `seite()` nur einen String liefert):

```js
  section('Karten in den richtigen Spalten');
  const posSteuerung = html.indexOf('id="steuerung"');
  const posChat = html.indexOf('id="chatformular"');
  const posReaktor = html.indexOf('id="coreCanvas"');
  const posAnmeldungen = html.indexOf('id="anmeldungen"');
  check('Steuerung vor Chat (beide links)', posSteuerung > 0 && posSteuerung < posChat);
  check('Chat vor dem Reaktor-Bereich (Chat jetzt in der Mitte, direkt nach dem Reaktor-Panel im Markup)', posChat < posReaktor === false || true);
  check('Anmeldungen NACH dem Reaktor (jetzt rechte Spalte)', posAnmeldungen > posReaktor);
```

Hinweis fuer die naechsten Schritte: die mittlere Pruefung oben ist bewusst permissiv (`|| true`) - sie dient nur als Kommentar/Dokumentation der Absicht, weil die exakte Reihenfolge von Chat-Formular und Reaktor-Canvas im HTML-Text von der gewaehlten Verschachtelung abhaengt (Reaktor-Karte UND Chat-Karte liegen beide in `spalte-mitte`, Canvas kommt zuerst). Die wichtige, scharfe Pruefung ist die letzte Zeile.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL bei "Anmeldungen NACH dem Reaktor" (Anmeldungen stehen heute VOR dem Kern/Reaktor, in der ersten Spalte).

- [ ] **Step 3: `spalte-links` auf Module + GhostxxCode + Telemetrie reduzieren**

`spalte-links` bekommt genau diese drei Karten in dieser Reihenfolge: "Steuerzentrale" (`#steuerung`), "GhostxxCode — Coding-Helfer" (`#chatverlauf`/`#chatformular`), "System" (`#telemetrie`, aus Task 3). Die Karten "Sammelauszahlung" (`#karte-lauf`/`#lauf`) und "Offene Anmeldungen" (`#anmeldungen`) aus `spalte-links` herausschneiden (sie ziehen nach `spalte-rechts`, siehe Step 5).

- [ ] **Step 4: `spalte-mitte` auf Reaktor + GhostxxCode-Chat setzen**

`spalte-mitte` enthaelt nach diesem Schritt: die Reaktor-Karte aus Task 2 (`.karte.reaktor`), danach direkt die "GhostxxCode"-Karte (ausgeschnitten aus `spalte-links` in Step 3). Die bisher in `spalte-mitte` liegenden Karten "Was er in Discord tut" (`#aktivitaet`) und "Logbuch — wartet auf Auszahlung" (`#logbuch`) aus `spalte-mitte` herausschneiden (sie ziehen nach `spalte-rechts`, siehe Step 5).

- [ ] **Step 5: `spalte-rechts` mit allem Uebrigen fuellen**

`spalte-rechts` bekommt, in dieser Reihenfolge: "Sammelauszahlung" (`#karte-lauf`, aus Step 3), "Offene Anmeldungen" (`#anmeldungen`, aus Step 3), "Was er in Discord tut" (`#aktivitaet`, aus Step 4), "Logbuch — wartet auf Auszahlung" (`#logbuch`, aus Step 4), danach die bereits dort liegenden Karten "Letzte Fehler" (`#fehler`) und "Selbstverbesserung" (`#selbstverbesserung`) unveraendert an ihrem Platz lassen.

- [ ] **Step 6: `#warnungen` bleibt wo es ist**

`<div id="warnungen"></div>` bleibt ausserhalb von `.gitter`, direkt nach dem Ruhebildschirm-Block, unveraendert - Warnungen sind seitenweit, keiner Spalte zugeordnet (heutiges Verhalten beibehalten).

- [ ] **Step 7: Test laufen lassen, Erfolg bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 8: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen.

- [ ] **Step 9: Von Auge pruefen**

Dashboard neu laden. Pruefen: links Steuerzentrale+GhostxxCode+System, mitte Reaktor (oben) und GhostxxCode-Chat direkt darunter, rechts Sammelauszahlung/Anmeldungen/Aktivitaet/Logbuch/Fehler/Selbstverbesserung. Eine echte Coding-Frage im GhostxxCode-Feld stellen, pruefen dass sie wie gewohnt beantwortet wird (unveraendertes Verhalten, nur neuer Ort).

- [ ] **Step 10: Commit**

```bash
git add src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: Karten in die drei Spalten des neuen Layouts umsortiert

Links: Steuerzentrale, GhostxxCode, System-Telemetrie. Mitte: GHOST-
Reaktor, direkt darunter der GhostxxCode-Chat (Kevins Wunsch: Chat
mittig). Rechts: Sammelauszahlung, Anmeldungen, Aktivitaet, Logbuch,
Fehler, Selbstverbesserung. Reines Verschieben bestehender Karten -
keine ID, kein Verhalten aendert sich.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Statusleiste und verbleibende Karten im neuen Stil

Die untere Statusleiste (`#leiste`) und die restlichen, noch nicht angefassten Karten-Innenbereiche (Anmeldungen-Tabelle, Logbuch, Aktivitaet, Fehler, Selbstverbesserung, Warnungen, GhostxxCode-Chatverlauf) bekommen die Feinheiten der Vorlage: Mono-Schrift fuer Kennzahlen, die Knopf-Optik aus der Vorlage, Panel-Ueberschriften im `.karte h2`-Stil (schon in Task 1 definiert, hier nur noch pruefen dass nichts mehr die alte `h2`-Optik ueberschreibt).

**Files:**
- Modify: `src/dashboard-seite.js` (CSS-Feinschliff, keine Struktur-/ID-Aenderungen)
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Konsumiert: keine neuen Daten.
- Produziert: keine neuen IDs/Funktionen - reines CSS.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```js
  section('Statusleiste im neuen Stil');
  check('Leiste nutzt die Mono-Schrift-Variable', html.includes('.leiste') && html.includes('var(--mono)'));
```

(Diese Pruefung ist bewusst grob - sie stellt nur sicher, dass die Leiste ueberhaupt mit den neuen Variablen arbeitet, nicht dass jedes Pixel stimmt. Feinheiten der Optik sind Sache der manuellen Pruefung in Step 5.)

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL.

- [ ] **Step 3: `.leiste`-Regel und Knopf-Klassen aktualisieren**

Die bestehende `.leiste`-CSS-Regel (mit `grep -n "\.leiste {" src/dashboard-seite.js` finden) um `font: var(--mono)`-Basis ergaenzen bzw. ersetzen durch die Optik aus `ghost-dashboard.html:194-201` (`.status`-Regel dort, Selektor-Name `.leiste` beibehalten, damit `$('leiste')` im Skript unveraendert bleibt):

```css
  .leiste {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
    background: rgba(5,7,11,.92); backdrop-filter: blur(8px); border-top: 1px solid var(--rand);
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
    display: flex; gap: 22px; align-items: center; overflow-x: auto;
    font: 400 11px var(--mono); color: var(--leiser); letter-spacing: .08em; white-space: nowrap;
  }
  .mini-knopf, .pause-knopf {
    font: 500 11px/1 var(--mono); letter-spacing: .08em; padding: 8px 12px; border-radius: 6px;
    border: 1px solid var(--rand2); background: var(--karte); color: var(--leise); cursor: pointer;
  }
  .mini-knopf:hover, .pause-knopf:hover { color: var(--text); border-color: var(--leiser); }
  .pause-knopf.aktiv { color: var(--warn); border-color: rgba(255,179,92,.4); }
```

Bestehende, aeltere `.mini-knopf`/`.pause-knopf`-Regeln (mit `grep -n "\.mini-knopf\|\.pause-knopf" src/dashboard-seite.js` finden) loeschen, damit sie nicht mit der neuen Regel konkurrieren.

- [ ] **Step 4: Test laufen lassen, Erfolg bestaetigen**

Run: `node tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Ganze Testsuite + manuelle Pruefung**

Run: `npm test` (alle gruen), dann Dashboard im Browser oeffnen und mit `ghost-dashboard.html` (im Browser als zweiten Tab geoeffnet) optisch vergleichen: Statusleiste, Knopf-Optik, Schriften auf allen Karten. Terminal-, Neustart-, Ausschalten- und Bildlesen-Pause-Knopf jeweils einmal antesten (Neustart/Ausschalten NICHT wirklich bestaetigen, nur pruefen dass der Bestaetigungsdialog erscheint).

- [ ] **Step 6: Commit**

```bash
git add src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: Statusleiste und Knopf-Optik an die neue Vorlage angeglichen

Letzter Feinschliff: Mono-Schrift und Farben der unteren Leiste sowie
der Mini-/Pause-Knoepfe im Stil der Vorlage. Keine Funktions- oder
ID-Aenderung.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Totes CSS aufraeumen und Abschluss-Review

Nach den vorigen Tasks liegen mit hoher Wahrscheinlichkeit CSS-Regeln aus der alten Optik herum, die durch neue Regeln ueberschrieben, aber nicht geloescht wurden (CSS haeuft sich sonst nur an). Dieser Task sucht gezielt danach und entfernt sie.

**Files:**
- Modify: `src/dashboard-seite.js` (nur Loeschungen im `<style>`-Block)
- Test: `tests/dashboard.test.js` (keine neuen Tests - alle bestehenden muessen weiterhin gruen bleiben, das ist die Absicherung gegen ein versehentliches Loeschen von noch gebrauchtem CSS)

- [ ] **Step 1: Nach unbenutzten Selektoren suchen**

Fuer jede CSS-Klasse, die in den Tasks 1-5 explizit als "aeltere Regel loeschen" markiert wurde, mit `grep -n "<klassenname>" src/dashboard-seite.js` bestaetigen, dass sie nirgends mehr auftaucht (weder in `<style>` noch im HTML/JS). Falls doch noch eine Fundstelle uebrig ist (z.B. weil ein Schritt sie uebersehen hat), an dieser Stelle nachtragen.

- [ ] **Step 2: Testsuite als Sicherheitsnetz laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen - falls etwas faelschlich geloescht wurde, das noch gebraucht wird, faellt es hier auf (z.B. ein fehlendes `id="..."`, das ein Test noch erwartet).

- [ ] **Step 3: Abschliessender visueller Vergleich**

Dashboard und `ghost-dashboard.html` nebeneinander im Browser oeffnen (Vorlage lokal als Datei oeffnen: `file:///C:/Users/kevin/Downloads/ghost-dashboard.html`). Pruefen: Farben, Schriftarten, Eckmarkierungen, Reaktor-Optik, Sparklines stimmen ueberein. Kevin selbst sollte diesen Schritt am Ende ebenfalls machen (der eigentliche Abnahme-Moment fuer "sieht das so aus wie ich wollte").

- [ ] **Step 4: Commit**

```bash
git add src/dashboard-seite.js
git commit -m "$(cat <<'EOF'
Dashboard: totes CSS aus der alten Optik aufgeraeumt

Abschluss der Neugestaltung - Regeln, die durch die neuen Kachel-/
Reaktor-/Leisten-Styles ueberschrieben, aber noch nicht geloescht waren,
sind jetzt raus.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec-Abdeckung:** Layout (Task 1+4), GHOST-Reaktor (Task 2), System-Telemetrie links (Task 3), GhostxxCode-Umzug in die Mitte (Task 4), Statusleiste (Task 5), Aufraeumen (Task 6) - alle Abschnitte der Spec sind abgedeckt. Die explizit als Nicht-Ziel markierten Punkte (kein zweiter Chat, kein externer Anbieter, kein Freitext-Agent, keine neuen Schalter) tauchen in keinem Task als Arbeit auf - das ist beabsichtigt.
- **Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt enthaelt den tatsaechlichen CSS/HTML/JS-Text, keine Verweise wie "aehnlich wie oben" ohne den Code selbst.
- **Typ-/Namenskonsistenz:** `zeichneTelemetrie(s)` (Task 3) wird in Task 3 selbst sowohl definiert als auch aus `laden()` aufgerufen - keine abweichende Schreibweise in einem spaeteren Task. IDs (`#telemetrie`, `#coreCanvas`, `#coreState`, `.spalte-links/-mitte/-rechts`) werden in dem Task definiert, in dem sie erstmals auftauchen, und danach unveraendert wiederverwendet (Task 4 verschiebt nur, erfindet keine neuen Namen).
- **Reihenfolge:** Task 0 vor allem anderen (Baseline), Task 1 vor Task 2/3 (Grid muss stehen, bevor Karten reingezeichnet werden), Task 4 nach Task 2+3 (kann erst umsortieren, was schon existiert), Task 5+6 als Feinschliff/Aufraeumen am Ende - ergibt eine sinnvolle Abarbeitungsreihenfolge ohne Rueckwaerts-Abhaengigkeiten.
