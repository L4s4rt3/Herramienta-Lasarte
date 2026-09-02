' Lanza correo-diario.cmd SIN ventana (mismo patron que foto-palets.vbs).
' Tarea programada "Lasarte - Informe rendimiento diario", cada dia 09:00.
Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\correo-diario.cmd""", 0, True
