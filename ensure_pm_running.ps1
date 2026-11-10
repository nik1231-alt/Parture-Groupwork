# ensure_pm_running.ps1 - haelt die Groupwork-App (Port 5060) am Leben UND rollt neue Staende aus. Idempotent.
# Aufgabe "Parture PM (5060)" (bei Anmeldung + alle 10 Min) anlegen: aufgabe_anlegen.ps1 einmal ausfuehren.
#
# Ablauf je Aufruf:
#   1. git fetch; liegt origin/main vor dem lokalen Stand -> git pull --ff-only (nie merge, nie rebase: der Server
#      aendert den Code nicht selbst), bei geaenderter package-lock.json -> npm ci, danach Neustart.
#   2. /healthz pruefen; antwortet nichts -> (haengenden Prozess beenden und) starten.
# So geht jeder Merge auf main innerhalb von 10 Minuten live. Lokale Aenderungen auf dem Server werden nicht ueberschrieben,
# sondern blockieren den Pull - das steht dann in pm.log.
$ErrorActionPreference = 'Stop'
$DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE = 'C:\nvm4w\nodejs\node.exe'
$LOG  = Join-Path $DIR 'pm.log'
function Log($m) { Add-Content -Path $LOG -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 }
if (-not (Test-Path $NODE)) { $NODE = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $NODE) { Log "ABBRUCH: node.exe nicht gefunden"; exit 1 }
$NPM = Join-Path (Split-Path -Parent $NODE) 'npm.cmd'

function Prozesse() { Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node' -and $_.CommandLine -match 'parture-pm[\\/]app[\\/]server\.mjs' } }
function Gesund() { try { (Invoke-WebRequest -Uri 'http://127.0.0.1:5060/healthz' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false } }
function Starten() {
  Log "starte app/server.mjs"
  Start-Process -FilePath $NODE -ArgumentList (Join-Path $DIR 'app\server.mjs') -WorkingDirectory $DIR -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DIR 'pm.out.log') -RedirectStandardError (Join-Path $DIR 'pm.err.log')
}

# 1. Neuer Stand auf GitHub?
$neustart = $false
try {
  Push-Location $DIR
  git fetch --quiet origin main 2>$null
  $lokal  = git rev-parse HEAD
  $remote = git rev-parse origin/main
  if ($lokal -ne $remote) {
    $lockVorher = git rev-parse HEAD:package-lock.json 2>$null
    $out = git pull --ff-only --quiet origin main 2>&1
    if ($LASTEXITCODE -ne 0) { Log "PULL BLOCKIERT ($lokal -> $remote): $out" }
    else {
      $lockNachher = git rev-parse HEAD:package-lock.json 2>$null
      if ($lockVorher -ne $lockNachher) { Log "package-lock geaendert -> npm ci"; & $NPM ci --no-audit --no-fund 2>&1 | Out-Null }
      Log "ausgerollt: $($lokal.Substring(0,7)) -> $($remote.Substring(0,7))"
      $neustart = $true
    }
  }
} catch { Log "fetch/pull Fehler: $($_.Exception.Message)" } finally { Pop-Location }

# 2. Laeuft sie?
if ($neustart) { Prozesse | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 2; Starten; exit 0 }
if (Gesund) { exit 0 }
$p = Prozesse
if ($p) { Log "Prozess da, /healthz antwortet nicht - beende $($p.ProcessId)"; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 2 }
Starten
