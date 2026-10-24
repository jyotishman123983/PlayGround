import { config } from './config.mjs';
import { ApiError } from './errors.mjs';

function providerLabel() {
  if (config.whatsapp.provider === 'meta') return 'WhatsApp Business Platform (Meta Cloud API)';
  if (config.whatsapp.provider === 'twilio') return 'Twilio WhatsApp';
  return 'not configured';
}

export function whatsappStatus() {
  return {
    configured: config.whatsapp.configured,
    provider: config.whatsapp.provider,
    providerLabel: providerLabel(),
    deliveryMode: config.whatsapp.configured ? 'whatsapp' : (config.allowDevOtp ? 'development' : 'unavailable')
  };
}

async function parseProviderError(response) {
  let text = '';
  try { text = await response.text(); } catch {}
  let message = text;
  try {
    const parsed = JSON.parse(text);
    message = parsed.error?.message || parsed.message || text;
  } catch {}
  return `WhatsApp provider rejected the request (HTTP ${response.status}). ${String(message || '').slice(0, 300)}`.trim();
}

async function sendMeta(phone, code) {
  const { token, phoneNumberId, templateName, templateLanguage, graphVersion, usePlainText } = config.whatsapp.meta;
  if (!token || !phoneNumberId) {
    throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp OTP provider is not configured.');
  }
  const payload = usePlainText
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace('+', ''),
        type: 'text',
        text: { preview_url: false, body: `Your ViralYantra AI verification code is ${code}. It expires in ${Math.round(config.otp.ttlSeconds / 60)} minutes. Never share this code.` }
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace('+', ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
        }
      };
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new ApiError(502, 'WHATSAPP_DELIVERY_FAILED', await parseProviderError(response));
  const data = await response.json().catch(() => ({}));
  return data.messages?.[0]?.id || null;
}

async function sendTwilio(phone, code) {
  const { accountSid, authToken, from, contentSid } = config.whatsapp.twilio;
  if (!accountSid || !authToken || !from) {
    throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'Twilio WhatsApp provider is not configured.');
  }
  const body = new URLSearchParams();
  body.set('From', from.startsWith('whatsapp:') ? from : `whatsapp:${from}`);
  body.set('To', `whatsapp:${phone}`);
  if (contentSid) {
    body.set('ContentSid', contentSid);
    body.set('ContentVariables', JSON.stringify({ 1: code }));
  } else {
    body.set('Body', `Your ViralYantra AI verification code is ${code}. It expires in ${Math.round(config.otp.ttlSeconds / 60)} minutes. Never share this code.`);
  }
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new ApiError(502, 'WHATSAPP_DELIVERY_FAILED', await parseProviderError(response));
  const data = await response.json().catch(() => ({}));
  return data.sid || null;
}

export async function sendWhatsAppOtp(phone, code) {
  if (!config.whatsapp.configured) {
    throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp OTP delivery is not configured on the server.', {
      provider: config.whatsapp.provider,
      required: [
        'WHATSAPP_PROVIDER=meta',
        'WHATSAPP_TOKEN (permanent system user token)',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_TEMPLATE_NAME (approved authentication template)',
        'WHATSAPP_TEMPLATE_LANGUAGE'
      ]
    });
  }
  if (config.whatsapp.provider === 'meta') return sendMeta(phone, code);
  if (config.whatsapp.provider === 'twilio') return sendTwilio(phone, code);
  throw new ApiError(503, 'WHATSAPP_NOT_CONFIGURED', 'Unsupported WhatsApp provider configuration.');
}
