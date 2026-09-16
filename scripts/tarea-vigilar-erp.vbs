' Lanza tarea-vigilar-erp.cmd SIN ventana (mismo patron que foto-palets.vbs).
'
' Cada hora de 06:05 a 15:05 revisa que el ERP no tenga consultas congeladas y
' cancela las de este equipo que lleven mas de 60 s. Tarda un segundo; el True
' espera a que termine para que dos pasadas no se solapen.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\tarea-vigilar-erp.cmd""", 0, True
