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
# Y LO QUE DE VERDAD IMPEDIA QUE CORRIERA (diagnosticado el 12-08-2026): este
# portatil solo tiene SUSPENSION MODERNA (S0 Low Power Idle); no existe el modo
# de espera clasico. Con eso, aunque la configuracion de energia diga "tapa
# cerrada: no hacer nada" y "suspender: nunca", el equipo entra igual en reposo
# cuando se apaga la pantalla — parece encendido pero esta dormido. El 12-08 no
# hubo NI UN evento del sistema entre las 00:30 y las 07:01, y por eso la tarea
# de las 6:30 no se ejecuto.
#
# Para que se ejecute hacen falta las DOS cosas a la vez:
#   1. Que el sistema permita temporizadores de reactivacion con corriente
#      (venia deshabilitado).
#   2. Que la tarea tenga permiso para despertar el equipo (WakeToRun).
#
# QUIEN DESPIERTA EL PORTATIL Y QUIEN NO:
#   - La tarea diaria (7:10): SI. Es la que hace el trabajo del dia.
#   - El receptor: SI. Lo que llegue con el equipo dormido se pierde y no vuelve,
#     asi que tiene que estar escuchando durante toda la jornada. Para no
#     despertarlo cada 10 minutos, el reintento se separa: cada 30 min es de
#     sobra para relanzarlo si muriera.
#   - Las fotos: NO. Si el equipo esta dormido no hay nadie dando de alta, asi
#     que no hay nada nuevo que fotografiar.
#
# Es idempotente: se puede volver a lanzar cuando se quiera.
#
#   powershell -ExecutionPolicy Bypass -File scripts\arreglar-tareas.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# La VENTANA de cada tarea importa tanto como el resto: el Sizer manda sus
# informes segun cierra lotes (el 11-ago, entre las 07:47 y las 12:38), y lo que
# llegue con el receptor parado se pierde y no vuelve. Por eso escucha de 06:00 a
# 22:00 — cubre el turno de verano (terminan sobre las 13:10) y el normal (14:00
# o 15:00) sin tener que tocar nada cuando cambie.
#
# Y el RITMO del reintento del receptor es lo que mide el agujero cuando se
# cae: reintentaba cada 30 min y el 14-08-2026 se murio a las 07:0x, asi que
# hasta las 07:30 no habia quien recogiera nada. Baja a 5 min — un intento que
# no toma muere en menos de un segundo, asi que no cuesta nada.
#
# LA TAREA DIARIA TAMBIEN SE REINTENTA, y por lo mismo: ese 14-08 corrio a las
# 07:10 con el portatil recien despierto y sin red todavia, murio entera y nadie
# lo volvio a intentar hasta el dia siguiente — un correo y dos partes perdidos
# por unos minutos de red. Se repite cada 20 min hasta las 12:10; el propio .cmd
# se planta solo en cuanto el dia sale entero (ver sus dos marcas), asi que en un
# dia normal se ejecuta UNA vez.
$tareas = @(
  @{ nombre = "Lasarte - Sincronizar ERP";     vbs = "tarea-diaria.vbs";      despierta = $true;  reintento = "PT20M"; duracion = "PT5H" }
  @{ nombre = "Lasarte - Receptor calibrador"; vbs = "arrancar-receptor.vbs"; despierta = $true;  reintento = "PT5M" }
  @{ nombre = "Lasarte - Foto palets ERP";     vbs = "foto-palets.vbs";       despierta = $false }
  # "Lasarte - Leer buzon" se deshabilito el 14-08-2026 a proposito (el buzon
  # IMAP no se usa: todo lo automatico entra por el receptor de la LAN). Si se
  # reactivara, volver a añadirla aqui y en _shared/saludTrabajos.ts.
  # La copia despierta el equipo: es la unica defensa contra un desastre de la
  # base, y a las 21:30 el portatil puede estar en reposo moderno. El propio
  # script se planta si la de hoy ya esta verificada, asi que el reintento de
  # 30 min sale gratis.
  @{ nombre = "Lasarte - Copia de seguridad";  vbs = "copia-seguridad.vbs";   despierta = $true;  reintento = "PT30M"; duracion = "PT3H" }
)

# Temporizadores de reactivacion con corriente alterna: 1 = habilitar. Sin esto,
# WakeToRun en la tarea no sirve de nada.
$GUID_WAKE = "bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d"
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP $GUID_WAKE 1 2>&1 | Out-Null
powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null
$estado = (powercfg /q SCHEME_CURRENT SUB_SLEEP $GUID_WAKE | Select-String 'corriente alterna|AC Power Setting')
Write-Host "  temporizadores de reactivacion (enchufado): $(if ($estado -match '0x0*1') { 'HABILITADOS' } else { 'NO se pudieron habilitar (hace falta admin)' })"
Write-Host ""

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
  $set.WakeToRun                  = $t.despierta

  # Sin ventana: siempre a traves del .vbs.
  $ruta = Join-Path $repo "scripts\$($t.vbs)"
  if (-not (Test-Path $ruta)) { throw "no existe $ruta" }
  $accion = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$ruta`""

  Set-ScheduledTask -TaskName $t.nombre -Settings $set -Action $accion | Out-Null

  # El disparador solo se toca donde se pide un ritmo concreto: el resto tienen
  # su hora puesta a mano y no hay que inventarles ninguna.
  #
  # La repeticion se CREA si no la hay (la tarea diaria nacio sin ella, con un
  # unico disparo a las 07:10), y para eso hace falta la duracion: un intervalo
  # sin duracion Windows lo ignora en silencio.
  if ($t.reintento) {
    $disp = (Get-ScheduledTask -TaskName $t.nombre).Triggers
    foreach ($d in $disp) {
      if ($d.Repetition -and $d.Repetition.Duration) {
        $d.Repetition.Interval = $t.reintento
      } elseif ($t.duracion) {
        $d.Repetition.Interval = $t.reintento
        $d.Repetition.Duration = $t.duracion
        $d.Repetition.StopAtDurationEnd = $false
      }
    }
    Set-ScheduledTask -TaskName $t.nombre -Trigger $disp | Out-Null
    $r = (Get-ScheduledTask -TaskName $t.nombre).Triggers[0].Repetition
    Write-Host "  $($t.nombre): arreglada (reintento cada $($r.Interval) durante $($r.Duration))"
  } else {
    Write-Host "  $($t.nombre): arreglada"
  }
}

Write-Host ""
Write-Host "COMO QUEDAN:"
foreach ($t in $tareas) {
  $x = Get-ScheduledTask -TaskName $t.nombre -ErrorAction SilentlyContinue
  if (-not $x) { continue }
  $s = $x.Settings
  $ventana = if ($x.Actions[0].Execute -match "wscript") { "oculta" } else { "ABRE VENTANA" }
  $bateria = if (-not $s.DisallowStartIfOnBatteries -and -not $s.StopIfGoingOnBatteries) { "con bateria: sigue" } else { "CON BATERIA: SE PARA" }
  $perdida = if ($s.StartWhenAvailable) { "recupera" } else { "NO RECUPERA" }
  $wake    = if ($s.WakeToRun) { "DESPIERTA el equipo" } else { "no despierta" }
  Write-Host ("  {0,-24} {1,-14} {2,-22} {3,-12} {4}" -f $t.nombre.Replace("Lasarte - ", ""), $ventana, $bateria, $perdida, $wake)
}
