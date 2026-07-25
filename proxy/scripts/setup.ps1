<#
.SYNOPSIS
  One-shot setup for the cm-llm-proxy on a Windows (QSEoW) node. Automates the
  mechanical install steps; you still supply the site secrets (API key, Qlik auth).

.DESCRIPTION
  Runs, idempotently:
    1. Verify Node.js (>= 18) is on PATH.
    2. npm ci  (install proxy dependencies from the lockfile).
    3. -DevCert:  generate a self-signed localhost TLS cert into ./certs (if missing),
                  and with -TrustCert add it to the current user's Root store so the
                  browser trusts it. (Production uses a CA-signed cert instead — set
                  TLS_CERT/TLS_KEY in .env; see README "Production certificate".)
    4. Create/patch .env from .env.example with any values you pass (ANTHROPIC_API_KEY,
       QLIK_SESSION_URL, QLIK_CERT, QLIK_KEY, QLIK_ORIGINS, LOG_LEVEL). Existing values
       are only overwritten for the parameters you provide.
    5. -InstallService:  install node-windows and register the auto-start/restart
       "cm-llm-proxy" Windows service (stop triggers the graceful drain).

  What it deliberately does NOT do: invent secrets. The API key and the Qlik
  session-validation URL + client certificates are yours to provide.

.EXAMPLE
  # Local dev: deps + trusted self-signed cert + a starter .env, then run by hand.
  pwsh scripts/setup.ps1 -DevCert -TrustCert -ApiKey 'sk-ant-...' `
    -QlikSessionUrl 'https://spmad-mby1:4243/qps/session' `
    -QlikCert './certs/client.pem' -QlikKey './certs/client_key.pem' `
    -Origins 'https://spmad-mby1' -LogLevel DEBUG

.EXAMPLE
  # Production node: deps + .env + register the Windows service (CA cert set in .env).
  pwsh scripts/setup.ps1 -ApiKey 'sk-ant-...' -QlikSessionUrl '...' `
    -QlikCert '...' -QlikKey '...' -Origins 'https://your-qlik' -LogLevel INFO -InstallService
#>

param(
  [string] $ApiKey,
  [string] $QlikSessionUrl,
  [string] $QlikCert,
  [string] $QlikKey,
  [string] $Origins,
  [ValidateSet('ERROR', 'WARN', 'INFO', 'DEBUG')]
  [string] $LogLevel,
  [switch] $DevCert,
  [switch] $TrustCert,
  [switch] $InstallService
)

$ErrorActionPreference = 'Stop'
$proxyRoot = Split-Path -Parent $PSScriptRoot
Set-Location $proxyRoot
function Info($m) { Write-Host "[setup] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[setup] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[setup] $m" -ForegroundColor Yellow }

# 1. Node.js present and recent enough.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js is not on PATH. Install Node >= 18 from https://nodejs.org and re-run.'; exit 1 }
$nodeMajor = [int](& node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if ($nodeMajor -lt 18) { Write-Error "Node.js $nodeMajor is too old; need >= 18."; exit 1 }
Ok "Node.js $(& node -v) OK"

# 2. Dependencies (reproducible from the committed lockfile).
Info 'Installing dependencies (npm ci)…'
if (Test-Path 'package-lock.json') { & npm ci } else { & npm install }
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed.'; exit 1 }
Ok 'Dependencies installed'

# 3. Dev TLS certificate (self-signed localhost). Production uses a CA-signed cert.
if ($DevCert) {
  New-Item -ItemType Directory -Force './certs' | Out-Null
  $certPem = './certs/localhost3000-cert.pem'
  $keyPem  = './certs/localhost3000-key.pem'
  if ((Test-Path $certPem) -and (Test-Path $keyPem)) {
    Info 'Dev cert already present — skipping generation.'
  } else {
    $openssl = Get-Command openssl -ErrorAction SilentlyContinue
    if (-not $openssl) {
      Write-Error 'openssl not found. Install it (Git for Windows bundles it) or supply a cert manually — see README "Certificates".'
      exit 1
    }
    Info 'Generating self-signed localhost cert (SAN: localhost, 127.0.0.1)…'
    & openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout $keyPem -out $certPem `
      -subj '/CN=localhost' `
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    if ($LASTEXITCODE -ne 0) { Write-Error 'openssl cert generation failed.'; exit 1 }
    Ok 'Dev cert generated'
  }
  if ($TrustCert) {
    Info 'Trusting the dev cert in the current user Root store (certutil)…'
    & certutil -user -addstore Root $certPem | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok 'Dev cert trusted (restart the browser to pick it up)' }
    else { Warn 'certutil failed — trust the cert manually (see README).' }
  }
}

# 4. .env — create from the template, then set only the values you passed.
$envPath = './.env'
if (-not (Test-Path $envPath)) {
  Copy-Item './.env.example' $envPath
  Ok 'Created .env from .env.example'
} else {
  Info '.env already exists — updating only the values you passed.'
}

function Set-EnvVar([string]$key, [string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $lines = Get-Content $envPath
  $pattern = "^#?\s*$([regex]::Escape($key))="
  $set = $false
  $out = foreach ($line in $lines) {
    if ($line -match $pattern) { $set = $true; "$key=$value" } else { $line }
  }
  if (-not $set) { $out += "$key=$value" }
  Set-Content -Path $envPath -Value $out -Encoding utf8
  Info "  set $key"
}
Set-EnvVar 'ANTHROPIC_API_KEY' $ApiKey
Set-EnvVar 'QLIK_SESSION_URL'  $QlikSessionUrl
Set-EnvVar 'QLIK_CERT'         $QlikCert
Set-EnvVar 'QLIK_KEY'          $QlikKey
Set-EnvVar 'QLIK_ORIGINS'      $Origins
Set-EnvVar 'LOG_LEVEL'         $LogLevel

# 5. Windows service (optional).
if ($InstallService) {
  Info 'Installing node-windows (dev/ops dependency) and registering the service…'
  & npm install --no-save node-windows
  if ($LASTEXITCODE -ne 0) { Write-Error 'node-windows install failed.'; exit 1 }
  & node service/install-service.js
  if ($LASTEXITCODE -ne 0) { Write-Error 'Service registration failed (run as Administrator).'; exit 1 }
  Ok 'Windows service "cm-llm-proxy" registered (auto-start/restart)'
}

Write-Host ''
Ok 'Setup complete.'
Write-Host '  Next steps:' -ForegroundColor Green
Write-Host '   - Review .env (required: ANTHROPIC_API_KEY, QLIK_SESSION_URL, QLIK_CERT, QLIK_KEY, QLIK_ORIGINS).'
if (-not $InstallService) { Write-Host '   - Start the proxy:  npm start   (or re-run with -InstallService to run it as a service).' }
Write-Host '   - Health check:  https://localhost:3000/health'
