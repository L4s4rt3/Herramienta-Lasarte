' Lanza copia-seguridad.cmd SIN ventana.
'
' Mismo patron que foto-palets.vbs: el 0 es "ventana oculta" y el True es
' "espera a que termine", para que un reintento no se solape con una copia que
' siga en marcha (la primera del dia puede tardar varios minutos).

Dim shell, aqui
Set shell = CreateObject("WScript.Shell")
aqui = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & aqui & "\copia-seguridad.cmd""", 0, True
