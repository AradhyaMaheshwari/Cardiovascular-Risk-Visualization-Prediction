$ErrorActionPreference = 'Stop'

$projectRoot = if (Test-Path (Join-Path $PSScriptRoot 'cardio-risk-studio/backend/main.py')) {
  Join-Path $PSScriptRoot 'cardio-risk-studio'
} elseif (Test-Path (Join-Path $PSScriptRoot 'backend/main.py')) {
  $PSScriptRoot
} else {
  throw 'Could not find cardio-risk-studio/backend/main.py. Keep this script beside the cardio-risk-studio folder.'
}

$backendPath = Join-Path $projectRoot 'backend'
$python = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

$port = $null
foreach ($candidate in 8000..8010) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$candidate/api/health" -TimeoutSec 1
    if ($health.status -eq 'ok' -and $health.models_loaded) {
      Write-Host "CardioLab is already running with all models loaded: http://127.0.0.1:$candidate" -ForegroundColor Green
      return
    }
  } catch {
    # This candidate does not have a reachable, healthy CardioLab service.
  }

  $probe = $null
  try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    $probe.Start()
    $port = $candidate
    break
  } catch {
    # Try the next local port when Windows reports this one as unavailable.
  } finally {
    if ($probe) { $probe.Stop() }
  }
}
if (-not $port) { throw 'Could not find an available local port between 8000 and 8010.' }
if ($port -ne 8000) {
  Write-Warning "Port 8000 cannot be bound by Windows even though no listener is visible. Using port $port instead."
}

if (-not (Test-Path (Join-Path $projectRoot 'frontend/dist/index.html'))) {
  Write-Warning 'Built frontend not found. In another PowerShell window, run: cd frontend; npm install; npm run build'
}

Write-Host "Starting CardioLab API and website from $backendPath" -ForegroundColor Cyan
Write-Host "Open http://127.0.0.1:$port when startup completes." -ForegroundColor Cyan
Write-Host 'Keep this PowerShell window open. Press Ctrl+C to stop the server.' -ForegroundColor DarkGray
Push-Location $backendPath
try {
  & $python -m uvicorn main:app --host 127.0.0.1 --port $port
} finally {
  Pop-Location
}
