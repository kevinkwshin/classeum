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

rem A Classeum server still running from this folder comes first: it is stopped, or asked about while a lesson is
rem under way, before an update or an install changes anything under it.
node scripts\check-port.mjs
if errorlevel 1 (
  echo.
  echo   위 안내를 확인하세요. 아무 키나 누르면 창이 닫혀요.
  pause > nul
  exit /b 1
)

rem A folder cloned with git gets the newest version before it starts. The records (.data) aren't in git, so they
rem are never touched; offline, or with a file changed here that the update changes too, it starts as it is. The
rem whole block is read before it runs, and after an update it starts this file again from the top, so a
rem Classeum.bat the update itself changed never runs half old, half new; packages the update changed are installed
rem further down. git goes through call in case it is a .cmd wrapper, which would otherwise end this script, and is told
rem this folder is safe: on a USB drive, or made by another Windows account, git refuses it as of 'dubious ownership'.
if not defined CLASSEUM_UPDATED if exist .git (
  set "CLASSEUM_UPDATED=1"
  where git > nul 2> nul
  if errorlevel 1 (
    echo.
    echo   git이 없어서 새 버전 확인은 건너뛰어요.
  ) else (
    echo.
    echo   새 버전이 있는지 확인하는 중이에요...
    rem No password prompt or sign-in window: a public repository needs none, and nothing may wait for a click here.
    set "GIT_TERMINAL_PROMPT=0"
    call git -c safe.directory=* -c credential.helper= -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 fetch --quiet > nul 2> nul
    if errorlevel 1 (
      echo   새 버전을 확인하지 못해서 지금 버전으로 켤게요. 인터넷 연결을 확인해 보세요.
    ) else (
      call git -c safe.directory=* merge-base --is-ancestor @{u} HEAD > nul 2> nul
      if errorlevel 1 (
        call git -c safe.directory=* merge --ff-only --quiet @{u} > nul 2> nul
        if errorlevel 1 (
          echo   새 버전을 받지 못해서 지금 버전으로 켤게요. 이 폴더의 파일을 직접 고쳤다면 그래요.
        ) else (
          echo   새 버전을 받았어요.
          "%~f0" %*
        )
      ) else (
        echo   최신 버전이에요.
      )
    )
  )
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

rem Packages that no longer match package-lock.json (an update changed them, or their install broke off) are installed
rem again. If that fails it stops here rather than start half updated, and the next start tries again.
node scripts\build-if-changed.mjs --needs-install > nul 2> nul
if errorlevel 1 (
  echo.
  echo   필요한 파일이 바뀌어서 다시 받는 중이에요. 몇 분 걸릴 수 있어요.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   필요한 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.
    echo.
    pause
    exit /b 1
  )
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
