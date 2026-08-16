Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
If Not fso.FolderExists(root & "\tmp") Then
  fso.CreateFolder root & "\tmp"
End If
Set logFile = fso.OpenTextFile(root & "\tmp\shortcut-launch.log", 8, True)
logFile.WriteLine Now & " shortcut start"
electron = root & "\node_modules\electron\dist\electron.exe"
main = root & "\electron\main.mjs"
If Not fso.FileExists(electron) Then
  logFile.WriteLine Now & " npm install"
  sh.Run "cmd /c npm install", 1, True
End If
If Not fso.FileExists(main) Then
  logFile.WriteLine Now & " npm run build"
  sh.Run "cmd /c npm run build", 1, True
End If
If Not fso.FileExists(electron) Or Not fso.FileExists(main) Then
  logFile.WriteLine Now & " missing electron or main"
  logFile.Close
  MsgBox "Sky Command is not built. Run npm install and npm run build, then open again.", 16, "Sky Command"
  WScript.Quit 1
End If
logFile.WriteLine Now & " launching electron"
logFile.Close
sh.Run """" & electron & """ """ & main & """", 1, False
