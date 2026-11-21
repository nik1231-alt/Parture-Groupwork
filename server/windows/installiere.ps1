# Creates the scheduled task for the watcher (Windows). Run it once per environment, in PowerShell.
#   .\server\windows\installiere.ps1 -Umgebung prod      in the PROD folder:    follows origin/main (fast-forward only, after the tests pass)
#   .\server\windows\installiere.ps1 -Umgebung vorschau  in the PREVIEW folder: follows origin/vorschau (every minute)
# The task starts at boot (even without a logon) and restarts itself after a crash. Idempotent.
# Needs an ELEVATED PowerShell (S4U logon): without administrator rights Register-ScheduledTask reports "Access is denied"
# (Parture server, 17 Nov 2026). In that case use aufgaben-ohne-admin.ps1 instead: same task, but it starts at logon.
param([Parameter(Mandatory = $true)][ValidateSet('prod', 'vorschau')][string]$Umgebung)
$ErrorActionPreference = 'Stop'
$ordner = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $ordner '.env'))) { throw "The folder $ordner has no .env (template: server\env.$Umgebung.beispiel)." }
$name = "Parture Waechter ($Umgebung)"
$args = if ($Umgebung -eq 'prod') { 'app\waechter.mjs --branch main --intervall 600' } else { 'app\waechter.mjs --branch vorschau --hart --intervall 60' }

# The old task from the early days (pulls main without tests) must no longer run
$alt = Get-ScheduledTask -TaskName 'Parture PM (5060)' -ErrorAction SilentlyContinue
if ($alt -and $Umgebung -eq 'prod') { Stop-ScheduledTask -TaskName $alt.TaskName -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $alt.TaskName | Out-Null; "Old task 'Parture PM (5060)' disabled." }

$aktion = New-ScheduledTaskAction -Execute $node -Argument $args -WorkingDirectory $ordner
$ausloeser = New-ScheduledTaskTrigger -AtStartup
$einstellungen = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
# S4U: runs even without a logged-on user, without storing a password
$konto = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
# The CIM errors of these cmdlets are non-terminating; without try/catch the script reported "created" although nothing was created.
try {
  Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $konto -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $name -ErrorAction Stop
} catch {
  # ASCII only in strings: without a BOM Windows PowerShell reads the file as ANSI, and a UTF-8 dash then contains a quotation-mark byte.
  throw "Task '$name' was NOT created: $($_.Exception.Message). Start PowerShell as administrator or use server\windows\aufgaben-ohne-admin.ps1."
}
if ((Get-ScheduledTask -TaskName $name).State -notin @('Running', 'Ready')) { throw "Task '$name' was created but is not running (state: $((Get-ScheduledTask -TaskName $name).State))." }
"Task '$name' created and started. Log: $ordner\daten\waechter.log"
