# Run once (PowerShell, no administrator rights): creates the task "Parture PM (5060)" that calls ensure_pm_running.ps1
# at logon and every 10 minutes. Idempotent.
if (Get-ScheduledTask -TaskName 'Parture PM (5060)' -ErrorAction SilentlyContinue) { "Task already exists"; exit 0 }
$a  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\parture-pm\ensure_pm_running.ps1"'
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
$s  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Parture PM (5060)' -Action $a -Trigger $t1,$t2 -Settings $s | Out-Null
Start-ScheduledTask -TaskName 'Parture PM (5060)'
"Task 'Parture PM (5060)' created and started"
