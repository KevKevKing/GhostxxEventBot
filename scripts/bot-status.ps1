# Zeigt, ob der Bot laeuft, seit wann, und die letzten Logzeilen.

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$logFile = Join-Path $rootDir 'logs\bot.log'

. (Join-Path $scriptDir 'lib-bot-process.ps1')

$nodes = @(Get-BotNodeProcess -RootDir $rootDir)
$watchdogs = @(Get-BotWatchdog)
$ausDatei = Join-Path $rootDir 'data\bot-aus.json'
$istAus = $false
if (Test-Path $ausDatei) {
    try { $istAus = [bool](Get-Content $ausDatei -Raw | ConvertFrom-Json).aus } catch { }
}

Write-Host "=== GhostxxEventBot ===" -ForegroundColor Cyan

if ($nodes.Count -eq 0 -and $istAus) {
    Write-Host "  Bot ist ausgeschaltet (Dashboard-Aus-Knopf) - Watchdog und Autostart warten" -ForegroundColor Yellow
    Write-Host "  Wieder an: die Dashboard-Seite oeffnen und einschalten, oder .\scripts\start-bot.ps1"
} elseif ($nodes.Count -gt 0) {
    foreach ($n in $nodes) {
        # Get-CimInstance liefert CreationDate bereits als DateTime.
        $since = $n.CreationDate -as [datetime]
        if ($since) {
            $mins = [int]((Get-Date) - $since).TotalMinutes
            Write-Host "  Bot laeuft (PID $($n.ProcessId), seit $($since.ToString('HH:mm:ss')), $mins Min)" -ForegroundColor Green
        } else {
            Write-Host "  Bot laeuft (PID $($n.ProcessId))" -ForegroundColor Green
        }
    }
    if ($nodes.Count -gt 1) {
        Write-Host "  ACHTUNG: mehr als ein Bot laeuft - das postet alles doppelt!" -ForegroundColor Red
        Write-Host "  Beheben mit: .\scripts\restart-bot.ps1" -ForegroundColor Red
    }
} else {
    Write-Host "  Bot laeuft NICHT" -ForegroundColor Red
}

if ($watchdogs.Count -gt 0) {
    Write-Host "  Watchdog aktiv (PID $($watchdogs.ProcessId -join ', '))" -ForegroundColor Green
} else {
    Write-Host "  Watchdog laeuft nicht - nach einem Absturz startet der Bot nicht von selbst neu" -ForegroundColor Yellow
}

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'GhostxxEventBot.lnk'
if (Test-Path $lnk) {
    Write-Host "  Autostart eingerichtet" -ForegroundColor Green
} else {
    Write-Host "  Autostart FEHLT - install-autostart.ps1 ausfuehren" -ForegroundColor Yellow
}

if (Test-Path $logFile) {
    $size = [math]::Round((Get-Item $logFile).Length / 1MB, 1)
    Write-Host ""
    Write-Host "=== Letzte 15 Logzeilen ($size MB) ===" -ForegroundColor Cyan

    # Tee-Object schreibt UTF-16, Add-Content schreibt ANSI. Null-Bytes
    # rausfiltern, damit die Mischung lesbar bleibt.
    Get-Content $logFile -Tail 15 |
        ForEach-Object { ($_ -replace "`0", '').TrimEnd() } |
        Where-Object { $_ } |
        ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host ""
    Write-Host "  Noch kein Log vorhanden." -ForegroundColor Yellow
}
