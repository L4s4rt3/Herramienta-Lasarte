' Lanza tarea-diaria-erp.cmd SIN ventana.
'
' La tarea de las 6:30 sincroniza el ERP, deja el parte hecho y manda el correo.
' Llamando al .cmd directamente saltaba una consola cada manana y se quedaba
' abierta el rato que durase todo el proceso. Con esto va invisible: el 0 es
' "ventana oculta" y el True es "espera a que termine" (aqui si interesa, porque
' el .cmd encadena varios pasos y el log tiene que quedar completo).
'
' Mismo patron que arrancar-receptor.vbs.

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\tarea-diaria-erp.cmd""", 0, True
