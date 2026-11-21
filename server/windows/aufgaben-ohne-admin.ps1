# aufgaben-ohne-admin.ps1 - creates the watcher tasks for prod AND vorschau (preview) without administrator rights.
#   powershell -ExecutionPolicy Bypass -File .\server\windows\aufgaben-ohne-admin.ps1 [-Wurzel C:\parture]
# Difference from installiere.ps1: logon type Interactive and trigger "at logon" instead of S4U / "at startup".
# An S4U task can only be created from an elevated shell (Register-ScheduledTask: "Access is denied", Parture server, 17 Nov 2026).
# Consequence: after a reboot the watcher only runs once the user logs on. On the Parture server this is true for all
# services alike; there is no automatic logon there. It starts without a window through conhost --headless (console host).
# Expects the folders <Wurzel>\prod and <Wurzel>\vorschau, each with a .env. Idempotent. ASCII only (without a BOM,
# Windows PowerShell reads the file as ANSI).
param([string]$Wurzel = 'C:\parture')
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($u in @(@{ n = 'prod'; a = 'app\waechter.mjs --branch main --intervall 600' }, @{ n = 'vorschau'; a = 'app\waechter.mjs --branch vorschau --hart --intervall 60' })) {
  $ordner = Join-Path $Wurzel $u.n
  if (-not (Test-Path (Join-Path $ordner '.env'))) { throw "The folder $ordner has no .env (template: server\env.$($u.n).beispiel)." }
  $name = "Parture Waechter ($($u.n))"
  $aktion = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless "' + $node + '" ' + $u.a) -WorkingDirectory $ordner
  $ausloeser = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $einst = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  $konto = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
  try {
    Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einst -Principal $konto -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $name -ErrorAction Stop
  } catch { throw "Task '$name' was NOT created: $($_.Exception.Message)" }
  "Task '$name' created and started (Interactive, at logon, headless). Log: $ordner\daten\waechter.log"
}
