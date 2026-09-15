'use strict';

// Remove the cm-llm-proxy Windows service (P06 rollback). After this, `node server.js`
// still runs the proxy standalone. Run as Administrator:
//
//   node service/uninstall-service.js

const path = require('path');

let Service;
try {
  ({ Service } = require('node-windows'));
} catch {
  console.error('[uninstall-service] node-windows is not installed. Run:');
  console.error('  npm install --no-save node-windows');
  process.exit(1);
}

const svc = new Service({
  // Must match the SERVICE_NAME the service was installed under.
  name: process.env.SERVICE_NAME || 'cm-llm-proxy',
  script: path.join(__dirname, '..', 'server.js'),
});

svc.on('uninstall', () => console.log('[uninstall-service] cm-llm-proxy removed.'));
svc.on('error', (err) => console.error('[uninstall-service] error:', err));

svc.uninstall();
