import { config } from './config.mjs';
import { addSeconds, nowIso, one, run, transaction } from './db.mjs';
import { ApiError } from './errors.mjs';
import { sendWhatsAppOtp, whatsappStatus } from './otp-provider.mjs';
import { maskPhone, normalizePhone } from './phone.mjs';
import {
  generateOtp,
  hashOtp,
  otpSendLimiter,
  otpVerifyLimiter,
  clientIp,
  randomToken,
  safeEqual,
  sha256
} from './security.mjs';
import { grantSignupBonusTx, walletView } from './wallet.mjs';

function userByPhone(phone) {
  return one('SELECT * FROM users WHERE phone_e164 = ?', phone);
}

function userById(id) {
  return one('SELECT * FROM users WHERE id = ?', id);
}

function isAdminPhone(phone) {
  return config.adminPhones.includes(phone);
}

function auditAdminRole(user, ip) {
  const timestamp = nowIso();
  run(
    `INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, details_json, ip, created_at)
     VALUES (?, ?, 'admin_role_assigned', ?, ?, ?, ?)`,
    randomToken(16), null, user.id, JSON.stringify({ phone: user.phone_e164, reason: 'Verified initial administrator phone' }), ip, timestamp
  );
}

function createSessionTx(userId, req) {
  const rawToken = randomToken(32);
  const csrfToken = randomToken(24);
  const id = randomToken(16);
  const timestamp = nowIso();
  const expiresAt = addSeconds(config.sessionDays * 24 * 60 * 60);
  run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, sha256(rawToken), csrfToken, expiresAt, timestamp, timestamp,
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 200),
    String(req.headers['user-agent'] || '').slice(0, 500)
  );
  return { rawToken, csrfToken, expiresAt };
}

export function toPublicUser(user) {
  return {
    id: user.id,
    phone: user.phone_e164,
    phoneMasked: maskPhone(user.phone_e164),
    countryCode: user.country_code,
    role: user.role,
    isAdmin: user.role === 'admin',
    status: user.status,
    verified: Boolean(user.verified_at),
    verifiedAt: user.verified_at,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at
  };
}

