# ensure_pm_running.ps1 — startet die Groupwork-App (Port 5060) NUR, wenn sie nicht laeuft. Idempotent.
# Muster: C:\dev\Niko\ebay-mcp\ebay-mcp\ensure_hub_running.ps1. Aufgabe „Parture PM (5060)" (alle 10 Min + Anmeldung):
#   $a  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\parture-pm\ensure_pm_running.ps1"'
#   $t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
#   $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
#   $s  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
#   Register-ScheduledTask -TaskName 'Parture PM (5060)' -Action $a -Trigger $t1,$t2 -Settings $s
$ErrorActionPreference = 'Stop'
$DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE = 'C:\nvm4w\nodejs\node.exe'
$LOG  = Join-Path $DIR 'pm.log'
if (-not (Test-Path $NODE)) { $NODE = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $NODE) { Add-Content $LOG "[$(Get-Date -Format s)] ABBRUCH: node.exe nicht gefunden"; exit 1 }

try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5060/healthz' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { exit 0 } } catch {}

$laeuft = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node' -and $_.CommandLine -match 'parture-pm[\\/]app[\\/]server\.mjs' }
if ($laeuft) { Add-Content $LOG "[$(Get-Date -Format s)] Prozess da, aber /healthz antwortet nicht — beende $($laeuft.ProcessId)"; $laeuft | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } ; Start-Sleep 2 }

Add-Content $LOG "[$(Get-Date -Format s)] starte app/server.mjs"
Start-Process -FilePath $NODE -ArgumentList (Join-Path $DIR 'app\server.mjs') -WorkingDirectory $DIR -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DIR 'pm.out.log') -RedirectStandardError (Join-Path $DIR 'pm.err.log')
