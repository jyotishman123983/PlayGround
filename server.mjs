import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { config } from './src/config.mjs';
import { db } from './src/db.mjs';
import { ensureSettings } from './src/settings.mjs';
import { handleApi, apiErrorPayload } from './src/api.mjs';
import { attachCookies, securityHeaders, sendText, serveStatic } from './src/http.mjs';
import { recoverStalledJobs } from './src/generation.mjs';
import { cleanupAuthState } from './src/auth.mjs';

ensureSettings();
const recovered = recoverStalledJobs();
if (recovered) console.warn(`[startup] Recovered ${recovered} interrupted generation job(s) and refunded reservations.`);
cleanupAuthState();

const server = createServer(async (req, res) => {
  attachCookies(req);
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendText(res, 400, 'Bad request');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, securityHeaders({ Allow: 'GET, HEAD, POST, PATCH, OPTIONS' }));
    return res.end();
  }

  if (url.pathname === '/healthz') {
    return sendText(res, 200, 'ok');
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const { status, body } = apiErrorPayload(error);
      res.writeHead(status, securityHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }));
      res.end(JSON.stringify(body));
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed');
  }

  if (serveStatic(req, res, url.pathname)) return;
  if (!url.pathname.includes('.') && String(req.headers.accept || '').includes('text/html')) {
    if (serveStatic(req, res, '/index.html')) return;
  }
  sendText(res, 404, 'Not found');
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(config.port, '0.0.0.0', () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : config.port;
  console.log(`[ViralYantra AI] listening on http://0.0.0.0:${boundPort}`);
  console.log(`[ViralYantra AI] env=${config.isProduction ? 'production' : 'development'} whatsapp=${config.whatsapp.configured ? config.whatsapp.provider : (config.allowDevOtp ? 'development-otp' : 'unconfigured')} ai=${config.generation.configured ? config.generation.provider : (config.generation.demoEnabled ? 'demo' : 'unconfigured')}`);
  if (process.env.OPENCODE_WEB_DIR) {
    try {
      writeFileSync(join(process.env.OPENCODE_WEB_DIR, 'deployment-output.json'), JSON.stringify({
        project: config.root,
        directory: join(config.root, 'public'),
        server: 'node server.mjs'
      }));
    } catch (error) {
      console.warn('[startup] Could not write deployment-output.json:', error.message);
    }
  }
});

const cleanupTimer = setInterval(() => {
  try { cleanupAuthState(); } catch (error) { console.error('[cleanup]', error.message); }
}, 60 * 60 * 1000);
cleanupTimer.unref();

function shutdown(signal) {
  console.log(`[ViralYantra AI] ${signal} received, shutting down.`);
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
