const Stripe = require('stripe');

let stripeClient = null;

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

async function createPaymentIntent(amount, currency = 'usd', metadata = {}) {
  const stripe = getStripeClient();
  if (!stripe) return null;

  return stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
    automatic_payment_methods: { enabled: true },
  });
}

function constructWebhookEvent(body, sig) {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  return stripe.webhooks.constructEvent(body, sig, webhookSecret);
}

module.exports = {
  createPaymentIntent,
  constructWebhookEvent,
};
