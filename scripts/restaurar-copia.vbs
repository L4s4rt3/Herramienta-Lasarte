' Lanza restaurar-copia.cmd SIN ventana (mismo patron que copia-seguridad.vbs).
' Tarea programada "Lasarte - Ensayo restauracion", el dia 2 de ene/abr/jul/oct a las 22:45.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\restaurar-copia.cmd""", 0, True
