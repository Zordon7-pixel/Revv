// Mailer — powered by Resend (https://resend.com)
// Zero npm packages — uses Node 18+ native fetch
// Required env var: RESEND_API_KEY
// Optional env var: RESEND_FROM (default: REVV <noreply@revvshop.app>)

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'REVV <noreply@revvshop.app>';

if (RESEND_API_KEY) {
  console.log('[Mailer] Resend configured');
} else {
  console.log('[Mailer] RESEND_API_KEY not set — email notifications disabled');
}

async function sendMail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log('[Mailer] No-op: Resend not configured');
    return null;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Mailer] Resend rejected send; HTTP status:',
        Number.isInteger(res.status) && res.status >= 100 && res.status <= 599 ? res.status : 'unknown');
      throw new Error(data.message || 'Resend API error');
    }

    // Only UUID-shaped provider references may enter logs; never coerce arbitrary values.
    const reference = typeof data.id === 'string' && data.id.length === 36
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.id)
      ? data.id : 'unavailable';
    console.log('[Mailer] Sent via Resend; reference:', reference);
    return data;
  } catch (err) {
    console.error('[Mailer] Send failed');
    throw err;
  }
}

module.exports = { sendMail };
