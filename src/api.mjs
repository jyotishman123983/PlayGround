import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, durationPlans } from './config.mjs';
import { one } from './db.mjs';
import { ApiError } from './errors.mjs';
import {
  authenticate,
  requestOtp,
  revokeSession,
  sessionPayload,
  verifyOtp
} from './auth.mjs';
import { COUNTRY_CODES } from './phone.mjs';
import { VIDEO_STYLES } from './catalog.mjs';
import { getPricing, getSettings } from './settings.mjs';
import { whatsappStatus } from './otp-provider.mjs';
import { listTransactions, walletView } from './wallet.mjs';
import {
  cancelJob,
  createJob,
  demoSetupStatus,
  listJobsForUser,
  publicJob,
  startJob
} from './generation.mjs';
import {
  adjustUserTokens,
  adminCancelJob,
  adminJobs,
  getAudit,
  overview,
  providersPublicStatus,
  searchUsers,
  setUserStatus,
  updateAdminSettings,
  userDetail
} from './admin.mjs';
import {
  clearCookie,
  parseBody,
  sendFile,
  sendJson,
  setCookie
} from './http.mjs';
import { apiLimiter, clientIp, cookieOptions } from './security.mjs';

const APP_VERSION = JSON.parse(readFileSync(join(config.root, 'package.json'), 'utf8')).version;

function setupMessages() {
  const whatsapp = whatsappStatus();
  const demo = demoSetupStatus();
  return {
    whatsapp: whatsapp.configured
      ? null
      : config.allowDevOtp
        ? 'WhatsApp OTP is not configured. Development OTP mode is active and is shown on the verification screen. It cannot be used for production authentication.'
        : 'WhatsApp OTP is not configured. Add WHATSAPP_PROVIDER, WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server to enable login.',
    ai: config.generation.configured
      ? null
      : demo.enabled
        ? 'No AI video provider is configured. The clearly labelled demo simulation renders a local placeholder video so you can test the entitlement flow.'
        : demo.reason || 'No AI video provider is configured.'
  };
}

function publicConfig() {
  const settings = getSettings();
  const whatsapp = whatsappStatus();
  const demo = demoSetupStatus();
  return {
    app: {
      name: 'ViralYantra AI',
      version: APP_VERSION,
      production: config.isProduction,
      maintenance: settings.maintenance
    },
    auth: {
      whatsapp,
      devOtpEnabled: config.allowDevOtp && !config.isProduction,
      defaultCountryCode: '+91',
      countryCodes: COUNTRY_CODES.map(({ code, country, iso, nationalLength }) => ({ code, country, iso, nationalLength })),
      otpExpirySeconds: config.otp.ttlSeconds,
      otpResendSeconds: config.otp.cooldownSeconds,
      setupMessage: setupMessages().whatsapp
    },
    pricing: {
      signupBonus: config.pricing.signupBonus,
      shortsCost: settings.pricing.shortsCost,
      longCost: settings.pricing.longCost,
      plans: Object.values(durationPlans).map(plan => ({
        id: plan.id,
        label: plan.label,
        duration: plan.seconds,
        aspectRatio: plan.aspectRatio,
        cost: settings.pricing[plan.costKey],
        sceneCount: plan.seconds === 30 ? config.generation.shortScenes : config.generation.longScenes
      }))
    },
    generation: {
      aiConfigured: config.generation.configured,
      aiProvider: config.generation.provider,
      aiModel: config.generation.configured ? config.generation.replicateModel : null,
      demoEnabled: demo.enabled,
      demoReason: demo.reason,
      setupMessage: setupMessages().ai,
      maxPromptLength: config.generation.maxPromptLength,
      maxImageBytes: config.generation.maxImageBytes,
      styles: VIDEO_STYLES
    }
  };
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try {
    const parsed = new URL(origin);
    if (parsed.host !== allowed) throw new Error('origin mismatch');
  } catch {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-origin request rejected.');
  }
}

function requireCsrf(req, auth) {
  const provided = String(req.headers['x-csrf-token'] || '');
  if (!auth || !provided || provided !== auth.session.csrfToken) {
    throw new ApiError(403, 'CSRF_TOKEN_INVALID', 'Security token is missing or expired. Refresh the page and try again.');
  }
}

function requireAuth(req) {
  const auth = authenticate(req);
  if (!auth) throw new ApiError(401, 'NOT_AUTHENTICATED', 'Please sign in to continue.');
  if (auth.suspended || auth.user.status === 'suspended') {
    throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support for help.');
  }
  return auth;
}

