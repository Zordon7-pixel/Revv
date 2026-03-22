const express = require('express');
const auth = require('../middleware/auth');
const { requireOwner } = require('../middleware/roles');
const { getStripeClient } = require('../services/stripe');
const { dbGet, dbRun } = require('../db');

const router = express.Router();

const DEFAULT_APP_URL = 'https://revvshop.app';
const PLAN_BY_PRICE_ID = {
  [process.env.STRIPE_PRICE_ID_PRO]: 'pro',
  [process.env.STRIPE_PRICE_ID_AGENCY]: 'agency',
};

function normalizeRequestedPlan(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'pro' || value === 'tier2' || value === '2') return 'pro';
  if (value === 'agency' || value === 'tier3' || value === '3') return 'agency';
  return null;
}

function getCheckoutUrls() {
  const appUrl = process.env.APP_URL || DEFAULT_APP_URL;
  return {
    success_url: `${appUrl}/dashboard?subscribed=1`,
    cancel_url: `${appUrl}/settings`,
  };
}

async function ensureStripeCustomer(shopId) {
  const stripe = getStripeClient();
  if (!stripe) return { error: 'Stripe is not configured' };

  const shop = await dbGet(
    'SELECT id, name, stripe_customer_id FROM shops WHERE id = $1',
    [shopId]
  );
  if (!shop) return { error: 'Shop not found', status: 404 };

  if (shop.stripe_customer_id) {
    return { stripe, customerId: shop.stripe_customer_id };
  }

  const owner = await dbGet(
    `SELECT email, name
     FROM users
     WHERE shop_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [shopId]
  );

  const customer = await stripe.customers.create({
    name: shop.name || owner?.name || 'REVV Shop',
    email: owner?.email || undefined,
    metadata: { shop_id: shopId },
  });

  await dbRun(
    'UPDATE shops SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, shopId]
  );

  return { stripe, customerId: customer.id };
}

router.get('/status', auth, requireOwner, async (req, res) => {
  try {
    const shop = await dbGet(
      `SELECT plan, trial_ends_at, plan_expires_at, stripe_subscription_id
       FROM shops
       WHERE id = $1`,
      [req.user.shop_id]
    );

    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    return res.json({
      plan: shop.plan || 'free',
      trial_ends_at: shop.trial_ends_at,
      plan_expires_at: shop.plan_expires_at,
      stripe_subscription_id: shop.stripe_subscription_id,
      available_plans: ['free', 'pro', 'agency'],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/checkout', auth, requireOwner, async (req, res) => {
  try {
    const plan = normalizeRequestedPlan(req.body?.plan || req.body?.tier);
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const currentShop = await dbGet(
      'SELECT plan, stripe_subscription_id FROM shops WHERE id = $1',
      [req.user.shop_id]
    );
    if (!currentShop) return res.status(404).json({ error: 'Shop not found' });
    if ((currentShop.plan || 'free') === plan && currentShop.stripe_subscription_id) {
      return res.status(409).json({
        error: `You are already on the ${plan} tier. Use Manage Billing to update payment details.`,
      });
    }

    const priceId =
      plan === 'pro'
        ? process.env.STRIPE_PRICE_ID_PRO
        : process.env.STRIPE_PRICE_ID_AGENCY;
    if (!priceId) return res.status(500).json({ error: 'Missing Stripe price configuration' });

    const customerResult = await ensureStripeCustomer(req.user.shop_id);
    if (customerResult.error) {
      return res.status(customerResult.status || 503).json({ error: customerResult.error });
    }

    const { stripe, customerId } = customerResult;
    const { success_url, cancel_url } = getCheckoutUrls();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      metadata: {
        shop_id: req.user.shop_id,
        plan,
      },
      subscription_data: {
        metadata: {
          shop_id: req.user.shop_id,
          plan,
        },
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/portal', auth, requireOwner, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' });

    const shop = await dbGet(
      'SELECT stripe_customer_id FROM shops WHERE id = $1',
      [req.user.shop_id]
    );
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    if (!shop.stripe_customer_id) return res.status(400).json({ error: 'No Stripe customer found for this shop' });

    const session = await stripe.billingPortal.sessions.create({
      customer: shop.stripe_customer_id,
      return_url: `${process.env.APP_URL || DEFAULT_APP_URL}/settings`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function handleWebhook(req, res) {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(200).json({ received: true, skipped: true });

    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET configuration' });
    }

    const event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const itemPriceId = subscription.items?.data?.[0]?.price?.id;
      const plan = PLAN_BY_PRICE_ID[itemPriceId] || subscription.metadata?.plan || 'free';
      const planExpiresAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;

      await dbRun(
        `UPDATE shops
         SET plan = $1,
             plan_expires_at = $2,
             stripe_subscription_id = $3
         WHERE stripe_customer_id = $4`,
        [plan, planExpiresAt, subscription.id, customerId]
      );
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      await dbRun(
        `UPDATE shops
         SET plan = 'free',
             stripe_subscription_id = NULL,
             plan_expires_at = NULL
         WHERE stripe_customer_id = $1`,
        [customerId]
      );
    }

    return res.json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
}

router.post('/', handleWebhook);
router.post('/webhook', handleWebhook);

module.exports = router;
