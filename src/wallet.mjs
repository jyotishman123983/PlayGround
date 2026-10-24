import { config } from './config.mjs';
import { all, nowIso, one, run, transaction } from './db.mjs';
import { ApiError } from './errors.mjs';
import { randomToken } from './security.mjs';

function walletRow(userId) {
  const wallet = one('SELECT user_id, balance, reserved, updated_at FROM wallets WHERE user_id = ?', userId);
  if (!wallet) throw new ApiError(500, 'WALLET_MISSING', 'Wallet is not initialized for this account.');
  return wallet;
}

export function getWallet(userId) {
  return walletRow(userId);
}

export function walletView(user) {
  const wallet = walletRow(user.id);
  const unlimited = user.role === 'admin';
  return {
    balance: wallet.balance,
    reserved: wallet.reserved,
    available: unlimited ? null : wallet.balance,
    unlimited,
    display: unlimited ? 'Unlimited' : String(wallet.balance),
    unit: 'tokens',
    updatedAt: wallet.updated_at
  };
}

export function listTransactions(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return all(
    `SELECT id, type, delta, balance_after, reserved_after, amount, job_id, reason, metadata_json, created_at
     FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    userId, safeLimit
  ).map(row => ({
    id: row.id,
    type: row.type,
    delta: row.delta,
    balanceAfter: row.balance_after,
    reservedAfter: row.reserved_after,
    amount: row.amount,
    jobId: row.job_id,
    reason: row.reason,
    createdAt: row.created_at
  }));
}

export function grantSignupBonusTx(userId) {
  const user = one('SELECT signup_bonus_granted FROM users WHERE id = ?', userId);
  if (!user || user.signup_bonus_granted) return false;
  const existing = one("SELECT id FROM token_transactions WHERE user_id = ? AND type = 'signup_bonus'", userId);
  if (existing) {
    run('UPDATE users SET signup_bonus_granted = 1 WHERE id = ?', userId);
    return false;
  }
  const amount = config.pricing.signupBonus;
  const timestamp = nowIso();
  const wallet = walletRow(userId);
  const nextBalance = wallet.balance + amount;
  run('UPDATE wallets SET balance = ?, updated_at = ? WHERE user_id = ?', nextBalance, timestamp, userId);
  run(
    `INSERT INTO token_transactions
      (id, user_id, type, delta, balance_after, reserved_after, amount, reason, metadata_json, created_at)
     VALUES (?, ?, 'signup_bonus', ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), userId, amount, nextBalance, wallet.reserved, amount,
    'Welcome bonus after mobile verification', JSON.stringify({ grantedOnce: true }), timestamp
  );
  run('UPDATE users SET signup_bonus_granted = 1, updated_at = ? WHERE id = ?', timestamp, userId);
  return true;
}

