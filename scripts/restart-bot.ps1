# Stoppt den Bot und startet ihn frisch - danach laeuft der aktuelle Code.
# Node laedt den Code beim Start, Aenderungen an src/ greifen also erst hier.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptDir 'stop-bot.ps1')
Write-Host ""
Start-Sleep -Seconds 2
& (Join-Path $scriptDir 'start-bot.ps1')
