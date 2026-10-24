import {
  esc,
  fmtNumber,
  fmtDate,
  fmtDuration,
  timeAgo,
  hashHue,
  statusBadge,
  STATUS_LABELS,
  icon,
  logoHtml,
  toast
} from './js/ui.js';

const app = document.getElementById('app');
const OTPS_KEY = 'vy_pending_otp_v1';

const defaultDraft = () => ({
  mode: 'text-to-video',
  style: 'cinematic',
  duration: 30,
  prompt: '',
  imageDataUrl: null,
  imageName: null,
  demo: false
});

const state = {
  config: null,
  auth: null,
  wallet: null,
  csrf: null,
  otp: null,
  draft: defaultDraft(),
  demoDefaulted: false,
  seq: 0,
  pollTimer: null,
  resendTimer: null,
  jobs: [],
  currentJob: null,
  admin: null,
  adminTab: 'users',
  adminSearch: '',
  adminJobStatus: 'all',
  notified: new Set(),
  loading: false
};

function readPendingOtp() {
  try {
    const value = JSON.parse(sessionStorage.getItem(OTPS_KEY) || 'null');
    if (value && value.challengeId) return value;
  } catch {}
  return null;
}

function savePendingOtp(value) {
  state.otp = value;
  try {
    if (value) sessionStorage.setItem(OTPS_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(OTPS_KEY);
  } catch {}
}

function parseRoute() {
  const raw = (window.location.hash || '#/create').replace(/^#\/?/, '');
  const [name, id] = raw.split('/');
  return { name: name || 'create', id: id || null };
}

function navigate(hash) {
  closeModal();
  if (window.location.hash === hash) renderCurrent();
  else window.location.hash = hash;
}

async function api(path, options = {}) {
  const { method = 'GET', body, idempotencyKey, headers = {}, allowAuthError = false } = options;
  const requestHeaders = { Accept: 'application/json', ...headers };
  let payload = body;
  if (body !== undefined && body !== null) {
    requestHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (state.csrf && method !== 'GET') requestHeaders['X-CSRF-Token'] = state.csrf;
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: payload,
    credentials: 'same-origin'
  });
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { data = await response.json(); } catch {}
  }
  if (!response.ok) {
    if (response.status === 401 && !allowAuthError && !path.startsWith('/api/auth/')) {
      expireSession();
    }
    const apiError = new Error(data?.error?.message || `Request failed (HTTP ${response.status}).`);
    apiError.code = data?.error?.code || 'REQUEST_FAILED';
    apiError.status = response.status;
    apiError.details = data?.error?.details;
    throw apiError;
  }
  return data;
}

function setAuth(payload) {
  state.auth = payload.user;
  state.wallet = payload.wallet;
  state.csrf = payload.csrfToken;
}

function expireSession() {
  stopTimers();
  state.auth = null;
  state.wallet = null;
  state.csrf = null;
  state.admin = null;
  state.currentJob = null;
  closeModal();
  if (window.location.hash !== '#/login') window.location.hash = '#/login';
  else renderCurrent();
  toast('Your session expired. Please sign in again.', 'warn');
}

function stopTimers() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  if (state.resendTimer) clearInterval(state.resendTimer);
  state.pollTimer = null;
  state.resendTimer = null;
}

function walletChip() {
  const unlimited = state.wallet?.unlimited;
  const value = unlimited ? 'Unlimited' : fmtNumber(state.wallet?.balance ?? 0);
  return `<span class="wallet-chip" title="Token wallet">${icon('zap')}<span><small>tokens</small> ${value}</span></span>`;
}

function navLink(name, hash, iconName, label, active, extra = '') {
  return `<a class="nav-item ${active ? 'active' : ''}" href="${hash}">${icon(iconName)}<span>${label}</span>${extra}</a>`;
}

function bottomLink(name, hash, iconName, label, active) {
  return `<a class="${active ? 'active' : ''}" href="${hash}">${icon(iconName)}<span>${label}</span></a>`;
}

function shell(content, activeName) {
  const isAdmin = state.auth?.isAdmin;
  const adminBadge = isAdmin ? '<span class="nav-badge">ADMIN</span>' : '';
  const initial = (state.auth?.phone || 'V').replace('+', '').slice(-2);
  return `
    <div class="app-shell">
      <header class="app-header">
        <div class="header-left">
          <a href="#/create" aria-label="ViralYantra AI home">${logoHtml({ size: 32, text: false })}</a>
          <span class="desktop-logo">${logoHtml({ size: 30 })}</span>
        </div>
        <div class="header-right">
          <a href="#/wallet" aria-label="Open token wallet" style="text-decoration:none">${walletChip()}</a>
          <button class="profile-btn ${isAdmin ? 'is-admin' : ''}" type="button" data-action="toggle-profile" aria-label="Account menu" aria-expanded="false">${isAdmin ? icon('shield') : icon('users')}</button>
        </div>
        <div id="profile-menu" class="profile-menu hidden">
          <div class="pm-head">
            <strong>${esc(state.auth?.phone || '')}</strong>
            <span>${isAdmin ? 'Administrator · unlimited tokens' : 'Verified member'}</span>
          </div>
          <button class="menu-item" type="button" data-action="go-wallet">${icon('wallet')} Token wallet</button>
          ${isAdmin ? `<button class="menu-item" type="button" data-action="go-admin">${icon('shield')} Admin console</button>` : ''}
          <button class="menu-item danger" type="button" data-action="logout">${icon('logout')} Logout</button>
        </div>
      </header>
      <aside class="sidebar">
        <div class="side-label">Studio</div>
        ${navLink('create', '#/create', 'sparkles', 'Create video', activeName === 'create')}
        ${navLink('videos', '#/videos', 'film', 'My videos', activeName === 'videos')}
        ${navLink('wallet', '#/wallet', 'wallet', 'Token wallet', activeName === 'wallet')}
        ${isAdmin ? '<div class="side-label" style="margin-top:14px">Control</div>' : ''}
        ${isAdmin ? navLink('admin', '#/admin', 'shield', 'Admin console', activeName === 'admin', adminBadge) : ''}
        <div class="sidebar-foot">
          <strong>${isAdmin ? 'Unlimited account' : 'Scene-based studio'}</strong>
          <span>${isAdmin ? 'Administrator generation is never charged.' : '30s Shorts · 25 tokens<br>10-min Long · 500 tokens'}</span>
        </div>
      </aside>
      <main class="app-main">${content}</main>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${bottomLink('create', '#/create', 'sparkles', 'Create', activeName === 'create')}
        ${bottomLink('videos', '#/videos', 'film', 'Videos', activeName === 'videos')}
        ${bottomLink('wallet', '#/wallet', 'wallet', 'Wallet', activeName === 'wallet')}
        ${isAdmin ? bottomLink('admin', '#/admin', 'shield', 'Admin', activeName === 'admin') : ''}
      </nav>
    </div>
  `;
}

function pageFade(content, activeName) {
  app.innerHTML = shell(content, activeName);
}

function loadingPage(label, activeName) {
  pageFade(`
    <div class="page">
      <div class="page-head"><div><h1>${esc(label)}</h1><p>Loading your workspace securely…</p></div></div>
      <div class="section-loading">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>
  `, activeName);
}

function errorPage(title, message, activeName = 'create') {
  pageFade(`
    <div class="page">
      <div class="panel panel-pad" style="max-width:620px;margin:40px auto;text-align:center">
        <div class="empty-icon" style="color:var(--red);background:rgba(251,113,133,.08)">${icon('alert')}</div>
        <h2 style="font-size:18px;letter-spacing:-.025em">${esc(title)}</h2>
        <p style="color:var(--muted);font-size:12.5px;margin-top:8px;line-height:1.6">${esc(message)}</p>
        <div style="margin-top:18px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <a class="btn btn-primary" href="#/create">Back to studio</a>
          <button class="btn btn-secondary" type="button" data-action="reload-app">${icon('refresh')} Reload</button>
        </div>
      </div>
    </div>
  `, activeName);
}

function setupBanner(message, tone = 'warn') {
  if (!message) return '';
  return `<div class="setup-banner ${tone === 'info' ? 'info' : ''}">${icon(tone === 'info' ? 'info' : 'alert')}<div>${esc(message)}</div></div>`;
}

function formError(message, details) {
  let extra = '';
  if (details?.attemptsRemaining !== undefined) extra = ` ${details.attemptsRemaining} attempt${details.attemptsRemaining === 1 ? '' : 's'} remaining.`;
  if (details?.retryAfter) extra = ` Try again in ${details.retryAfter} seconds.`;
  if (details?.shortfall) extra = ` You need ${fmtNumber(details.shortfall)} more tokens.`;
  return `${icon('alert')}<div>${esc(message)}${esc(extra)}</div>`;
}

function setFormError(selector, error) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.innerHTML = formError(error.message || String(error), error.details);
  el.classList.add('visible');
}

function clearFormError(selector) {
  const el = document.querySelector(selector);
  if (el) { el.classList.remove('visible'); el.innerHTML = ''; }
}

function setBusy(button, label = 'Please wait…') {
  if (!button) return;
  button.dataset.original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
}

function clearBusy(button) {
  if (!button || !button.dataset.original) return;
  button.innerHTML = button.dataset.original;
  button.disabled = false;
  delete button.dataset.original;
}

function closeProfile() {
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  const button = document.querySelector('[data-action="toggle-profile"]');
  if (button) button.setAttribute('aria-expanded', 'false');
}

function getPlan(duration = state.draft.duration) {
  return state.config?.pricing?.plans?.find(plan => plan.duration === Number(duration)) || null;
}

function availableTokens() {
  if (state.wallet?.unlimited) return Infinity;
  return Number(state.wallet?.available ?? state.wallet?.balance ?? 0);
}

function costFor(duration) {
  return getPlan(duration)?.cost ?? 0;
}

