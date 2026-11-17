# aufgaben-ohne-admin.ps1 - legt die Waechter-Aufgaben fuer prod UND vorschau an, ohne Adminrechte.
#   powershell -ExecutionPolicy Bypass -File .\server\windows\aufgaben-ohne-admin.ps1 [-Wurzel C:\parture]
# Unterschied zu installiere.ps1: Anmeldeart Interactive und Ausloeser "bei Anmeldung" statt S4U/"beim Hochfahren".
# Eine S4U-Aufgabe kann nur eine erhoehte Shell anlegen (Register-ScheduledTask: "Access is denied", Parture-Server 17.11.2026).
# Folge: Nach einem Neustart laeuft der Waechter erst, wenn sich der Benutzer anmeldet. Auf dem Parture-Server gilt das fuer alle
# Dienste gleich, dort gibt es keine automatische Anmeldung. Der Start ist fensterlos ueber conhost --headless (Konsolenhost).
# Erwartet die Ordner <Wurzel>\prod und <Wurzel>\vorschau mit jeweils einer .env. Idempotent. Nur ASCII (ohne BOM liest
# Windows PowerShell die Datei als ANSI).
param([string]$Wurzel = 'C:\parture')
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($u in @(@{ n = 'prod'; a = 'app\waechter.mjs --branch main --intervall 600' }, @{ n = 'vorschau'; a = 'app\waechter.mjs --branch vorschau --hart --intervall 60' })) {
  $ordner = Join-Path $Wurzel $u.n
  if (-not (Test-Path (Join-Path $ordner '.env'))) { throw "Im Ordner $ordner fehlt die .env (Vorlage: server\env.$($u.n).beispiel)." }
  $name = "Parture Waechter ($($u.n))"
  $aktion = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless "' + $node + '" ' + $u.a) -WorkingDirectory $ordner
  $ausloeser = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $einst = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  $konto = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
  try {
    Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einst -Principal $konto -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $name -ErrorAction Stop
  } catch { throw "Aufgabe '$name' NICHT angelegt: $($_.Exception.Message)" }
  "Aufgabe '$name' angelegt und gestartet (Interactive, bei Anmeldung, headless). Log: $ordner\daten\waechter.log"
}
