import { config } from './config.mjs';
import { all, nowIso, one, parseJson, run, transaction } from './db.mjs';
import { ApiError } from './errors.mjs';
import { revokeUserSessions, toPublicUser } from './auth.mjs';
import { adminAdjustTokens, ledgerStats } from './wallet.mjs';
import { getSettings, updateSettings } from './settings.mjs';
import { listJobsForAdmin, publicJob } from './generation.mjs';
import { randomToken } from './security.mjs';

function scalar(sql, ...params) {
  return one(sql, ...params)?.value ?? 0;
}

function audit(adminId, action, { targetUserId = null, targetJobId = null, details = null, ip = null } = {}) {
  run(
    `INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, target_job_id, details_json, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), adminId, action, targetUserId, targetJobId, details ? JSON.stringify(details) : null, ip, nowIso()
  );
}

export function overview(admin) {
  const settings = getSettings();
  const aiCost = one('SELECT COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS total FROM ai_usage')?.total || 0;
  const stats = {
    totalUsers: scalar('SELECT COUNT(*) AS value FROM users'),
    verifiedUsers: scalar('SELECT COUNT(*) AS value FROM users WHERE verified_at IS NOT NULL'),
    suspendedUsers: scalar("SELECT COUNT(*) AS value FROM users WHERE status = 'suspended'"),
    successfulGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'completed' AND is_demo = 0"),
    shortsGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'completed' AND is_demo = 0 AND target_duration = 30"),
    longGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'completed' AND is_demo = 0 AND target_duration = 600"),
    failedGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'failed'"),
    cancelledGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'cancelled'"),
    demoGenerations: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status = 'completed' AND is_demo = 1"),
    activeJobs: scalar("SELECT COUNT(*) AS value FROM video_jobs WHERE status IN ('queued','planning','generating','assembling')"),
    refundedTokens: ledgerStats().refundedTokens,
    grantedSignupTokens: ledgerStats().grantedTokens,
    aiCostUsd: Number(aiCost.toFixed(4)),
    hostingMonthlyUsd: Number(settings.platform.hostingMonthlyUsd || 0),
    totalTokenBalance: scalar("SELECT COALESCE(SUM(balance), 0) AS value FROM wallets"),
    reservedTokens: scalar("SELECT COALESCE(SUM(reserved), 0) AS value FROM wallets"),
    generationCosts: {
      shorts: settings.pricing.shortsCost,
      long: settings.pricing.longCost
    }
  };
  const recentJobs = all(
    `SELECT j.*, u.phone_e164 FROM video_jobs j JOIN users u ON u.id = j.user_id
     ORDER BY j.created_at DESC LIMIT 10`
  ).map(row => ({ ...publicJob(row, { includeScenes: false }), userPhone: row.phone_e164 }));
  const recentAudit = all(
    `SELECT a.*, u.phone_e164 AS admin_phone FROM admin_audit_logs a
     LEFT JOIN users u ON u.id = a.admin_user_id ORDER BY a.created_at DESC LIMIT 8`
  ).map(auditView);
  return { stats, settings, recentJobs, recentAudit, admin: toPublicUser(admin) };
}

function auditView(row) {
  return {
    id: row.id,
    adminPhone: row.admin_phone || 'System',
    action: row.action,
    targetUserId: row.target_user_id,
    targetJobId: row.target_job_id,
    details: parseJson(row.details_json, {}),
    ip: row.ip,
    createdAt: row.created_at
  };
}

export function searchUsers(query = '', limit = 100) {
  const raw = String(query || '').trim();
  const digits = raw.replace(/\D/g, '');
  const params = [];
  let where = '';
  if (raw) {
    where = 'WHERE u.phone_e164 LIKE ? OR u.phone_national LIKE ? OR u.id = ?';
    params.push(`%${raw}%`, `%${digits || raw}%`, raw);
  }
  return all(
    `SELECT u.*, w.balance, w.reserved,
       (SELECT COUNT(*) FROM video_jobs j WHERE j.user_id = u.id) AS job_count,
       (SELECT COUNT(*) FROM video_jobs j WHERE j.user_id = u.id AND j.status = 'completed') AS completed_count,
       (SELECT COUNT(*) FROM video_jobs j WHERE j.user_id = u.id AND j.status = 'failed') AS failed_count,
       (SELECT COALESCE(SUM(amount), 0) FROM token_transactions t WHERE t.user_id = u.id AND t.type = 'generation_charge') AS spent_tokens
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC LIMIT ?`,
    ...params, Math.min(Number(limit) || 100, 300)
  ).map(row => ({
    ...toPublicUser(row),
    balance: row.balance ?? 0,
    reserved: row.reserved ?? 0,
    unlimited: row.role === 'admin',
    jobCount: row.job_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    spentTokens: row.spent_tokens
  }));
}

export function userDetail(userId) {
  const user = one('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
  const wallet = one('SELECT * FROM wallets WHERE user_id = ?', userId);
  const jobs = all('SELECT * FROM video_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', userId)
    .map(job => publicJob(job, { includeScenes: false }));
  const transactions = all(
    'SELECT * FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50',
    userId
  ).map(row => ({
    id: row.id,
    type: row.type,
    delta: row.delta,
    balanceAfter: row.balance_after,
    amount: row.amount,
    jobId: row.job_id,
    adminId: row.admin_id,
    reason: row.reason,
    createdAt: row.created_at
  }));
  return {
    user: { ...toPublicUser(user), balance: wallet?.balance ?? 0, reserved: wallet?.reserved ?? 0, unlimited: user.role === 'admin' },
    jobs,
    transactions
  };
}

export function adjustUserTokens({ admin, targetUserId, amount, reason, ip }) {
  const target = one('SELECT * FROM users WHERE id = ?', targetUserId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
  const delta = Number(amount);
  if (!Number.isInteger(delta) || delta === 0) throw new ApiError(400, 'INVALID_ADJUSTMENT', 'Enter a non-zero whole number of tokens.');
  const wallet = adminAdjustTokens({ admin, targetUser: target, delta, reason, ip });
  return { user: toPublicUser(target), ...wallet };
}

export function setUserStatus({ admin, targetUserId, suspended, reason, ip }) {
  const target = one('SELECT * FROM users WHERE id = ?', targetUserId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
  if (target.id === admin.id) throw new ApiError(400, 'CANNOT_SUSPEND_SELF', 'You cannot suspend your own administrator account.');
  if (target.role === 'admin') throw new ApiError(400, 'CANNOT_SUSPEND_ADMIN', 'Administrator accounts cannot be suspended from this panel.');
  return transaction(() => {
    const status = suspended ? 'suspended' : 'active';
    run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), target.id);
    if (suspended) revokeUserSessions(target.id);
    audit(admin.id, suspended ? 'suspend_user' : 'reactivate_user', {
      targetUserId: target.id,
      details: { reason: String(reason || '').slice(0, 500), phone: target.phone_e164 },
      ip
    });
    return { id: target.id, status };
  });
}

export function adminCancelJob({ admin, jobId, reason, ip }) {
  const job = one('SELECT * FROM video_jobs WHERE id = ?', jobId);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
  if (job.status === 'completed') throw new ApiError(409, 'JOB_COMPLETED', 'Completed jobs cannot be cancelled.');
  const timestamp = nowIso();
  const result = transaction(() => {
    const current = one('SELECT * FROM video_jobs WHERE id = ?', jobId);
    if (!current) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    if (current.status === 'cancelled') return publicJob(current);
    if (current.reserved_amount > 0) {
      const wallet = one('SELECT * FROM wallets WHERE user_id = ?', current.user_id);
      if (wallet && wallet.reserved >= current.reserved_amount) {
        const cost = current.reserved_amount;
        run('UPDATE wallets SET balance = balance + ?, reserved = reserved - ?, updated_at = ? WHERE user_id = ?',
          cost, cost, timestamp, current.user_id);
        run(
          `INSERT INTO token_transactions
            (id, user_id, type, delta, balance_after, reserved_after, amount, job_id, admin_id, reason, created_at)
           VALUES (?, ?, 'generation_refund', ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomToken(16), current.user_id, cost, wallet.balance + cost, wallet.reserved - cost, cost,
          current.id, admin.id, `Admin refund: ${String(reason || 'job cancelled').slice(0, 300)}`, timestamp
        );
      }
    }
    run(
      `UPDATE video_jobs SET status = 'cancelled', cancel_requested = 1, refunded = ?, error_code = 'ADMIN_CANCELLED',
        error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      current.reserved_amount > 0 ? 1 : 0, String(reason || 'Cancelled by administrator').slice(0, 500), timestamp, timestamp, current.id
    );
    audit(admin.id, 'cancel_job', {
      targetUserId: current.user_id,
      targetJobId: current.id,
      details: { reason: String(reason || ''), refunded: current.reserved_amount > 0 },
      ip
    });
    return publicJob(one('SELECT * FROM video_jobs WHERE id = ?', current.id));
  });
  return result;
}

export function getAudit(limit = 100) {
  return all(
    `SELECT a.*, u.phone_e164 AS admin_phone FROM admin_audit_logs a
     LEFT JOIN users u ON u.id = a.admin_user_id ORDER BY a.created_at DESC LIMIT ?`,
    Math.min(Number(limit) || 100, 300)
  ).map(auditView);
}

export function updateAdminSettings({ admin, patch, ip }) {
  const current = getSettings();
  const shortsCost = patch.shortsCost ?? current.pricing.shortsCost;
  const longCost = patch.longCost ?? current.pricing.longCost;
  for (const [label, value] of [['Shorts cost', shortsCost], ['Long video cost', longCost]]) {
    if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 100000) {
      throw new ApiError(400, 'INVALID_PRICING', `${label} must be a whole number between 1 and 100000.`);
    }
  }
  const maintenanceMessage = String(patch.maintenanceMessage ?? current.maintenance.message).trim();
  if (maintenanceMessage.length > 300) throw new ApiError(400, 'INVALID_MESSAGE', 'Maintenance message must be 300 characters or fewer.');
  const hostingMonthlyUsd = patch.hostingMonthlyUsd ?? current.platform.hostingMonthlyUsd;
  if (!Number.isFinite(Number(hostingMonthlyUsd)) || Number(hostingMonthlyUsd) < 0) {
    throw new ApiError(400, 'INVALID_COST', 'Hosting cost must be a positive number.');
  }
  const next = updateSettings({
    pricing: { shortsCost: Number(shortsCost), longCost: Number(longCost) },
    maintenance: {
      enabled: typeof patch.maintenanceMode === 'boolean' ? patch.maintenanceMode : current.maintenance.enabled,
      message: maintenanceMessage
    },
    platform: { hostingMonthlyUsd: Number(hostingMonthlyUsd) }
  }, admin.id);
  audit(admin.id, 'update_settings', { details: next, ip });
  return next;
}

export function adminJobs(query = {}) {
  return listJobsForAdmin(query);
}

export function providersPublicStatus() {
  return {
    aiConfigured: config.generation.configured,
    aiProvider: config.generation.provider,
    aiModel: config.generation.replicateModel,
    demoEnabled: config.generation.demoEnabled,
    adminPhonesConfigured: config.adminPhones.length
  };
}
