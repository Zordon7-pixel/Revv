'use strict';
const { randomUUID } = require('node:crypto');
const { getRoMoneySummary, getPaidCents, reconcilePaymentStatus } = require('./roMoney');

class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message = 'Payment requires manual reconciliation', status = 409) => { throw new PaymentError(message, status); };
const released = row => row.status === 'released';
const succeeded = row => ['paid', 'succeeded'].includes(String(row.status || '').toLowerCase());
const cents = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

// Parent first, matching DELETE RO. All money queries use this transaction client.
async function withLockedRo(roId, shopId, work) {
  const client = await require('../db').pool.connect();
  let result;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Freeze the tax input before reading money. SHARE conflicts with tax updates
    // but lets payments on different ROs proceed concurrently.
    await client.query('SELECT id FROM shops WHERE id = $1 FOR SHARE', [shopId]);
    const ro = (await client.query('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE', [roId, shopId])).rows[0];
    if (!ro) fail('Repair order not found', 404);
    result = await work(client, ro);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  // Expected refusal after provider reconciliation must commit its durable outcome.
  if (result instanceof PaymentError) throw result;
  return result;
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
    } else if (!released(attempt)) {
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
  const hasOpenPayments = attempts.some(a => !['settled', 'released'].includes(a.status)) ||
    ledger.some(p => !succeeded(p) && !attempts.some(a => released(a) && p.stripe_payment_intent_id &&
      a.stripe_payment_intent_id === p.stripe_payment_intent_id));
  return { money, paidCents, remainingCents, occupiedCents, hasOpenPayments, availableCents: remainingCents - occupiedCents };
}

