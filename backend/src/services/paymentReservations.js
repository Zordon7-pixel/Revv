'use strict';
const { randomUUID } = require('node:crypto');
const { getRoMoneySummary, getPaidCents, reconcilePaymentStatus } = require('./roMoney');

class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message = 'Payment requires manual reconciliation', status = 409) => { throw new PaymentError(message, status); };
const succeeded = row => ['paid', 'succeeded'].includes(String(row.status || '').toLowerCase());
const cents = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

// Parent first, matching DELETE RO. All money queries use this transaction client.
async function withLockedRo(roId, shopId, work) {
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const ro = (await client.query('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE', [roId, shopId])).rows[0];
    if (!ro) fail('Repair order not found', 404);
    const result = await work(client, ro);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function getPaymentBalance(client, ro) {
  const money = await getRoMoneySummary(ro.id, ro.shop_id, client);
  const ledgerPaid = await getPaidCents(ro.id, ro.shop_id, client);
  const legacyPaid = Number(ro.amount_paid_cents || 0);
  const paidCents = Math.max(ledgerPaid, legacyPaid);
  const remainingCents = money.totalCents - paidCents;
  if (!money.lineCount || !cents(money.totalCents) || money.totalCents <= 0 ||
      !cents(ledgerPaid) || !cents(legacyPaid) || !Number.isSafeInteger(remainingCents) || remainingCents <= 0 ||
      ['paid', 'succeeded'].includes(String(ro.payment_status || '').trim().toLowerCase()) || ro.payment_received === true || Number(ro.payment_received) > 0) {
    fail('Repair order is already paid or has an invalid balance', 400);
  }
  const params = [ro.id, ro.shop_id];
  const attempts = (await client.query('SELECT * FROM ro_payment_attempts WHERE ro_id = $1 AND shop_id = $2', params)).rows;
  const ledger = (await client.query('SELECT * FROM ro_payments WHERE ro_id = $1 AND shop_id = $2', params)).rows;
  if (ledger.some(p => !cents(p.amount_cents)) || attempts.some(p => !cents(p.amount_cents))) fail();
  // Old Checkout links were not persisted. Identifiable dangling provider pointers
  // or unexplained pending state require operator reconciliation, never a new link.
  if ((ro.stripe_payment_intent_id && ![...ledger, ...attempts].some(p => p.stripe_payment_intent_id === ro.stripe_payment_intent_id)) ||
      (String(ro.payment_status).toLowerCase() === 'pending' && !ledger.length && !attempts.length)) fail();
  let occupiedCents = 0;
  for (const attempt of attempts) {
    const payment = ledger.find(p => p.stripe_payment_intent_id && p.stripe_payment_intent_id === attempt.stripe_payment_intent_id);
    if (attempt.status === 'settled') {
      if (!payment || !succeeded(payment) || Number(payment.amount_cents) !== Number(attempt.amount_cents)) fail();
    } else {
      // Even an inconsistent successful ledger cannot silently release an attempt.
      occupiedCents += Number(attempt.amount_cents);
    }
  }
  for (const payment of ledger) {
    if (!succeeded(payment) && !attempts.some(a => a.stripe_payment_intent_id && a.stripe_payment_intent_id === payment.stripe_payment_intent_id)) {
      occupiedCents += Number(payment.amount_cents);
    }
  }
  if (!cents(occupiedCents)) fail();
  return { money, paidCents, remainingCents, occupiedCents, availableCents: remainingCents - occupiedCents };
}

async function reservePayment({ roId, shopId, kind, amount, allowPartial = false }) {
  if (!['intent', 'checkout'].includes(kind)) fail();
  return withLockedRo(roId, shopId, async (client, ro) => {
    const balance = await getPaymentBalance(client, ro);
    if (balance.availableCents <= 0) fail('Payment capacity is already reserved');
    const amountCents = amount === undefined ? balance.availableCents :
      ['number', 'string'].includes(typeof amount) && String(amount).trim() ? Number(amount) : NaN;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) fail('amount must be a positive integer in cents', 400);
    if (amountCents > balance.availableCents) fail('Payment amount exceeds the remaining balance', 400);
    if (amountCents !== balance.availableCents && allowPartial !== true) fail('Payment amount must match the server-calculated amount owed', 400);
    const id = randomUUID(), idempotencyKey = `ro-payment-${id}`;
    await client.query(`INSERT INTO ro_payment_attempts (id, shop_id, ro_id, idempotency_key, amount_cents, kind)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, shopId, roId, idempotencyKey, amountCents, kind]);
    return { id, idempotencyKey, amountCents, remainingCents: balance.remainingCents, ro, kind };
  });
}

function metadataFor(attempt) {
  return { roId: String(attempt.ro.id), shopId: String(attempt.ro.shop_id), roNumber: attempt.ro.ro_number || '',
    paymentAttemptId: attempt.id, amountOwedCents: String(attempt.remainingCents),
    paymentKind: attempt.amountCents === attempt.remainingCents ? 'full' : 'partial' };
}

function providerId(value) { return typeof value === 'string' ? value : value?.id || null; }
async function bindProvider(client, attempt, intentId, sessionId, status) {
  if ((attempt.stripe_payment_intent_id && intentId && attempt.stripe_payment_intent_id !== intentId) ||
      (attempt.stripe_checkout_session_id && sessionId && attempt.stripe_checkout_session_id !== sessionId)) fail();
  await client.query(`UPDATE ro_payment_attempts SET
    stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $1),
    stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $2),
    status = CASE WHEN status = 'settled' THEN status ELSE $3 END, updated_at = NOW()
    WHERE id = $4 AND shop_id = $5 AND ro_id = $6`,
  [intentId, sessionId, status, attempt.id, attempt.shop_id, attempt.ro_id]);
}

// A reserved row is already a conservative hold if this update or the process
// fails. Never release on timeout/error; no automatic retry creates a new object.
async function recordProviderResult(attempt, object) {
  return withLockedRo(attempt.ro.id, attempt.ro.shop_id, async (client) => {
    const row = (await client.query('SELECT * FROM ro_payment_attempts WHERE id = $1 AND shop_id = $2 AND ro_id = $3 FOR UPDATE',
      [attempt.id, attempt.ro.shop_id, attempt.ro.id])).rows[0];
    if (!row || !object?.id) fail();
    await bindProvider(client, row, attempt.kind === 'intent' ? object.id : providerId(object.payment_intent),
      attempt.kind === 'checkout' ? object.id : null, 'open');
  });
}

async function settlePaymentEvent(event) {
  const types = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'checkout.session.completed',
    'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
  if (!types.includes(event.type)) return null;
  const object = event.data.object, metadata = object.metadata || {};
  const roId = metadata.roId, shopId = metadata.shopId;
  // Subscription Checkout belongs to its separate handler, never this RO ledger.
  if (!roId && !shopId && !metadata.paymentAttemptId) return null;
  if (!roId || !shopId) fail();
  const checkout = event.type.startsWith('checkout.');
  const success = event.type === 'payment_intent.succeeded' || event.type === 'checkout.session.async_payment_succeeded' ||
    (event.type === 'checkout.session.completed' && object.payment_status === 'paid');
  const intentId = checkout ? providerId(object.payment_intent) : object.id;
  const sessionId = checkout ? object.id : null;
  const amount = Number(checkout ? object.amount_total : (success ? object.amount_received : object.amount));
  if (!cents(amount) || amount <= 0 || object.currency !== 'usd' || (!intentId && success)) fail();
  return withLockedRo(roId, shopId, async (client, ro) => {
    let attempt;
    if (metadata.paymentAttemptId) {
      attempt = (await client.query('SELECT * FROM ro_payment_attempts WHERE id = $1 AND shop_id = $2 AND ro_id = $3 FOR UPDATE',
        [metadata.paymentAttemptId, shopId, roId])).rows[0];
      if (!attempt) fail();
    } else {
      attempt = (await client.query(`SELECT * FROM ro_payment_attempts WHERE shop_id = $1 AND ro_id = $2
        AND ((stripe_payment_intent_id = $3 AND $3 IS NOT NULL) OR (stripe_checkout_session_id = $4 AND $4 IS NOT NULL)) FOR UPDATE`,
      [shopId, roId, intentId, sessionId])).rows[0];
    }
    if (attempt && (Number(attempt.amount_cents) !== amount || (checkout && attempt.kind !== 'checkout'))) fail();
    // Global unique identity lookup verifies tenant binding before any mutation.
    const payment = intentId ? (await client.query('SELECT * FROM ro_payments WHERE stripe_payment_intent_id = $1 FOR UPDATE', [intentId])).rows[0] : null;
    if (payment && (String(payment.shop_id) !== String(shopId) || String(payment.ro_id) !== String(roId) || Number(payment.amount_cents) !== amount)) fail();
    if (!attempt && !payment) {
      // First observation of a legacy untracked Checkout/intent: retain its full
      // capacity on failures too. Actual historical success must remain accounted.
      attempt = { id: randomUUID(), shop_id: shopId, ro_id: roId, amount_cents: amount };
      await client.query(`INSERT INTO ro_payment_attempts (id, shop_id, ro_id, idempotency_key, amount_cents, kind)
        VALUES ($1,$2,$3,$4,$5,$6)`, [attempt.id, shopId, roId, `legacy-${attempt.id}`, amount, checkout ? 'checkout' : 'intent']);
    }
    if (attempt) await bindProvider(client, attempt, intentId, sessionId, success ? 'settled' : 'retryable');
    if (!success) {
      if (payment && !succeeded(payment)) await client.query(`UPDATE ro_payments SET status = 'failed', failure_message = 'Payment failed', updated_at = NOW()
        WHERE id = $1 AND shop_id = $2 AND ro_id = $3 AND LOWER(COALESCE(status,'')) NOT IN ('paid','succeeded')`, [payment.id, shopId, roId]);
      return null;
    }
    if (payment && succeeded(payment)) return null;
    const paidAt = new Date().toISOString();
    // Carry forward manual money absent from the ledger. Taking max only AFTER
    // inserting would absorb this new payment into the old floor and reopen capacity.
    const previousLedgerPaid = await getPaidCents(roId, shopId, client);
    const previousManualPaid = Number(ro.amount_paid_cents || 0);
    if (!cents(previousLedgerPaid) || !cents(previousManualPaid)) fail();
    const paidCents = Math.max(previousLedgerPaid, previousManualPaid) + amount;
    if (payment) {
      await client.query(`UPDATE ro_payments SET status = 'succeeded', payment_method = 'card', paid_at = $1, updated_at = NOW()
        WHERE id = $2 AND shop_id = $3 AND ro_id = $4`, [paidAt, payment.id, shopId, roId]);
    } else {
      await client.query(`INSERT INTO ro_payments (id, shop_id, ro_id, stripe_payment_intent_id, amount_cents, currency, status, payment_method, paid_at)
        VALUES ($1,$2,$3,$4,$5,'usd','succeeded','card',$6)`, [randomUUID(), shopId, roId, intentId, amount, paidAt]);
    }
    const money = await getRoMoneySummary(roId, shopId, client);
    if (!cents(paidCents) || !cents(money.totalCents)) fail();
    const status = reconcilePaymentStatus({ paidCents, owedCents: money.totalCents });
    await client.query(`UPDATE repair_orders SET payment_status = $1, stripe_payment_intent_id = $2,
      payment_received = $3, payment_received_at = $4, payment_method = 'card', paid_at = $5,
      paid_amount = $6, amount_paid_cents = $7, amount_owed_cents = $8, updated_at = NOW()
      WHERE id = $9 AND shop_id = $10`, [status, intentId, status === 'paid' ? 1 : 0, paidAt, paidAt, amount, paidCents, money.totalCents, roId, shopId]);
    return { roId, shopId, amountPaid: amount, ro };
  });
}

module.exports = { PaymentError, withLockedRo, getPaymentBalance, reservePayment, metadataFor, recordProviderResult, settlePaymentEvent };
