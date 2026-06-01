const lastSentByCode = new Map();
const THROTTLE_MS = 5 * 60 * 1000;

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
