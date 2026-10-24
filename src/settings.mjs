import { config } from './config.mjs';
import { all, nowIso, one, parseJson, run, transaction } from './db.mjs';

const defaults = {
  pricing: {
    shortsCost: config.pricing.shortsCost,
    longCost: config.pricing.longCost
  },
  maintenance: {
    enabled: false,
    message: 'ViralYantra AI is receiving a scheduled upgrade. Please try again shortly.'
  },
  platform: {
    hostingMonthlyUsd: config.generation.hostingMonthlyUsd
  }
};

function storedSettings() {
  const rows = all('SELECT key, value_json FROM app_settings');
  const result = {};
  for (const row of rows) result[row.key] = parseJson(row.value_json, {});
  return result;
}

export function getSettings() {
  const stored = storedSettings();
  return {
    pricing: { ...defaults.pricing, ...(stored.pricing || {}) },
    maintenance: { ...defaults.maintenance, ...(stored.maintenance || {}) },
    platform: { ...defaults.platform, ...(stored.platform || {}) }
  };
}

export function getPricing() {
  return getSettings().pricing;
}

export function updateSettings(patch, adminId) {
  return transaction(() => {
    const current = getSettings();
    const next = {
      pricing: {
        shortsCost: patch.pricing?.shortsCost ?? current.pricing.shortsCost,
        longCost: patch.pricing?.longCost ?? current.pricing.longCost
      },
      maintenance: {
        enabled: patch.maintenance?.enabled ?? current.maintenance.enabled,
        message: patch.maintenance?.message ?? current.maintenance.message
      },
      platform: {
        hostingMonthlyUsd: patch.platform?.hostingMonthlyUsd ?? current.platform.hostingMonthlyUsd
      }
    };
    const timestamp = nowIso();
    for (const [key, value] of Object.entries(next)) {
      run(
        `INSERT INTO app_settings (key, value_json, updated_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        key, JSON.stringify(value), adminId, timestamp
      );
    }
    return next;
  });
}

export function ensureSettings() {
  const existing = one("SELECT key FROM app_settings WHERE key = 'pricing'");
  if (!existing) {
    const timestamp = nowIso();
    for (const [key, value] of Object.entries(defaults)) {
      run('INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), timestamp);
    }
  }
}
