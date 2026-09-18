# Backlog

## Done
- [2026-09-18] Public-readiness audit before making the repo public: confirmed no real secrets anywhere in the current tree or the full git history (checked `git log --all -p` for key/token patterns), and that LICENSE, `.gitignore`, CI workflows, `package.json`, and `.qext` metadata are all clean.
- [2026-09-18] Rewrote `SECURITY.md` to drop the stale client-side "API key AES-encrypted in localStorage" description and point to `docs/security-model.md` (the accurate, authoritative source) instead of duplicating it.
- [2026-09-18] Verified the extension builds and tests cleanly on this Mac: `npm ci`, `npm run lint` (clean), `npm test` (52/52 passing), and `pwsh package.ps1` (produces a valid 19-file `AnthropicExtension-v0.5.5.zip`).
- [2026-09-18] Fixed architecture drift in `CLAUDE.md` (local-only, gitignored): removed the stale `js/security.js` reference and documented `js/config-validate.js` / `js/log.js`, which exist but weren't listed.
- [2026-09-18] Synced local Mac clone with origin (pulled 15 commits: v0.5.5/build 45, ESLint 8→10, dependency bumps, doc cleanup).

## Pending
- Import updated `docs/project-overview.md` and `docs/data-flow.md` from the other machine. The current untracked copies still describe the pre-hardening architecture (client-side API key, `js/security.js`, `cm-llm-proxy` as an external repo) and must not be committed as-is.
- `js/prompt-store.js` (untracked) — WIP implementation of the multi-chart + prompt-template feature (`specs/02-custom-prompt-feature.md`); not yet wired into `ui-controller.js`, not committed.
- Decide whether to add `.obsidian/` and `linkedin-post-*.md` to `.gitignore` before publishing — both are currently untracked but unignored, so a careless `git add -A` could sweep them into the public repo. Offered, not yet confirmed.
- `specs/03-rag-support.md` — new spec, not implemented: RAG over a local document folder via mira-core, so chart analysis can be checked against a reference/policy doc.

## Notes
- Personal email `miguel.angel@baeyens.es` appears as author/committer on 89 commits reachable from `main`, included in every published tag from v0.5.0 onward. User explicitly confirmed this is fine — no history rewrite planned.
- `SECURITY.md` is intentionally minimal (just the vulnerability-reporting policy). `docs/security-model.md` is the single source of truth for the security architecture — don't re-add architecture detail to `SECURITY.md`.
