# Stoppt den Bot vollstaendig.
#
# Wichtig: es reicht nicht, den node-Prozess zu beenden. run-bot.ps1 laeuft als
# Watchdog daneben und wuerde den Bot nach ein paar Sekunden neu starten.
# Deshalb wird zuerst der Watchdog beendet, danach der Bot selbst.

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

. (Join-Path $scriptDir 'lib-bot-process.ps1')

Write-Host "Suche laufende Bot-Prozesse..."

$stopped = 0

# 1. Zuerst der Watchdog - sonst startet er den Bot sofort wieder
foreach ($w in @(Get-BotWatchdog)) {
    Write-Host "  Watchdog beenden (PID $($w.ProcessId))"
    Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
}

# 2. Dann der Bot und die npm-Zwischenschicht
foreach ($p in @(Get-BotProcess -RootDir $rootDir)) {
    Write-Host "  $($p.Name) beenden (PID $($p.ProcessId))"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
}

Start-Sleep -Seconds 2

$rest = @(Get-BotNodeProcess -RootDir $rootDir)

Write-Host ""
if ($rest.Count -gt 0) {
    Write-Host "ACHTUNG: Es laufen noch Prozesse:" -ForegroundColor Yellow
    $rest | ForEach-Object { Write-Host "  PID $($_.ProcessId) - $($_.CommandLine)" }
} elseif ($stopped -eq 0) {
    Write-Host "Der Bot lief nicht." -ForegroundColor Yellow
} else {
    Write-Host "Bot gestoppt. ($stopped Prozess(e) beendet)" -ForegroundColor Green
}
