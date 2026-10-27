@echo off
rem Double-click to start Classeum. Closing this window stops the server.
chcp 65001 > nul
title Classeum
cd /d "%~dp0"

if not exist package.json (
  echo.
  echo   압축을 먼저 푼 다음, 푼 폴더 안의 Classeum.bat을 실행하세요.
  echo.
  pause
  exit /b 1
)

where node > nul 2> nul
if errorlevel 1 (
  echo.
  echo   Node.js가 없어요. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

rem npm writes this file only when an install finished, so a half-done first install is repeated.
if not exist node_modules\.package-lock.json (
  echo.
  echo   처음 실행이라 필요한 파일을 받는 중이에요. 몇 분 걸릴 수 있어요.
  echo.
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
  rem The first start also puts a shortcut with the Classeum icon on the desktop.
  call "%~dp0바로가기 만들기.bat" quiet
)

echo.
echo   Classeum을 켜는 중이에요. 이 창을 닫으면 서버가 꺼져요.
echo.
call npm run class
set "CODE=%errorlevel%"

rem Keep the window open so an error stays readable.
echo.
if not "%CODE%"=="0" (
  echo   위 안내를 확인하세요. 아무 키나 누르면 창이 닫혀요.
) else (
  echo   서버가 꺼졌어요. 아무 키나 누르면 창이 닫혀요.
)
pause > nul
