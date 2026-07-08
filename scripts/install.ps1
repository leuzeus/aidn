$aidnRef = $env:AIDN_REF

if ([string]::IsNullOrWhiteSpace($aidnRef)) {
  $aidnRef = "dev"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node is required. Install Node.js 18 or newer."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required."
  exit 1
}

npx "github:leuzeus/aidn#$aidnRef" bootstrap @args
exit $LASTEXITCODE