function renderCurrent() {
  stopTimers();
  closeModal();
  window.scrollTo(0, 0);
  const seq = ++state.seq;
  const route = parseRoute();

  if (!state.config) {
    app.innerHTML = `<div class="boot-screen"><div class="boot-wordmark">Could not load ViralYantra AI</div><button class="btn btn-secondary" type="button" data-action="reload-app">Reload</button></div>`;
    return;
  }

  if (!state.auth) {
    closeProfile();
    if (state.otp && route.name === 'verify') return renderOtp(seq);
    if (route.name !== 'login') {
      history.replaceState(null, '', '#/login');
    }
    return renderLogin();
  }

  if (route.name === 'login' || route.name === 'verify') {
    history.replaceState(null, '', '#/create');
    return renderCreate(seq);
  }

  if (route.name === 'job' && route.id) return renderJobRoute(route.id, seq);
  if (route.name === 'videos') return renderVideos(seq);
  if (route.name === 'wallet') return renderWallet(seq);
  if (route.name === 'admin') {
    if (!state.auth.isAdmin) {
      toast('Administrator access is required.', 'error');
      history.replaceState(null, '', '#/create');
      return renderCreate(seq);
    }
    return renderAdmin(seq);
  }
  if (route.name !== 'create') history.replaceState(null, '', '#/create');
  return renderCreate(seq);
}

function renderLogin() {
  const auth = state.config.auth;
  const plans = state.config.pricing.plans;
  const shortPlan = plans.find(plan => plan.duration === 30);
  const longPlan = plans.find(plan => plan.duration === 600);
  const options = auth.countryCodes.map(country => `
    <option value="${esc(country.code)}" ${country.code === auth.defaultCountryCode ? 'selected' : ''}>${esc(country.country)} (${esc(country.code)})</option>
  `).join('');
  const setup = auth.setupMessage
    ? setupBanner(auth.setupMessage, auth.devOtpEnabled ? 'info' : 'warn')
    : '';

  app.innerHTML = `
    <div class="auth-page">
      <header class="auth-nav">
        ${logoHtml({ size: 36 })}
        <span class="badge ${auth.whatsapp.configured ? 'live' : 'amber'}">${icon(auth.whatsapp.configured ? 'shield' : 'info')} ${auth.whatsapp.configured ? 'WhatsApp verified login' : auth.devOtpEnabled ? 'Development OTP mode' : 'OTP setup required'}</span>
      </header>
      <div class="auth-grid">
        <section class="hero">
          <div class="hero-eyebrow"><span class="dot"></span> Scene-based AI video studio</div>
          <h1 class="hero-title">One idea.<br><span class="grad">Viral videos.</span></h1>
          <p class="hero-copy">Turn a prompt or a single image into a finished, scene-by-scene video. Create <strong>30-second Shorts</strong> or assemble a <strong>10-minute Long Video</strong> — with transparent token pricing and verified output duration.</p>
          <div class="feature-row">
            <div class="feature-card">
              <div class="fc-icon">${icon('sparkles')}</div>
              <strong>Text to Video</strong>
              <span>Prompt, style, scene plan and render.</span>
            </div>
            <div class="feature-card">
              <div class="fc-icon">${icon('image')}</div>
              <strong>Image to Video</strong>
              <span>Animate a reference frame with AI motion.</span>
            </div>
            <div class="feature-card">
              <div class="fc-icon">${icon('film')}</div>
              <strong>Shorts + Long</strong>
              <span>9:16 Shorts or 16:9 long-form video.</span>
            </div>
          </div>
          <div class="hero-proof">
            <span>${icon('shield')} Backend-verified admin access</span>
            <span>${icon('check')} 1,000 free tokens after verification</span>
            <span>${icon('clock')} Resumable, persistent login</span>
          </div>
        </section>

        <section class="auth-card" aria-labelledby="login-title">
          <h2 id="login-title">Continue with mobile</h2>
          <p class="sub">We'll send a one-time code to your WhatsApp number. No password to forget.</p>
          <form id="login-form" class="auth-form" novalidate>
            <div class="field">
              <label for="country-code">Country code <span class="hint">India default</span></label>
              <div class="select-wrap">
                <select id="country-code" name="countryCode" class="select">${options}</select>
                ${icon('chevronDown')}
              </div>
            </div>
            <div class="field">
              <label for="phone-input">Mobile number <span class="hint">WhatsApp</span></label>
              <div class="phone-input-wrap">
                <span class="cc" id="phone-cc">+91</span>
                <input id="phone-input" name="phone" class="input" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="18" aria-describedby="phone-help">
              </div>
              <div id="phone-help" class="sr-only">Enter your mobile number without the country code.</div>
            </div>
            <div id="login-error" class="form-error" role="alert"></div>
            ${setup}
            <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('whatsapp')} Send OTP on WhatsApp</button>
          </form>
          <div class="mini-plans">
            <div class="mini-plan"><span>YouTube Shorts · 30s</span><strong><em>${fmtNumber(shortPlan?.cost ?? 25)} tokens</em></strong></div>
            <div class="mini-plan"><span>Long Video · 10 min</span><strong><em>${fmtNumber(longPlan?.cost ?? 500)} tokens</em></strong></div>
          </div>
          <div class="secure-note">${icon('lock')} Verified numbers only · 1,000 signup tokens granted once</div>
          <p class="auth-legal">By continuing you agree to fair-use generation limits. Token costs are shown before every generation.</p>
        </section>
      </div>
    </div>
  `;

  const countrySelect = document.getElementById('country-code');
  countrySelect?.addEventListener('change', () => {
    const cc = document.getElementById('phone-cc');
    if (cc) cc.textContent = countrySelect.value;
  });
}

function startOtpTimer() {
  if (state.resendTimer) clearInterval(state.resendTimer);
  const tick = () => {
    const pending = state.otp;
    if (!pending) return;
    const resendButton = document.getElementById('resend-btn');
    const expiry = document.getElementById('otp-expiry');
    const resendRemaining = Math.max(0, Math.ceil((pending.resendAt - Date.now()) / 1000));
    if (resendButton) {
      resendButton.disabled = resendRemaining > 0;
      resendButton.textContent = resendRemaining > 0 ? `Resend in 0:${String(resendRemaining).padStart(2, '0')}` : 'Resend code';
    }
    if (expiry) {
      const expiryRemaining = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
      expiry.textContent = expiryRemaining > 0
        ? `Code expires in ${Math.floor(expiryRemaining / 60)}:${String(expiryRemaining % 60).padStart(2, '0')}`
        : 'Code expired · request a new one';
    }
  };
  tick();
  state.resendTimer = setInterval(tick, 1000);
}

function renderOtp(seq) {
  const pending = state.otp;
  if (!pending) {
    history.replaceState(null, '', '#/login');
    return renderLogin();
  }
  const devBlock = pending.devOtp ? `
    <div class="dev-otp">
      <div class="dev-top"><span>${icon('alert')} Development-only OTP</span><span class="badge live">Not production</span></div>
      <div class="dev-code"><strong>${esc(pending.devOtp)}</strong><button class="btn btn-secondary btn-sm" type="button" data-action="autofill-otp">Use code</button></div>
      <p class="dev-note">This code was generated locally because WhatsApp delivery is not configured for this environment. It is never available when NODE_ENV=production.</p>
    </div>
  ` : '';
  const notice = pending.deliveryWarning
    ? setupBanner(pending.deliveryWarning, 'warn')
    : pending.setupNotice
      ? setupBanner(pending.setupNotice, 'info')
      : '';
  const inputs = Array.from({ length: 6 }, (_, index) => `
    <input class="otp-digit" data-otp-index="${index}" inputmode="numeric" autocomplete="${index === 0 ? 'one-time-code' : 'off'}" maxlength="1" aria-label="OTP digit ${index + 1}" ${index === 0 ? 'autofocus' : ''}>
  `).join('');

  app.innerHTML = `
    <div class="otp-page">
      <header class="auth-nav">${logoHtml({ size: 34 })}<span class="badge violet">${icon('lock')} Secure verification</span></header>
      <div class="otp-wrap">
        <div class="otp-card">
          <button class="back-link" type="button" data-action="back-login">${icon('arrowLeft')} Change number</button>
          ${logoHtml({ size: 34 })}
          <h1>Verify on WhatsApp</h1>
          <p class="sub">Enter the 6-digit code sent to <span class="phone-display">${esc(pending.phone)}</span>. ${state.config.auth.whatsapp.configured ? 'Delivery is handled by the server-side WhatsApp provider.' : 'Development verification is active in this environment.'}</p>
          <form id="verify-form" novalidate>
            <div class="otp-grid">${inputs}</div>
            <div id="otp-error" class="form-error" role="alert"></div>
            <div class="otp-meta">
              <span id="otp-expiry">Code expires in ${Math.floor(state.config.auth.otpExpirySeconds / 60)}:00</span>
              <button id="resend-btn" class="resend" type="button" data-action="resend-otp" disabled>Resend code</button>
            </div>
            <button class="btn btn-primary btn-block btn-lg" type="submit" style="margin-top:18px">${icon('shield')} Verify and continue</button>
          </form>
          ${notice}
          ${devBlock}
          <div class="secure-note">${icon('lock')} Codes expire quickly and are rate-limited on the server</div>
        </div>
      </div>
    </div>
  `;
  startOtpTimer();
  setTimeout(() => document.querySelector('[data-otp-index="0"]')?.focus(), 60);
}

