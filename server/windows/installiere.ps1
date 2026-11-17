# Legt die geplante Aufgabe für den Wächter an (Windows). Einmal je Umgebung ausführen, in PowerShell.
#   .\server\windows\installiere.ps1 -Umgebung prod      im PROD-Ordner:     folgt origin/main (nur Fast-Forward, nach bestandenen Tests)
#   .\server\windows\installiere.ps1 -Umgebung vorschau  im VORSCHAU-Ordner: folgt origin/vorschau (jede Minute)
# Die Aufgabe startet beim Hochfahren (auch ohne Anmeldung) und startet sich nach einem Absturz neu. Idempotent.
# Braucht eine ERHÖHTE PowerShell (S4U-Anmeldung): ohne Adminrechte meldet Register-ScheduledTask „Access is denied“
# (Parture-Server 17.11.2026). Dann stattdessen aufgaben-ohne-admin.ps1 nehmen: gleiche Aufgabe, aber Start bei der Anmeldung.
param([Parameter(Mandatory = $true)][ValidateSet('prod', 'vorschau')][string]$Umgebung)
$ErrorActionPreference = 'Stop'
$ordner = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $ordner '.env'))) { throw "Im Ordner $ordner fehlt die .env (Vorlage: server\env.$Umgebung.beispiel)." }
$name = "Parture Waechter ($Umgebung)"
$args = if ($Umgebung -eq 'prod') { 'app\waechter.mjs --branch main --intervall 600' } else { 'app\waechter.mjs --branch vorschau --hart --intervall 60' }

# Die alte Aufgabe aus der Anfangszeit (zieht main ohne Tests) darf nicht mehr laufen
$alt = Get-ScheduledTask -TaskName 'Parture PM (5060)' -ErrorAction SilentlyContinue
if ($alt -and $Umgebung -eq 'prod') { Stop-ScheduledTask -TaskName $alt.TaskName -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $alt.TaskName | Out-Null; "Alte Aufgabe 'Parture PM (5060)' deaktiviert." }

$aktion = New-ScheduledTaskAction -Execute $node -Argument $args -WorkingDirectory $ordner
$ausloeser = New-ScheduledTaskTrigger -AtStartup
$einstellungen = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
# S4U: läuft auch ohne angemeldeten Benutzer, ohne dass ein Passwort gespeichert wird
$konto = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
# Die CIM-Fehler dieser Cmdlets sind nicht terminierend; ohne try/catch meldete das Skript „angelegt“, obwohl nichts angelegt war.
try {
  Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $konto -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $name -ErrorAction Stop
} catch {
  # Nur ASCII in Zeichenketten: Windows PowerShell liest die Datei ohne BOM als ANSI, ein UTF-8-Gedankenstrich enthaelt dann ein Anfuehrungszeichen-Byte.
  throw "Aufgabe '$name' NICHT angelegt: $($_.Exception.Message). PowerShell als Administrator starten oder server\windows\aufgaben-ohne-admin.ps1 verwenden."
}
if ((Get-ScheduledTask -TaskName $name).State -notin @('Running', 'Ready')) { throw "Aufgabe '$name' angelegt, läuft aber nicht (Zustand: $((Get-ScheduledTask -TaskName $name).State))." }
"Aufgabe '$name' angelegt und gestartet. Log: $ordner\daten\waechter.log"