export async function requestOtp({ countryCode, national, req }) {
  const phone = normalizePhone(countryCode, national);
  const ip = clientIp(req);
  otpSendLimiter.check(`otp-send:ip:${ip}`, config.otp.maxPerIpHour, 60 * 60 * 1000);

  const windowStart = addSeconds(-config.otp.phoneWindowMinutes * 60);
  const phoneCount = one(
    'SELECT COUNT(*) AS count FROM otp_challenges WHERE phone_e164 = ? AND created_at >= ?',
    phone.phone, windowStart
  );
  if (phoneCount.count >= config.otp.maxPerPhoneWindow) {
    throw new ApiError(429, 'OTP_LIMIT_REACHED', 'Too many OTP requests for this number. Please wait before trying again.', {
      retryAfter: config.otp.phoneWindowMinutes * 60
    });
  }

  const latest = one(
    'SELECT last_sent_at FROM otp_challenges WHERE phone_e164 = ? ORDER BY created_at DESC LIMIT 1',
    phone.phone
  );
  if (latest) {
    const elapsed = (Date.now() - new Date(latest.last_sent_at).getTime()) / 1000;
    if (elapsed < config.otp.cooldownSeconds) {
      const retryAfter = Math.max(1, Math.ceil(config.otp.cooldownSeconds - elapsed));
      throw new ApiError(429, 'OTP_COOLDOWN', `Please wait ${retryAfter} seconds before requesting another code.`, { retryAfter });
    }
  }

  if (!config.whatsapp.configured && !config.allowDevOtp) {
    throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp OTP is not configured. Add WhatsApp Business Platform credentials on the server to enable real verification.', {
      provider: whatsappStatus().provider,
      required: [
        'WHATSAPP_PROVIDER=meta',
        'WHATSAPP_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_TEMPLATE_NAME',
        'WHATSAPP_TEMPLATE_LANGUAGE'
      ]
    });
  }

  const code = generateOtp();
  const salt = randomToken(16);
  const challengeId = randomToken(24);
  const timestamp = nowIso();
  const expiresAt = addSeconds(config.otp.ttlSeconds);
  const devMode = !config.whatsapp.configured;

  run("UPDATE otp_challenges SET status = 'expired' WHERE phone_e164 = ? AND status = 'pending'", phone.phone);
  run(
    `INSERT INTO otp_challenges
      (id, phone_e164, code_hash, salt, expires_at, attempts, max_attempts, resend_count, last_sent_at,
       status, provider, dev_mode, request_ip, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    challengeId, phone.phone, hashOtp(code, salt), salt, expiresAt,
    config.otp.maxAttempts, latest ? 1 : 0, timestamp,
    devMode ? 'development' : config.whatsapp.provider, devMode ? 1 : 0, ip, timestamp
  );

  let deliveryWarning = null;
  if (config.whatsapp.configured) {
    try {
      const messageId = await sendWhatsAppOtp(phone.phone, code);
      run('UPDATE otp_challenges SET provider_message_id = ? WHERE id = ?', messageId, challengeId);
    } catch (error) {
      if (!config.allowDevOtp) {
        run("UPDATE otp_challenges SET status = 'failed' WHERE id = ?", challengeId);
        throw error;
      }
      deliveryWarning = `WhatsApp delivery failed (${error.message}). A development-only code is shown below. It was NOT sent on WhatsApp.`;
      run("UPDATE otp_challenges SET provider = ?, dev_mode = 1 WHERE id = ?", `${config.whatsapp.provider}:failed`, challengeId);
      console.warn(`[otp] WhatsApp delivery failed; using development fallback because ALLOW_DEV_OTP is enabled: ${error.message}`);
    }
  }

  const exposingDevCode = config.allowDevOtp && (!config.whatsapp.configured || deliveryWarning);
  if (exposingDevCode) console.info(`[otp:dev] ${phone.phone} code ${code}`);

  return {
    ok: true,
    challengeId,
    phone: phone.phone,
    phoneMasked: maskPhone(phone.phone),
    expiresIn: config.otp.ttlSeconds,
    resendAfter: config.otp.cooldownSeconds,
    devMode: exposingDevCode,
    devOtp: exposingDevCode ? code : undefined,
    deliveryWarning,
    setupNotice: !config.whatsapp.configured
      ? 'WhatsApp OTP is not configured. This is a development-only verification flow and cannot be used in production.'
      : null
  };
}

export async function verifyOtp({ challengeId, code, req }) {
  const ip = clientIp(req);
  otpVerifyLimiter.check(`otp-verify:ip:${ip}`, 30, 10 * 60 * 1000);
  if (!challengeId || !/^[A-Za-z0-9_-]{10,80}$/.test(String(challengeId))) {
    throw new ApiError(400, 'INVALID_CHALLENGE', 'Verification request is invalid. Request a new OTP.');
  }
  if (!/^\d{6}$/.test(String(code || ''))) {
    throw new ApiError(400, 'INVALID_OTP_FORMAT', 'Enter the 6-digit code from WhatsApp.');
  }
  const challenge = one('SELECT * FROM otp_challenges WHERE id = ?', challengeId);
  if (!challenge) throw new ApiError(400, 'INVALID_CHALLENGE', 'Verification request was not found. Request a new OTP.');
  if (challenge.consumed_at || challenge.status === 'verified') {
    throw new ApiError(409, 'OTP_ALREADY_USED', 'This code has already been used. Request a new OTP.');
  }
  if (challenge.status === 'locked') throw new ApiError(429, 'OTP_LOCKED', 'Too many incorrect attempts. Request a new code.');
  if (challenge.status === 'failed') throw new ApiError(400, 'OTP_DELIVERY_FAILED', 'That code was never delivered. Request a new OTP.');
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    run("UPDATE otp_challenges SET status = 'expired' WHERE id = ?", challenge.id);
    throw new ApiError(410, 'OTP_EXPIRED', 'This code has expired. Request a new OTP.');
  }
  if (challenge.attempts >= challenge.max_attempts) {
    run("UPDATE otp_challenges SET status = 'locked' WHERE id = ?", challenge.id);
    throw new ApiError(429, 'OTP_LOCKED', 'Too many incorrect attempts. Request a new code.');
  }

  if (!safeEqual(hashOtp(String(code), challenge.salt), challenge.code_hash)) {
    const attempts = challenge.attempts + 1;
    const locked = attempts >= challenge.max_attempts;
    run(
      'UPDATE otp_challenges SET attempts = ?, status = ? WHERE id = ?',
      attempts, locked ? 'locked' : challenge.status, challenge.id
    );
    throw new ApiError(locked ? 429 : 401, locked ? 'OTP_LOCKED' : 'INVALID_OTP',
      locked ? 'Too many incorrect attempts. Request a new code.' : 'Incorrect OTP. Check the code and try again.',
      { attemptsRemaining: Math.max(0, challenge.max_attempts - attempts) }
    );
  }

  const result = transaction(() => {
    const consumed = run(
      "UPDATE otp_challenges SET status = 'verified', consumed_at = ? WHERE id = ? AND status = 'pending' AND consumed_at IS NULL",
      nowIso(), challenge.id
    );
    if (consumed.changes !== 1) throw new ApiError(409, 'OTP_ALREADY_USED', 'This code has already been used. Request a new OTP.');

    let user = userByPhone(challenge.phone_e164);
    let isNewUser = false;
    const timestamp = nowIso();
    if (!user) {
      isNewUser = true;
      const parts = normalizePhoneFromE164(challenge.phone_e164);
      const id = randomToken(16);
      run(
        `INSERT INTO users (id, phone_e164, country_code, phone_national, role, status, signup_bonus_granted,
          verified_at, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, 'user', 'active', 0, ?, ?, ?, ?)`,
        id, challenge.phone_e164, parts.countryCode, parts.national, timestamp, timestamp, timestamp, timestamp
      );
      run('INSERT INTO wallets (user_id, balance, reserved, updated_at) VALUES (?, 0, 0, ?)', id, timestamp);
      user = userById(id);
    }

    if (user.status === 'suspended') {
      throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support for help.');
    }

    if (isAdminPhone(user.phone_e164) && user.role !== 'admin') {
      run("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", timestamp, user.id);
      user = userById(user.id);
      auditAdminRole(user, ip);
    }

    if (user.role !== 'admin') grantSignupBonusTx(user.id);
    run('UPDATE users SET verified_at = COALESCE(verified_at, ?), last_login_at = ?, updated_at = ? WHERE id = ?',
      timestamp, timestamp, timestamp, user.id);
    user = userById(user.id);
    const session = createSessionTx(user.id, req);
    return { user, session, isNewUser };
  });

  return {
    ok: true,
    user: toPublicUser(result.user),
    wallet: walletView(result.user),
    csrfToken: result.session.csrfToken,
    sessionToken: result.session.rawToken,
    sessionExpiresAt: result.session.expiresAt,
    isNewUser: result.isNewUser
  };
}

function normalizePhoneFromE164(phone) {
  const known = ['+91', '+971', '+880', '+977', '+44', '+61', '+65', '+92', '+94', '+1']
    .sort((a, b) => b.length - a.length)
    .find(code => phone.startsWith(code));
  if (!known) return { countryCode: '+91', national: phone.replace(/\D/g, '').slice(-10) };
  return { countryCode: known, national: phone.slice(known.length) };
}

export function authenticate(req) {
  const cookies = req.cookies || {};
  const token = cookies.vy_session;
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = one(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at AS session_expires_at, s.revoked_at,
            s.last_seen_at, u.id, u.phone_e164, u.country_code, u.phone_national, u.role, u.status,
            u.signup_bonus_granted, u.verified_at, u.created_at, u.updated_at, u.last_login_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    tokenHash
  );
  if (!row || row.revoked_at) return null;
  if (new Date(row.session_expires_at).getTime() <= Date.now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  if (row.status === 'suspended') return { user: row, session: { id: row.session_id, csrfToken: row.csrf_token }, suspended: true };
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > 60_000) {
    run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), row.session_id);
  }
  return {
    user: row,
    session: { id: row.session_id, csrfToken: row.csrf_token, expiresAt: row.session_expires_at },
    suspended: false
  };
}

export function revokeSession(req) {
  const token = req.cookies?.vy_session;
  if (!token) return;
  run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function revokeUserSessions(userId) {
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);
}

export function sessionPayload(auth) {
  return {
    user: toPublicUser(auth.user),
    wallet: walletView(auth.user),
    csrfToken: auth.session.csrfToken,
    sessionExpiresAt: auth.session.expiresAt || null
  };
}

export function cleanupAuthState() {
  const timestamp = nowIso();
  run("UPDATE otp_challenges SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?", timestamp);
  run('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', timestamp);
}
