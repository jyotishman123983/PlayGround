import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let ffmpeg = '';
try { ffmpeg = require('ffmpeg-static') || ''; } catch {}

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    PORT: '0',
    SESSION_SECRET: 'test-session-secret-'.padEnd(48, 'x'),
    ALLOW_DEV_OTP: 'true',
    ENABLE_DEMO: 'true',
    WHATSAPP_PROVIDER: 'none',
    WHATSAPP_TOKEN: '',
    WHATSAPP_PHONE_NUMBER_ID: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_WHATSAPP_FROM: '',
    REPLICATE_API_TOKEN: '',
    OTP_COOLDOWN_SECONDS: '0',
    OTP_MAX_ATTEMPTS: '3',
    DEMO_SCENE_DELAY_MS: '0',
    API_RATE_LIMIT_PER_MINUTE: '2000',
    ...overrides
  };
}

async function startServer(overrides = {}, dataDir = mkdtempSync(join(tmpdir(), 'vy-test-'))) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: baseEnv({ DATA_DIR: dataDir, ...overrides }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start.\n${stdout}\n${stderr}`)), 15_000);
    const onData = () => {
      const match = stdout.match(/listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolvePort(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code}.\n${stdout}\n${stderr}`));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
    if (attempt === 79) throw new Error(`Health check failed.\n${stdout}\n${stderr}`);
  }
  return {
    base,
    dataDir,
    logs: () => `${stdout}\n${stderr}`,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(resolveExit => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 5_000);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); });
      });
    },
    cleanup() {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    }
  };
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.csrf = '';
  }

  async request(path, { method = 'GET', body, csrf = true, origin = true, headers = {} } = {}) {
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    if (origin) requestHeaders.Origin = this.base;
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    if (csrf && this.csrf && method !== 'GET') requestHeaders['X-CSRF-Token'] = this.csrf;
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0];
      if (pair.startsWith('vy_session=')) this.cookie = pair;
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }

  async login(phone = '9876543210', countryCode = '+91') {
    const requested = await this.request('/api/auth/request-otp', {
      method: 'POST',
      body: { countryCode, phone },
      csrf: false
    });
    assert.equal(requested.status, 200, JSON.stringify(requested.data));
    assert.match(requested.data.devOtp, /^\d{6}$/);
    const verified = await this.request('/api/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: requested.data.challengeId, code: requested.data.devOtp },
      csrf: false
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.ok(this.cookie);
    this.csrf = verified.data.csrfToken;
    return verified.data;
  }
}

async function waitForJob(client, id, wanted, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await client.request(`/api/jobs/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    last = response.data;
    if (wanted.includes(last.job.status)) return last;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${wanted.join(', ')}. Last state: ${JSON.stringify(last)}`);
}

async function withServer(t, overrides, run) {
  const server = await startServer(overrides);
  t.after(async () => {
    await server.stop();
    server.cleanup();
  });
  return run(server);
}

test('first-time verification grants exactly 1000 tokens and promotes the configured admin', async t => {
  await withServer(t, {}, async server => {
    const user = new Client(server.base);
    const verified = await user.login('9123456780');
    assert.equal(verified.isNewUser, true);
    assert.equal(verified.user.isAdmin, false);
    assert.equal(verified.wallet.balance, 1000);

    const session = await user.request('/api/auth/session');
    assert.equal(session.status, 200);
    assert.equal(session.data.authenticated, true);
    assert.equal(session.data.wallet.balance, 1000);

    const wallet = await user.request('/api/wallet');
    assert.equal(wallet.status, 200);
    assert.equal(wallet.data.wallet.balance, 1000);
    const bonuses = wallet.data.transactions.filter(item => item.type === 'signup_bonus');
    assert.equal(bonuses.length, 1);
    assert.equal(bonuses[0].amount, 1000);

    const admin = new Client(server.base);
    const adminLogin = await admin.login('7002063596');
    assert.equal(adminLogin.user.isAdmin, true);
    assert.equal(adminLogin.wallet.unlimited, true);
    assert.equal(adminLogin.wallet.display, 'Unlimited');

    const overview = await admin.request('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.data.stats.totalUsers, 2);

    const forbidden = await user.request('/api/admin/overview');
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.data.error.code, 'ADMIN_REQUIRED');
  });
});

