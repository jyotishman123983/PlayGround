# ViralYantra AI

Scene-based AI video studio with WhatsApp OTP login, a persistent token wallet, 30-second Shorts, 10-minute Long Video, and a verified admin console.

The app ships as a zero-framework Node.js server with a mobile-first SPA. It uses Node's built-in SQLite driver, so there is no database service to provision.

## Features

- WhatsApp OTP authentication with Meta Cloud API or Twilio WhatsApp support.
- Persistent, HttpOnly cookie sessions with CSRF protection and rate limiting.
- One-time 1,000-token signup bonus, enforced by the database.
- Server-side pricing and token reservation before generation.
- 30-second Shorts (9:16) and 10-minute Long Video (16:9) plans.
- Scene-by-scene generation state, cancellation, and automatic refunds.
- Final duration verification before a job can be marked complete and charged.
- Text-to-Video and Image-to-Video modes with six visual styles.
- User video library, scene manifests, MP4 downloads, and wallet ledger.
- Admin console for users, jobs, pricing, maintenance mode, token adjustments, suspensions, audit logs, and provider status.
- Clearly labelled development demo renderer for testing the wallet flow without an AI provider.
- No fake WhatsApp delivery in production.

## Requirements

- Node.js 22.5 or newer. Node 22.19+ is recommended.
- Optional `ffmpeg` for demo rendering and scene assembly. The optional `ffmpeg-static` dependency is installed automatically on supported platforms.
- A WhatsApp provider for real OTP delivery.
- A Replicate API token and a video model for real AI generation.

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env, then start the server:
npm start
```

Open `http://localhost:3000`.

For local development, `ALLOW_DEV_OTP=true` shows a development-only code on the verification screen. That code is never available when `NODE_ENV=production`. If no AI provider is configured, the development demo renderer is enabled by default.

Run the test suite:

```bash
npm test
```

## How the Token Wallet Works

| Plan | Duration | Aspect ratio | Scenes | Cost |
| --- | --- | --- | --- | --- |
| YouTube Shorts | 30 seconds | 9:16 | 5 | 25 tokens |
| YouTube Long Video | 10 minutes | 16:9 | 20 | 500 tokens |

1. A new verified number receives 1,000 tokens exactly once.
2. Starting a job reserves its full cost immediately.
3. A successful job settles the reservation and records the final charge.
4. A failed or cancelled job releases the reservation and refunds the tokens.
5. The server rejects jobs when the available balance is too low.
6. An `Idempotency-Key` header is required for job creation, preventing duplicate charges.
7. Administrators have unlimited generation and are never charged.

Token costs can be changed in the admin console under **Pricing & settings**. Defaults come from environment variables and are seeded into the database on first run.

## WhatsApp OTP Setup

### Meta Cloud API

Create a WhatsApp Business Platform app, an approved authentication template, and a permanent system-user token.

```env
WHATSAPP_PROVIDER=meta
WHATSAPP_TOKEN=your-permanent-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_TEMPLATE_NAME=viralyantra_otp
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_GRAPH_VERSION=v21.0
```

The default template payload sends the OTP as body parameter `{{1}}`. For local testing only, `WHATSAPP_USE_PLAIN_TEXT=true` sends a plain text message instead of a template; Meta may reject plain-text business-initiated messages outside an open service window.

### Twilio WhatsApp

```env
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=+14155238886
# Optional approved content template:
TWILIO_CONTENT_SID=HX...
```

When `TWILIO_CONTENT_SID` is set, the OTP is sent as content variable `{{1}}`.

### Production Rule

When `NODE_ENV=production`, development OTP is disabled even if `ALLOW_DEV_OTP=true`. If WhatsApp is not configured, OTP requests return HTTP 503 with setup instructions. No code is invented, displayed, or logged.

## AI Video Provider

The built-in adapter uses Replicate:

```env
VIDEO_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
REPLICATE_VIDEO_MODEL=minimax/video-01
REPLICATE_MAX_SCENE_SECONDS=30
AI_COST_PER_SCENE_USD=0
```

Each scene is generated separately, downloaded, and assembled with ffmpeg. The assembled duration is probed before the job is marked complete. A 10-minute job is rejected if the final video does not reach 600 seconds within a 1-second tolerance.

The adapter must be reviewed against the chosen model's input schema and maximum scene duration before production use.

## Demo Mode

Demo mode exists for development and wallet testing. It:

- Is disabled automatically when `NODE_ENV=production`.
- Renders a local gradient placeholder video with an on-screen label: `VIRALYANTRA AI / DEMO - NOT AI GENERATED`.
- Embeds MP4 metadata identifying it as a demo.
- Uses the real reservation, settlement, and refund ledger.
- Never claims to be AI-generated.

Set `ENABLE_DEMO=false` to disable it even in development.

## Admin Access

Set one or more administrator phone numbers in E.164 format:

```env
ADMIN_PHONE=+917002063596
```

