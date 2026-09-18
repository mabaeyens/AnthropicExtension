# Backlog

## Done
- [2026-09-18] Public-readiness audit before making the repo public: confirmed no real secrets anywhere in the current tree or the full git history (checked `git log --all -p` for key/token patterns), and that LICENSE, `.gitignore`, CI workflows, `package.json`, and `.qext` metadata are all clean.
- [2026-09-18] Rewrote `SECURITY.md` to drop the stale client-side "API key AES-encrypted in localStorage" description and point to `docs/security-model.md` (the accurate, authoritative source) instead of duplicating it.
- [2026-09-18] Verified the extension builds and tests cleanly on this Mac: `npm ci`, `npm run lint` (clean), `npm test` (52/52 passing), and `pwsh package.ps1` (produces a valid 19-file `AnthropicExtension-v0.5.5.zip`).
- [2026-09-18] Fixed architecture drift in `CLAUDE.md` (local-only, gitignored): removed the stale `js/security.js` reference and documented `js/config-validate.js` / `js/log.js`, which exist but weren't listed.
- [2026-09-18] Synced local Mac clone with origin (pulled 15 commits: v0.5.5/build 45, ESLint 8→10, dependency bumps, doc cleanup).
- [2026-09-18] Rewrote `docs/project-overview.md` and `docs/data-flow.md` from scratch against the current proxy-only architecture (no client-side API key, no `js/security.js`) — the expected "import from the other machine" never materialized since that machine's copy doesn't have these files at all. Committed.
- [2026-09-18] Deleted `js/prompt-store.js` — untracked, unreferenced by any other file, not in the built zip; dead WIP code for `specs/02-custom-prompt-feature.md`.
- [2026-09-18] Added `.obsidian/` and `linkedin-post-2026-09-18.md` to `.gitignore` — both are personal/stray files that don't belong in this repo.
- [2026-09-18] Fresh independent public-readiness re-audit: 7/9. No secrets in history or tree, CI green (52/52 tests), versions consistent everywhere. Confirmed the repo is still private on GitHub.

## Pending
- Flip the GitHub repo to public — everything else was prep, this is the actual step, not yet taken.
- No `CONTRIBUTING.md`. Not a blocker, but CI workflows already imply outside contributions are expected — a short one (CHANGELOG conventions, PR checklist) would round out the public-facing docs.
- `specs/03-rag-support.md` — new spec, not implemented: RAG over a local document folder via mira-core, so chart analysis can be checked against a reference/policy doc.

## Notes
- Personal email `miguel.angel@baeyens.es` appears as author/committer on 89 commits reachable from `main`, included in every published tag from v0.5.0 onward. User explicitly confirmed this is fine — no history rewrite planned.
- `SECURITY.md` is intentionally minimal (just the vulnerability-reporting policy). `docs/security-model.md` is the single source of truth for the security architecture — don't re-add architecture detail to `SECURITY.md`.