function renderCreate(seq) {
  const draft = state.draft;
  const plan = getPlan(draft.duration);
  const cost = plan?.cost ?? 0;
  const unlimited = Boolean(state.wallet?.unlimited);
  const available = availableTokens();
  const insufficient = !unlimited && available < cost;
  const maintenance = state.config.app.maintenance.enabled && !state.auth.isAdmin;
  const styles = state.config.generation.styles.map(style => `
    <button class="style-card ${draft.style === style.id ? 'active' : ''}" type="button" data-action="style" data-style="${esc(style.id)}">
      <span class="style-dot"></span>
      <strong>${esc(style.name)}</strong>
      <span class="check-mark">${icon('check')}</span>
    </button>
  `).join('');
  const planCards = state.config.pricing.plans.map(item => `
    <button class="plan-card ${Number(draft.duration) === Number(item.duration) ? 'active' : ''}" type="button" data-action="duration" data-duration="${item.duration}">
      <div class="plan-top"><strong>${item.duration === 600 ? 'Long Video' : 'YouTube Shorts'}</strong><span class="ratio">${esc(item.aspectRatio)}</span></div>
      <span class="duration">${item.duration === 600 ? '10 minutes · 600 seconds' : '30 seconds'}</span>
      <div class="plan-price"><b>${fmtNumber(item.cost)}</b><span>tokens / video</span></div>
    </button>
  `).join('');
  const imageBlock = draft.mode === 'image-to-video'
    ? (draft.imageDataUrl
      ? `<div class="upload-preview">
          <img src="${draft.imageDataUrl}" alt="Selected reference">
          <div class="file-meta"><strong>${esc(draft.imageName || 'Reference image')}</strong><span>Ready to animate</span></div>
          <button class="btn btn-ghost btn-sm" type="button" data-action="remove-image">${icon('x')} Remove</button>
        </div>`
      : `<label class="upload-zone" id="upload-zone">
          <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp">
          <span class="up-icon">${icon('image')}</span>
          <strong>Drop a reference image or browse</strong>
          <span>PNG, JPEG or WebP · up to ${Math.round(state.config.generation.maxImageBytes / 1024 / 1024)}MB</span>
        </label>`)
    : '';

  const demoBox = state.config.generation.demoEnabled ? `
    <div class="demo-box">
      <div class="demo-toggle">
        <div class="dt-copy">
          <strong>${icon('alert', 'icon-sm')} Demo simulation ${state.config.generation.aiConfigured ? '' : '(AI provider not configured)'}</strong>
          <span>Clearly labelled local placeholder render. It exercises the real token reservation, charge and refund ledger. Not AI-generated and disabled in production.</span>
        </div>
        <label class="switch" aria-label="Toggle demo simulation">
          <input id="demo-toggle" type="checkbox" ${draft.demo ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  ` : '';

  const workflowScenes = plan?.sceneCount ?? 0;
  const selectedStyle = state.config.generation.styles.find(item => item.id === draft.style);
  const content = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Create your next viral video</h1>
          <p>Text or image in. Scene-based video out. The server validates pricing, reserves tokens and verifies the final duration before charging.</p>
        </div>
        <div class="head-actions">
          <a class="btn btn-secondary btn-sm" href="#/videos">${icon('film')} My videos</a>
        </div>
      </div>
      ${maintenance ? setupBanner(state.config.app.maintenance.message, 'warn') : ''}
      <div class="create-grid">
        <section class="panel panel-pad">
          <div class="panel-head" style="margin-bottom:15px">
            <div class="tabs" role="tablist" aria-label="Generation mode">
              <button class="tab ${draft.mode === 'text-to-video' ? 'active' : ''}" type="button" data-action="mode" data-mode="text-to-video" role="tab" aria-selected="${draft.mode === 'text-to-video'}">${icon('sparkles')} Text to Video</button>
              <button class="tab ${draft.mode === 'image-to-video' ? 'active' : ''}" type="button" data-action="mode" data-mode="image-to-video" role="tab" aria-selected="${draft.mode === 'image-to-video'}">${icon('image')} Image to Video</button>
            </div>
            <span class="badge violet">${icon('activity', 'icon-sm')} ${workflowScenes} scenes</span>
          </div>

          <form id="create-form" novalidate>
            ${draft.mode === 'image-to-video' ? `<div class="field-row"><div class="field"><label>Reference image <span class="hint">${draft.imageDataUrl ? 'Selected' : 'Required'}</span></label>${imageBlock}</div></div>` : ''}
            <div class="field-row">
              <div class="field">
                <label for="prompt">Describe your video <span class="hint">Be specific</span></label>
                <textarea id="prompt" class="prompt-area" maxlength="${state.config.generation.maxPromptLength}" placeholder="A founder launches a solar startup in Mumbai. Show the city at sunrise, the product reveal, happy customers and a bold call to action.">${esc(draft.prompt)}</textarea>
                <div class="prompt-foot"><span>Scene prompts are generated from this idea</span><span class="count"><span id="prompt-count">${draft.prompt.length}</span> / ${state.config.generation.maxPromptLength}</span></div>
                <div class="idea-chips">
                  <button class="idea-chip" type="button" data-action="idea" data-prompt="A cinematic drone journey through the Himalayas at sunrise, with a lone traveler discovering a hidden temple.">Travel cinematic</button>
                  <button class="idea-chip" type="button" data-action="idea" data-prompt="A sleek smartwatch product launch: macro details, water splash, fitness montage and a bold end card.">Product launch</button>
                  <button class="idea-chip" type="button" data-action="idea" data-prompt="An explainer about saving money: a young professional, a growing plant, simple motion graphics and a clear call to action.">Explainer</button>
                </div>
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label>Video style <span class="hint">${esc(selectedStyle?.name || '')}</span></label>
                <div class="style-grid">${styles}</div>
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label>Output plan <span class="hint">Backend-validated pricing</span></label>
                <div class="plan-grid">${planCards}</div>
              </div>
            </div>

            ${demoBox}

            <div class="summary">
              <div class="summary-line"><span>Target duration</span><strong>${plan?.duration === 600 ? '10 minutes (600s)' : '30 seconds'}</strong></div>
              <div class="summary-line"><span>Aspect ratio</span><strong>${esc(plan?.aspectRatio || '9:16')}</strong></div>
              <div class="summary-line"><span>Scene plan</span><strong>${workflowScenes} scenes</strong></div>
              <div class="summary-line"><span>Reserved at start</span><strong>${unlimited ? 'Unlimited' : `${fmtNumber(cost)} tokens`}</strong></div>
              <div class="summary-line"><span>Wallet after success</span><strong id="summary-after">${unlimited ? 'Unlimited' : fmtNumber(Math.max(0, available - cost))}</strong></div>
              <div class="summary-line total"><span>Generation cost</span><b>${fmtNumber(cost)} tokens</b></div>
              ${insufficient ? `<div class="insufficient">${icon('alert')}<div>Insufficient tokens. You need <strong>${fmtNumber(cost - available)}</strong> more. Ask the administrator for a bonus or choose a lower-cost plan.</div></div>` : ''}
            </div>
            <button class="btn btn-primary btn-lg generate-btn" type="submit" ${insufficient || maintenance ? 'disabled' : ''}>
              ${icon('sparkles')} ${unlimited ? 'Generate with unlimited tokens' : `Generate for ${fmtNumber(cost)} tokens`}
            </button>
          </form>
        </section>

        <aside class="panel panel-pad workflow-card">
          <div class="workflow-visual">
            <div class="wf-tag t1">plan.scenes</div>
            <div class="wf-tag t2">${esc(plan?.aspectRatio || '9:16')}</div>
            <div class="wf-tag t3">${esc(selectedStyle?.name?.toLowerCase() || 'cinematic')}</div>
            <div class="wf-orb"></div>
          </div>
          <div class="panel-head" style="margin-bottom:12px">
            <div class="panel-title-row">${icon('activity')}<div><h2>Scene workflow</h2><p>Every step is tracked server-side</p></div></div>
          </div>
          <div class="workflow-list">
            <div class="workflow-step"><span class="ws-num">01</span><div><strong>Plan the story</strong><span>Your idea is split into ${workflowScenes} connected scenes with a consistent style.</span></div></div>
            <div class="workflow-step"><span class="ws-num">02</span><div><strong>Reserve tokens</strong><span>${unlimited ? 'Administrator tokens are never deducted.' : `${fmtNumber(cost)} tokens are held securely — not charged yet.`}</span></div></div>
            <div class="workflow-step"><span class="ws-num">03</span><div><strong>Generate & assemble</strong><span>${draft.demo ? 'A labelled local demo video is rendered without AI.' : 'Each scene is generated, then assembled into one video.'}</span></div></div>
            <div class="workflow-step"><span class="ws-num">04</span><div><strong>Verify duration</strong><span>The final file must reach ${plan?.duration === 600 ? '600 seconds' : '30 seconds'} before it is marked complete and charged.</span></div></div>
          </div>
          <div class="workflow-meta">
            <div class="wm-item"><span>Model</span><strong>${draft.demo ? 'Demo renderer' : state.config.generation.aiConfigured ? esc(state.config.generation.aiModel) : 'Not configured'}</strong></div>
            <div class="wm-item"><span>Aspect</span><strong>${esc(plan?.aspectRatio || '9:16')}</strong></div>
            <div class="wm-item"><span>Scenes</span><strong>${workflowScenes} × ${plan?.duration === 600 ? '30s' : '6s'}</strong></div>
            <div class="wm-item"><span>Charge</span><strong>${unlimited ? 'Unlimited' : `${fmtNumber(cost)} tokens`}</strong></div>
          </div>
          <div class="workflow-note">${icon('info', 'icon-sm')} If the provider cannot reach the requested duration, the job fails honestly and the reserved tokens are refunded. No fake completion.</div>
        </aside>
      </div>
    </div>
  `;
  pageFade(content, 'create');

  const prompt = document.getElementById('prompt');
  prompt?.addEventListener('input', () => {
    state.draft.prompt = prompt.value;
    const count = document.getElementById('prompt-count');
    if (count) count.textContent = prompt.value.length;
  });
  prompt?.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') document.getElementById('create-form')?.requestSubmit();
  });
}

function renderJobRoute(jobId, seq) {
  loadingPage('Generation', 'videos');
  (async () => {
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`, { allowAuthError: true });
      if (seq !== state.seq) return;
      if (data.wallet) state.wallet = data.wallet;
      paintJob(data.job, seq);
    } catch (error) {
      if (seq !== state.seq) return;
      errorPage('Generation not found', error.message, 'videos');
    }
  })();
}

