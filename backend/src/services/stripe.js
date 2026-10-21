const { createHmac, timingSafeEqual } = require('node:crypto');
const { assertExternalEffectsAllowed } = require('./shopPolicy');

let stripeClient = null;

// Trusted tenancy is mandatory. Retained clients recheck before EVERY SDK method,
// including retrieve/cancel/refund and nested checkout/portal operations.
async function getStripeClient(shopId, readRows) {
  await assertExternalEffectsAllowed(shopId, readRows);
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  if (!stripeClient) {
    const Stripe = require('stripe');
    stripeClient = new Stripe(secretKey);
  }
  const guard = target => new Proxy(target, {
    get(object, key) {
      // Do not make the returned client a thenable.
      if (key === 'then') return undefined;
      const value = Reflect.get(object, key);
      if (typeof value === 'function') return async (...args) => {
        await assertExternalEffectsAllowed(shopId, readRows);
        return value.apply(object, args);
      };
      return value && typeof value === 'object' ? guard(value) : value;
    },
  });
  return guard(stripeClient);
}

async function createPaymentIntent(amount, currency = 'usd', metadata = {}, idempotencyKey, shopId) {
  // Metadata is a provider payload, not authority for selecting the policy row.
  const stripe = await getStripeClient(shopId);
  if (!stripe) return null;
  return stripe.paymentIntents.create({
    amount, currency, metadata,
    automatic_payment_methods: { enabled: true },
  }, idempotencyKey ? { idempotencyKey } : undefined);
}

// Verify the raw signed bytes locally: fixture callbacks must not import/create a
// Stripe client merely to authenticate. Matches Stripe's v1 HMAC and 300s tolerance.
// No unsigned body/metadata is used to look up policy or mutate billing state.
function constructWebhookEvent(body, sig) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  if ((!Buffer.isBuffer(body) && typeof body !== 'string') || typeof sig !== 'string') {
    throw new Error('Invalid webhook signature');
  }
  const fields = sig.split(',').map(part => part.split('='));
  const timestamps = fields.filter(([key]) => key === 't');
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamp || '') ||
      Math.floor(Date.now() / 1000) - Number(timestamp) > 300) {
    throw new Error('Invalid webhook timestamp');
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  const valid = fields.some(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '') &&
    timingSafeEqual(expected, Buffer.from(value, 'hex')));
  if (!valid) throw new Error('Invalid webhook signature');
  return JSON.parse(payload.toString('utf8'));
}

module.exports = { getStripeClient, createPaymentIntent, constructWebhookEvent };
