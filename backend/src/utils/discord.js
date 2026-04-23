/**
 * Discord webhook utility — sends embeds to DISCORD_WEBHOOK_URL
 */

async function sendDiscordEmbed({ title, description, color = 0x6366f1, fields = [], footer }) {
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
