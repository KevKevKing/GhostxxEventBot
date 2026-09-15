# Startet den Bot im Hintergrund - genauso, wie es der Autostart beim Login tut.
# Laeuft der Bot schon, passiert nichts (kein zweiter Bot, der doppelt postet).

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$runScript = Join-Path $scriptDir 'run-bot.ps1'

. (Join-Path $scriptDir 'lib-bot-process.ps1')

$running = @(Get-BotNodeProcess -RootDir $rootDir)
if ($running.Count -gt 0) {
    Write-Host "Der Bot laeuft bereits (PID $($running.ProcessId -join ', '))." -ForegroundColor Yellow
    Write-Host "Zum Neustarten:  .\scripts\restart-bot.ps1"
    return
}

# Von Hand gestartet heisst: der Bot soll laufen, auch wenn er ueber den
# Aus-Knopf im Dashboard stillgelegt wurde - sonst wuerde run-bot.ps1 gleich
# wieder auf die Aus-Seite gehen, ohne dass das hier irgendwie zu sehen waere.
$ausDatei = Join-Path $rootDir 'data\bot-aus.json'
if (Test-Path $ausDatei) {
    Set-Content -Path $ausDatei -Value (@{ aus = $false } | ConvertTo-Json) -Encoding UTF8
}

Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$runScript`"" `
    -WorkingDirectory $rootDir `
    -WindowStyle Hidden

Write-Host "Starte..." -NoNewline

$started = @()
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    $started = @(Get-BotNodeProcess -RootDir $rootDir)
    if ($started.Count -gt 0) { break }
}
Write-Host ""

if ($started.Count -gt 0) {
    Write-Host "Bot gestartet (PID $($started.ProcessId -join ', '))." -ForegroundColor Green
    Write-Host "Status pruefen:  .\scripts\bot-status.ps1"
} else {
    Write-Host "Der Bot ist noch nicht oben. Log pruefen:" -ForegroundColor Yellow
    Write-Host "  .\scripts\bot-status.ps1"
}
