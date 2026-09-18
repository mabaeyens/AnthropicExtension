# Security Policy

## Reporting a vulnerability

If you discover a security issue, please **do not open a public issue**. Instead,
report it privately via [GitHub Security Advisories](https://github.com/mabaeyens/AnthropicExtension/security/advisories/new)
or by contacting the maintainer directly. You'll get an acknowledgement as soon
as possible, and a fix or mitigation will be coordinated before any public
disclosure.

## Security model

The extension is proxy-only: the browser never holds an Anthropic API key and never
calls `api.anthropic.com` directly. The proxy under [`proxy/`](./proxy) holds the key
server-side and authenticates callers by their Qlik session. See
[`docs/security-model.md`](docs/security-model.md) for the full actor and
trust-boundary breakdown, and [`docs/concurrency-model.md`](docs/concurrency-model.md)
for the companion request-admission contract.

## Scope

This is a community project provided "as is" (see [LICENSE](LICENSE)). There is no
guaranteed response time, but reports are genuinely appreciated.
