// Shared by provisioning and signature verification; never trust request headers.
const WEBHOOK_PATH = '/api/sms/webhook';
const CONFIG_ERROR = '[SMS Config] Inbound SMS disabled: configure APP_URL or PUBLIC_URL as a valid public HTTP(S) base URL.';

function inboundWebhookUrl() {
  try {
    const base = new URL(process.env.APP_URL || process.env.PUBLIC_URL || '');
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password
        || base.search || base.hash) return null;
    return `${base.href.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
  } catch {
    return null;
  }
}

// Configuration errors disable SMS only. Do not log the supplied URL or secrets.
if (!inboundWebhookUrl()) console.error(CONFIG_ERROR);

module.exports = { WEBHOOK_PATH, CONFIG_ERROR, inboundWebhookUrl };
