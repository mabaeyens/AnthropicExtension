# Maintainer/dev tooling: pre-release guard (E07 §4.4/§4.5). Refuses to proceed unless
# the immutable-release invariants hold. Run from anywhere:
#     pwsh scripts/pre-release-check.ps1 vX.Y.Z
#
# Checks:
#   1. The tag does NOT already exist (never re-point a published tag).
#   2. js/config.js VERSION == AnthropicExtension.qext version, and both match the tag.
#   3. CHANGELOG.md has an entry for the version.
# Exits non-zero (and prints why) on any failure; prints an OK summary otherwise.

param(
  [Parameter(Mandatory = $true)]
  [string] $Tag   # e.g. v0.5.0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = @()

# Normalise: tag "vX.Y.Z" → version "X.Y.Z"
$version = $Tag -replace '^v', ''

# 1. Tag must be new.
$existing = git tag --list $Tag
if ($existing) { $fail += "Tag '$Tag' already exists -- releases are immutable; bump the patch version instead." }

# 2. Version single-sourcing: config.js VERSION == .qext version == tag.
$configText = Get-Content (Join-Path $root 'js/config.js') -Raw
$cfgVersion = if ($configText -match "VERSION:\s*'([^']+)'") { $matches[1] } else { $null }
$qext = Get-Content (Join-Path $root 'AnthropicExtension.qext') -Raw | ConvertFrom-Json
$qextVersion = $qext.version

if ($cfgVersion -ne $qextVersion) { $fail += "js/config.js VERSION ('$cfgVersion') != .qext version ('$qextVersion')." }
if ($cfgVersion -ne $version)     { $fail += "js/config.js VERSION ('$cfgVersion') != requested tag ('$version'). Bump VERSION/BUILD first." }

# 3. CHANGELOG entry for the version.
$changelogPath = Join-Path $root 'CHANGELOG.md'
if (-not (Test-Path $changelogPath)) {
  $fail += 'CHANGELOG.md is missing.'
} else {
  $changelog = Get-Content $changelogPath -Raw
  if ($changelog -notmatch [regex]::Escape($version)) {
    $fail += "CHANGELOG.md has no entry for '$version'. Add a '## v$version' section before releasing."
  }
}

if ($fail.Count -gt 0) {
  Write-Host 'Pre-release check FAILED:' -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "Pre-release check OK for $Tag (config.js/.qext/tag all v$version; CHANGELOG entry present; tag is new)." -ForegroundColor Green
