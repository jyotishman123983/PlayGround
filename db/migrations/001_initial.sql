CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL,
  phone_national TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  signup_bonus_granted INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  job_id TEXT,
  admin_id TEXT,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_token_signup_bonus
  ON token_transactions(user_id) WHERE type = 'signup_bonus';
CREATE INDEX IF NOT EXISTS ix_token_user_created
  ON token_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_token_job
  ON token_transactions(job_id);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  resend_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL,
  consumed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'expired', 'locked', 'failed')),
  provider TEXT,
  provider_message_id TEXT,
  dev_mode INTEGER NOT NULL DEFAULT 0,
  request_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_otp_phone_created
  ON otp_challenges(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_otp_ip_created
  ON otp_challenges(request_ip, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('text-to-video', 'image-to-video')),
  style TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_path TEXT,
  image_mime TEXT,
  target_duration INTEGER NOT NULL,
  aspect_ratio TEXT NOT NULL,
  scene_count INTEGER NOT NULL,
  scenes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'planning', 'generating', 'assembling', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL,
  reserved_amount INTEGER NOT NULL DEFAULT 0,
  charged_amount INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  provider_job_id TEXT,
  actual_duration REAL,
  output_path TEXT,
  output_mime TEXT,
  output_kind TEXT,
  error_code TEXT,
  error_message TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_jobs_user_created
  ON video_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON video_jobs(status);

CREATE TABLE IF NOT EXISTS generated_videos (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES video_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  aspect_ratio TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES video_jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT,
  scenes INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_job_id TEXT,
  details_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_audit_created ON admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
