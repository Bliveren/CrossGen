export function createFindPidsByPathScript(): string {
  return `
$ErrorActionPreference = "Continue"
try {
  $target = [System.IO.Path]::GetFullPath($env:IMAGE2TOOLS_EXE_PATH)
  $requireWindow = $env:IMAGE2TOOLS_REQUIRE_WINDOW -eq "1"
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Image2Tools.exe'" -ErrorAction SilentlyContinue)
  foreach ($candidateProcess in $processes) {
    try {
      if (-not $candidateProcess.ExecutablePath) { continue }
      $candidatePath = [System.IO.Path]::GetFullPath($candidateProcess.ExecutablePath)
      if (-not [System.StringComparer]::OrdinalIgnoreCase.Equals($candidatePath, $target)) { continue }
      if ($requireWindow) {
        $windowProcess = Get-Process -Id $candidateProcess.ProcessId -ErrorAction SilentlyContinue
        if (-not $windowProcess -or $windowProcess.MainWindowHandle -eq 0) { continue }
      }
      [Console]::Out.WriteLine($candidateProcess.ProcessId)
    } catch {
      continue
    }
  }
} catch {
}
exit 0
`;
}