function paintJob(job, seq) {
  state.currentJob = job;
  const terminal = ['completed', 'failed', 'cancelled'].includes(job.status);
  const statusDetail = job.status === 'queued' ? 'Your job is queued and waiting for a worker.'
    : job.status === 'planning' ? 'Splitting your idea into connected scenes.'
    : job.status === 'generating' ? (job.currentScene ? `Generating scene ${job.currentScene} of ${job.sceneCount}.` : 'Generating scene clips.')
    : job.status === 'assembling' ? 'Assembling the final video and verifying its duration.'
    : job.status === 'completed' ? 'The final video passed duration verification.'
    : job.status === 'cancelled' ? 'Generation was cancelled and reserved tokens were refunded.'
    : 'The generation could not be completed. Any reservation was refunded.';
  const scenes = Array.isArray(job.scenes) ? job.scenes : [];
  const sceneRows = scenes.map(scene => {
    const sceneClass = scene.status === 'complete' ? 'complete' : scene.status === 'active' ? 'active' : '';
    const sceneState = scene.status === 'complete'
      ? `<span class="scene-state done">${icon('check', 'icon-sm')} Complete</span>`
      : scene.status === 'active'
        ? '<span class="scene-state live">Rendering…</span>'
        : '<span class="scene-state">Queued</span>';
    return `<div class="scene-row ${sceneClass}">
      <span class="scene-index">${String(scene.index).padStart(2, '0')}</span>
      <div class="scene-copy"><strong>${esc(scene.title)}</strong><span>${esc(fmtDuration(scene.durationSeconds))} · ${esc(job.styleName)}</span></div>
      ${sceneState}
    </div>`;
  }).join('');

  const resultBlock = job.status === 'completed' ? `
    <div class="result-card">
      <div class="result-head">
        <div class="result-icon">${icon('check')}</div>
        <div>
          <strong>${job.isDemo ? 'Demo video ready' : 'Your video is ready'}</strong>
          <p>Verified duration: <strong>${esc(fmtDuration(job.actualDuration))}</strong> · target ${esc(fmtDuration(job.targetDuration))} · ${job.isDemo ? 'demo simulation, not AI-generated' : 'AI scene pipeline completed'}.</p>
          ${job.isDemo ? `<span class="demo-stamp">${icon('alert', 'icon-sm')} Demo simulation — no AI inference</span>` : ''}
        </div>
      </div>
      <video class="video-player" controls preload="metadata" src="/api/jobs/${encodeURIComponent(job.id)}/download"></video>
      <div class="result-actions">
        <a class="btn btn-primary" href="/api/jobs/${encodeURIComponent(job.id)}/download">${icon('download')} Download MP4</a>
        <a class="btn btn-secondary" href="/api/jobs/${encodeURIComponent(job.id)}/manifest">${icon('list')} Scene plan JSON</a>
        <a class="btn btn-ghost" href="#/create">${icon('plus')} Create another</a>
      </div>
    </div>
  ` : job.status === 'failed' || job.status === 'cancelled' ? `
    <div class="result-card ${job.status === 'cancelled' ? 'cancelled' : 'failed'}">
      <div class="result-head">
        <div class="result-icon">${icon(job.status === 'cancelled' ? 'alert' : 'x')}</div>
        <div>
          <strong>${job.status === 'cancelled' ? 'Generation cancelled' : 'Generation failed'}</strong>
          <p>${esc(job.errorMessage || 'The generation did not complete.')}</p>
          <p style="margin-top:5px">${job.refunded ? 'Your reserved tokens were refunded to your wallet.' : 'No tokens were charged for this job.'}</p>
        </div>
      </div>
      <div class="result-actions">
        <button class="btn btn-primary" type="button" data-action="retry-job" data-job-id="${job.id}">${icon('refresh')} Try again</button>
        <a class="btn btn-secondary" href="#/wallet">${icon('wallet')} Check wallet</a>
        <a class="btn btn-ghost" href="#/videos">${icon('film')} All videos</a>
      </div>
    </div>
  ` : '';

  const content = `
    <div class="page progress-wrap">
      <div class="page-head" style="margin-bottom:14px">
        <div>
          <a class="back-link" href="#/videos">${icon('arrowLeft')} Back to videos</a>
          <h1>${job.isDemo ? 'Demo generation' : 'Generating your video'}</h1>
          <p>${esc(job.prompt)}</p>
        </div>
        <div class="head-actions">${statusBadge(job.status)}<span class="badge">${icon('clock', 'icon-sm')} ${esc(fmtDuration(job.targetDuration))}</span></div>
      </div>
      <section class="panel panel-pad progress-panel">
        <div class="progress-top">
          <div>
            <div class="badge violet">${icon('activity', 'icon-sm')} Scene-based job</div>
            <h2 style="font-size:20px;letter-spacing:-.03em;margin-top:9px">${esc(job.styleName)} · ${job.targetDuration === 600 ? 'Long Video' : 'Shorts'}</h2>
            <p>Job ${esc(job.id.slice(0, 12))}… · ${job.isDemo ? 'demo simulation' : state.config.generation.aiConfigured ? esc(state.config.generation.aiModel) : 'provider unavailable'}</p>
          </div>
          ${!terminal ? `<button class="btn btn-danger btn-sm" type="button" data-action="cancel-job" data-job-id="${job.id}">${icon('x')} Cancel</button>` : ''}
        </div>
        <div class="progress-visual">
          <div class="orb-wrap ${job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : ''}">
            <div class="orb-ring" style="--p:${Math.max(0, Math.min(100, job.progress))}%"></div>
            <div class="orb-inner">
              <div class="pct">${Math.round(job.progress)}<small>%</small></div>
              <div class="orb-label">${esc(STATUS_LABELS[job.status] || job.status)}</div>
            </div>
          </div>
          <div class="progress-detail">
            <strong>${esc(STATUS_LABELS[job.status] || job.status)}</strong>
            <p>${esc(statusDetail)}</p>
            <div class="progress-bar"><span style="width:${Math.max(0, Math.min(100, job.progress))}%"></span></div>
            <div class="progress-stats">
              <span class="stat-pill">${icon('film', 'icon-sm')} <strong>${job.sceneCount}</strong> scenes</span>
              <span class="stat-pill">${icon('clock', 'icon-sm')} target <strong>${esc(fmtDuration(job.targetDuration))}</strong></span>
              <span class="stat-pill">${icon('zap', 'icon-sm')} <strong>${job.isDemo ? 'Demo' : state.wallet?.unlimited ? 'Unlimited' : `${fmtNumber(job.cost)}`}</strong> ${job.isDemo ? 'render' : 'tokens'}</span>
              ${job.isDemo ? '<span class="stat-pill" style="color:var(--amber)">Demo only</span>' : ''}
            </div>
          </div>
        </div>
        ${resultBlock}
        <div style="margin-top:22px">
          <div class="panel-head" style="margin-bottom:10px"><div class="panel-title-row">${icon('list')}<div><h2>Scene progress</h2><p>Actual generated scene state, not a simulated counter</p></div></div></div>
          <div class="scene-list">${sceneRows || '<p style="color:var(--muted);font-size:12px">Scene plan is being prepared.</p>'}</div>
        </div>
      </section>
    </div>
  `;
  pageFade(content, 'videos');

  if (!terminal) {
    state.pollTimer = setTimeout(async () => {
      if (seq !== state.seq) return;
      try {
        const data = await api(`/api/jobs/${encodeURIComponent(job.id)}`, { allowAuthError: true });
        if (seq !== state.seq) return;
        if (data.wallet) state.wallet = data.wallet;
        const next = data.job;
        if (next.status !== job.status && ['completed', 'failed', 'cancelled'].includes(next.status) && !state.notified.has(next.id)) {
          state.notified.add(next.id);
          if (next.status === 'completed') toast(next.isDemo ? 'Demo video complete and verified.' : 'Video complete and verified.', 'success');
          else if (next.status === 'cancelled') toast('Generation cancelled. Reserved tokens refunded.', 'warn');
          else toast('Generation failed. Reserved tokens refunded.', 'error');
        }
        paintJob(next, seq);
      } catch (error) {
        if (error.status !== 401) toast(error.message, 'error');
      }
    }, 1500);
  }
}

function renderVideos(seq) {
  loadingPage('My videos', 'videos');
  (async () => {
    try {
      const data = await api('/api/jobs?limit=100', { allowAuthError: true });
      if (seq !== state.seq) return;
      state.jobs = data.jobs || [];
      const cards = state.jobs.map(job => {
        const hue = hashHue(job.id);
        const active = ['queued', 'planning', 'generating', 'assembling'].includes(job.status);
        const actions = job.status === 'completed'
          ? `${job.downloadUrl ? `<a class="btn btn-secondary btn-sm" href="${job.downloadUrl}">${icon('download')} MP4</a>` : ''}<a class="btn btn-ghost btn-sm" href="${job.manifestUrl || `/api/jobs/${job.id}/manifest`}">${icon('list')} Scenes</a><a class="btn btn-ghost btn-sm" href="#/job/${job.id}">Open</a>`
          : active
            ? `<a class="btn btn-secondary btn-sm" href="#/job/${job.id}">${icon('activity')} View progress</a>`
            : `<button class="btn btn-secondary btn-sm" type="button" data-action="retry-job" data-job-id="${job.id}">${icon('refresh')} Retry</button><a class="btn btn-ghost btn-sm" href="#/job/${job.id}">Details</a>`;
        return `<article class="panel video-card">
          <div class="thumb" style="--hue:${hue}">
            <div class="thumb-badges">${statusBadge(job.status)}${job.isDemo ? '<span class="badge amber">Demo</span>' : ''}</div>
            <div class="play-orb">${icon('play')}</div>
            <span class="ratio-badge">${esc(job.aspectRatio)}</span>
          </div>
          <div class="video-body">
            <h3>${esc(job.prompt)}</h3>
            <div class="video-sub">
              <span>${icon('film', 'icon-sm')} ${job.targetDuration === 600 ? 'Long Video' : 'Short'}</span>
              <span>${icon('clock', 'icon-sm')} ${esc(job.actualDuration ? fmtDuration(job.actualDuration) : fmtDuration(job.targetDuration))}</span>
              <span>${icon('zap', 'icon-sm')} ${job.isDemo ? 'Demo' : `${fmtNumber(job.cost)} tokens`}</span>
              <span>${esc(timeAgo(job.createdAt))}</span>
            </div>
            <div class="video-actions">${actions}</div>
          </div>
        </article>`;
      }).join('');

      const content = `
        <div class="page">
          <div class="page-head">
            <div><h1>My videos</h1><p>Every generation, its real status, verified duration and token outcome.</p></div>
            <div class="head-actions"><a class="btn btn-primary btn-sm" href="#/create">${icon('plus')} New video</a></div>
          </div>
          ${state.jobs.length ? `<div class="video-grid">${cards}</div>` : `
            <div class="panel empty-state">
              <div class="empty-icon">${icon('film')}</div>
              <h2>No videos yet</h2>
              <p>Start with a 30-second Short or a 10-minute Long Video. Your first 1,000 tokens are on us after WhatsApp verification.</p>
              <a class="btn btn-primary" href="#/create">${icon('sparkles')} Create your first video</a>
            </div>`}
        </div>
      `;
      pageFade(content, 'videos');
    } catch (error) {
      if (seq !== state.seq) return;
      errorPage('Could not load videos', error.message, 'videos');
    }
  })();
}

