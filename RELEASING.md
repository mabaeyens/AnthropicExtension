# Releasing the AnthropicExtension (immutable releases)

Releases are **immutable**: a published tag/release always points to the exact code and
zip it shipped with. **Never** `git push -f` a published tag or `gh release upload
--clobber` a published asset. For any change that warrants a release, cut a **new** patch
version. (These rules are codified from `CLAUDE.md`; `scripts/pre-release-check.ps1`
enforces the cheap, checkable parts.)

## Checklist

1. **Bump the version** in the single source of truth and the manifest, together:
   - `VERSION` in `js/config.js`
   - `version` in `AnthropicExtension.qext`
   - Bump `BUILD` in `js/config.js` by 1.
   `package.ps1` fails if `js/config.js` VERSION ≠ `.qext` version (E07 §4.3).
2. **Add a `CHANGELOG.md` entry** for the new version (a `## vX.Y.Z` heading).
3. **Lint + test:** `npm run lint && npm test` (extension) — both green.
4. **Package:** `powershell -NoProfile -ExecutionPolicy Bypass -File ./package.ps1`
   → produces `AnthropicExtension-v<version>.zip` (runtime files only).
5. **Pre-release guard:** `pwsh scripts/pre-release-check.ps1 vX.Y.Z`
   — refuses if the tag already exists, if `CHANGELOG.md` has no entry for the version,
   or if `js/config.js`/`.qext` disagree on the version.
6. **Tag + release (new tag only):**
   ```
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z AnthropicExtension-vX.Y.Z.zip --notes-file <notes>
   ```
   Commit messages carry **no** `Co-Authored-By` trailer (project rule).

## Never

- Re-point or force-push a published tag.
- `--clobber` a published release asset.
- Ship secrets or environment-specific values in `js/**` (there is no API key after E01;
  the proxy URL is a per-instance property / config default, not a secret).
