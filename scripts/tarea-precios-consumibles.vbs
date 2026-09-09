' Lanza tarea-precios-consumibles.cmd SIN ventana.
'
' Mismo patron que tarea-asistencia-reloj.vbs: el 0 es "ventana oculta" y el
' True es "espera a que termine".

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\tarea-precios-consumibles.cmd""", 0, True
