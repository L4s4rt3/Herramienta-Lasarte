' Lanza tarea-analisis-semanal.cmd SIN ventana (mismo patron que foto-palets.vbs).
'
' Lunes a las 05:45: el analisis completo de la empresa de la semana anterior, con
' correo a soporte@. Tarda medio minuto.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\tarea-analisis-semanal.cmd""", 0, True
