import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';
import { ApiError } from './errors.mjs';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hmac(value) {
  return createHmac('sha256', config.sessionSecret).update(String(value)).digest('hex');
}

export function hashOtp(code, salt) {
  return hmac(`otp:${salt}:${code}`);
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateOtp() {
  if (!config.isProduction && config.otp.testCode && /^\d{6}$/.test(config.otp.testCode)) return config.otp.testCode;
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

export function cookieOptions(req) {
  const secure = config.isProduction || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60
  };
}

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.lastSweep = Date.now();
  }

  check(key, limit, windowMs) {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
      this.lastSweep = now;
    }
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new ApiError(429, 'RATE_LIMITED', `Too many requests. Try again in ${retryAfter} seconds.`, { retryAfter });
    }
  }
}

export const apiLimiter = new RateLimiter();
export const otpSendLimiter = new RateLimiter();
export const otpVerifyLimiter = new RateLimiter();
