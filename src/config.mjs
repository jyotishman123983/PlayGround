import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStoredPhone } from './phone.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = resolve(root, process.env.DATA_DIR || 'data');
for (const dir of ['outputs', 'uploads']) mkdirSync(join(dataDir, dir), { recursive: true });

let sessionSecret = process.env.SESSION_SECRET || '';
if (!sessionSecret) {
  const secretFile = join(dataDir, '.session-secret');
  if (existsSync(secretFile)) {
    sessionSecret = readFileSync(secretFile, 'utf8').trim();
  } else {
    sessionSecret = randomBytes(48).toString('base64url');
    writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
    try { chmodSync(secretFile, 0o600); } catch {}
  }
  if (isProduction) {
    console.warn('[security] SESSION_SECRET is not set. A persistent local secret was generated. Set SESSION_SECRET in production.');
  }
}
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');

const metaToken = process.env.WHATSAPP_TOKEN || process.env.META_WHATSAPP_TOKEN || '';
const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID || '';
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || '';

let whatsappProvider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();
if (!whatsappProvider) {
  if (metaToken && metaPhoneId) whatsappProvider = 'meta';
  else if (twilioSid && twilioToken && twilioFrom) whatsappProvider = 'twilio';
  else whatsappProvider = 'none';
}
const metaConfigured = Boolean(metaToken && metaPhoneId);
const twilioConfigured = Boolean(twilioSid && twilioToken && twilioFrom);
const whatsappConfigured =
  (whatsappProvider === 'meta' && metaConfigured) ||
  (whatsappProvider === 'twilio' && twilioConfigured);

if (isProduction && process.env.ALLOW_DEV_OTP === 'true') {
  console.warn('[security] ALLOW_DEV_OTP is ignored because NODE_ENV=production.');
}
const allowDevOtp = !isProduction && bool(process.env.ALLOW_DEV_OTP, true);

let ffmpegPath = process.env.FFMPEG_PATH || '';
if (!ffmpegPath) {
  try {
    const require = createRequire(import.meta.url);
    ffmpegPath = require('ffmpeg-static') || '';
  } catch {}
}
if (!ffmpegPath || !existsSync(ffmpegPath)) {
  ffmpegPath = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(path => existsSync(path)) || '';
}

const videoProvider = String(process.env.VIDEO_PROVIDER || (process.env.REPLICATE_API_TOKEN ? 'replicate' : 'none')).toLowerCase();
const aiConfigured = videoProvider === 'replicate' && Boolean(process.env.REPLICATE_API_TOKEN);
const demoEnabled = !isProduction && bool(process.env.ENABLE_DEMO, true) && Boolean(ffmpegPath);

const adminPhones = [...new Set(
  String(process.env.ADMIN_PHONE || process.env.INITIAL_ADMIN_PHONE || '+917002063596')
    .split(',')
    .map(normalizeStoredPhone)
    .filter(Boolean)
)];

const fontCandidates = [
  process.env.VIDEO_FONT_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
].filter(Boolean);
const videoFont = fontCandidates.find(path => existsSync(path)) || '';

export const config = Object.freeze({
  root,
  isProduction,
  port: integer(process.env.PORT || process.env.APP_PORT, 3000),
  dataDir,
  databasePath: resolve(root, process.env.DATABASE_PATH || join(dataDir, 'viralyantra.db')),
  sessionSecret,
  sessionDays: integer(process.env.SESSION_DAYS, 30),
  adminPhones,
  allowDevOtp,
  whatsapp: Object.freeze({
    provider: whatsappProvider,
    configured: whatsappConfigured,
    meta: Object.freeze({
      token: metaToken,
      phoneNumberId: metaPhoneId,
      templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'viralyantra_otp',
      templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v21.0',
      usePlainText: bool(process.env.WHATSAPP_USE_PLAIN_TEXT, false)
    }),
    twilio: Object.freeze({
      accountSid: twilioSid,
      authToken: twilioToken,
      from: twilioFrom,
      contentSid: process.env.TWILIO_CONTENT_SID || ''
    })
  }),
  otp: Object.freeze({
    ttlSeconds: integer(process.env.OTP_TTL_SECONDS, 300),
    cooldownSeconds: integer(process.env.OTP_COOLDOWN_SECONDS, 30),
    maxAttempts: integer(process.env.OTP_MAX_ATTEMPTS, 5),
    maxPerPhoneWindow: integer(process.env.OTP_MAX_PER_PHONE_WINDOW, 5),
    phoneWindowMinutes: integer(process.env.OTP_PHONE_WINDOW_MINUTES, 15),
    maxPerIpHour: integer(process.env.OTP_MAX_PER_IP_HOUR, 20),
    testCode: String(process.env.OTP_TEST_CODE || '')
  }),
  pricing: Object.freeze({
    shortsCost: integer(process.env.SHORTS_TOKEN_COST, 25),
    longCost: integer(process.env.LONG_TOKEN_COST, 500),
    signupBonus: integer(process.env.SIGNUP_BONUS_TOKENS, 1000)
  }),
  generation: Object.freeze({
    provider: videoProvider,
    configured: aiConfigured,
    replicateToken: process.env.REPLICATE_API_TOKEN || '',
    replicateModel: process.env.REPLICATE_VIDEO_MODEL || 'minimax/video-01',
    replicateMaxSceneSeconds: integer(process.env.REPLICATE_MAX_SCENE_SECONDS, 30),
    costPerSceneUsd: Number(process.env.AI_COST_PER_SCENE_USD || 0),
    hostingMonthlyUsd: Number(process.env.HOSTING_MONTHLY_COST_USD || 0),
    demoEnabled,
    ffmpegPath,
    fontPath: videoFont,
    shortScenes: integer(process.env.SHORT_SCENE_COUNT, 5),
    longScenes: integer(process.env.LONG_SCENE_COUNT, 20),
    maxPromptLength: integer(process.env.MAX_PROMPT_LENGTH, 2000),
    maxImageBytes: integer(process.env.MAX_IMAGE_BYTES, 6 * 1024 * 1024)
  }),
  limits: Object.freeze({
    jsonBodyBytes: integer(process.env.MAX_JSON_BODY_BYTES, 8 * 1024 * 1024),
    apiPerMinute: integer(process.env.API_RATE_LIMIT_PER_MINUTE, 600)
  })
});

export const durationPlans = Object.freeze({
  30: { id: 'shorts', label: 'YouTube Shorts', seconds: 30, aspectRatio: '9:16', costKey: 'shortsCost' },
  600: { id: 'long', label: 'YouTube Long Video', seconds: 600, aspectRatio: '16:9', costKey: 'longCost' }
});
