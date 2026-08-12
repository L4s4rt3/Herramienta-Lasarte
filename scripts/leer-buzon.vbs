' Lanza leer-buzon.cmd SIN ventana.
'
' Se ejecuta cada 30 minutos durante toda la jornada, asi que una consola
' saltando cada media hora seria insoportable. El 0 es "ventana oculta" y el
' True es "espera a que termine" — leer el buzon tarda unos segundos y no
' conviene que dos pasadas se solapen.
'
' Mismo patron que arrancar-receptor.vbs.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\leer-buzon.cmd""", 0, True