function transactionLabel(type) {
  return {
    signup_bonus: 'Welcome bonus',
    generation_reserve: 'Tokens reserved',
    generation_release: 'Reservation released',
    generation_charge: 'Video generation',
    generation_refund: 'Generation refund',
    admin_grant: 'Bonus from administrator',
    admin_deduct: 'Adjustment by administrator'
  }[type] || type;
}

function renderWallet(seq) {
  loadingPage('Token wallet', 'wallet');
  (async () => {
    try {
      const data = await api('/api/wallet', { allowAuthError: true });
      if (seq !== state.seq) return;
      state.wallet = data.wallet;
      const plans = state.config.pricing.plans;
      const transactions = data.transactions || [];
      const ledger = transactions.map(tx => {
        const positive = tx.delta >= 0;
        const isReserve = tx.type === 'generation_reserve' || tx.type === 'generation_charge' || tx.type === 'admin_deduct';
        const plus = tx.type === 'generation_release' || tx.type === 'generation_refund' || tx.type === 'signup_bonus' || tx.type === 'admin_grant';
        return `<div class="ledger-row">
          <div class="ledger-icon ${plus ? 'plus' : isReserve ? 'minus' : ''}">${icon(plus ? 'plus' : isReserve ? 'zap' : 'activity')}</div>
          <div class="ledger-copy"><strong>${esc(transactionLabel(tx.type))}</strong><span>${esc(tx.reason || 'Wallet update')} · ${esc(fmtDate(tx.createdAt, true))}</span></div>
          <div class="ledger-amount ${tx.delta > 0 ? 'plus' : tx.delta < 0 ? 'minus' : ''}">${tx.delta > 0 ? '+' : ''}${fmtNumber(tx.delta)}<small>${fmtNumber(tx.balanceAfter)} left</small></div>
        </div>`;
      }).join('');
      const unlimited = state.wallet.unlimited;
      const content = `
        <div class="page">
          <div class="page-head">
            <div><h1>Token wallet</h1><p>Reserved tokens are held at job start and only settled after a verified successful video.</p></div>
            <div class="head-actions"><a class="btn btn-primary btn-sm" href="#/create">${icon('sparkles')} Use tokens</a></div>
          </div>
          <div class="wallet-hero">
            <div class="balance-card">
              <div class="balance-label">${icon('zap')} Available balance</div>
              <div class="balance-value">${unlimited ? 'Unlimited' : fmtNumber(state.wallet.balance)}${unlimited ? '' : '<small>tokens</small>'}</div>
              <div class="balance-foot">
                <span>${icon('shield')} ${unlimited ? 'Administrator generation is never charged' : 'Server-verified wallet'}</span>
                <span>${icon('lock')} ${unlimited ? 'Unlimited role' : `${fmtNumber(state.wallet.reserved)} tokens reserved`}</span>
              </div>
            </div>
            <div class="wallet-side">
              <div class="wallet-stat"><span>Reserved now</span><strong>${fmtNumber(state.wallet.reserved)}</strong><small>Held by active jobs</small></div>
              <div class="wallet-stat"><span>Signup bonus</span><strong>${fmtNumber(state.config.pricing.signupBonus)}</strong><small>Granted once after verification</small></div>
            </div>
          </div>
          <div class="price-cards">
            ${plans.map(plan => `<div class="price-card"><div class="pc-head"><span>${plan.duration === 600 ? 'YouTube Long Video' : 'YouTube Shorts'}</span>${icon('film')}</div><strong>${fmtNumber(plan.cost)} <small>tokens</small></strong><small>${plan.duration === 600 ? '10 minutes · 600s · 16:9' : '30 seconds · 9:16'}</small></div>`).join('')}
          </div>
          <section class="panel panel-pad">
            <div class="panel-head"><div class="panel-title-row">${icon('list')}<div><h2>Transaction ledger</h2><p>Append-only token history</p></div></div><span class="badge">${transactions.length} entries</span></div>
            <div class="ledger">${ledger || '<div class="empty-state" style="padding:30px"><p>No transactions yet.</p></div>'}</div>
          </section>
        </div>
      `;
      pageFade(content, 'wallet');
    } catch (error) {
      if (seq !== state.seq) return;
      errorPage('Could not load wallet', error.message, 'wallet');
    }
  })();
}

/* Admin console */

function renderAdmin(seq) {
  loadAdmin(seq);
}

async function loadAdmin(seq = ++state.seq) {
  loadingPage('Admin console', 'admin');
  try {
    const overview = await api('/api/admin/overview', { allowAuthError: true });
    let tabData = null;
    if (state.adminTab === 'users') {
      tabData = await api(`/api/admin/users?q=${encodeURIComponent(state.adminSearch)}`, { allowAuthError: true });
    } else if (state.adminTab === 'jobs') {
      tabData = await api(`/api/admin/jobs?status=${encodeURIComponent(state.adminJobStatus)}`, { allowAuthError: true });
    } else if (state.adminTab === 'audit') {
      tabData = await api('/api/admin/audit', { allowAuthError: true });
    } else if (state.adminTab === 'setup') {
      tabData = await api('/api/admin/providers', { allowAuthError: true });
    }
    if (seq !== state.seq) return;
    state.admin = { overview, tabData };
    paintAdmin(seq);
  } catch (error) {
    if (seq !== state.seq) return;
    errorPage('Admin console unavailable', error.message, 'admin');
  }
}

