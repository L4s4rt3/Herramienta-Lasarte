' Lanza foto-palets.cmd SIN ventana.
'
' La foto del ERP se toma cada hora de 12:00 a 00:00 (13 veces al dia). Llamando
' al .cmd directamente saltaba una consola cada hora encima de lo que estuvieras
' haciendo. Con esto va invisible: el 0 es "ventana oculta" y el True es "espera
' a que termine" — la foto tarda un par de segundos y conviene que no se solape
' con la siguiente si un dia el ERP va lento.
'
' Mismo patron que arrancar-receptor.vbs.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\foto-palets.cmd""", 0, True
