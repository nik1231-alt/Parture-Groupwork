# ensure_pm_running.ps1 - keeps the Groupwork app (port 5060) alive AND rolls out new versions. Idempotent.
# To create the task "Parture PM (5060)" (at logon + every 10 min), run aufgabe_anlegen.ps1 once.
#
# Steps per call:
#   1. git fetch; if origin/main is ahead of the local state -> git pull --ff-only (never merge, never rebase: the server
#      does not change the code itself); if package-lock.json changed -> npm ci, then restart.
#   2. Check /healthz; if nothing answers -> (kill the hanging process and) start.
# This way every merge to main goes live within 10 minutes. Local changes on the server are not overwritten,
# they block the pull instead - that is then written to pm.log.
$ErrorActionPreference = 'Stop'
$DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE = 'C:\nvm4w\nodejs\node.exe'
$LOG  = Join-Path $DIR 'pm.log'
function Log($m) { Add-Content -Path $LOG -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 }
if (-not (Test-Path $NODE)) { $NODE = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $NODE) { Log "ABORT: node.exe not found"; exit 1 }
$NPM = Join-Path (Split-Path -Parent $NODE) 'npm.cmd'

function Prozesse() { Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node' -and $_.CommandLine -match 'parture-pm[\\/]app[\\/]server\.mjs' } }
function Gesund() { try { (Invoke-WebRequest -Uri 'http://127.0.0.1:5060/healthz' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false } }
function Starten() {
  Log "starting app/server.mjs"
  Start-Process -FilePath $NODE -ArgumentList (Join-Path $DIR 'app\server.mjs') -WorkingDirectory $DIR -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DIR 'pm.out.log') -RedirectStandardError (Join-Path $DIR 'pm.err.log')
}

# 1. New version on GitHub?
$neustart = $false
try {
  Push-Location $DIR
  git fetch --quiet origin main 2>$null
  $lokal  = git rev-parse HEAD
  $remote = git rev-parse origin/main
  if ($lokal -ne $remote) {
    $lockVorher = git rev-parse HEAD:package-lock.json 2>$null
    $out = git pull --ff-only --quiet origin main 2>&1
    if ($LASTEXITCODE -ne 0) { Log "PULL BLOCKED ($lokal -> $remote): $out" }
    else {
      $lockNachher = git rev-parse HEAD:package-lock.json 2>$null
      if ($lockVorher -ne $lockNachher) { Log "package-lock changed -> npm ci"; & $NPM ci --no-audit --no-fund 2>&1 | Out-Null }
      Log "rolled out: $($lokal.Substring(0,7)) -> $($remote.Substring(0,7))"
      $neustart = $true
    }
  }
} catch { Log "fetch/pull error: $($_.Exception.Message)" } finally { Pop-Location }

# 2. Is it running?
if ($neustart) { Prozesse | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 2; Starten; exit 0 }
if (Gesund) { exit 0 }
$p = Prozesse
if ($p) { Log "Process exists, /healthz does not answer - stopping $($p.ProcessId)"; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 2 }
Starten