function metricCard(label, value, iconName, sub = '') {
  return `<div class="metric"><div class="m-top"><span>${esc(label)}</span>${icon(iconName)}</div><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function adminTabs() {
  const tabs = [['users', 'Users'], ['jobs', 'Generation jobs'], ['settings', 'Pricing & settings'], ['audit', 'Audit log'], ['setup', 'Provider setup']];
  return `<div class="admin-tabs">${tabs.map(([id, label]) => `<button class="admin-tab ${state.adminTab === id ? 'active' : ''}" type="button" data-action="admin-tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}

function paintAdmin(seq) {
  const { overview, tabData } = state.admin;
  const stats = overview.stats;
  const settings = overview.settings;
  let panel = '';

  if (state.adminTab === 'users') {
    const users = tabData?.users || [];
    const rows = users.map(user => `
      <tr>
        <td><div class="user-cell"><span class="user-avatar">${esc(user.phoneMasked.slice(-2))}</span><div><strong>${esc(user.phone)}</strong><span>${user.isAdmin ? 'Administrator' : 'Member'} · joined ${esc(fmtDate(user.createdAt))}</span></div></div></td>
        <td><span class="badge ${user.isAdmin ? 'violet' : ''}">${user.isAdmin ? 'Admin' : 'User'}</span></td>
        <td><span class="badge ${user.status === 'active' ? 'live' : 'red'}">${esc(user.status)}</span></td>
        <td>${user.unlimited ? '<span class="badge cyan">Unlimited</span>' : `${fmtNumber(user.balance)} <small style="color:var(--muted-2)">/ ${fmtNumber(user.reserved)} res.</small>`}</td>
        <td>${fmtNumber(user.jobCount)}</td>
        <td><div class="table-actions"><button class="btn btn-secondary btn-sm" type="button" data-action="manage-user" data-user-id="${user.id}">Manage</button></div></td>
      </tr>
    `).join('');
    panel = `<section class="panel panel-pad">
      <div class="panel-head"><div class="panel-title-row">${icon('users')}<div><h2>User management</h2><p>Search by mobile number, inspect wallet and jobs</p></div></div><span class="badge">${users.length} users</span></div>
      <form id="admin-search-form" class="search-row">
        <div class="search-input-wrap">${icon('search')}<input id="admin-search" class="input" name="q" value="${esc(state.adminSearch)}" placeholder="Search mobile number or user ID" autocomplete="off"></div>
        <button class="btn btn-secondary" type="submit">Search</button>
      </form>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Wallet</th><th>Jobs</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">No matching users.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  } else if (state.adminTab === 'jobs') {
    const jobs = tabData?.jobs || [];
    const rows = jobs.map(job => `
      <tr>
        <td><div><strong style="font-size:11px">${esc(job.mode)}</strong><br><span style="color:var(--muted-2);font-size:9.5px">${esc(job.id.slice(0, 12))}… · ${esc(job.styleName)}</span></div></td>
        <td>${esc(job.userPhone)}</td>
        <td>${statusBadge(job.status)}</td>
        <td>${job.targetDuration === 600 ? '10 min' : '30 sec'}</td>
        <td>${job.isDemo ? 'Demo' : fmtNumber(job.cost)}</td>
        <td>${esc(fmtDate(job.createdAt, true))}</td>
        <td><div class="table-actions">${!['completed', 'failed', 'cancelled'].includes(job.status) ? `<button class="btn btn-danger btn-sm" type="button" data-action="cancel-admin-job" data-job-id="${job.id}">Cancel</button>` : `<a class="btn btn-ghost btn-sm" href="#/job/${job.id}">Open</a>`}</div></td>
      </tr>
    `).join('');
    panel = `<section class="panel panel-pad">
      <div class="panel-head"><div class="panel-title-row">${icon('film')}<div><h2>Generation jobs</h2><p>Failed jobs, refunds, scene status and final durations</p></div></div>
        <div class="select-wrap" style="min-width:150px"><select id="admin-job-status" class="select" style="min-height:38px;font-size:12px">
          ${['all', 'queued', 'generating', 'completed', 'failed', 'cancelled'].map(status => `<option value="${status}" ${state.adminJobStatus === status ? 'selected' : ''}>${status === 'all' ? 'All jobs' : esc(status)}</option>`).join('')}
        </select>${icon('chevronDown')}</div>
      </div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Job</th><th>User</th><th>Status</th><th>Target</th><th>Tokens</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px">No jobs match this filter.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  } else if (state.adminTab === 'settings') {
    panel = `<section class="panel panel-pad">
      <div class="panel-head"><div class="panel-title-row">${icon('settings')}<div><h2>Pricing, maintenance & cost tracking</h2><p>Changes affect new generations immediately and are audited</p></div></div></div>
      <form id="admin-settings-form" class="settings-form">
        <div class="settings-section">
          <h3>Token pricing</h3>
          <p>Server-side pricing is authoritative. The frontend never decides the charge.</p>
          <div class="form-grid">
            <div class="field"><label for="shorts-cost">30-second Short cost</label><input id="shorts-cost" class="input" name="shortsCost" type="number" min="1" max="100000" step="1" value="${settings.pricing.shortsCost}" required></div>
            <div class="field"><label for="long-cost">10-minute Long Video cost</label><input id="long-cost" class="input" name="longCost" type="number" min="1" max="100000" step="1" value="${settings.pricing.longCost}" required></div>
          </div>
        </div>
        <div class="settings-section">
          <h3>Maintenance mode</h3>
          <p>Blocks new generations for ordinary users. Administrators can still test the pipeline.</p>
          <div class="check-row">
            <div><strong>Enable maintenance mode</strong><span>Existing jobs continue and complete normally.</span></div>
            <label class="switch"><input id="maintenance-mode" name="maintenanceMode" type="checkbox" ${settings.maintenance.enabled ? 'checked' : ''}><span class="slider"></span></label>
          </div>
          <div class="field" style="margin-top:11px"><label for="maintenance-message">Maintenance message</label><input id="maintenance-message" class="input" name="maintenanceMessage" maxlength="300" value="${esc(settings.maintenance.message)}"></div>
        </div>
        <div class="settings-section">
          <h3>Infrastructure cost tracking</h3>
          <p>AI inference costs are tracked separately from token balances. Hosting cost is shown on the overview only.</p>
          <div class="form-grid"><div class="field"><label for="hosting-cost">Hosting cost / month (USD)</label><input id="hosting-cost" class="input" name="hostingMonthlyUsd" type="number" min="0" step="0.01" value="${settings.platform.hostingMonthlyUsd}"></div></div>
        </div>
        <button class="btn btn-primary" type="submit">${icon('check')} Save settings</button>
      </form>
    </section>`;
  } else if (state.adminTab === 'audit') {
    const audit = tabData?.audit || [];
    panel = `<section class="panel panel-pad">
      <div class="panel-head"><div class="panel-title-row">${icon('list')}<div><h2>Admin audit log</h2><p>Append-only record of privileged actions</p></div></div><span class="badge">${audit.length} events</span></div>
      <div class="audit-list">${audit.length ? audit.map(item => `
        <div class="audit-row"><span class="audit-dot"></span><div class="audit-copy"><strong>${esc(item.action.replaceAll('_', ' '))}</strong><span>${esc(item.adminPhone)} · ${esc(JSON.stringify(item.details || {}))}</span></div><span class="audit-time">${esc(timeAgo(item.createdAt))}</span></div>
      `).join('') : '<p style="color:var(--muted);font-size:12px;padding:20px;text-align:center">No admin actions recorded yet.</p>'}</div>
    </section>`;
  } else {
    const providers = tabData || {};
    panel = `<section class="panel panel-pad">
      <div class="panel-head"><div class="panel-title-row">${icon('settings')}<div><h2>Provider setup</h2><p>Secrets are read only from server environment variables</p></div></div></div>
      <div class="provider-card">
        <div class="pc-top"><strong>WhatsApp OTP delivery</strong><span class="badge ${providers.whatsapp?.configured ? 'live' : 'amber'}">${providers.whatsapp?.configured ? 'Configured' : 'Not configured'}</span></div>
        <p>${esc(providers.setup?.whatsapp || 'Configure a legitimate WhatsApp Business Platform provider to send OTPs.')}</p>
        <div class="env-list">${(providers.required?.whatsapp || []).map(item => `<code class="env-code">${esc(item)}</code>`).join('')}</div>
      </div>
      <div class="provider-card">
        <div class="pc-top"><strong>AI video provider</strong><span class="badge ${providers.aiConfigured ? 'live' : 'amber'}">${providers.aiConfigured ? 'Configured' : 'Not configured'}</span></div>
        <p>${esc(providers.setup?.ai || 'Add a real video provider to generate production videos.')}${providers.demo?.enabled ? ' Demo simulation is available in this non-production environment and is always labelled.' : ''}</p>
        <div class="env-list">${(providers.required?.ai || []).map(item => `<code class="env-code">${esc(item)}</code>`).join('')}</div>
      </div>
      <div class="provider-card">
        <div class="pc-top"><strong>Administrator security</strong><span class="badge violet">Backend enforced</span></div>
        <p>The initial administrator is configured by <code class="env-code">ADMIN_PHONE</code> and only receives the role after a successful OTP verification. Frontend role claims are ignored. Current configured administrator numbers: ${providers.providers?.adminPhonesConfigured ?? 0}.</p>
        <div class="env-list"><code class="env-code">SESSION_SECRET</code><code class="env-code">ADMIN_PHONE</code><code class="env-code">NODE_ENV=production</code></div>
      </div>
    </section>`;
  }

  const content = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="badge violet" style="margin-bottom:9px">${icon('shield', 'icon-sm')} Secure admin console</div>
          <h1>Control room</h1>
          <p>Verified administrator: ${esc(state.auth.phone)}. Unlimited generation tokens, but inference and hosting costs are tracked separately.</p>
        </div>
        <div class="head-actions"><button class="btn btn-secondary btn-sm" type="button" data-action="refresh-admin">${icon('refresh')} Refresh</button></div>
      </div>
      <div class="metric-grid">
        ${metricCard('Total users', fmtNumber(stats.totalUsers), 'users')}
        ${metricCard('Verified numbers', fmtNumber(stats.verifiedUsers), 'shield')}
        ${metricCard('Successful videos', fmtNumber(stats.successfulGenerations), 'film')}
        ${metricCard('Active jobs', fmtNumber(stats.activeJobs), 'activity')}
        ${metricCard('30s Shorts', fmtNumber(stats.shortsGenerations), 'zap')}
        ${metricCard('10-min Long', fmtNumber(stats.longGenerations), 'clock')}
        ${metricCard('Failed jobs', fmtNumber(stats.failedGenerations), 'alert', `${fmtNumber(stats.cancelledGenerations)} cancelled · ${fmtNumber(stats.refundedTokens)} tokens refunded`)}
        ${metricCard('AI spend (USD)', `$${Number(stats.aiCostUsd || 0).toFixed(2)}`, 'chart', `Hosting $${Number(stats.hostingMonthlyUsd || 0).toFixed(2)}/mo`)}
      </div>
      ${adminTabs()}
      <div class="admin-grid">
        ${panel}
        <aside class="stack">
          <section class="panel panel-pad">
            <div class="panel-head" style="margin-bottom:10px"><div class="panel-title-row">${icon('zap')}<div><h2>Wallet health</h2><p>Platform-wide</p></div></div></div>
            <div class="mini-stat-row"><span>Circulating tokens</span><strong>${fmtNumber(stats.totalTokenBalance)}</strong></div>
            <div class="mini-stat-row"><span>Reserved tokens</span><strong>${fmtNumber(stats.reservedTokens)}</strong></div>
            <div class="mini-stat-row"><span>Signup bonuses granted</span><strong>${fmtNumber(stats.grantedSignupTokens)}</strong></div>
            <div class="mini-stat-row"><span>Refunded tokens</span><strong>${fmtNumber(stats.refundedTokens)}</strong></div>
            <div class="mini-stat-row"><span>Demo runs (not AI)</span><strong>${fmtNumber(stats.demoGenerations)}</strong></div>
          </section>
          <section class="panel panel-pad">
            <div class="panel-head" style="margin-bottom:10px"><div class="panel-title-row">${icon('activity')}<div><h2>Recent activity</h2><p>Latest admin actions</p></div></div></div>
            <div class="audit-list">${(overview.recentAudit || []).map(item => `
              <div class="audit-row"><span class="audit-dot"></span><div class="audit-copy"><strong>${esc(item.action.replaceAll('_', ' '))}</strong><span>${esc(item.adminPhone)}</span></div><span class="audit-time">${esc(timeAgo(item.createdAt))}</span></div>
            `).join('') || '<p style="color:var(--muted-2);font-size:10.5px">No admin actions yet.</p>'}</div>
          </section>
          <section class="panel panel-pad">
            <div class="panel-head" style="margin-bottom:10px"><div class="panel-title-row">${icon('lock')}<div><h2>Security invariants</h2><p>Enforced on the server</p></div></div></div>
            <div class="workflow-list">
              <div class="workflow-step"><span class="ws-num">01</span><div><strong>Role after OTP only</strong><span>Administrator phone must complete verification.</span></div></div>
              <div class="workflow-step"><span class="ws-num">02</span><div><strong>Users cannot self-credit</strong><span>Only admin routes can change balances.</span></div></div>
              <div class="workflow-step"><span class="ws-num">03</span><div><strong>No charge on failure</strong><span>Reserved tokens are refunded on failure or cancel.</span></div></div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
  pageFade(content, 'admin');
  const searchInput = document.getElementById('admin-search');
  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); state.adminSearch = searchInput.value.trim(); loadAdmin(); }
  });
}

function openModal(content) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-close-modal><div class="modal" role="dialog" aria-modal="true">${content}</div></div>`;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
}

async function openUserModal(userId) {
  openModal(`<div class="modal-body" style="text-align:center;padding:40px"><div class="spinner" style="margin:0 auto;border-top-color:var(--violet)"></div><p style="color:var(--muted);font-size:12px;margin-top:14px">Loading user record…</p></div>`);
  try {
    const detail = await api(`/api/admin/users/${encodeURIComponent(userId)}`);
    const { user, transactions } = detail;
    const txRows = (transactions || []).slice(0, 8).map(tx => `<div class="mini-tx"><span>${esc(transactionLabel(tx.type))}</span><strong style="color:${tx.delta > 0 ? 'var(--green)' : tx.delta < 0 ? 'var(--red)' : 'var(--muted)'}">${tx.delta > 0 ? '+' : ''}${fmtNumber(tx.delta)}</strong></div>`).join('');
    openModal(`
      <div class="modal-head">
        <div><h2>${esc(user.phone)}</h2><p>${user.isAdmin ? 'Administrator · unlimited generation' : 'Verified member'} · joined ${esc(fmtDate(user.createdAt))}</p></div>
        <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <div class="mini-stat-row"><span>Status</span><strong><span class="badge ${user.status === 'active' ? 'live' : 'red'}">${esc(user.status)}</span></strong></div>
          <div class="mini-stat-row"><span>Wallet balance</span><strong>${user.unlimited ? 'Unlimited' : fmtNumber(user.balance)}</strong></div>
          <div class="mini-stat-row"><span>Reserved</span><strong>${fmtNumber(user.reserved)}</strong></div>
          <div class="mini-stat-row"><span>User ID</span><strong style="font-family:var(--mono);font-size:10px">${esc(user.id)}</strong></div>
        </div>
        <div class="modal-section">
          <h3>Adjust tokens</h3>
          <form id="admin-token-form" data-user-id="${user.id}">
            <div class="form-grid modal-grid">
              <div class="field"><label for="adjust-type">Action</label><select id="adjust-type" name="adjustType" class="select"><option value="grant">Grant tokens</option><option value="deduct">Deduct tokens</option></select></div>
              <div class="field"><label for="adjust-amount">Amount</label><input id="adjust-amount" class="input" name="amount" type="number" min="1" step="1" value="100" required></div>
            </div>
            <div class="field" style="margin-top:9px"><label for="adjust-reason">Reason (audited)</label><input id="adjust-reason" class="input" name="reason" maxlength="500" placeholder="Bonus, correction, support credit…" required></div>
            <div class="modal-actions"><button class="btn btn-primary btn-sm" type="submit">${icon('zap')} Apply adjustment</button></div>
          </form>
        </div>
        <div class="modal-section">
          <h3>Account status</h3>
          <div class="field"><label for="status-reason">Reason (optional)</label><input id="status-reason" class="input" maxlength="500" placeholder="Reason for suspension or reactivation"></div>
          <div class="modal-actions">
            <button class="btn ${user.status === 'suspended' ? 'btn-secondary' : 'btn-danger'} btn-sm" type="button" data-action="toggle-suspend" data-user-id="${user.id}" data-suspended="${user.status !== 'suspended'}">${icon(user.status === 'suspended' ? 'refresh' : 'power')} ${user.status === 'suspended' ? 'Reactivate account' : 'Suspend account'}</button>
          </div>
        </div>
        <div class="modal-section">
          <h3>Recent token activity</h3>
          ${txRows || '<p style="color:var(--muted-2);font-size:10.5px">No token activity.</p>'}
        </div>
        <p style="color:var(--muted-2);font-size:9.5px;line-height:1.5">Every token adjustment is written to the admin audit log with your administrator identity and the reason supplied above. ${user.isAdmin ? 'This account is an administrator: its wallet displays Unlimited and generation is never charged.' : ''}</p>
      </div>
    `);
  } catch (error) {
    toast(error.message, 'error');
    closeModal();
  }
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handleLoginSubmit(form) {
  clearFormError('#login-error');
  const countryCode = form.countryCode.value;
  const phone = String(form.phone.value || '').replace(/\D/g, '');
  const button = form.querySelector('button[type="submit"]');
  if (!phone) { setFormError('#login-error', new Error('Enter your mobile number.')); return; }
  setBusy(button, 'Sending OTP…');
  try {
    const data = await api('/api/auth/request-otp', { method: 'POST', body: { countryCode, phone } });
    const pending = {
      challengeId: data.challengeId,
      phone: data.phone,
      phoneMasked: data.phoneMasked,
      countryCode,
      national: phone,
      devMode: data.devMode,
      devOtp: data.devOtp || null,
      deliveryWarning: data.deliveryWarning || null,
      setupNotice: data.setupNotice || null,
      expiresAt: Date.now() + Number(data.expiresIn || 300) * 1000,
      resendAt: Date.now() + Number(data.resendAfter || 30) * 1000
    };
    savePendingOtp(pending);
    if (data.devMode) toast('Development OTP generated — it was not sent on WhatsApp.', 'warn');
    else toast('OTP sent on WhatsApp.', 'success');
    navigate('#/verify');
  } catch (error) {
    setFormError('#login-error', error);
  } finally {
    clearBusy(button);
  }
}

async function handleVerifySubmit(form) {
  clearFormError('#otp-error');
  const code = Array.from(form.querySelectorAll('[data-otp-index]')).map(input => input.value).join('');
  if (!/^\d{6}$/.test(code)) { setFormError('#otp-error', new Error('Enter all six digits.')); return; }
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, 'Verifying…');
  try {
    const data = await api('/api/auth/verify-otp', { method: 'POST', body: { challengeId: state.otp.challengeId, code } });
    setAuth(data);
    savePendingOtp(null);
    state.notified.clear();
    state.draft = defaultDraft();
    state.demoDefaulted = false;
    applyDemoDefault();
    toast(data.isNewUser ? `Phone verified. ${fmtNumber(state.config.pricing.signupBonus)} bonus tokens added.` : 'Welcome back to ViralYantra AI.', 'success');
    navigate('#/create');
  } catch (error) {
    setFormError('#otp-error', error);
    const inputs = form.querySelectorAll('[data-otp-index]');
    inputs.forEach(input => { input.value = ''; input.classList.remove('filled'); });
    inputs[0]?.focus();
  } finally {
    clearBusy(button);
  }
}

function applyDemoDefault() {
  if (state.demoDefaulted || !state.config) return;
  if (!state.config.generation.aiConfigured && state.config.generation.demoEnabled) state.draft.demo = true;
  state.demoDefaulted = true;
}

async function handleCreateSubmit(form) {
  const draft = state.draft;
  if (draft.prompt.trim().length < 3) { toast('Describe your video in at least 3 characters.', 'error'); document.getElementById('prompt')?.focus(); return; }
  if (draft.mode === 'image-to-video' && !draft.imageDataUrl) { toast('Choose a reference image for Image-to-Video.', 'error'); return; }
  const plan = getPlan(draft.duration);
  if (!plan) return toast('Choose a valid output plan.', 'error');
  if (!state.wallet?.unlimited && availableTokens() < plan.cost) {
    toast(`You need ${fmtNumber(plan.cost - availableTokens())} more tokens for this generation.`, 'error');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, 'Starting generation…');
  try {
    const result = await api('/api/jobs', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      body: {
        mode: draft.mode,
        style: draft.style,
        duration: Number(draft.duration),
        prompt: draft.prompt.trim(),
        imageDataUrl: draft.mode === 'image-to-video' ? draft.imageDataUrl : undefined,
        demo: Boolean(draft.demo)
      }
    });
    if (result.wallet) state.wallet = result.wallet;
    toast(result.duplicate ? 'This generation was already started. Opening the job.' : state.wallet?.unlimited ? 'Generation started with unlimited tokens.' : `${fmtNumber(plan.cost)} tokens reserved.`, result.duplicate ? 'warn' : 'success');
    navigate(`#/job/${result.job.id}`);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_TOKENS' && error.details) {
      state.wallet = { ...(state.wallet || {}), balance: error.details.balance, available: error.details.balance };
      if (error.details.shortfall) toast(`Insufficient tokens. ${fmtNumber(error.details.shortfall)} more needed.`, 'error');
      else toast(error.message, 'error');
      renderCreate(++state.seq);
    } else {
      toast(error.message, 'error');
    }
  } finally {
    clearBusy(button);
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {}
  state.auth = null;
  state.wallet = null;
  state.csrf = null;
  state.admin = null;
  state.currentJob = null;
  state.jobs = [];
  state.notified.clear();
  closeProfile();
  closeModal();
  savePendingOtp(null);
  if (window.location.hash !== '#/login') window.location.hash = '#/login';
  else renderCurrent();
  toast('Signed out securely.', 'success');
}

async function resendOtp() {
  const pending = state.otp;
  if (!pending) return;
  const button = document.getElementById('resend-btn');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/auth/request-otp', { method: 'POST', body: { countryCode: pending.countryCode, phone: pending.national } });
    const next = {
      ...pending,
      challengeId: data.challengeId,
      phone: data.phone,
      phoneMasked: data.phoneMasked,
      devMode: data.devMode,
      devOtp: data.devOtp || null,
      deliveryWarning: data.deliveryWarning || null,
      setupNotice: data.setupNotice || null,
      expiresAt: Date.now() + Number(data.expiresIn || 300) * 1000,
      resendAt: Date.now() + Number(data.resendAfter || 30) * 1000
    };
    savePendingOtp(next);
    renderOtp(++state.seq);
    toast(data.devMode ? 'New development OTP generated.' : 'A new OTP was sent on WhatsApp.', data.devMode ? 'warn' : 'success');
  } catch (error) {
    if (error.details?.retryAfter) {
      state.otp.resendAt = Date.now() + error.details.retryAfter * 1000;
    }
    toast(error.message, 'error');
    startOtpTimer();
  }
}

