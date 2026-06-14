# Creates AnthropicExtension-v{version}.zip in the project root.
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

$qextPath = Join-Path $PSScriptRoot "AnthropicExtension.qext"
$qextRaw  = [System.IO.File]::ReadAllText($qextPath)
$qextRaw  = [regex]::Replace($qextRaw, '("description"\s*:\s*")(v[\d.]+ build \d+ — )?', "`${1}v$version build $build $([char]0x2014) ")
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
