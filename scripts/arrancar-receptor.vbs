' Lanza arrancar-receptor.cmd SIN ventana.
'
' La tarea programada intenta arrancar el receptor cada 10 minutos, y si se
' llamara al .cmd directamente saldria una consola parpadeando toda la manana.
' Con esto va invisible. El 0 es "ventana oculta" y el False es "no esperes a
' que termine" — el receptor se queda corriendo, no vuelve.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\arrancar-receptor.cmd""", 0, False
