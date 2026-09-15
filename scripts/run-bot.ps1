$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$logDir = Join-Path $rootDir 'logs'
$logFile = Join-Path $logDir 'bot.log'
$dataDir = Join-Path $rootDir 'data'
$ausDatei = Join-Path $dataDir 'bot-aus.json'
$dashboardPort = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { 8787 }
$npm = 'C:\Program Files\nodejs\npm.cmd'

if (-not (Test-Path $npm)) {
    $npm = 'npm.cmd'
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $rootDir

# Ollama steht nicht im Windows-Autostart. Ohne diesen Anstoss ist der Chat
# nach jedem Neustart des Rechners tot, bis jemand es von Hand startet -
# genau das ist einmal passiert und niemand hat es gemerkt.
function Start-OllamaWennNoetig {
    try {
        $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3 -UseBasicParsing
        return $true
    } catch {
        # laeuft nicht - weiter unten starten
    }

    $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
    if (-not (Test-Path $ollama)) {
        Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Ollama nicht gefunden unter $ollama - Chat bleibt aus."
        return $false
    }

    Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Ollama laeuft nicht, starte es..."
    Start-Process -FilePath $ollama -ArgumentList '--hide', '--fast-startup' -WindowStyle Hidden

    # Der Server braucht einen Moment, bis er Anfragen annimmt.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 -UseBasicParsing
            Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Ollama ist oben."
            return $true
        } catch { }
    }

    Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Ollama antwortet nicht - Chat bleibt aus, alles andere laeuft."
    return $false
}

# Das Dashboard-Fenster (GhostXX.exe) einmal starten - UNABHAENGIG vom Bot
# selbst, deshalb hier oben vor der Neustart-Schleife und nicht darin.
#
# Stuerzt der Bot ab und der Watchdog startet ihn weiter unten neu, bleibt
# dieses Fenster einfach stehen und laedt die Seite automatisch neu, sobald
# das Dashboard wieder antwortet - das regelt die exe selbst. Wuerde der
# Start hier IN der Schleife stehen, poppte bei jedem Absturz ein neues
# Fenster auf.
#
# Existiert die exe nicht (noch nicht gebaut, oder jemand hat sie geloescht),
# laeuft der Bot trotzdem ganz normal weiter - das Fenster ist reine Zugabe.
$desktopApp = Join-Path $rootDir 'desktop-app\dist\GhostXX.exe'
if (Test-Path $desktopApp) {
    $schonOffen = Get-Process -Name 'GhostXX' -ErrorAction SilentlyContinue
    if (-not $schonOffen) {
        Start-Process -FilePath $desktopApp
        Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Dashboard-Fenster gestartet."
    }
} else {
    Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Dashboard-Fenster nicht gefunden unter $desktopApp - wird uebersprungen."
}