async function reservePayment({ roId, shopId, kind, amount, allowPartial = false }) {
  if (!['intent', 'checkout'].includes(kind)) fail();
  return withLockedRo(roId, shopId, async (client, ro) => {
    await reconcileLocked(client, ro, { reason: 'expiry' });
    try {
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
    } catch (error) { if (error instanceof PaymentError) return error; throw error; }
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
    status = CASE WHEN status IN ('settled', 'released') THEN status ELSE $3 END, updated_at = NOW()
    WHERE id = $4 AND shop_id = $5 AND ro_id = $6`,
  [intentId, sessionId, status, attempt.id, attempt.shop_id, attempt.ro_id]);
}

// A reserved row is already a conservative hold if this update or the process
// fails. Never release on timeout/error; no automatic retry creates a new object.
async function recordProviderResult(attempt, object) {
  return withLockedRo(attempt.ro.id, attempt.ro.shop_id, async (client) => {
    const row = (await client.query('SELECT * FROM ro_payment_attempts WHERE id = $1 AND shop_id = $2 AND ro_id = $3 FOR UPDATE',
      [attempt.id, attempt.ro.shop_id, attempt.ro.id])).rows[0];
    if (!row || !object?.id || released(row)) fail();
    await bindProvider(client, row, attempt.kind === 'intent' ? object.id : providerId(object.payment_intent),
      attempt.kind === 'checkout' ? object.id : null, 'open');
  });
}

async function settlePaymentEvent(event, locked = null) {
  const types = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'checkout.session.completed',
    'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'checkout.session.expired', 'payment_intent.canceled'];
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
  const work = async (client, ro) => {
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
    if (!attempt && (!payment || !succeeded(payment))) {
      // First observation of a legacy untracked Checkout/intent: retain its full
      // capacity on failures too. Actual historical success must remain accounted.
      attempt = { id: randomUUID(), shop_id: shopId, ro_id: roId, amount_cents: amount,
        status: 'reserved', kind: checkout ? 'checkout' : 'intent' };
      await client.query(`INSERT INTO ro_payment_attempts (id, shop_id, ro_id, idempotency_key, amount_cents, kind)
        VALUES ($1,$2,$3,$4,$5,$6)`, [attempt.id, shopId, roId, `legacy-${attempt.id}`, amount, checkout ? 'checkout' : 'intent']);
    }
    if (attempt) {
      if (released(attempt)) {
        // A late success contradicts terminal provider proof: never charge twice or
        // silently revive capacity. Require investigation; retain original evidence.
        if (success) fail();
        return null;
      }
      await bindProvider(client, attempt, intentId, sessionId, success ? 'settled' : 'open');
    }
    if (!success) {
      if (event.type !== 'checkout.session.completed' && payment && !succeeded(payment)) await client.query(`UPDATE ro_payments SET status = 'failed', failure_message = 'Payment failed', updated_at = NOW()
        WHERE id = $1 AND shop_id = $2 AND ro_id = $3 AND LOWER(COALESCE(status,'')) NOT IN ('paid','succeeded')`, [payment.id, shopId, roId]);
      if (attempt && attempt.status !== 'settled' && event.type !== 'checkout.session.completed') {
        await reconcileAttempt(client, ro, { ...attempt, kind: attempt.kind || (checkout ? 'checkout' : 'intent'),
          stripe_payment_intent_id: intentId, stripe_checkout_session_id: sessionId || attempt.stripe_checkout_session_id },
        { reason: 'provider_event', terminalObject: ['checkout.session.expired', 'payment_intent.canceled'].includes(event.type) ? object : null });
      }
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
    Object.assign(ro, { amount_paid_cents: paidCents, payment_status: status, payment_received: status === 'paid' ? 1 : 0 });
    return { roId, shopId, amountPaid: amount, ro };
  };
  return locked ? work(locked.client, locked.ro) : withLockedRo(roId, shopId, work);
}


// Only terminal provider proof releases capacity. In particular requires_payment_method
// still accepts confirmation with the old client secret, so cancel it before retrying.
async function reconcileAttempt(client, ro, attempt, { actorId = null, reason, terminalObject = null }) {
  if (['settled', 'released'].includes(attempt.status)) return;
  let outcome = 'unknown';
  let settledEvent = null;
  try {
    const stripe = require('./stripe').getStripeClient();
    let intentId = attempt.stripe_payment_intent_id;
    const check = (object, id, checkout = false) => {
      if (!object || object.id !== id || object.currency !== 'usd' ||
          Number(checkout ? object.amount_total : object.amount) !== Number(attempt.amount_cents)) fail();
      return object;
    };
    if (attempt.kind === 'checkout') {
      const id = attempt.stripe_checkout_session_id;
      if (!id) fail(); // Create may still be in flight, or its response lost.
      let session = check(terminalObject?.id === id ? terminalObject : await stripe.checkout.sessions.retrieve(id), id, true);
      if (session.status === 'open') session = check(await stripe.checkout.sessions.expire(id), id, true);
      if (!['expired', 'complete'].includes(session.status)) fail();
      const sessionIntent = providerId(session.payment_intent);
      if (intentId && sessionIntent !== intentId) fail();
      intentId = sessionIntent;
      if (!intentId) {
        if (session.status !== 'expired' || session.payment_status === 'paid') fail();
        outcome = 'released';
      }
    }
    if (intentId) {
      let intent = check(terminalObject?.id === intentId ? terminalObject : await stripe.paymentIntents.retrieve(intentId), intentId);
      if (!['canceled', 'succeeded'].includes(intent.status)) intent = check(await stripe.paymentIntents.cancel(intentId), intentId);
      if (intent.status === 'succeeded') {
        settledEvent = { type: 'payment_intent.succeeded', data: { object: { ...intent,
          metadata: { roId: ro.id, shopId: ro.shop_id, paymentAttemptId: attempt.id } } } };
        outcome = 'settled';
      } else if (intent.status === 'canceled') outcome = 'released';
      else fail();
      await bindProvider(client, attempt, intentId, null, attempt.status);
    } else if (outcome !== 'released') fail();
  } catch (error) {
    // Never store provider messages, request bodies, client secrets or customer PII.
    // Cancellation timeouts and unidentified objects remain chargeable until proven otherwise.
    outcome = 'unknown';
  }
  if (settledEvent) await settlePaymentEvent(settledEvent, { client, ro });
  await client.query(`UPDATE ro_payment_attempts SET status = $1, updated_at = NOW()
    WHERE id = $2 AND shop_id = $3 AND ro_id = $4 AND status NOT IN ('settled','released')`,
  [outcome, attempt.id, ro.shop_id, ro.id]);
  await client.query(`INSERT INTO ro_payment_attempt_audit
    (id, shop_id, ro_id, attempt_id, actor_id, action, prior_state, outcome)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [randomUUID(), ro.shop_id, ro.id, attempt.id, actorId, reason, attempt.status, outcome]);
}

async function reconcileLocked(client, ro, { actorId = null, reason = 'staff' } = {}) {
  const args = [ro.id, ro.shop_id];
  const attempts = (await client.query('SELECT * FROM ro_payment_attempts WHERE ro_id = $1 AND shop_id = $2', args)).rows;
  const ledger = (await client.query('SELECT * FROM ro_payments WHERE ro_id = $1 AND shop_id = $2', args)).rows;
  // Adopt identifiable historical attempts; retaining their rows preserves history.
  for (const payment of ledger) {
    if (succeeded(payment) || !payment.stripe_payment_intent_id || !cents(payment.amount_cents) || Number(payment.amount_cents) <= 0 ||
        attempts.some(a => a.stripe_payment_intent_id === payment.stripe_payment_intent_id)) continue;
    const attempt = { id: randomUUID(), shop_id: ro.shop_id, ro_id: ro.id, kind: 'intent',
      amount_cents: payment.amount_cents, status: 'reserved', created_at: payment.created_at,
      stripe_payment_intent_id: payment.stripe_payment_intent_id };
    await client.query(`INSERT INTO ro_payment_attempts (id, shop_id, ro_id, idempotency_key, amount_cents, kind)
      VALUES ($1,$2,$3,$4,$5,$6)`, [attempt.id, ro.shop_id, ro.id, `legacy-${attempt.id}`, attempt.amount_cents, 'intent']);
    await bindProvider(client, attempt, payment.stripe_payment_intent_id, null, 'unknown');
    attempt.status = 'unknown';
    attempts.push(attempt);
  }
  for (const attempt of attempts) {
    if (reason !== 'expiry' || ['retryable', 'unknown'].includes(attempt.status) ||
        new Date(attempt.created_at).getTime() <= Date.now() - 24 * 60 * 60 * 1000) {
      await reconcileAttempt(client, ro, attempt, { actorId, reason });
    }
  }
}

async function reconcileReservations({ roId, shopId, actorId }) {
  return withLockedRo(roId, shopId, async (client, ro) => {
    await reconcileLocked(client, ro, { actorId, reason: 'staff' });
    const rows = (await client.query('SELECT * FROM ro_payment_attempts WHERE ro_id = $1 AND shop_id = $2', [roId, shopId])).rows;
    const ledger = (await client.query('SELECT * FROM ro_payments WHERE ro_id = $1 AND shop_id = $2', [roId, shopId])).rows;
    const unresolved = rows.some(a => !['settled', 'released'].includes(a.status)) ||
      ledger.some(p => !succeeded(p) && !rows.some(a => released(a) && p.stripe_payment_intent_id && a.stripe_payment_intent_id === p.stripe_payment_intent_id)) ||
      (ro.stripe_payment_intent_id && ![...rows, ...ledger].some(p => p.stripe_payment_intent_id === ro.stripe_payment_intent_id)) ||
      (String(ro.payment_status).toLowerCase() === 'pending' && !rows.length && !ledger.length);
    if (unresolved) return new PaymentError('Payment requires manual reconciliation', 409);
    return { reconciled: true };
  });
}

// Bulk reset preflights every locked RO before deleting any child. Keep the
// whole existing reset in this transaction so late FK/trigger failures are atomic.
async function withLockedShopDeletion(shopId, work) {
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const ros = (await client.query('SELECT id FROM repair_orders WHERE shop_id = $1 ORDER BY id FOR UPDATE', [shopId])).rows;
    for (const ro of ros) await client.query('SELECT revv_assert_ro_deletable($1::text, $2::text)', [shopId, ro.id]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23514' && ['RO_HISTORY_PROTECTED', 'RO_FINANCIAL_HOLD'].includes(error.message)) {
      throw new PaymentError('Cannot reset data with payment, reservation, approval, claim, agreement or panel history', 409);
    }
    throw error;
  } finally { client.release(); }
}

module.exports = { reconcileLocked, reconcileReservations, withLockedShopDeletion, PaymentError, withLockedRo, getPaymentBalance, reservePayment, metadataFor, recordProviderResult, settlePaymentEvent };
