# Deja las tareas programadas de Lasarte como tienen que estar.
#
# POR QUE EXISTE. Windows crea las tareas con dos ajustes que las rompen en un
# portatil, y no se ven a menos que se mire el XML:
#
#   1. "No iniciar en Bateria" + "Detener en modo Bateria". Si alguien desenchufa
#      el portatil se para TODO: el receptor de informes del calibrador, la
#      sincronizacion del ERP y las fotos de palets. Y el portatil esta pensado
#      para quedarse encendido siempre.
#   2. Falta "StartWhenAvailable": si el equipo estaba suspendido a la hora, esa
#      ejecucion se pierde y nadie se entera hasta que falta un dia de datos.
#
# Ademas, las tareas que llaman a un .cmd abren una ventana de consola encima de
# lo que estes haciendo. Se lanzan con su .vbs para que vayan invisibles.
#
# Es idempotente: se puede volver a lanzar cuando se quiera.
#
#   powershell -ExecutionPolicy Bypass -File scripts\arreglar-tareas.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

$tareas = @(
  @{ nombre = "Lasarte - Sincronizar ERP";     vbs = "tarea-diaria.vbs" }
  @{ nombre = "Lasarte - Receptor calibrador"; vbs = "arrancar-receptor.vbs" }
  @{ nombre = "Lasarte - Foto palets ERP";     vbs = "foto-palets.vbs" }
)

foreach ($t in $tareas) {
  $tarea = Get-ScheduledTask -TaskName $t.nombre -ErrorAction SilentlyContinue
  if (-not $tarea) { Write-Host "  $($t.nombre): no existe, se salta"; continue }

  # Energia y recuperacion: lo que de verdad importa.
  $set = $tarea.Settings
  $set.DisallowStartIfOnBatteries = $false
  $set.StopIfGoingOnBatteries     = $false
  $set.StartWhenAvailable         = $true
  $set.RunOnlyIfIdle              = $false
  $set.ExecutionTimeLimit         = "PT2H"   # que una cuelgue no la deje viva 72 h

  # Sin ventana: siempre a traves del .vbs.
  $ruta = Join-Path $repo "scripts\$($t.vbs)"
  if (-not (Test-Path $ruta)) { throw "no existe $ruta" }
  $accion = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$ruta`""

  Set-ScheduledTask -TaskName $t.nombre -Settings $set -Action $accion | Out-Null
  Write-Host "  $($t.nombre): arreglada"
}

Write-Host ""
Write-Host "COMO QUEDAN:"
foreach ($t in $tareas) {
  $x = Get-ScheduledTask -TaskName $t.nombre -ErrorAction SilentlyContinue
  if (-not $x) { continue }
  $s = $x.Settings
  $ventana = if ($x.Actions[0].Execute -match "wscript") { "oculta" } else { "ABRE VENTANA" }
  $bateria = if (-not $s.DisallowStartIfOnBatteries -and -not $s.StopIfGoingOnBatteries) { "sigue con bateria" } else { "SE PARA CON BATERIA" }
  $perdida = if ($s.StartWhenAvailable) { "recupera la perdida" } else { "NO RECUPERA" }
  Write-Host ("  {0,-32} {1,-14} {2,-20} {3}" -f $t.nombre.Replace("Lasarte - ", ""), $ventana, $bateria, $perdida)
}