function requireAdmin(req) {
  const auth = requireAuth(req);
  if (auth.user.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  return auth;
}

function jobForAccess(auth, jobId) {
  const job = publicJobDetail(jobId);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Generation job not found.');
  if (job.user_id !== auth.user.id && auth.user.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this job.');
  }
  return job;
}

function publicJobDetail(jobId) {
  return one('SELECT * FROM video_jobs WHERE id = ?', jobId);
}

function manifestPayload(job) {
  const detail = publicJob(job);
  return {
    label: detail.isDemo ? 'DEMO SIMULATION - NOT AI GENERATED' : 'ViralYantra AI scene plan',
    jobId: detail.id,
    mode: detail.mode,
    style: detail.style,
    styleName: detail.styleName,
    prompt: detail.prompt,
    targetDurationSeconds: detail.targetDuration,
    actualDurationSeconds: detail.actualDuration,
    aspectRatio: detail.aspectRatio,
    status: detail.status,
    costTokens: detail.cost,
    scenes: detail.scenes,
    generatedAt: detail.completedAt || detail.updatedAt
  };
}

export async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;
  const ip = clientIp(req);
  apiLimiter.check(`api:${ip}`, config.limits.apiPerMinute, 60_000);

  if (path === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, app: 'ViralYantra AI', version: APP_VERSION, time: new Date().toISOString() });
  }

  if (path === '/api/public/config' && method === 'GET') {
    return sendJson(res, 200, publicConfig());
  }

  if (path === '/api/auth/request-otp' && method === 'POST') {
    requireSameOrigin(req);
    const body = await parseBody(req, 64 * 1024);
    const result = await requestOtp({ countryCode: body.countryCode, national: body.phone, req });
    return sendJson(res, 200, result);
  }

  if (path === '/api/auth/verify-otp' && method === 'POST') {
    requireSameOrigin(req);
    const body = await parseBody(req, 64 * 1024);
    const result = await verifyOtp({ challengeId: body.challengeId, code: body.code, req });
    setCookie(res, 'vy_session', result.sessionToken, cookieOptions(req));
    return sendJson(res, 200, {
      ok: true,
      user: result.user,
      wallet: result.wallet,
      csrfToken: result.csrfToken,
      sessionExpiresAt: result.sessionExpiresAt,
      isNewUser: result.isNewUser
    });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    requireSameOrigin(req);
    const auth = authenticate(req);
    if (auth && !auth.suspended) requireCsrf(req, auth);
    revokeSession(req);
    clearCookie(res, 'vy_session', cookieOptions(req));
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/auth/session' && method === 'GET') {
    const auth = authenticate(req);
    if (!auth) return sendJson(res, 200, { authenticated: false });
    if (auth.suspended) {
      revokeSession(req);
      clearCookie(res, 'vy_session', cookieOptions(req));
      return sendJson(res, 200, { authenticated: false, suspended: true });
    }
    return sendJson(res, 200, { authenticated: true, ...sessionPayload(auth) });
  }

  if (path === '/api/me' && method === 'GET') {
    const auth = requireAuth(req);
    return sendJson(res, 200, sessionPayload(auth));
  }

  if (path === '/api/wallet' && method === 'GET') {
    const auth = requireAuth(req);
    return sendJson(res, 200, {
      wallet: walletView(auth.user),
      transactions: listTransactions(auth.user.id, 50),
      pricing: getPricing()
    });
  }

  if (path === '/api/wallet/transactions' && method === 'GET') {
    const auth = requireAuth(req);
    return sendJson(res, 200, { transactions: listTransactions(auth.user.id, Number(url.searchParams.get('limit') || 50)) });
  }

  if (path === '/api/jobs' && method === 'GET') {
    const auth = requireAuth(req);
    return sendJson(res, 200, { jobs: listJobsForUser(auth.user.id, Number(url.searchParams.get('limit') || 50)) });
  }

  if (path === '/api/jobs' && method === 'POST') {
    requireSameOrigin(req);
    const auth = requireAuth(req);
    requireCsrf(req, auth);
    const body = await parseBody(req);
    const result = createJob({ user: auth.user, body, idempotencyKey: req.headers['idempotency-key'], req });
    if (!result.duplicate) startJob(result.job.id);
    return sendJson(res, result.duplicate ? 200 : 201, { ...result, pricing: getPricing() });
  }

  const jobMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]{8,80})$/);
  if (jobMatch && method === 'GET') {
    const auth = requireAuth(req);
    const job = jobForAccess(auth, jobMatch[1]);
    return sendJson(res, 200, { job: publicJob(job), wallet: walletView(auth.user) });
  }

  const cancelMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]{8,80})\/cancel$/);
  if (cancelMatch && method === 'POST') {
    requireSameOrigin(req);
    const auth = requireAuth(req);
    requireCsrf(req, auth);
    const job = jobForAccess(auth, cancelMatch[1]);
    const body = await parseBody(req, 64 * 1024).catch(() => ({}));
    const result = cancelJob({ job, user: auth.user, reason: body.reason || 'Cancelled by user' });
    return sendJson(res, 200, { job: result, wallet: walletView(authenticate(req).user) });
  }

  const downloadMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]{8,80})\/download$/);
  if (downloadMatch && method === 'GET') {
    const auth = requireAuth(req);
    const job = jobForAccess(auth, downloadMatch[1]);
    if (job.status !== 'completed' || job.output_kind !== 'video' || !job.output_path) {
      throw new ApiError(409, 'VIDEO_NOT_READY', 'This video is not ready to download.');
    }
    const resolved = job.output_path;
    if (!resolved.startsWith(config.dataDir)) throw new ApiError(403, 'FORBIDDEN', 'Invalid output path.');
    const filename = `viralyantra-${job.target_duration === 600 ? 'long' : 'short'}-${job.id.slice(0, 8)}${job.is_demo ? '-demo' : ''}.mp4`;
    return sendFile(req, res, resolved, { mime: 'video/mp4', filename });
  }

  const manifestMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]{8,80})\/manifest$/);
  if (manifestMatch && method === 'GET') {
    const auth = requireAuth(req);
    const job = jobForAccess(auth, manifestMatch[1]);
    const manifest = manifestPayload(job);
    const body = JSON.stringify(manifest, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="viralyantra-scene-plan-${job.id.slice(0, 8)}.json"`,
      'Cache-Control': 'private, no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    return res.end(body);
  }

  if (path === '/api/admin/overview' && method === 'GET') {
    const auth = requireAdmin(req);
    return sendJson(res, 200, { ...overview(auth.user), providers: providersPublicStatus(), setup: setupMessages() });
  }

  if (path === '/api/admin/users' && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, { users: searchUsers(url.searchParams.get('q') || '', Number(url.searchParams.get('limit') || 100)) });
  }

  const adminUserMatch = path.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{8,80})$/);
  if (adminUserMatch && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, userDetail(adminUserMatch[1]));
  }

  const tokensMatch = path.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{8,80})\/tokens$/);
  if (tokensMatch && method === 'POST') {
    requireSameOrigin(req);
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    const body = await parseBody(req, 64 * 1024);
    const result = adjustUserTokens({
      admin: auth.user,
      targetUserId: tokensMatch[1],
      amount: body.amount,
      reason: body.reason,
      ip
    });
    return sendJson(res, 200, result);
  }

  const statusMatch = path.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{8,80})\/status$/);
  if (statusMatch && method === 'POST') {
    requireSameOrigin(req);
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    const body = await parseBody(req, 64 * 1024);
    const result = setUserStatus({
      admin: auth.user,
      targetUserId: statusMatch[1],
      suspended: Boolean(body.suspended),
      reason: body.reason,
      ip
    });
    return sendJson(res, 200, result);
  }

  if (path === '/api/admin/jobs' && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, {
      jobs: adminJobs({
        status: url.searchParams.get('status') || 'all',
        userId: url.searchParams.get('userId') || undefined,
        limit: Number(url.searchParams.get('limit') || 100)
      })
    });
  }

  const adminCancelMatch = path.match(/^\/api\/admin\/jobs\/([A-Za-z0-9_-]{8,80})\/cancel$/);
  if (adminCancelMatch && method === 'POST') {
    requireSameOrigin(req);
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    const body = await parseBody(req, 64 * 1024);
    return sendJson(res, 200, {
      job: adminCancelJob({ admin: auth.user, jobId: adminCancelMatch[1], reason: body.reason, ip })
    });
  }

  if (path === '/api/admin/audit' && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, { audit: getAudit(Number(url.searchParams.get('limit') || 100)) });
  }

  if (path === '/api/admin/settings' && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, { settings: getSettings() });
  }

  if (path === '/api/admin/settings' && method === 'PATCH') {
    requireSameOrigin(req);
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    const body = await parseBody(req, 64 * 1024);
    const settings = updateAdminSettings({ admin: auth.user, patch: body, ip });
    return sendJson(res, 200, { settings });
  }

  if (path === '/api/admin/providers' && method === 'GET') {
    requireAdmin(req);
    return sendJson(res, 200, {
      providers: providersPublicStatus(),
      whatsapp: whatsappStatus(),
      setup: setupMessages(),
      aiConfigured: config.generation.configured,
      demo: demoSetupStatus(),
      required: {
        whatsapp: ['WHATSAPP_PROVIDER=meta', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE'],
        ai: ['VIDEO_PROVIDER=replicate', 'REPLICATE_API_TOKEN', 'REPLICATE_VIDEO_MODEL'],
        security: ['SESSION_SECRET', 'ADMIN_PHONE (+917002063596)']
      }
    });
  }

  throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
}

export function apiErrorPayload(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details || undefined } }
    };
  }
  console.error('[api] Unhandled error:', error);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. Please try again.' } }
  };
}
