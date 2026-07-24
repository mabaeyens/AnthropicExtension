# Security model (target architecture)

> **Status: design reference for the in-progress production-hardening effort.**
> This describes the **target** state, not the current one. The shipped **v0.4.0 is a
> demo**: it holds the Anthropic API key (obfuscated) in the browser and the proxy
> authenticates no one — see the disclaimer in [`../README.md`](../README.md). The
> boundaries and controls below are realised by the hardening work (credential custody,
> caller authentication, proxy-only transport). Until those land, treat the current
> behaviour as demo-grade.

This is the authoritative reference the security-bearing hardening work cites. It
defines who the actors are, where the trust boundaries sit, what crosses them, and
what the hardening removes.

## Actors & identities

| Actor | Description | Identity origin |
|---|---|---|
| **Analyst** | An authenticated Qlik Sense user in a browser, using the extension. | The Qlik session (cookie/ticket), resolved to a user id by the proxy. |
| **Proxy** | A trusted server process on the Qlik node holding the upstream credential. The only component that talks to Anthropic. | Service identity (least-privilege Windows service account). |
| **Upstream** | Anthropic API (hosted) or local Ollama (on-node). | Out of identity scope — a downstream dependency. |

## Trust boundaries

Every boundary below must validate/authorise what crosses it. Each names the control
and where it is implemented.

| # | Boundary | What crosses | Control (target) |
|---|---|---|---|
| **B1** | Browser → Proxy | The analyst's request (question + chart data + data-model context) and their Qlik session reference. | Caller authentication (validate the Qlik session), strict origin allowlist + rate limiting, per-route body validation. |
| **B2** | Proxy → Anthropic | The request body + the **server-held** key. | Key injected server-side; TLS to the public API; client-supplied keys stripped. |
| **B3** | Proxy → Ollama | The request body (no key). | Localhost plaintext on the node; never exposed to the browser directly (mixed-content + no auth). |
| **B4** | Proxy → Qlik Repository/Proxy API | The session reference, for validation. | Mutual-TLS call using the proxy's client certificate. |

## Assets & their location (target)

| Asset | Location after hardening | Notes |
|---|---|---|
| **Upstream API key** | **Server only** (env / OS secret store). | Never in the browser, never logged, never in an error body. |
| **Qlik session credential** | Browser → proxy per request. | Used for validation; not persisted by the proxy. |
| **Chart data + data-model context** | Leaves the environment only on **hosted** models; stays on-node on **local** models. | Unchanged by hardening; restated here for completeness. The ~65 KB pre-send warning and the data-collection caps bound the volume. |

## Removed by the hardening (must not reappear)

- **Browser-side key storage.** Delete `js/security.js`, `js/lib/crypto-js.min.js`, the
  bundled passphrase, and the API-key property.
- **Direct browser → Anthropic transport**, including the
  `anthropic-dangerous-direct-browser-access` header path. All traffic goes through the
  authenticated proxy.

A grep for `crypto-js`, `x-api-key`, `getAPIKey`, or `dangerous-direct-browser` under
`js/` must return nothing once the transport hardening lands.

## Residual risks

| Risk | Disposition |
|---|---|
| A compromised proxy host exposes the key. | Mitigated (not solved) by OS secret store + least-privilege service account. |
| A valid analyst can still cause cost / data egress. | Mitigated by per-user rate limits and audit; not eliminated — an authorised user asking questions is the intended use. |
| The local-model path trusts the node. | Accepted: no secret is involved; nothing leaves the machine. |
| Qlik validation API outage blocks all users. | A dependency failure returns `503` (not `401`); readiness checks surface it at startup. |

## See also

- [`concurrency-model.md`](./concurrency-model.md) — the companion contract for
  request admission, queueing, and cancellation.
- The per-area hardening specifications (credential custody, caller authentication,
  transport hardening, proxy-only transport) implement the controls named above.
