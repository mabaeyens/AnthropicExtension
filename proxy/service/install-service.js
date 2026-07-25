'use strict';

// Install the proxy as an auto-start / auto-restart Windows service (P06 §4.7).
// Requires node-windows (a dev/ops dependency, installed separately so the runtime
// stays lean): npm install --no-save node-windows, then run this as Administrator.
//
//   node service/install-service.js
//
// Service stop triggers the P03 graceful drain via SIGTERM handling in server.js.
// Run the service under a least-privilege account that can read the TLS + Qlik certs.

const path = require('path');

let Service;
try {
  ({ Service } = require('node-windows'));
} catch {
  console.error('[install-service] node-windows is not installed. Run:');
  console.error('  npm install --no-save node-windows');
  process.exit(1);
}

const svc = new Service({
  name: 'cm-llm-proxy',
  description: 'Qlik Sense → Anthropic/Ollama hardened LLM proxy',
  script: path.join(__dirname, '..', 'server.js'),
  // Auto-restart with backoff on crash.
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  // Environment is read from .env by dotenv at boot; nothing secret is placed here.
  env: [{ name: 'NODE_ENV', value: 'production' }],
});

svc.on('install', () => {
  console.log('[install-service] installed; starting…');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('[install-service] already installed.'));
svc.on('start', () => console.log('[install-service] cm-llm-proxy is running.'));
svc.on('error', (err) => console.error('[install-service] error:', err));

svc.install();
