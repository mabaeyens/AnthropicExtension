---
name: package-extension
description: Remove any previous AnthropicExtension ZIP and build a fresh import-ready ZIP for Qlik Sense. Use when asked to package, zip, build, or release the extension for QMC/Desktop import.
model: haiku
allowed-tools: Bash, Read
---

# Package the AnthropicExtension for Qlik Sense

Build a clean, import-ready ZIP of this Qlik Sense visualization extension. The
task is fully deterministic — follow these steps exactly, do not improvise file
selection.

## What goes in the ZIP

Qlik imports a ZIP whose **single top-level folder is `AnthropicExtension/`**
containing only the runtime files (the `.qext` manifest must sit next to the
entry JS). The canonical file list lives in `package.ps1`:

- `AnthropicExtension.js` (entry point)
- `AnthropicExtension.qext` (manifest — its `version` field names the ZIP)
- `icon.png`
- `css/`, `html/`, `js/` (recursively)

Docs, `.git`, `.claude`, `package.ps1`, `_staging/`, and old ZIPs are **excluded**.

## Steps

1. **Confirm you are in the project root** (the folder containing
   `AnthropicExtension.qext`):
   ```bash
   ls AnthropicExtension.qext package.ps1
   ```

2. **Remove every previous build ZIP** (all versions, not just the current one):
   ```bash
   rm -f AnthropicExtension-v*.zip
   ```

3. **Build the fresh ZIP** by running the canonical packager. It reads the
   version from the `.qext`, stages only the runtime files into a temp folder,
   compresses to `AnthropicExtension-v<version>.zip`, and cleans up:
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File ./package.ps1
   ```

4. **Verify the result** — confirm exactly one ZIP exists and inspect its
   contents (every path must start with `AnthropicExtension/`):
   ```bash
   ls AnthropicExtension-v*.zip
   powershell -NoProfile -Command "Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead((Resolve-Path AnthropicExtension-v*.zip)).Entries | ForEach-Object FullName"
   ```

5. **Report** the ZIP filename, its size, and the top-level entry count. Flag a
   problem if: no ZIP was produced, more than one ZIP remains, the `js/` folder
   is missing from the archive, or any entry is not under `AnthropicExtension/`.

## Notes

- If `package.ps1` is missing, the file list above is the source of truth — stage
  those files under an `AnthropicExtension/` folder and compress that folder.
- Do **not** bump the version here; packaging only reflects the current `.qext`.
- This skill never edits source files — it only deletes old ZIPs and produces a
  new one.
