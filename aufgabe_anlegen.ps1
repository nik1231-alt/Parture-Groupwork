# Einmal ausfuehren (PowerShell, ohne Adminrechte): legt die Aufgabe "Parture PM (5060)" an, die ensure_pm_running.ps1
# bei Anmeldung und alle 10 Minuten aufruft. Idempotent.
if (Get-ScheduledTask -TaskName 'Parture PM (5060)' -ErrorAction SilentlyContinue) { "Aufgabe existiert schon"; exit 0 }
$a  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\parture-pm\ensure_pm_running.ps1"'
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
$s  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Parture PM (5060)' -Action $a -Trigger $t1,$t2 -Settings $s | Out-Null
Start-ScheduledTask -TaskName 'Parture PM (5060)'
"Aufgabe 'Parture PM (5060)' angelegt und gestartet"
