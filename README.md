# cm-llm-proxy

Local HTTPS proxy that forwards requests from the Qlik Sense [AnthropicExtension](https://github.com/mabaeyens/AnthropicExtension) to the Anthropic API.

## Why is this needed?

Qlik Sense Server enforces CORS restrictions and does not allow direct calls to external APIs from the browser. This proxy runs on the Qlik server (or locally) and acts as a secure intermediary.

```
Qlik Sense (browser) → https://localhost:3000/api/anthropic → api.anthropic.com
```

## Requirements

- Node.js >= 18
- SSL certificates for `localhost:3000` (see Certificates section)

## Setup

```bash
# 1. Copy and edit the environment file
cp .env.example .env
# Edit .env: set QLIK_ORIGIN to your Qlik Sense server URL

# 2. Install dependencies
npm install
```

## Configuration

All settings are configured via `.env` (copied from `.env.example`):

| Variable | Description | Default |
|---|---|---|
| `QLIK_ORIGIN` | Qlik Sense server URL allowed by CORS | `https://your-qlik-server` |
| `PORT` | Proxy server port | `3000` |

## Certificates

The files `certs/localhost3000-cert.pem` and `certs/localhost3000-key.pem` in the repo are **empty placeholders**. Generate your own self-signed certificates:

```bash
openssl req -x509 -newkey rsa:4096 -keyout certs/localhost3000-key.pem \
  -out certs/localhost3000-cert.pem -days 365 -nodes \
  -subj "/CN=localhost"
```

> The certificate must be imported as trusted in the browser and in Qlik Sense to avoid SSL errors.

## Usage

```bash
npm start
```

The server starts at `https://localhost:3000`. Available endpoints:

- `GET  /health` — Check that the proxy is running
- `POST /api/anthropic` — Forwards the request to `api.anthropic.com/v1/messages`

The Anthropic API key is passed per request via the `x-api-key` header (managed by the Qlik extension).

## Related repositories

- [AnthropicExtension](https://github.com/mabaeyens/AnthropicExtension): Qlik Sense extension that consumes this proxy
- [RAG](https://github.com/mabaeyens/RAG): RAG pipeline with ChromaDB and local embeddings
