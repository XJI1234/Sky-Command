Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
electron = root & "\node_modules\electron\dist\electron.exe"
main = root & "\electron\main.mjs"
If Not fso.FileExists(electron) Then
  sh.Run "cmd /c npm install", 1, True
End If
If Not fso.FileExists(main) Then
  sh.Run "cmd /c npm run build", 1, True
End If
If Not fso.FileExists(electron) Or Not fso.FileExists(main) Then
  MsgBox "桌面程序还没有构建完成。请在项目目录执行 npm install 和 npm run build 后再打开。", 16, "Sky Command"
  WScript.Quit 1
End If
sh.Run """" & electron & """ """ & main & """", 1, False
