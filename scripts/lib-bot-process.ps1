# Gemeinsame Prozesserkennung fuer start/stop/status.
#
# Der Bot laeuft als "node  src/index.js" - ohne Projektpfad in der
# Kommandozeile. Ein Filter auf den Ordnernamen findet ihn deshalb nicht.
# Stattdessen wird der Prozessbaum unterhalb des Watchdogs eingesammelt.

function Get-BotWatchdog {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*run-bot.ps1*' }
}

function Get-ProcessDescendant {
    param([int[]]$ParentIds, [int]$MaxDepth = 6)

    $all = Get-CimInstance Win32_Process
    $found = @()
    $frontier = $ParentIds

    for ($depth = 0; $depth -lt $MaxDepth -and $frontier.Count -gt 0; $depth++) {
        $children = $all | Where-Object { $frontier -contains $_.ParentProcessId }
        if (-not $children) { break }
        $found += $children
        $frontier = @($children | ForEach-Object { $_.ProcessId })
    }

    $found
}

# Liefert alle Prozesse, die zu diesem Bot gehoeren.
function Get-BotProcess {
    param([string]$RootDir)

    $result = @{}

    # Normalfall: alles unterhalb des Watchdogs
    $watchdogs = @(Get-BotWatchdog)
    if ($watchdogs.Count -gt 0) {
        foreach ($p in Get-ProcessDescendant -ParentIds @($watchdogs.ProcessId)) {
            if ($p.Name -in @('node.exe', 'cmd.exe', 'npm.cmd')) {
                $result[$p.ProcessId] = $p
            }
        }
    }

    # Handstart ohne Watchdog: node mit index.js aus diesem Projekt
    $manual = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object {
            $_.CommandLine -and (
                $_.CommandLine -like "*$RootDir*" -or
                $_.CommandLine -like '*src/index.js*' -or
                $_.CommandLine -like '*src\index.js*'
            )
        }

    foreach ($p in $manual) { $result[$p.ProcessId] = $p }

    $result.Values
}

# Nur der eigentliche Bot (nicht npm/cmd drumherum) - fuer Statusmeldungen.
function Get-BotNodeProcess {
    param([string]$RootDir)

    Get-BotProcess -RootDir $RootDir |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*index.js*' }
}
