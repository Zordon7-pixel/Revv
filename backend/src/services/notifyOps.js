const lastSentByCode = new Map();
const THROTTLE_MS = 5 * 60 * 1000;
const { resolveShopPolicy } = require('./shopPolicy');

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};
  return {
    shop_id: context.shop_id,
    ro_id: context.ro_id,
  };
}

async function notifyOps(severity, code, context = {}) {
  const safeContext = sanitizeContext(context);
  const payload = {
    severity,
    code,
    context: safeContext,
    ts: new Date().toISOString(),
  };

  console.error('[OPS]', JSON.stringify(payload));

  // Read current persisted policy even on late failure callbacks. Suppression
  // stays local and does not consume the ordinary alert throttle.
  const policy = await resolveShopPolicy(safeContext.shop_id);
  if (!policy.allowExternalEffects) {
    console.warn('[OPS] External alert suppressed:', policy.reason);
    return { ok: false, suppressed: true, provider_attempted: false, reason: policy.reason };
  }

  const webhook = process.env.OPS_DISCORD_WEBHOOK;
  if (!webhook) return;

  const now = Date.now();
  const lastSent = lastSentByCode.get(code) || 0;
  if (now - lastSent < THROTTLE_MS) return;
  lastSentByCode.set(code, now);

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `[OPS:${severity}] ${code} :: ${JSON.stringify(safeContext)}`,
      }),
    });
  } catch (err) {
    console.error('[OPS] webhook delivery failed:', err?.message || 'unknown error');
  }
}

module.exports = { notifyOps };
