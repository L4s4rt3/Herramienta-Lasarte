' Lanza tarea-asistencia-reloj.cmd SIN ventana.
'
' Mismo patron que copia-seguridad.vbs: el 0 es "ventana oculta" y el True es
' "espera a que termine".

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "	area-asistencia-reloj.cmd""", 0, True
