import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { config } from './config.mjs';
import { parseCookies, serializeCookie } from './security.mjs';
import { ApiError } from './errors.mjs';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...(config.isProduction ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    ...extra
  };
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  }));
  res.end(body);
}

export function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, securityHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders
  }));
  res.end(text);
}

export function setCookie(res, name, value, options) {
  const existing = res.getHeader('Set-Cookie');
  const cookie = serializeCookie(name, value, options);
  if (existing) res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
  else res.setHeader('Set-Cookie', cookie);
}

export function clearCookie(res, name, options) {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}

export function parseBody(req, maxBytes = config.limits.jsonBodyBytes) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ApiError(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export function attachCookies(req) {
  req.cookies = parseCookies(req.headers.cookie || '');
}

export function serveStatic(req, res, urlPath) {
  const publicDir = resolve(config.root, 'public');
  let relative = decodeURIComponent(urlPath.split('?')[0]);
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative.includes('\0')) return false;
  const filePath = normalize(join(publicDir, relative));
  if (!(filePath === publicDir || filePath.startsWith(`${publicDir}/`))) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }
  const stats = statSync(filePath);
  const extension = extname(filePath).toLowerCase();
  const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, securityHeaders({ ETag: etag }));
    res.end();
    return true;
  }
  res.writeHead(200, securityHeaders({
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
    'Content-Length': stats.size,
    ETag: etag
  }));
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(filePath).pipe(res);
  return true;
}

export function sendFile(req, res, filePath, { mime = 'application/octet-stream', filename = 'video.mp4', inline = false } = {}) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new ApiError(404, 'FILE_NOT_FOUND', 'The requested file is not available.');
  }
  const stats = statSync(filePath);
  const headers = securityHeaders({
    'Content-Type': mime,
    'Content-Length': stats.size,
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(filename).replace(/["\\]/g, '')}"`,
    'Accept-Ranges': 'bytes'
  });
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
      if (start <= end && start < stats.size) {
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stats.size}`, 'Content-Length': end - start + 1 });
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(filePath).pipe(res);
}
