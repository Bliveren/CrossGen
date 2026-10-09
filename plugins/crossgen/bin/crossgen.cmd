@echo off
rem Plugin launcher for CrossGen on Windows.
rem Locates the CrossGen installation and delegates to it.
setlocal

if defined CROSSGEN_APP_EXECUTABLE (
  set "APP=%CROSSGEN_APP_EXECUTABLE%"
  goto :run
)
if defined CROSSGEN_PLUGIN_APP_EXECUTABLE (
  set "APP=%CROSSGEN_PLUGIN_APP_EXECUTABLE%"
  goto :run
)

if exist "%LOCALAPPDATA%\Programs\CrossGen\resources\cli\crossgen.cmd" (
  call "%LOCALAPPDATA%\Programs\CrossGen\resources\cli\crossgen.cmd" %*
  exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\CrossGen\resources\cli\crossgen.cmd" (
  call "%ProgramFiles%\CrossGen\resources\cli\crossgen.cmd" %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\CrossGen\CrossGen.exe" set "APP=%LOCALAPPDATA%\Programs\CrossGen\CrossGen.exe"
if not defined APP if exist "%ProgramFiles%\CrossGen\CrossGen.exe" set "APP=%ProgramFiles%\CrossGen\CrossGen.exe"

:run
if not defined APP (
  echo CrossGen was not found. Install the CrossGen desktop app, or set CROSSGEN_APP_EXECUTABLE to its executable. 1>&2
  exit /b 127
)

if "%~1"=="--mcp" (
  "%APP%" %*
) else (
  "%APP%" --cli %*
)
exit /b %ERRORLEVEL%