The default development admin number is `+917002063596`. Change this before deployment.

An account only becomes an administrator after successful OTP verification of a configured admin number. The role is assigned on the server and cannot be granted by the browser.

Admin capabilities:

- Platform overview and generation metrics.
- User search by mobile number, wallet and job inspection.
- Grant or deduct tokens with a required reason.
- Suspend and reactivate users.
- Cancel active jobs and refund reservations.
- View failed jobs, refunded tokens, demo runs, AI spend, and hosting cost.
- Edit token pricing and maintenance mode.
- Review the admin audit log.
- Inspect WhatsApp and AI provider configuration status.

## Security Notes

- OTPs are hashed with a per-challenge salt and compared in constant time.
- OTP attempts, resend windows, IP sends, and API requests are rate-limited.
- Sessions are stored as SHA-256 token hashes; raw session tokens are only in HttpOnly cookies.
- State-changing authenticated requests require a per-session CSRF token and same-origin checks.
- Production cookies are `Secure` and `SameSite=Lax`.
- Security headers include CSP, frame denial, no-sniff, referrer policy, and HSTS in production.
- Uploaded reference images are validated by MIME type and file signature, size-limited, and stored outside the public directory.
- Admin actions are written to an audit log.
- Never commit `.env`, `SESSION_SECRET`, or the SQLite database.

## Configuration

See `.env.example` for the full list. Important variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Enables production security behavior |
| `PORT` / `APP_PORT` | `3000` | HTTP port |
| `DATA_DIR` | `data` | Database, uploads, and rendered outputs |
| `SESSION_SECRET` | generated file | OTP hashing and session security secret; set explicitly in production |
| `ADMIN_PHONE` | `+917002063596` | Comma-separated administrator numbers |
| `ALLOW_DEV_OTP` | `true` in development | Enables development-only OTP display |
| `ENABLE_DEMO` | `true` in development | Enables local demo rendering |
| `SIGNUP_BONUS_TOKENS` | `1000` | Initial signup grant |
| `SHORTS_TOKEN_COST` | `25` | Initial Shorts price |
| `LONG_TOKEN_COST` | `500` | Initial Long Video price |
| `SESSION_DAYS` | `30` | Session lifetime |
| `OTP_TTL_SECONDS` | `300` | OTP validity |
| `OTP_COOLDOWN_SECONDS` | `30` | Resend cooldown |
| `OTP_MAX_ATTEMPTS` | `5` | Incorrect attempts before lockout |
| `MAX_IMAGE_BYTES` | `6291456` | Maximum reference image size |
| `MAX_JSON_BODY_BYTES` | `8388608` | Maximum API JSON body |
| `API_RATE_LIMIT_PER_MINUTE` | `600` | Per-IP API request limit |

## Deployment

The repository includes `start.sh` and `startup.sh`. Both launch `node server.mjs`.

```bash
NODE_ENV=production \
SESSION_SECRET='replace-with-a-long-random-secret' \
ADMIN_PHONE='+91...' \
WHATSAPP_PROVIDER=meta \
WHATSAPP_TOKEN='...' \
WHATSAPP_PHONE_NUMBER_ID='...' \
VIDEO_PROVIDER=replicate \
REPLICATE_API_TOKEN='...' \
npm start
```

Use a reverse proxy with HTTPS. If the app is behind a proxy, forward `X-Forwarded-Proto` and `X-Forwarded-For`. Restrict direct access to the Node port so forwarded headers cannot be spoofed.

Back up `DATA_DIR` regularly. The SQLite database, uploads, and rendered outputs live there.

## Project Layout

```text
server.mjs                 HTTP server and startup recovery
start.sh / startup.sh      Runtime entry points
src/config.mjs             Environment and provider configuration
src/db.mjs                 SQLite connection, migrations, helpers
src/auth.mjs               OTP, sessions, admin role assignment
src/wallet.mjs             Token reservation, settlement, refunds
src/generation.mjs         Scene plans, demo renderer, Replicate adapter
src/admin.mjs              Admin metrics, users, jobs, audit
src/api.mjs                API routes and security checks
src/http.mjs               Static files, cookies, JSON/file responses
src/otp-provider.mjs       Meta and Twilio WhatsApp delivery
public/                    SPA, styles, icons
db/migrations/             Database schema
test/                      Integration tests
```

## Tests

`npm test` starts isolated servers with temporary databases and verifies:

- First-time signup bonus and admin promotion.
- Session and wallet persistence across restart.
- 30-second demo reservation, charge, idempotency, download, cancellation, and refund.
- 10-minute demo duration verification and 500-token charge.
- CSRF, idempotency, duration, image signature, and insufficient-balance validation.
- Admin token adjustment and audit ledger.
- Production refusal of fake OTP delivery and demo generation.

## Project Origin

Originally scaffolded from [OMGithub](https://omgithub.com/jyotishman123983/PlayGround).
