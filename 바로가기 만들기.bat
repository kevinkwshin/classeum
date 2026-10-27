@echo off
rem Puts a Classeum shortcut, with the Classeum icon, on the desktop. Classeum.bat runs this once on its first start;
rem run it again any time (it just replaces the shortcut). "quiet" skips the closing pause.
chcp 65001 > nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$desk = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Classeum.lnk')); $s.TargetPath = '%~dp0Classeum.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0Classeum.ico,0'; $s.Description = 'Classeum 켜기'; $s.Save()"
if errorlevel 1 (
  echo.
  echo   바탕화면 바로가기를 만들지 못했어요. Classeum.bat을 더블클릭해서 켜도 돼요.
) else (
  echo.
  echo   바탕화면에 Classeum 바로가기를 만들었어요. 다음부터는 그걸 더블클릭하세요.
)
if /i not "%~1"=="quiet" (
  echo.
  pause
)