test('session and signup bonus survive a server restart', async t => {
  const server = await startServer();
  t.after(async () => {
    await server.stop();
    server.cleanup();
  });
  const client = new Client(server.base);
  const verified = await client.login('9988776655');
  assert.equal(verified.wallet.balance, 1000);

  await server.stop();
  const restarted = await startServer({ DATA_DIR: server.dataDir }, server.dataDir);
  t.after(async () => {
    await restarted.stop();
    restarted.cleanup();
  });
  const restored = new Client(restarted.base);
  restored.cookie = client.cookie;
  restored.csrf = client.csrf;
  const session = await restored.request('/api/auth/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.wallet.balance, 1000);
  const wallet = await restored.request('/api/wallet');
  assert.equal(wallet.data.transactions.filter(item => item.type === 'signup_bonus').length, 1);
});

test('30-second demo reserves, charges once, is idempotent, downloads, and refunds a cancellation', { skip: !ffmpeg }, async t => {
  await withServer(t, {}, async server => {
    const client = new Client(server.base);
    await client.login('9000000001');
    const key = 'test-short-idempotent';
    const created = await client.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'A cinematic solar startup launch at sunrise in Mumbai.', demo: true }
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.job.cost, 25);
    assert.equal(created.data.wallet.balance, 975);
    assert.equal(created.data.wallet.reserved, 25);

    const duplicate = await client.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'A cinematic solar startup launch at sunrise in Mumbai.', demo: true }
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.job.id, created.data.job.id);
    assert.equal(duplicate.data.wallet.balance, 975);

    const completed = await waitForJob(client, created.data.job.id, ['completed', 'failed']);
    assert.equal(completed.job.status, 'completed', completed.job.errorMessage);
    assert.equal(completed.job.actualDuration, 30);
    assert.equal(completed.job.chargedAmount, 25);
    assert.equal(completed.wallet.balance, 975);
    assert.equal(completed.wallet.reserved, 0);

    const download = await client.request(`/api/jobs/${created.data.job.id}/download`);
    assert.equal(download.status, 200);

    const second = await client.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-cancel-refund' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'A launch film that will be cancelled while generating.', demo: true }
    });
    assert.equal(second.status, 201);
    assert.equal(second.data.wallet.balance, 950);
    const cancelled = await client.request(`/api/jobs/${second.data.job.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.job.status, 'cancelled');
    assert.equal(cancelled.data.job.refunded, true);
    assert.equal(cancelled.data.wallet.balance, 975);
    assert.equal(cancelled.data.wallet.reserved, 0);
  });
});

test('10-minute demo assembles a verified 600-second video and charges 500 tokens', { skip: !ffmpeg }, async t => {
  await withServer(t, {}, async server => {
    const client = new Client(server.base);
    await client.login('9000000002');
    const created = await client.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-long-complete' },
      body: { mode: 'text-to-video', style: 'documentary', duration: 600, prompt: 'A documentary about a solar startup transforming rural India.', demo: true }
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.job.sceneCount, 20);
    assert.equal(created.data.job.aspectRatio, '16:9');
    assert.equal(created.data.wallet.balance, 500);
    assert.equal(created.data.wallet.reserved, 500);

    const completed = await waitForJob(client, created.data.job.id, ['completed', 'failed'], 60_000);
    assert.equal(completed.job.status, 'completed', completed.job.errorMessage);
    assert.equal(completed.job.actualDuration, 600);
    assert.equal(completed.job.chargedAmount, 500);
    assert.equal(completed.wallet.balance, 500);
    assert.equal(completed.wallet.reserved, 0);
  });
});

test('validation, CSRF, admin adjustment and insufficient balance are enforced', async t => {
  await withServer(t, {}, async server => {
    const user = new Client(server.base);
    await user.login('9000000003');

    const noCsrf = await user.request('/api/jobs', {
      method: 'POST',
      csrf: false,
      headers: { 'Idempotency-Key': 'test-no-csrf' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'A valid prompt for CSRF validation.', demo: true }
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.data.error.code, 'CSRF_TOKEN_INVALID');

    const noKey = await user.request('/api/jobs', {
      method: 'POST',
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'A valid prompt for idempotency validation.', demo: true }
    });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.data.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const badDuration = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-bad-duration' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 45, prompt: 'A valid prompt for duration validation.', demo: true }
    });
    assert.equal(badDuration.status, 400);
    assert.equal(badDuration.data.error.code, 'INVALID_DURATION');

    const badImage = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-bad-image' },
      body: { mode: 'image-to-video', style: 'cinematic', duration: 30, prompt: 'A valid prompt for image validation.', demo: true, imageDataUrl: 'data:image/png;base64,AAAA' }
    });
    assert.equal(badImage.status, 400);
    assert.equal(badImage.data.error.code, 'INVALID_IMAGE');

    const longOne = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-insufficient-one' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 600, prompt: 'The first long video reserves most of the wallet balance.', demo: true }
    });
    assert.equal(longOne.status, 201);
    const longTwo = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-insufficient-two' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 600, prompt: 'The second long video uses the remaining wallet balance.', demo: true }
    });
    assert.equal(longTwo.status, 201);
    const longThree = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-insufficient-three' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 600, prompt: 'The third long video should be rejected for insufficient tokens.', demo: true }
    });
    assert.equal(longThree.status, 402);
    assert.equal(longThree.data.error.code, 'INSUFFICIENT_TOKENS');
    await user.request(`/api/jobs/${longOne.data.job.id}/cancel`, { method: 'POST' });
    await user.request(`/api/jobs/${longTwo.data.job.id}/cancel`, { method: 'POST' });

    const admin = new Client(server.base);
    await admin.login('7002063596');
    const userId = user.cookie ? (await user.request('/api/auth/session')).data.user.id : null;
    const adjusted = await admin.request(`/api/admin/users/${userId}/tokens`, {
      method: 'POST',
      body: { amount: 100, reason: 'QA credit' }
    });
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.data.balance, 1100);
    const userWallet = await user.request('/api/wallet');
    assert.equal(userWallet.data.wallet.balance, 1100);
    assert.equal(userWallet.data.transactions[0].type, 'admin_grant');
    assert.equal(userWallet.data.transactions[0].reason, 'QA credit');
  });
});

test('production refuses fake OTP delivery and disables the demo renderer', async t => {
  await withServer(t, { NODE_ENV: 'production', ALLOW_DEV_OTP: 'true', ENABLE_DEMO: 'true' }, async server => {
    const publicConfig = await new Client(server.base).request('/api/public/config');
    assert.equal(publicConfig.status, 200);
    assert.equal(publicConfig.data.auth.devOtpEnabled, false);
    assert.equal(publicConfig.data.generation.demoEnabled, false);
    assert.equal(publicConfig.data.auth.whatsapp.configured, false);

    const requested = await new Client(server.base).request('/api/auth/request-otp', {
      method: 'POST',
      csrf: false,
      body: { countryCode: '+91', phone: '9000000004' }
    });
    assert.equal(requested.status, 503);
    assert.equal(requested.data.error.code, 'WHATSAPP_NOT_CONFIGURED');
    assert.equal(requested.data.devOtp, undefined);
  });
});

test('admin settings, maintenance mode and suspension take effect immediately', async t => {
  await withServer(t, {}, async server => {
    const user = new Client(server.base);
    await user.login('9000000005');
    const admin = new Client(server.base);
    await admin.login('7002063596');

    const pricing = await admin.request('/api/admin/settings', {
      method: 'PATCH',
      body: { shortsCost: 40, longCost: 500, maintenanceMode: true, maintenanceMessage: 'Upgrade in progress', hostingMonthlyUsd: 12 }
    });
    assert.equal(pricing.status, 200);
    assert.equal(pricing.data.settings.pricing.shortsCost, 40);
    assert.equal(pricing.data.settings.maintenance.enabled, true);

    const blocked = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-maintenance' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'This job must be blocked by maintenance mode.', demo: true }
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.data.error.code, 'MAINTENANCE_MODE');

    const resumed = await admin.request('/api/admin/settings', {
      method: 'PATCH',
      body: { shortsCost: 40, longCost: 500, maintenanceMode: false, maintenanceMessage: 'Upgrade complete', hostingMonthlyUsd: 12 }
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.settings.maintenance.enabled, false);

    const priced = await user.request('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'test-new-price' },
      body: { mode: 'text-to-video', style: 'cinematic', duration: 30, prompt: 'This job uses the updated Shorts price.', demo: true }
    });
    assert.equal(priced.status, 201);
    assert.equal(priced.data.job.cost, 40);
    assert.equal(priced.data.wallet.balance, 960);
    await user.request(`/api/jobs/${priced.data.job.id}/cancel`, { method: 'POST' });

    const session = await user.request('/api/auth/session');
    const userId = session.data.user.id;
    const suspended = await admin.request(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      body: { suspended: true, reason: 'Test suspension' }
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.data.status, 'suspended');
    const afterSuspend = await user.request('/api/wallet');
    assert.equal(afterSuspend.status, 401);

    const reactivated = await admin.request(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      body: { suspended: false, reason: 'Test reactivation' }
    });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.data.status, 'active');

    const relogin = new Client(server.base);
    const again = await relogin.login('9000000005');
    assert.equal(again.isNewUser, false);
    assert.equal(again.wallet.balance, 1000);
  });
});
