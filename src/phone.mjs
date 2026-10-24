import { ApiError } from './errors.mjs';

export const COUNTRY_CODES = [
  { code: '+91', country: 'India', iso: 'IN', flag: '🇮🇳', nationalLength: 10, pattern: /^[6-9]\d{9}$/ },
  { code: '+1', country: 'United States / Canada', iso: 'US', flag: '🇺🇸', nationalLength: 10, pattern: /^\d{10}$/ },
  { code: '+44', country: 'United Kingdom', iso: 'GB', flag: '🇬🇧', nationalLength: 10, pattern: /^\d{10}$/ },
  { code: '+61', country: 'Australia', iso: 'AU', flag: '🇦🇺', nationalLength: 9, pattern: /^\d{9}$/ },
  { code: '+971', country: 'United Arab Emirates', iso: 'AE', flag: '🇦🇪', nationalLength: 9, pattern: /^\d{9}$/ },
  { code: '+65', country: 'Singapore', iso: 'SG', flag: '🇸🇬', nationalLength: 8, pattern: /^\d{8}$/ },
  { code: '+880', country: 'Bangladesh', iso: 'BD', flag: '🇧🇩', nationalLength: 10, pattern: /^\d{10}$/ },
  { code: '+92', country: 'Pakistan', iso: 'PK', flag: '🇵🇰', nationalLength: 10, pattern: /^\d{10}$/ },
  { code: '+94', country: 'Sri Lanka', iso: 'LK', flag: '🇱🇰', nationalLength: 9, pattern: /^\d{9}$/ },
  { code: '+977', country: 'Nepal', iso: 'NP', flag: '🇳🇵', nationalLength: 10, pattern: /^\d{10}$/ }
];

export function normalizePhone(countryCode, national) {
  const country = COUNTRY_CODES.find(item => item.code === String(countryCode || '').trim());
  if (!country) throw new ApiError(400, 'INVALID_COUNTRY_CODE', 'Select a supported country code.');
  const digits = String(national ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) throw new ApiError(400, 'INVALID_PHONE', 'Enter your mobile number.');
  if (!country.pattern.test(digits)) {
    const hint = country.code === '+91'
      ? 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.'
      : `Enter a valid ${country.nationalLength}-digit mobile number for ${country.country}.`;
    throw new ApiError(400, 'INVALID_PHONE', hint);
  }
  return {
    countryCode: country.code,
    national: digits,
    phone: `${country.code}${digits}`,
    country: country.country
  };
}

export function normalizeStoredPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

export function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 6) return `••••${digits.slice(-2)}`;
  return `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, digits.length - 8)}${'•'.repeat(4)}${digits.slice(-4)}`;
}
