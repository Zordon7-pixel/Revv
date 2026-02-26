const express = require('express');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { createNotification } = require('../services/notifications');

const router = express.Router();

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function normalizeAmountToCents(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function normalizedPaymentStatus(ro) {
  if (ro?.payment_status) return ro.payment_status;
  if (ro?.payment_received) return 'succeeded';
  return 'unpaid';
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

router.post('/create-intent', auth, async (req, res) => {
  try {
    await ensurePaymentsTable();
    const { roId, amount } = req.body || {};
    if (!roId || amount === undefined) {
      return res.status(400).json({ error: 'roId and amount are required' });
    }

    const ro = await dbGet(
      'SELECT id, shop_id, ro_number, customer_id, total, payment_status, payment_received FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const amountCents = normalizeAmountToCents(amount);
    if (!amountCents) return res.status(400).json({ error: 'Amount must be greater than 0' });

    const customer = ro.customer_id
      ? await dbGet('SELECT email FROM customers WHERE id = $1', [ro.customer_id])
      : null;

    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: {
        roId: ro.id,
        shopId: req.user.shop_id,
        roNumber: ro.ro_number || '',
      },
      receipt_email: customer?.email || undefined,
      automatic_payment_methods: { enabled: true },
    });

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
        'usd',
        paymentIntent.status || 'pending',
        customer?.email || null,
      ]
    );

    await dbRun(
      'UPDATE repair_orders SET payment_status = $1, updated_at = $2 WHERE id = $3 AND shop_id = $4',
      ['pending', new Date().toISOString(), ro.id, req.user.shop_id]
    );

    return res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create payment intent' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return res.status(400).json({ error: 'Missing webhook signature or secret' });
    }

    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

    await ensurePaymentsTable();

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const roId = intent.metadata?.roId || null;
      const shopId = intent.metadata?.shopId || null;
      const paidAt = intent.created ? new Date(intent.created * 1000).toISOString() : new Date().toISOString();
      const method = intent.payment_method_types?.[0] || 'card';

      await dbRun(
        `UPDATE ro_payments
         SET status = $1,
             payment_method = $2,
             paid_at = $3,
             updated_at = NOW()
         WHERE stripe_payment_intent_id = $4`,
        ['succeeded', method, paidAt, intent.id]
      );

      const existingPayment = await dbGet('SELECT id FROM ro_payments WHERE stripe_payment_intent_id = $1', [intent.id]);
      if (!existingPayment && roId && shopId) {
        await dbRun(
          `INSERT INTO ro_payments (id, shop_id, ro_id, stripe_payment_intent_id, amount_cents, currency, status, payment_method, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            uuidv4(),
            shopId,
            roId,
            intent.id,
            intent.amount_received || intent.amount || 0,
            intent.currency || 'usd',
            'succeeded',
            method,
            paidAt,
          ]
        );
      }

      if (roId && shopId) {
        await dbRun(
          `UPDATE repair_orders
           SET payment_status = $1,
               payment_received = 1,
               payment_received_at = $2,
               payment_method = $3,
           updated_at = $4
           WHERE id = $5 AND shop_id = $6`,
          ['succeeded', paidAt, 'card', new Date().toISOString(), roId, shopId]
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

    if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      const intent = event.data.object;
      const status = event.type === 'payment_intent.canceled' ? 'canceled' : 'failed';
      const failureMessage = intent.last_payment_error?.message || null;

      await dbRun(
        `UPDATE ro_payments
         SET status = $1,
             failure_message = $2,
             updated_at = NOW()
         WHERE stripe_payment_intent_id = $3`,
        [status, failureMessage, intent.id]
      );

      const roId = intent.metadata?.roId;
      const shopId = intent.metadata?.shopId;
      if (roId && shopId) {
        await dbRun(
          'UPDATE repair_orders SET payment_status = $1, updated_at = $2 WHERE id = $3 AND shop_id = $4',
          [status, new Date().toISOString(), roId, shopId]
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
      `SELECT id, shop_id, ro_number, payment_status, payment_received, payment_received_at, payment_method
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
      latestPayment,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
