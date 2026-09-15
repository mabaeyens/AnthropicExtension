<#
.SYNOPSIS
  One-shot setup for the cm-llm-proxy on a Windows (QSEoW) node. Automates the
  mechanical install steps; you still supply the site secrets (API key, Qlik auth).

.DESCRIPTION
  Runs, idempotently:
    1. Verify Node.js (>= 18) is on PATH.
    2. npm ci  (install proxy dependencies from the lockfile).
    3. -DevCert:  generate a dedicated local dev CA into ./certs/ca (if missing), then a
                  proper end-entity leaf cert signed by it into ./certs (CN/SAN from
                  -CertHosts). With -TrustCert, only the CA is added to the current
                  user's Root store — not the leaf — so a future leaf rotation (or a
                  second hostname) never needs re-trusting. (Production uses a CA-signed
                  cert from your own internal/enterprise CA instead — set TLS_CERT/
                  TLS_KEY in .env; see README "Production certificate".)
    4. Create/patch .env from .env.example with any values you pass (ANTHROPIC_API_KEY,
       QLIK_SESSION_URL, QLIK_CERT, QLIK_KEY, QLIK_ORIGINS, LOG_LEVEL). Existing values
       are only overwritten for the parameters you provide.
    5. -InstallService:  install node-windows and register the auto-start/restart
       "cm-llm-proxy" Windows service (stop triggers the graceful drain).

  What it deliberately does NOT do: invent secrets. The API key and the Qlik
  session-validation URL + client certificates are yours to provide.

.EXAMPLE
  # Local dev: deps + a trusted dev-CA-signed cert (SAN: localhost, 127.0.0.1, and the
  # real hostname clients will use) + a starter .env, then run by hand.
  pwsh scripts/setup.ps1 -DevCert -TrustCert -CertHosts 'spmad-mby1,spmad-mby1.qliktech.com' -ApiKey 'sk-ant-...' `
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
  # Comma-separated, e.g. 'spmad-mby1,spmad-mby1.qliktech.com' — a string, not an array:
  # array-typed params don't reliably survive a `pwsh -File` invocation from outside
  # PowerShell (the comma can arrive as literal text rather than an element separator).
  [string] $CertHosts = '',
  [switch] $TrustCert,
  [switch] $InstallService,
  [switch] $WithDevDeps
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

# 2. Dependencies — RUNTIME only (--omit=dev). The proxy runtime needs just
# axios/cors/dotenv/express; ESLint (a devDependency) and its deep, deprecated tree are
# for CI/local lint only and must NOT land on a production node (that tree is where the
# npm-audit "high severity" findings come from). Use -WithDevDeps to include them.
Info 'Installing runtime dependencies (npm ci --omit=dev)…'
$omit = if ($WithDevDeps) { @() } else { @('--omit=dev') }
if (Test-Path 'package-lock.json') { & npm ci @omit } else { & npm install @omit }
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed.'; exit 1 }
Ok 'Dependencies installed'

# 3. Dev TLS certificate: a dedicated local CA (once), then a proper leaf cert signed by
# it (every run, if missing). Two tiers so -TrustCert only ever has to trust the CA —
# rotating the leaf, or adding a second hostname, never needs a re-import.
if ($DevCert) {
  New-Item -ItemType Directory -Force './certs' | Out-Null
  New-Item -ItemType Directory -Force './certs/ca' | Out-Null
  $openssl = Get-Command openssl -ErrorAction SilentlyContinue
  if (-not $openssl) {
    Write-Error 'openssl not found. Install it (Git for Windows bundles it) or supply a cert manually — see README "Certificates".'
    exit 1
  }

  $caKey  = './certs/ca/proxy-dev-ca-key.pem'
  $caCert = './certs/ca/proxy-dev-ca-cert.pem'
  if ((Test-Path $caKey) -and (Test-Path $caCert)) {
    Info 'Dev CA already present — skipping generation.'
  } else {
    Info 'Generating dedicated dev CA (private to this checkout, not Qlik''s own PKI)…'
    & openssl req -x509 -newkey rsa:2048 -nodes -days 3650 `
      -keyout $caKey -out $caCert `
      -subj '/CN=AnthropicExtension Proxy Dev CA' `
      -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' `
      -addext 'keyUsage=critical,keyCertSign,cRLSign'
    if ($LASTEXITCODE -ne 0) { Write-Error 'openssl CA generation failed.'; exit 1 }
    Ok 'Dev CA generated (certs/ca/) — keep certs/ca/*.pem out of source control, it can mint further certs'
  }

  $certPem = './certs/localhost3000-cert.pem'
  $keyPem  = './certs/localhost3000-key.pem'
  if ((Test-Path $certPem) -and (Test-Path $keyPem)) {
    Info 'Leaf cert already present — skipping generation.'
  } else {
    $extraHosts = if ($CertHosts) { $CertHosts -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @() }
    $hosts = @('localhost', '127.0.0.1') + $extraHosts | Select-Object -Unique
    $san = ($hosts | ForEach-Object {
      if ($_ -match '^\d{1,3}(\.\d{1,3}){3}$') { "IP:$_" } else { "DNS:$_" }
    }) -join ','
    Info "Generating leaf cert signed by the dev CA (SAN: $san)…"
    $csr = './certs/localhost3000.csr'
    $extFile = './certs/leaf-ext.cnf'
    @(
      'basicConstraints=critical,CA:FALSE'
      'keyUsage=critical,digitalSignature,keyEncipherment'
      'extendedKeyUsage=serverAuth'
      "subjectAltName=$san"
    ) | Set-Content -Path $extFile -Encoding ascii
    & openssl req -new -newkey rsa:2048 -nodes -keyout $keyPem -out $csr -subj '/CN=AnthropicExtension Proxy'
    if ($LASTEXITCODE -ne 0) { Write-Error 'openssl CSR generation failed.'; exit 1 }
    & openssl x509 -req -in $csr -CA $caCert -CAkey $caKey -CAcreateserial -days 825 -sha256 `
      -extfile $extFile -out $certPem
    if ($LASTEXITCODE -ne 0) { Write-Error 'openssl leaf signing failed.'; exit 1 }
    Remove-Item $csr, $extFile -ErrorAction SilentlyContinue
    Ok 'Leaf cert generated and signed by the dev CA'
  }

  if ($TrustCert) {
    Info 'Trusting the dev CA (not the leaf) in the current user Root store (certutil)…'
    & certutil -user -addstore Root $caCert | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Ok 'Dev CA trusted (restart the browser to pick it up)'
      Warn 'Firefox keeps its own certificate store: import certs/ca/proxy-dev-ca-cert.pem there too, or enable security.enterprise_roots.enabled in about:config — see README "Certificates".'
    } else { Warn 'certutil failed — trust the CA manually (see README).' }
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