# Kevins Wunsch (30.08.): ein Aus-Knopf im Dashboard, der den Bot wirklich
# stilllegt - nicht nur den node-Prozess beenden, das wuerde dieser Watchdog
# ja sofort wieder neu starten, und beim naechsten Rechnerneustart kaeme der
# Windows-Autostart obendrauf. Die Datei data/bot-aus.json ist die einzige
# Bruecke: das Dashboard (Node, siehe /api/aus in dashboard.js) schreibt sie
# vor dem Beenden, dieser Watchdog liest sie VOR jedem Start.
#
# Steht "aus:true" drin, startet kein Ollama und kein Bot - stattdessen haelt
# diese Funktion selbst kurz eine winzige Seite auf demselben Port offen, an
# genau der Stelle, wo sonst das Dashboard waere. Ein Klick auf "Einschalten"
# schaltet die Datei zurueck und laesst die Schleife unten normal weiterlaufen.
#
# Diese eine Pruefung deckt automatisch auch den Windows-Autostart ab: der
# startet ja nichts anderes als dieses Skript hier (siehe install-autostart.ps1).
function Warte-BisEingeschaltet {
    if (-not (Test-Path $ausDatei)) { return }

    try {
        $stand = Get-Content $ausDatei -Raw | ConvertFrom-Json
    } catch {
        return
    }
    if (-not $stand.aus) { return }

    Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Bot ist ausgeschaltet (seit $($stand.seit)) - warte auf Einschalten..."

    $seitText = [System.Net.WebUtility]::HtmlEncode([string]$stand.seit)
    $seite = @"
<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Ghostxx - aus</title>
<style>
body{background:#060d18;color:#dceaf5;font:16px/1.5 "Segoe UI",system-ui,sans-serif;
display:grid;place-items:center;min-height:100vh;margin:0}
.box{text-align:center;max-width:420px;padding:32px}
h1{color:#ff5f6d;font-weight:600;margin:0 0 8px}
p{color:#6f93ad;margin:0 0 24px}
button{background:rgba(53,224,138,.12);border:1px solid #35e08a;color:#35e08a;
border-radius:8px;padding:10px 22px;font:inherit;font-weight:700;cursor:pointer}
button:hover{background:rgba(53,224,138,.24)}
button:disabled{opacity:.5;cursor:default}
</style></head><body><div class="box">
<h1>Ghostxx ist ausgeschaltet</h1>
<p>Ausgeschaltet seit $seitText.<br>Watchdog und Windows-Autostart sind ausgesetzt.</p>
<button id="an">Einschalten</button>
</div>
<script>
document.getElementById('an').addEventListener('click', async () => {
  const b = document.getElementById('an');
  b.disabled = true; b.textContent = 'schaltet ein...';
  await fetch('/an', { method: 'POST' }).catch(() => {});
  document.querySelector('p').textContent = 'Startet - diese Seite gleich neu laden.';
  setTimeout(() => location.reload(), 4000);
});
</script></body></html>
"@

    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$dashboardPort/")
    try {
        $listener.Start()
    } catch {
        # Port belegt oder keine Rechte - dann eben ohne Seite warten und alle
        # paar Sekunden erneut nachsehen, statt die Schleife zu blockieren.
        Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Aus-Seite konnte nicht starten ($($_.Exception.Message)) - warte ohne Seite."
        while ($true) {
            Start-Sleep -Seconds 5
            try { $stand = Get-Content $ausDatei -Raw | ConvertFrom-Json } catch { continue }
            if (-not $stand.aus) { return }
        }
    }

    try {
        while ($true) {
            $context = $listener.GetContext()
            $req = $context.Request
            $res = $context.Response

            if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/an') {
                $daten = @{ aus = $false } | ConvertTo-Json
                Set-Content -Path $ausDatei -Value $daten -Encoding UTF8
                $antwort = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
                $res.ContentType = 'application/json'
                $res.OutputStream.Write($antwort, 0, $antwort.Length)
                $res.OutputStream.Flush()
                # Kurz warten, bevor der Listener schliesst - sonst kommt die
                # Antwort beim Browser manchmal als abgebrochene Verbindung an
                # statt als "ok" (gemessen beim Testen dieser Funktion).
                Start-Sleep -Milliseconds 200
                $res.Close()
                Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Wieder eingeschaltet."
                break
            }

            $bytes = [System.Text.Encoding]::UTF8.GetBytes($seite)
            $res.ContentType = 'text/html; charset=utf-8'
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.Close()
        }
    } finally {
        $listener.Stop()
        $listener.Close()
    }
}

# Sofortige Abstuerze (Konfigurationsfehler, fehlende Intents) wuerden sonst
# alle 10 Sekunden endlos neu starten. Bei kurzer Laufzeit wird die Wartezeit
# schrittweise erhoeht, damit das Problem im Log sichtbar wird statt unterzugehen.
$minDelay = 10
$maxDelay = 300
$delay = $minDelay

while ($true) {
    # Steht der Bot auf Aus, hier anhalten (mit eigener Seite) und erst
    # weitermachen, wenn jemand ihn wieder eingeschaltet hat.
    Warte-BisEingeschaltet

    $startedAt = Get-Date
    $startedLabel = $startedAt.ToString('yyyy-MM-dd HH:mm:ss')

    # Vor jedem Botstart pruefen - faengt sowohl den Rechnerneustart ab als
    # auch den Fall, dass Ollama zwischendurch beendet wurde.
    $null = Start-OllamaWennNoetig

    Add-Content -Path $logFile -Value "[$startedLabel] Starte GhostxxEventBot..."

    & $npm start 2>&1 | Tee-Object -FilePath $logFile -Append

    $exitCode = $LASTEXITCODE
    $runSeconds = [int]((Get-Date) - $startedAt).TotalSeconds

    if ($runSeconds -ge 60) {
        $delay = $minDelay
    } else {
        $delay = [Math]::Min($delay * 2, $maxDelay)
    }

    $stoppedLabel = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $logFile -Value "[$stoppedLabel] Bot beendet nach ${runSeconds}s. ExitCode=$exitCode. Neustart in ${delay}s."

    if ($delay -ge $maxDelay) {
        Add-Content -Path $logFile -Value "[$stoppedLabel] WARNUNG: Der Bot stuerzt sofort nach dem Start ab. Bitte die Fehlermeldung weiter oben im Log pruefen."
    }

    Start-Sleep -Seconds $delay
}

