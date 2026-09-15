# Maintainer/dev tooling: creates AnthropicExtension-v{version}.zip in the project root
# from the runtime files (not needed to just run the extension from source).
# Run from any location: .\package.ps1

Set-Location $PSScriptRoot

# Read version from the .qext manifest
$qext   = Get-Content "AnthropicExtension.qext" | ConvertFrom-Json
$version = $qext.version
$zipName = "AnthropicExtension-v$version.zip"
$zipPath = Join-Path $PSScriptRoot $zipName

# Stamp the current build into the .qext description so the extension's preview
# text in Qlik always shows "v<version> build <n>" — makes it easy to confirm
# you re-imported the latest. The build number lives in js/config.js (BUILD),
# the single source of truth. The replace is idempotent: any existing
# "v… build … — " prefix is stripped before the fresh one is prepended.
$configText = Get-Content (Join-Path $PSScriptRoot "js/config.js") -Raw
$build = if ($configText -match 'BUILD:\s*(\d+)') { $matches[1] } else { '0' }

# Version-match guard (E07 §4.3): config.js VERSION is the single source of truth and
# must equal the .qext version, or a forgotten bump ships a mislabelled zip. Fail loudly.
$cfgVersion = if ($configText -match "VERSION:\s*'([^']+)'") { $matches[1] } else { $null }
if ($cfgVersion -ne $version) {
  Write-Error "Version mismatch: js/config.js VERSION ('$cfgVersion') != AnthropicExtension.qext version ('$version'). Bump both before packaging."
  exit 1
}
Write-Host "Version check OK: config.js and .qext both at v$version"

$qextPath = Join-Path $PSScriptRoot "AnthropicExtension.qext"
$qextRaw  = [System.IO.File]::ReadAllText($qextPath)
# The em dash is built from its code point on BOTH sides: a literal — in this
# script is mis-decoded under Windows PowerShell 5.1, so the strip-pattern would
# never match and the prefix would be stamped twice.
$dash     = [char]0x2014
$stampRe  = '("description"\s*:\s*")(v[\d.]+ build \d+ ' + $dash + ' )?'
$qextRaw  = [regex]::Replace($qextRaw, $stampRe, "`${1}v$version build $build $dash ")
[System.IO.File]::WriteAllText($qextPath, $qextRaw)   # UTF-8, no BOM
Write-Host "Stamped .qext description: v$version build $build"

# Staging folder — files are assembled here before compression
$stagingRoot = Join-Path $PSScriptRoot "_staging"
$staging     = Join-Path $stagingRoot "AnthropicExtension"
if (Test-Path $stagingRoot) { Remove-Item $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Force $staging | Out-Null

# Copy only the files Qlik needs to run the extension
Copy-Item "AnthropicExtension.js"   $staging
Copy-Item "AnthropicExtension.qext" $staging
Copy-Item "icon.png"                $staging
Copy-Item "css"  (Join-Path $staging "css")  -Recurse
Copy-Item "html" (Join-Path $staging "html") -Recurse
Copy-Item "js"   (Join-Path $staging "js")   -Recurse

# Compress staging → ZIP, then clean up
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $staging -DestinationPath $zipPath
Remove-Item $stagingRoot -Recurse -Force

Write-Host "Created: $zipName"