export function reserveTokensTx(user, cost, jobId) {
  if (user.role === 'admin') return { reserved: 0, balance: walletRow(user.id).balance, unlimited: true };
  if (!Number.isInteger(cost) || cost <= 0) throw new ApiError(500, 'INVALID_COST', 'Generation cost is invalid.');
  const wallet = walletRow(user.id);
  if (wallet.balance < cost) {
    throw new ApiError(402, 'INSUFFICIENT_TOKENS', `You need ${cost} tokens for this generation. Your available balance is ${wallet.balance}.`, {
      required: cost,
      balance: wallet.balance,
      shortfall: cost - wallet.balance
    });
  }
  const timestamp = nowIso();
  const nextBalance = wallet.balance - cost;
  const nextReserved = wallet.reserved + cost;
  run('UPDATE wallets SET balance = ?, reserved = ?, updated_at = ? WHERE user_id = ?', nextBalance, nextReserved, timestamp, user.id);
  run(
    `INSERT INTO token_transactions
      (id, user_id, type, delta, balance_after, reserved_after, amount, job_id, reason, created_at)
     VALUES (?, ?, 'generation_reserve', ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), user.id, -cost, nextBalance, nextReserved, cost, jobId, 'Tokens reserved for generation', timestamp
  );
  return { reserved: cost, balance: nextBalance, unlimited: false };
}

export function settleTokensTx(job) {
  if (!job.reserved_amount || job.reserved_amount <= 0) return;
  const wallet = walletRow(job.user_id);
  if (wallet.reserved < job.reserved_amount) {
    throw new ApiError(500, 'WALLET_INCONSISTENT', 'Reserved token balance is inconsistent.');
  }
  const cost = job.reserved_amount;
  const timestamp = nowIso();
  const releasedBalance = wallet.balance + cost;
  const releasedReserved = wallet.reserved - cost;
  run('UPDATE wallets SET balance = ?, reserved = ?, updated_at = ? WHERE user_id = ?', releasedBalance, releasedReserved, timestamp, job.user_id);
  run(
    `INSERT INTO token_transactions
      (id, user_id, type, delta, balance_after, reserved_after, amount, job_id, reason, created_at)
     VALUES (?, ?, 'generation_release', ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), job.user_id, cost, releasedBalance, releasedReserved, cost, job.id, 'Reserved tokens released for settlement', timestamp
  );
  const chargedBalance = releasedBalance - cost;
  run('UPDATE wallets SET balance = ?, updated_at = ? WHERE user_id = ?', chargedBalance, timestamp, job.user_id);
  run(
    `INSERT INTO token_transactions
      (id, user_id, type, delta, balance_after, reserved_after, amount, job_id, reason, created_at)
     VALUES (?, ?, 'generation_charge', ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), job.user_id, -cost, chargedBalance, releasedReserved, cost, job.id, 'Final charge for completed video', timestamp
  );
}

export function refundTokensTx(job, reason = 'Generation did not complete') {
  if (!job.reserved_amount || job.reserved_amount <= 0 || job.refunded) return;
  const wallet = walletRow(job.user_id);
  const cost = Math.min(job.reserved_amount, wallet.reserved);
  if (cost <= 0) return;
  const timestamp = nowIso();
  const nextBalance = wallet.balance + cost;
  const nextReserved = wallet.reserved - cost;
  run('UPDATE wallets SET balance = ?, reserved = ?, updated_at = ? WHERE user_id = ?', nextBalance, nextReserved, timestamp, job.user_id);
  run(
    `INSERT INTO token_transactions
      (id, user_id, type, delta, balance_after, reserved_after, amount, job_id, reason, created_at)
     VALUES (?, ?, 'generation_refund', ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), job.user_id, cost, nextBalance, nextReserved, cost, job.id, reason, timestamp
  );
}

export function adminAdjustTokens({ admin, targetUser, delta, reason, ip }) {
  if (!Number.isInteger(delta) || delta === 0) throw new ApiError(400, 'INVALID_ADJUSTMENT', 'Enter a non-zero token amount.');
  if (Math.abs(delta) > 1_000_000) throw new ApiError(400, 'INVALID_ADJUSTMENT', 'Token adjustment is too large.');
  if (!reason || String(reason).trim().length < 3) throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required for every token adjustment.');
  return transaction(() => {
    const wallet = walletRow(targetUser.id);
    const nextBalance = wallet.balance + delta;
    if (nextBalance < 0) {
      throw new ApiError(400, 'INSUFFICIENT_BALANCE', `Cannot deduct ${Math.abs(delta)} tokens. ${targetUser.phone_e164} only has ${wallet.balance}.`);
    }
    const timestamp = nowIso();
    run('UPDATE wallets SET balance = ?, updated_at = ? WHERE user_id = ?', nextBalance, timestamp, targetUser.id);
    run(
      `INSERT INTO token_transactions
        (id, user_id, type, delta, balance_after, reserved_after, amount, admin_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomToken(16), targetUser.id, delta > 0 ? 'admin_grant' : 'admin_deduct', delta, nextBalance,
      wallet.reserved, Math.abs(delta), admin.id, String(reason).trim().slice(0, 500), timestamp
    );
    run(
      `INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, details_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomToken(16), admin.id, delta > 0 ? 'grant_tokens' : 'deduct_tokens', targetUser.id,
      JSON.stringify({ delta, reason: String(reason).trim(), balanceAfter: nextBalance }), ip, timestamp
    );
    return { balance: nextBalance, reserved: wallet.reserved };
  });
}

export function ledgerStats() {
  return {
    refundedTokens: one("SELECT COALESCE(SUM(amount), 0) AS total FROM token_transactions WHERE type = 'generation_refund'")?.total || 0,
    grantedTokens: one("SELECT COALESCE(SUM(amount), 0) AS total FROM token_transactions WHERE type = 'signup_bonus'")?.total || 0
  };
}
