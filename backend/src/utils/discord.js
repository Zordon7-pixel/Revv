/**
 * Discord webhook utility — sends embeds to DISCORD_WEBHOOK_URL
 */

const { resolveShopPolicy } = require('../services/shopPolicy');

// Tenant effects still require persisted policy; public prospect alerts have a
// separate, narrowly scoped entry point below.
async function sendDiscordEmbed({ title, description, color = 0x6366f1, fields = [], footer }, shopId) {
  const policy = await resolveShopPolicy(shopId);
  if (!policy.allowExternalEffects) {
    console.warn('[Discord] Suppressed:', policy.reason);
    return { ok: false, suppressed: true, provider_attempted: false, reason: policy.reason };
  }
  return deliverEmbed({ title, description, color, fields, footer });
}

async function deliverEmbed({ title, description, color = 0x6366f1, fields = [], footer }, { timeoutMs, prospect = false } = {}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const embed = { title, description, color, fields, timestamp: new Date().toISOString() };
  if (footer) embed.footer = { text: footer };

  let timer;
  const timeoutError = new Error('DISCORD_TIMEOUT');
  const controller = timeoutMs ? new AbortController() : null;
  try {
    const delivery = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    // Race as well as abort: even a transport that ignores cancellation must not
    // keep the background task pending. Promise.race observes late rejections.
    const response = timeoutMs ? await Promise.race([delivery, new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError);
        controller.abort();
      }, timeoutMs);
      timer.unref?.();
    })]) : await delivery;
    if (!response.ok) console.error(prospect ? '[Discord] PROSPECT_DELIVERY_NON_2XX' : '[Discord] Webhook rejected');
  } catch (error) {
    // Only our own deadline identifies a timeout. Never inspect/log arbitrary
    // transport errors, response bodies or configuration to classify failures.
    if (prospect) console.error(error === timeoutError ? '[Discord] PROSPECT_DELIVERY_TIMEOUT' : '[Discord] PROSPECT_DELIVERY_FAILED');
    else console.error('[Discord] Webhook failed or timed out');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Anonymous prospects remain public. If credentials are supplied, use the normal
// verifier (including revocation checks), never body/query/cookie identity flags.
function prospectIdentity(req, res, next) {
  delete req.user;
  delete req.prospectIdentityUnavailable;
  delete req.prospectUserId;
  if (!req.headers?.authorization) return next();
  return require('../middleware/auth').optional(req, res, () => {
    if (typeof req.user?.id !== 'string' || !req.user.id.trim()) {
      delete req.user;
    }
    // null intentionally fails the alert policy gate; undefined is anonymous.
    req.prospectUserId = req.prospectIdentityUnavailable ? null : req.user?.id;
    return next();
  });
}

async function sendProspectDiscordEmbed(embed, authenticatedUserId) {
  let failureCode = 'PROSPECT_IDENTITY_UNAVAILABLE';
  try {
    if (authenticatedUserId !== undefined) {
      if (typeof authenticatedUserId !== 'string' || !authenticatedUserId.trim()) {
        throw new Error('SHOP_POLICY_UNAVAILABLE');
      }
      failureCode = 'PROSPECT_POLICY_UNAVAILABLE';
      // Even signed JWT shop/flag claims may be stale: current user membership and
      // shop policy come from persisted server-owned rows at the send boundary.
      const rows = await require('../db').dbAll(`SELECT u.id::text AS user_id, s.is_internal_test_shop
        FROM users u JOIN shops s ON s.id = u.shop_id WHERE u.id::text = $1`, [authenticatedUserId]);
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].user_id !== authenticatedUserId
          || typeof rows[0].is_internal_test_shop !== 'boolean') throw new Error('SHOP_POLICY_UNAVAILABLE');
      if (rows[0].is_internal_test_shop) {
        return { ok: false, suppressed: true, provider_attempted: false, reason: 'INTERNAL_TEST_SHOP' };
      }
    }
    // Email, source, shop_id and is_test never classify anonymous submissions.
    failureCode = 'PROSPECT_DELIVERY_FAILED';
    return await deliverEmbed(embed, { timeoutMs: 5000, prospect: true });
  } catch {
    console.error(`[Discord] ${failureCode}`);
    return { ok: false, suppressed: true, provider_attempted: false, reason: 'SHOP_POLICY_UNAVAILABLE' };
  }
}

module.exports = { sendDiscordEmbed, prospectIdentity, sendProspectDiscordEmbed };
