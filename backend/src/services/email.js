const nodemailer = require('nodemailer');

function isConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: parseInt(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendEmail(to, subject, html) {
  if (!isConfigured()) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(`[EMAIL] Body: ${html.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)}`);
    return { ok: true, simulated: true };
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendStatusUpdate(customerEmail, customerName, roNumber, newStatus, shopName) {
  const statusLabels = {
    intake: 'checked in',
    estimate: 'in the estimate phase',
    approval: 'awaiting approval',
    parts: 'waiting on parts',
    repair: 'in repair',
    paint: 'in paint',
    qc: 'in quality control',
    delivery: 'ready for delivery',
    closed: 'complete',
  };
  const label = statusLabels[newStatus] || newStatus;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">Vehicle Update from ${shopName}</h2>
      <p>Hi ${customerName},</p>
      <p>Your vehicle (RO# <strong>${roNumber}</strong>) is now <strong>${label}</strong>.</p>
      <p>Thank you for choosing ${shopName}.</p>
    </div>
  `;
  return sendEmail(customerEmail, `Update on your repair — ${roNumber}`, html);
}

async function sendEstimateLink(customerEmail, customerName, estimateUrl, shopName, jobType, total) {
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">Your Estimate from ${shopName}</h2>
      <p>Hi ${customerName},</p>
      <p>Your estimate for <strong>${jobType}</strong> is ready. Estimated total: <strong>$${parseFloat(total || 0).toFixed(2)}</strong>.</p>
      <p>Please review and approve or decline your estimate:</p>
      <p>
        <a href="${estimateUrl}" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">
          Review Estimate
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">Or copy this link: ${estimateUrl}</p>
    </div>
  `;
  return sendEmail(customerEmail, `Estimate ready — ${shopName}`, html);
}

async function sendReviewRequest(customerEmail, customerName, shopName, googleReviewUrl) {
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">How was your experience at ${shopName}?</h2>
      <p>Hi ${customerName},</p>
      <p>Your vehicle repair at ${shopName} is complete. We would love to hear how we did!</p>
      <p>
        <a href="${googleReviewUrl}" style="background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">
          Leave a Google Review
        </a>
      </p>
      <p>Thank you for your business!</p>
    </div>
  `;
  return sendEmail(customerEmail, `Thanks for choosing ${shopName} — share your experience!`, html);
}

module.exports = { sendEmail, sendStatusUpdate, sendEstimateLink, sendReviewRequest };