async function cancelCurrentJob(jobId) {
  if (!window.confirm('Cancel this generation? Reserved tokens will be refunded.')) return;
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: { reason: 'Cancelled by user' } });
    if (data.wallet) state.wallet = data.wallet;
    toast('Generation cancelled. Reserved tokens refunded.', 'warn');
    if (parseRoute().name === 'job') paintJob(data.job, state.seq);
    else if (parseRoute().name === 'videos') renderVideos(++state.seq);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function retryJob(jobId) {
  const job = state.jobs.find(item => item.id === jobId) || (state.currentJob?.id === jobId ? state.currentJob : null);
  if (!job) {
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      Object.assign(state.draft, { mode: data.job.mode, style: data.job.style, duration: data.job.targetDuration, prompt: data.job.prompt, imageDataUrl: null, imageName: null, demo: data.job.isDemo });
      navigate('#/create');
      if (data.job.mode === 'image-to-video') toast('Upload the reference image again to retry.', 'warn');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  state.draft = {
    ...state.draft,
    mode: job.mode,
    style: job.style,
    duration: job.targetDuration,
    prompt: job.prompt,
    imageDataUrl: null,
    imageName: null,
    demo: job.isDemo
  };
  navigate('#/create');
  if (job.mode === 'image-to-video') toast('Upload the reference image again to retry.', 'warn');
}

async function toggleSuspend(userId, suspend) {
  const reason = document.getElementById('status-reason')?.value || '';
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}/status`, { method: 'POST', body: { suspended: suspend, reason } });
    toast(suspend ? 'Account suspended and sessions revoked.' : 'Account reactivated.', 'success');
    closeModal();
    loadAdmin();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function cancelAdminJob(jobId) {
  if (!window.confirm('Cancel this job as administrator? The user reservation will be refunded.')) return;
  try {
    await api(`/api/admin/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: { reason: 'Cancelled from admin console' } });
    toast('Job cancelled and tokens refunded.', 'warn');
    loadAdmin();
  } catch (error) { toast(error.message, 'error'); }
}

