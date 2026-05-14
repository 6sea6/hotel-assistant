$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot 'scripts/sync-build-assets.js')
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
