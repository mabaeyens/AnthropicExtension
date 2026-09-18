# Contributing to AnthropicExtension

Thanks for your interest — this is a Qlik Sense visualization extension that adds an
AI panel to dashboards, developed in spare time. It's a small, single-maintainer
project, but issues, ideas, and pull requests are genuinely welcome. I'll review them
when I can, so please bear with turnaround time.

## Reporting bugs and requesting features

Open an [issue](https://github.com/mabaeyens/AnthropicExtension/issues). For bugs,
please include the Qlik Sense edition (Desktop / QSEoW Enterprise), extension version
(`AnthropicExtension.qext`), and whether it's the extension or the proxy (under
[`proxy/`](./proxy)) that's misbehaving — the two are versioned independently
(`vX.Y.Z` for the extension, `proxy-vX.Y.Z` for the proxy).

**Security issues do not go in public issues** — see [SECURITY.md](SECURITY.md).

## Prerequisites

| Tool | Version |
|------|---------|
| Qlik Sense | Desktop or Enterprise (QSEoW) |
| Node.js | 18+ |

This is a **monorepo**: the extension at the repo root, and its companion proxy under
`proxy/`. The proxy is mandatory, not optional — the browser never holds an Anthropic
API key or calls `api.anthropic.com` directly (see [`docs/security-model.md`](docs/security-model.md)).
If you're working on the extension, you'll need a proxy running locally to exercise it
end to end; see [`proxy/README.md`](proxy/README.md) for setup.

## Building

There's **no build step for the extension** — it's plain AMD/RequireJS JavaScript,
loaded as-is by Qlik Sense. To try a change:

1. Copy the repo folder into Qlik Sense's extensions directory (Desktop:
   `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\`; Enterprise:
   import via QMC), or run [`package.ps1`](package.ps1) to produce an import-ready zip.
2. Reload Qlik Sense and add the extension to a sheet.

The proxy is a normal Node.js app with its own `package.json` — see its README for
running it locally.

## Workflow

- **Spec first.** For anything non-trivial, jot a short spec (problem, files to touch,
  a hard constraint, edge cases, acceptance criteria) before writing code.
- **One feature or fix per pull request.** Keep commits coherent — squash
  trial-and-error noise before opening the PR.
- **Match the surrounding code.** AMD modules only (`define([...], function(...) {})`)
  — no ES modules or CommonJS in the extension. Follow the module boundaries already in
  `js/` (see the file list in [`README.md`](README.md)) rather than introducing new
  cross-cutting abstractions.
- **The proxy is a hard boundary.** Don't add a direct-to-Anthropic code path from the
  browser, and don't loosen caller authentication — both are deliberate security
  requirements, not defaults left over from a prototype.

## Before you open a pull request

- Run `npm test` (Node's `node:test`, covers the extension's dev-only unit tests) and
  `npm run lint` (ESLint) — both must pass.
- There's no automated UI test suite; smoke-test your change manually in a running Qlik
  Sense instance (the golden path, plus whatever edge case you touched).
- Don't commit secrets, API keys, or local config (`.env`, certificates, etc.).
- Update the README / CHANGELOG if the change is user-facing.

## Pull request

Describe what changed and why, link any related issue, and note how you tested it
(Qlik Sense edition, browser). Then open it against `main`.
