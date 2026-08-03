@echo off
setlocal
cd /d "%~dp0"

rem ===== CrossGen minimal Windows launcher =====
rem Uses pnpm (corepack preferred) or npm; auto-installs dependencies on first run.
rem pm_on_fail=ignore bypasses the pnpm version pin check when corepack provides a
rem newer pnpm than the "packageManager" field (nested "pnpm build:main" in dev:electron).

set "npm_config_pm_on_fail=ignore"

set "PM=pnpm"
where corepack >nul 2>nul
if %errorlevel%==0 (
  set "PM=corepack pnpm"
) else (
  where pnpm >nul 2>nul
  if errorlevel 1 set "PM=npm"
)

if not exist node_modules (
  echo [CrossGen] Installing dependencies with %PM% ...
  call %PM% install
  if errorlevel 1 (
    echo [CrossGen] Dependency install failed.
    exit /b 1
  )
)

echo [CrossGen] Starting Electron dev app ...
if "%PM%"=="npm" (
  call npm run dev:electron
) else (
  call %PM% dev:electron
)
exit /b %errorlevel%
