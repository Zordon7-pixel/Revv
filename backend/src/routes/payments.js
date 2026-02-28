const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { createPaymentIntent, constructWebhookEvent } = require('../services/stripe');

const router = express.Router();

function normalizedPaymentStatus(ro) {
  if (ro?.payment_status) return ro.payment_status;
  if (ro?.payment_received) return 'succeeded';
  return 'unpaid';
}

function normalizeAmountCents(amount) {
  const parsed = Number(amount);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function ensurePaymentsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_payments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      ro_id TEXT NOT NULL,
      stripe_payment_intent_id TEXT UNIQUE,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'pending',
      payment_method TEXT,
      receipt_email TEXT,
      paid_at TEXT,
      failure_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function handleCreateIntent(req, res) {
  try {
    await ensurePaymentsTable();

    const { ro_id: roId, amount } = req.body || {};
    if (!roId || amount === undefined) {
      return res.status(400).json({ error: 'ro_id and amount are required' });
    }

    const ro = await dbGet(
      'SELECT id, shop_id, ro_number, customer_id, payment_status, payment_received FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const amountCents = normalizeAmountCents(amount);
    if (!amountCents) return res.status(400).json({ error: 'amount must be a positive integer in cents' });

    const paymentIntent = await createPaymentIntent(amountCents, 'usd', {
      roId: ro.id,
      shopId: req.user.shop_id,
      roNumber: ro.ro_number || '',
    });

    if (!paymentIntent) {
      return res.status(503).json({ error: 'Stripe payments are not configured' });
    }

    const customer = ro.customer_id
      ? await dbGet('SELECT email FROM customers WHERE id = $1', [ro.customer_id])
      : null;

    await dbRun(
      `INSERT INTO ro_payments (id, shop_id, ro_id, stripe_payment_intent_id, amount_cents, currency, status, receipt_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (stripe_payment_intent_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                     currency = EXCLUDED.currency,
                     status = EXCLUDED.status,
                     receipt_email = EXCLUDED.receipt_email,
                     updated_at = NOW()`,
      [
        uuidv4(),
        req.user.shop_id,
        ro.id,
        paymentIntent.id,
        amountCents,
        paymentIntent.currency || 'usd',
        paymentIntent.status || 'pending',
        customer?.email || null,
      ]
    );

    await dbRun(
      'UPDATE repair_orders SET payment_status = $1, stripe_payment_intent_id = $2, updated_at = $3 WHERE id = $4 AND shop_id = $5',
      ['pending', paymentIntent.id, new Date().toISOString(), ro.id, req.user.shop_id]
    );

    return res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create payment intent' });
  }
}

router.post('/intent', auth, handleCreateIntent);

// Backward-compat alias
router.post('/create-intent', auth, async (req, res) => {
  req.body = {
    ro_id: req.body?.ro_id || req.body?.roId,
    amount: req.body?.amount,
  };
  return handleCreateIntent(req, res);
});

router.post('/webhook', async (req, res) => {
  try {
    await ensurePaymentsTable();

    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });

    const event = constructWebhookEvent(req.body, signature);
    if (!event) {
      return res.status(200).json({ received: true, skipped: true });
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const roId = intent.metadata?.roId || null;
      const shopId = intent.metadata?.shopId || null;
      const paidAt = intent.created ? new Date(intent.created * 1000).toISOString() : new Date().toISOString();
      const amountPaid = intent.amount_received || intent.amount || 0;

      await dbRun(
        `UPDATE ro_payments
         SET status = $1,
             payment_method = $2,
             paid_at = $3,
             updated_at = NOW()
         WHERE stripe_payment_intent_id = $4`,
        ['succeeded', 'card', paidAt, intent.id]
      );

      const existingPayment = await dbGet('SELECT id FROM ro_payments WHERE stripe_payment_intent_id = $1', [intent.id]);
      if (!existingPayment && roId && shopId) {
        await dbRun(
          `INSERT INTO ro_payments (id, shop_id, ro_id, stripe_payment_intent_id, amount_cents, currency, status, payment_method, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [uuidv4(), shopId, roId, intent.id, amountPaid, intent.currency || 'usd', 'succeeded', 'card', paidAt]
        );
      }

      if (roId && shopId) {
        await dbRun(
          `UPDATE repair_orders
           SET payment_status = $1,
               stripe_payment_intent_id = $2,
               payment_received = 1,
               payment_received_at = $3,
               payment_method = $4,
               paid_at = $5,
               paid_amount = $6,
               updated_at = $7
           WHERE id = $8 AND shop_id = $9`,
          ['succeeded', intent.id, paidAt, 'card', paidAt, amountPaid, new Date().toISOString(), roId, shopId]
        );

        const ro = await dbGet('SELECT ro_number FROM repair_orders WHERE id = $1 AND shop_id = $2', [roId, shopId]);
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
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const failureMessage = intent.last_payment_error?.message || 'Payment failed';

      console.error(`[Stripe] payment_intent.payment_failed ${intent.id}: ${failureMessage}`);

      await dbRun(
        `UPDATE ro_payments
         SET status = $1,
             failure_message = $2,
             updated_at = NOW()
         WHERE stripe_payment_intent_id = $3`,
        ['failed', failureMessage, intent.id]
      );

      const roId = intent.metadata?.roId;
      const shopId = intent.metadata?.shopId;
      if (roId && shopId) {
        await dbRun(
          `UPDATE repair_orders
           SET payment_status = $1,
               stripe_payment_intent_id = $2,
               updated_at = $3
           WHERE id = $4 AND shop_id = $5`,
          ['failed', intent.id, new Date().toISOString(), roId, shopId]
        );
      }
    }

    return res.json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
});

router.get('/history/:shopId', auth, async (req, res) => {
  try {
    const { shopId } = req.params;
    if (shopId !== req.user.shop_id) return res.status(403).json({ error: 'Forbidden' });

    await ensurePaymentsTable();

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
       ORDER BY COALESCE(p.paid_at, p.created_at) DESC`,
      [shopId]
    );

    return res.json({ payments });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/ro/:roId', auth, async (req, res) => {
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
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
