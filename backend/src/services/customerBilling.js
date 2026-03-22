const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const { getStripeClient } = require('./stripe');
const { sendMail } = require('./mailer');
const { closedPaidInvoiceEmail } = require('./emailTemplates');

function appBaseUrl() {
  return String(process.env.APP_URL || process.env.PUBLIC_URL || 'https://revvshop.app').replace(/\/+$/, '');
}

function normalizedPaymentStatus(ro) {
  const raw = String(ro?.payment_status || '').trim().toLowerCase();
  if (raw) return raw;
  return ro?.payment_received ? 'succeeded' : 'unpaid';
}

function dueAmountCents(ro) {
  const explicitTotal = Number(ro?.total || 0);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    return Math.round(explicitTotal * 100);
  }
  const parts = Number(ro?.parts_cost || 0);
  const labor = Number(ro?.labor_cost || 0);
  const sublet = Number(ro?.sublet_cost || 0);
  const tax = Number(ro?.tax || 0);
  const fallback = parts + labor + sublet + tax;
  if (!Number.isFinite(fallback) || fallback <= 0) return 0;
  return Math.round(fallback * 100);
}

async function ensureTrackingToken(roId, shopId) {
  const existing = await dbGet(
    'SELECT token FROM portal_tokens WHERE ro_id = $1 AND shop_id = $2 ORDER BY created_at DESC LIMIT 1',
    [roId, shopId]
  );
  if (existing?.token) return existing.token;

  const token = uuidv4().replace(/-/g, '');
  await dbRun(
    'INSERT INTO portal_tokens (id, ro_id, shop_id, token) VALUES ($1, $2, $3, $4)',
    [uuidv4(), roId, shopId, token]
  );
  return token;
}

async function createPaymentCheckoutLinkForRo({ roId, shopId, customerEmail = null, customerName = null, trackingToken = null }) {
  const stripe = getStripeClient();
  if (!stripe) {
    return { ok: false, error: 'Stripe is not configured' };
  }

  const ro = await dbGet(
    `SELECT id, shop_id, ro_number, total, parts_cost, labor_cost, sublet_cost, tax, payment_status, payment_received
     FROM repair_orders
     WHERE id = $1 AND shop_id = $2`,
    [roId, shopId]
  );
  if (!ro) return { ok: false, error: 'Repair order not found' };

  const paymentStatus = normalizedPaymentStatus(ro);
  if (paymentStatus === 'succeeded') {
    return { ok: false, error: 'Repair order is already paid' };
  }

  const amountCents = dueAmountCents(ro);
  if (!amountCents) {
    return { ok: false, error: 'Repair order total must be greater than zero' };
  }

  const token = trackingToken || (await ensureTrackingToken(ro.id, ro.shop_id));
  const statusUrl = `${appBaseUrl()}/track/${token}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail || undefined,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: `Repair Order #${ro.ro_number || ro.id}`,
            description: customerName ? `Customer: ${customerName}` : undefined,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      roId: ro.id,
      shopId: ro.shop_id,
      roNumber: ro.ro_number || '',
    },
    payment_intent_data: {
      metadata: {
        roId: ro.id,
        shopId: ro.shop_id,
        roNumber: ro.ro_number || '',
      },
      receipt_email: customerEmail || undefined,
    },
    success_url: `${statusUrl}?payment=success`,
    cancel_url: `${statusUrl}?payment=cancelled`,
  });

  return {
    ok: true,
    url: session.url,
    amountCents,
    trackingToken: token,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  };
}

async function sendClosedPaidInvoiceEmail({ roId, shopId, force = false }) {
  const ctx = await dbGet(
    `SELECT ro.id, ro.shop_id, ro.ro_number, ro.status, ro.payment_status, ro.payment_received,
            ro.invoice_emailed_at, c.email AS customer_email, c.name AS customer_name, s.name AS shop_name
     FROM repair_orders ro
     LEFT JOIN customers c ON c.id = ro.customer_id
     LEFT JOIN shops s ON s.id = ro.shop_id
     WHERE ro.id = $1 AND ro.shop_id = $2`,
    [roId, shopId]
  );

  if (!ctx) return { sent: false, reason: 'not_found' };
  if (!ctx.customer_email) return { sent: false, reason: 'no_customer_email' };
  if (ctx.status !== 'closed') return { sent: false, reason: 'not_closed' };
  if (normalizedPaymentStatus(ctx) !== 'succeeded') return { sent: false, reason: 'not_paid' };
  if (ctx.invoice_emailed_at && !force) return { sent: false, reason: 'already_sent' };

  const token = await ensureTrackingToken(ctx.id, ctx.shop_id);
  const invoiceUrl = `${appBaseUrl()}/api/invoice/public/${token}`;
  const trackUrl = `${appBaseUrl()}/track/${token}`;
  const { subject, html } = closedPaidInvoiceEmail({
    shopName: ctx.shop_name,
    roNumber: ctx.ro_number || 'N/A',
    customerName: ctx.customer_name || '',
    invoiceUrl,
    trackUrl,
  });

  await sendMail(ctx.customer_email, subject, html);
  await dbRun(
    'UPDATE repair_orders SET invoice_emailed_at = $1 WHERE id = $2 AND shop_id = $3',
    [new Date().toISOString(), ctx.id, ctx.shop_id]
  );
  return { sent: true };
}

module.exports = {
  createPaymentCheckoutLinkForRo,
  ensureTrackingToken,
  sendClosedPaidInvoiceEmail,
};
