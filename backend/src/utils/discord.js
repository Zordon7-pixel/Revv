/**
 * Discord webhook utility — sends embeds to DISCORD_WEBHOOK_URL
 */

const { resolveShopPolicy } = require('../services/shopPolicy');

// Public lead/waitlist payloads cannot establish fixture provenance. Until a
// reviewed server-owned path exists, missing tenancy disables external delivery.
async function sendDiscordEmbed({ title, description, color = 0x6366f1, fields = [], footer }, shopId) {
  const policy = await resolveShopPolicy(shopId);
  if (!policy.allowExternalEffects) {
    console.warn('[Discord] Suppressed:', policy.reason);
    return { ok: false, suppressed: true, provider_attempted: false, reason: policy.reason };
  }
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const embed = { title, description, color, fields, timestamp: new Date().toISOString() };
  if (footer) embed.footer = { text: footer };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error('[Discord] Webhook failed:', err.message);
  }
}

module.exports = { sendDiscordEmbed };
