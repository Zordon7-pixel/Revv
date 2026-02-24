const nodemailer = require('nodemailer');

// Gmail SMTP transporter — uses GMAIL_USER + GMAIL_PASS env vars
let transporter = null;

if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
  console.log('[Mailer] Gmail configured for', process.env.GMAIL_USER);
} else {
  console.log('[Mailer] GMAIL_USER not set — email notifications disabled');
}

async function sendMail(to, subject, html) {
  if (!transporter) {
    console.log('[Mailer] No-op: email not configured', { to, subject });
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      html,
    });
    console.log('[Mailer] Sent:', info.response);
    return info;
  } catch (err) {
    console.error('[Mailer] Error:', err.message);
    throw err;
  }
}

module.exports = { sendMail };
