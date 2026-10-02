const express = require('express');
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { createNotification } = require('../services/notifications');
const { createPaymentIntent, constructWebhookEvent } = require('../services/stripe');
const { sendMail } = require('../services/mailer');
const { paymentConfirmationEmail } = require('../services/emailTemplates');
const { createPaymentCheckoutLinkForRo, sendClosedPaidInvoiceEmail } = require('../services/customerBilling');
const { PaymentError, reservePayment, metadataFor, recordProviderResult, settlePaymentEvent } = require('../services/paymentReservations');

const router = express.Router();

function normalizedPaymentStatus(ro) {
  if (ro?.payment_status) return ro.payment_status;
  if (ro?.payment_received) return 'paid';
  return 'unpaid';
}

async function handleCreateIntent(req, res) {
  try {
    const { ro_id: roId, amount, allow_partial } = req.body || {};
    if (!roId) return res.status(400).json({ error: 'ro_id is required' });
    const attempt = await reservePayment({ roId, shopId: req.user.shop_id, kind: 'intent', amount, allowPartial: allow_partial });
    const paymentIntent = await createPaymentIntent(attempt.amountCents, 'usd', metadataFor(attempt), attempt.idempotencyKey);
    if (!paymentIntent) return res.status(503).json({ error: 'Stripe payments are not configured' });
    await recordProviderResult(attempt, paymentIntent);
    return res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id,
      amountCents: attempt.amountCents, amountOwedCents: attempt.remainingCents });
  } catch (err) {
    return res.status(err instanceof PaymentError ? err.status : 500).json({
      error: err instanceof PaymentError ? err.message : 'Failed to create payment intent' });
  }
}

router.post('/intent', auth, requireTechnician, handleCreateIntent);

// Backward-compat alias
router.post('/create-intent', auth, requireTechnician, async (req, res) => {
  req.body = {
    ro_id: req.body?.ro_id || req.body?.roId,
    amount: req.body?.amount,
    allow_partial: req.body?.allow_partial === true,
  };
  return handleCreateIntent(req, res);
});

router.post('/link/:roId', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      `SELECT ro.id, ro.shop_id, ro.ro_number, c.email AS customer_email, c.name AS customer_name
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE ro.id = $1 AND ro.shop_id = $2`,
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const result = await createPaymentCheckoutLinkForRo({
      roId: ro.id,
      shopId: ro.shop_id,
      customerEmail: ro.customer_email || null,
      customerName: ro.customer_name || null,
    });
    if (!result.ok) {
      const status = result.error === 'Repair order not found' ? 404
        : result.error === 'Repair order is already paid' ? 400
          : result.error === 'Stripe is not configured' ? 503
            : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.json({
      checkoutUrl: result.url,
      amountCents: result.amountCents,
      expiresAt: result.expiresAt,
      trackingToken: result.trackingToken,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not create payment link' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });

    const event = constructWebhookEvent(req.body, signature);
    if (!event) {
      return res.status(200).json({ received: true, skipped: true });
    }

    const settled = await settlePaymentEvent(event);
    if (settled) {
      const { roId, shopId, amountPaid, ro } = settled;
      const owners = await dbAll('SELECT id FROM users WHERE shop_id = $1 AND role = $2', [shopId, 'owner']);
      await Promise.all(
        owners.map((owner) =>
          createNotification(
            shopId,
            owner.id,
            'payment',
            'Payment Received',
            `Payment was received for RO #${ro?.ro_number || 'N/A'}.`,
            roId
          )
        )
      );

      // Send payment confirmation email to customer
      setImmediate(async () => {
        try {
          const customer = await dbGet(
            `SELECT c.email, c.name, s.name AS shop_name
             FROM customers c
             JOIN repair_orders ro ON c.id = ro.customer_id
             JOIN shops s ON s.id = ro.shop_id
             WHERE ro.id = $1 AND ro.shop_id = $2`,
            [roId, shopId]
          );

          if (customer && customer.email) {
            const amountFormatted = (amountPaid / 100).toFixed(2);
            const { subject, html } = paymentConfirmationEmail({
              shopName: customer.shop_name,
              roNumber: ro?.ro_number || 'N/A',
              amountFormatted: `$${amountFormatted}`,
              customerName: customer.name,
              email: customer.email,
            });

            await sendMail(customer.email, subject, html).catch((e) => {
              console.error('[Email] Payment confirmation failed');
            });
          }
          await sendClosedPaidInvoiceEmail({ roId, shopId }).catch((e) => {
            console.error('[Email] Closed+paid invoice email failed');
          });
        } catch (err) {
          console.error('[Email] Payment confirmation handler failed');
        }
      });
    }

    return res.json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: 'Payment webhook could not be processed' });
  }
});

router.get('/history/:shopId', auth, requireTechnician, async (req, res) => {
  try {
    const { shopId } = req.params;
    if (shopId !== req.user.shop_id) return res.status(403).json({ error: 'Forbidden' });

    const payments = await dbAll(
      `SELECT
         p.id,
         p.ro_id,
         p.stripe_payment_intent_id,
         p.amount_cents,
         p.currency,
         p.status,
         p.payment_method,
         p.receipt_email,
         p.paid_at,
         p.failure_message,
         p.created_at,
         p.updated_at,
         ro.ro_number,
         c.name AS customer_name
       FROM ro_payments p
       LEFT JOIN repair_orders ro ON ro.id = p.ro_id
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE p.shop_id = $1
       ORDER BY COALESCE(p.paid_at::timestamptz, p.created_at) DESC`,
      [shopId]
    );

    return res.json({ payments });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load payments' });
  }
});

router.get('/ro/:roId', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      `SELECT id, shop_id, ro_number, payment_status, payment_received, payment_received_at, payment_method,
              stripe_payment_intent_id, paid_at, paid_amount
       FROM repair_orders
       WHERE id = $1 AND shop_id = $2`,
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const latestPayment = await dbGet(
      `SELECT id, stripe_payment_intent_id, amount_cents, currency, status, payment_method, paid_at, failure_message, created_at
       FROM ro_payments
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [ro.id, req.user.shop_id]
    );

    return res.json({
      roId: ro.id,
      roNumber: ro.ro_number,
      paymentStatus: normalizedPaymentStatus(ro),
      paymentReceived: !!ro.payment_received,
      paymentReceivedAt: ro.payment_received_at,
      paymentMethod: ro.payment_method,
      paymentIntentId: ro.stripe_payment_intent_id,
      paidAt: ro.paid_at,
      paidAmount: ro.paid_amount,
      latestPayment,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load payments' });
  }
});

module.exports = router;
