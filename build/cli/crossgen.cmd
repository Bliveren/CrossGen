@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if not defined CROSSGEN_APP_EXECUTABLE (
  if exist "%SCRIPT_DIR%..\..\CrossGen.exe" set "CROSSGEN_APP_EXECUTABLE=%SCRIPT_DIR%..\..\CrossGen.exe"
)

if not defined CROSSGEN_APP_EXECUTABLE (
  echo CrossGen executable was not found. 1>&2
  exit /b 127
)

if not exist "%CROSSGEN_APP_EXECUTABLE%" (
  echo CrossGen executable was not found. 1>&2
  exit /b 127
)

if "%~1"=="--data-dir" (
  if "%~2"=="" (
    echo Missing value for --data-dir. 1>&2
    exit /b 2
  )
  set "CROSSGEN_DATA_DIR=%~2"
  set "CROSSGEN_USER_DATA_DIR=%~2"
  shift
  shift
)

if "%~1"=="--mcp" (
  "%CROSSGEN_APP_EXECUTABLE%" %*
) else (
  "%CROSSGEN_APP_EXECUTABLE%" --cli %*
)
exit /b %ERRORLEVEL%