/* Events */

document.addEventListener('click', async event => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) {
    closeProfile();
    return;
  }
  const action = actionEl.dataset.action;
  if (action !== 'toggle-profile') closeProfile();
  if (action === 'toggle-profile') {
    const menu = document.getElementById('profile-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    actionEl.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
    return;
  }
  if (action === 'logout') return logout();
  if (action === 'go-wallet') return navigate('#/wallet');
  if (action === 'go-admin') return navigate('#/admin');
  if (action === 'back-login') {
    savePendingOtp(null);
    navigate('#/login');
    return;
  }
  if (action === 'autofill-otp') {
    const code = state.otp?.devOtp;
    if (!code) return;
    const inputs = document.querySelectorAll('[data-otp-index]');
    code.split('').forEach((digit, index) => {
      if (inputs[index]) { inputs[index].value = digit; inputs[index].classList.add('filled'); }
    });
    inputs[5]?.focus();
    return;
  }
  if (action === 'copy-dev-code') {
    if (state.otp?.devOtp) {
      try { await navigator.clipboard.writeText(state.otp.devOtp); toast('Development code copied.', 'success'); } catch { toast('Copy failed. Select the code manually.', 'error'); }
    }
    return;
  }
  if (action === 'resend-otp') return resendOtp();
  if (action === 'idea') {
    state.draft.prompt = actionEl.dataset.prompt || '';
    const prompt = document.getElementById('prompt');
    if (prompt) { prompt.value = state.draft.prompt; prompt.focus(); }
    const count = document.getElementById('prompt-count');
    if (count) count.textContent = state.draft.prompt.length;
    return;
  }
  if (action === 'mode') {
    const promptEl = document.getElementById('prompt');
    if (promptEl) state.draft.prompt = promptEl.value;
    state.draft.mode = actionEl.dataset.mode;
    renderCreate(++state.seq);
    return;
  }
  if (action === 'style') {
    const promptEl = document.getElementById('prompt');
    if (promptEl) state.draft.prompt = promptEl.value;
    state.draft.style = actionEl.dataset.style;
    renderCreate(++state.seq);
    return;
  }
  if (action === 'duration') {
    const promptEl = document.getElementById('prompt');
    if (promptEl) state.draft.prompt = promptEl.value;
    state.draft.duration = Number(actionEl.dataset.duration);
    renderCreate(++state.seq);
    return;
  }
  if (action === 'remove-image') {
    state.draft.imageDataUrl = null;
    state.draft.imageName = null;
    renderCreate(++state.seq);
    return;
  }
  if (action === 'cancel-job') return cancelCurrentJob(actionEl.dataset.jobId);
  if (action === 'retry-job') return retryJob(actionEl.dataset.jobId);
  if (action === 'admin-tab') {
    state.adminTab = actionEl.dataset.tab;
    loadAdmin();
    return;
  }
  if (action === 'manage-user') return openUserModal(actionEl.dataset.userId);
  if (action === 'toggle-suspend') return toggleSuspend(actionEl.dataset.userId, actionEl.dataset.suspended === 'true');
  if (action === 'cancel-admin-job') return cancelAdminJob(actionEl.dataset.jobId);
  if (action === 'refresh-admin') { loadAdmin(); return; }
  if (action === 'close-modal') { closeModal(); return; }
  if (action === 'reload-app') { window.location.reload(); return; }
});

document.addEventListener('click', event => {
  const backdrop = event.target.closest('[data-close-modal]');
  if (backdrop && !event.target.closest('.modal')) closeModal();
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'login-form') {
    event.preventDefault();
    return handleLoginSubmit(form);
  }
  if (form.id === 'verify-form') {
    event.preventDefault();
    return handleVerifySubmit(form);
  }
  if (form.id === 'create-form') {
    event.preventDefault();
    return handleCreateSubmit(form);
  }
  if (form.id === 'admin-search-form') {
    event.preventDefault();
    state.adminSearch = String(new FormData(form).get('q') || '').trim();
    loadAdmin();
    return;
  }
  if (form.id === 'admin-token-form') {
    event.preventDefault();
    const userId = form.dataset.userId;
    const data = readForm(form);
    const amount = Number(data.amount);
    const signed = data.adjustType === 'deduct' ? -Math.abs(amount) : Math.abs(amount);
    if (!Number.isInteger(amount) || amount <= 0) return toast('Enter a whole token amount greater than zero.', 'error');
    if (!data.reason || data.reason.trim().length < 3) return toast('A reason is required and is written to the audit log.', 'error');
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, 'Applying…');
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/tokens`, { method: 'POST', body: { amount: signed, reason: data.reason.trim() } });
      toast('Token balance updated and audited.', 'success');
      closeModal();
      loadAdmin();
    } catch (error) {
      toast(error.message, 'error');
      clearBusy(button);
    }
    return;
  }
  if (form.id === 'admin-settings-form') {
    event.preventDefault();
    const data = readForm(form);
    const patch = {
      shortsCost: Number(data.shortsCost),
      longCost: Number(data.longCost),
      maintenanceMode: form.querySelector('[name="maintenanceMode"]').checked,
      maintenanceMessage: data.maintenanceMessage,
      hostingMonthlyUsd: Number(data.hostingMonthlyUsd)
    };
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, 'Saving…');
    try {
      await api('/api/admin/settings', { method: 'PATCH', body: patch });
      toast('Settings saved. New pricing applies to new jobs.', 'success');
      state.config = await api('/api/public/config');
      loadAdmin();
    } catch (error) {
      toast(error.message, 'error');
      clearBusy(button);
    }
  }
});

document.addEventListener('change', async event => {
  if (event.target.id === 'demo-toggle') {
    state.draft.demo = event.target.checked;
    return;
  }
  if (event.target.id === 'admin-job-status') {
    state.adminJobStatus = event.target.value;
    loadAdmin();
    return;
  }
  if (event.target.id === 'image-input') {
    const file = event.target.files?.[0];
    if (!file) return;
    const max = state.config.generation.maxImageBytes;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Choose a PNG, JPEG or WebP image.', 'error');
    if (file.size > max) return toast(`Image must be smaller than ${Math.round(max / 1024 / 1024)}MB.`, 'error');
    const reader = new FileReader();
    reader.onload = () => {
      state.draft.imageDataUrl = String(reader.result);
      state.draft.imageName = file.name;
      renderCreate(++state.seq);
    };
    reader.onerror = () => toast('Could not read that image.', 'error');
    reader.readAsDataURL(file);
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'phone-input') {
    event.target.value = event.target.value.replace(/[^\d\s-]/g, '');
  }
  if (event.target.matches('[data-otp-index]')) {
    const input = event.target;
    input.value = input.value.replace(/\D/g, '').slice(-1);
    input.classList.toggle('filled', Boolean(input.value));
    if (input.value) {
      const index = Number(input.dataset.otpIndex);
      const next = document.querySelector(`[data-otp-index="${index + 1}"]`);
      if (next) next.focus();
    }
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeModal();
    closeProfile();
  }
  if (event.target.matches?.('[data-otp-index]')) {
    const input = event.target;
    const index = Number(input.dataset.otpIndex);
    if (event.key === 'Backspace' && !input.value && index > 0) {
      const previous = document.querySelector(`[data-otp-index="${index - 1}"]`);
      if (previous) { previous.focus(); previous.value = ''; previous.classList.remove('filled'); event.preventDefault(); }
    }
    if (event.key === 'ArrowLeft' && index > 0) document.querySelector(`[data-otp-index="${index - 1}"]`)?.focus();
    if (event.key === 'ArrowRight' && index < 5) document.querySelector(`[data-otp-index="${index + 1}"]`)?.focus();
  }
});

document.addEventListener('paste', event => {
  if (!event.target.matches?.('[data-otp-index]')) return;
  const text = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
  if (!text) return;
  event.preventDefault();
  const inputs = document.querySelectorAll('[data-otp-index]');
  text.split('').forEach((digit, index) => {
    if (inputs[index]) { inputs[index].value = digit; inputs[index].classList.add('filled'); }
  });
  inputs[Math.min(text.length, 5)]?.focus();
});

window.addEventListener('hashchange', () => {
  closeProfile();
  renderCurrent();
});

async function boot() {
  try {
    const [config, session] = await Promise.all([
      fetch('/api/public/config', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error(`Configuration failed (HTTP ${response.status}).`);
        return response.json();
      }),
      fetch('/api/auth/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error(`Session check failed (HTTP ${response.status}).`);
        return response.json();
      })
    ]);
    state.config = config;
    if (session.authenticated) {
      setAuth(session);
    } else {
      const pending = readPendingOtp();
      if (pending && pending.expiresAt > Date.now()) state.otp = pending;
    }
    applyDemoDefault();
    renderCurrent();
  } catch (error) {
    app.innerHTML = `
      <div class="boot-screen">
        <div class="boot-logo">${logoHtml({ size: 58, text: false })}</div>
        <div class="boot-wordmark">ViralYantra <span>AI</span></div>
        <p style="color:var(--muted);font-size:13px;max-width:420px;text-align:center;line-height:1.6">${esc(error.message || 'The app could not start.')}</p>
        <button class="btn btn-primary" type="button" data-action="reload-app">${icon('refresh')} Retry</button>
      </div>`;
  }
}

window.addEventListener('error', event => {
  if (event.error) console.error('[ui]', event.error);
});

boot();
