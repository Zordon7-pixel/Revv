'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../src');
const shopId = 'synthetic-shop';
const plain = value => JSON.parse(JSON.stringify(value));
const noop = (_req, _res, next) => next?.();

// Closed dependency graph. Actual resolver and transports, synthetic rows and
// providers only; neither application DB/config nor any installed SDK may load.
function harness(flag = false) {
  const state = { flag, queries: [], writes: [], fetches: [], messages: [], transports: [],
    sdkLoads: 0, logs: [], pending: [], tokens: 0, checkouts: 0 };
  const env = { NODE_ENV: 'production', RESEND_API_KEY: 'synthetic-key',
    EMAIL_HOST: 'smtp.example.invalid', EMAIL_USER: 'synthetic-user', EMAIL_PASS: 'synthetic-password',
    EMAIL_PORT: '465', EMAIL_FROM: 'sender@example.invalid', JWT_SECRET: 'synthetic-signing-material',
    DISCORD_WEBHOOK_URL: 'https://discord.example.invalid', OPS_DISCORD_WEBHOOK: 'https://ops.example.invalid' };
  const ro = { id: 'ro', shop_id: shopId, ro_number: 'RO-TEST', status: 'closed', payment_status: 'paid',
    total: 123.45, customer_id: 'customer', customer_email: 'customer@example.invalid', customer_name: 'Customer',
    shop_name: 'Synthetic Shop', email_notifications_enabled: true, customer_email_consent: true,
    updated_at: '2026-10-21T12:00:00Z' };
  const db = {
    async dbAll(sql, params) {
      state.queries.push({ sql, params });
      if (sql.includes('is_internal_test_shop')) {
        assert.equal(sql, 'SELECT id::text AS id, is_internal_test_shop FROM shops WHERE id::text = $1');
        if (state.policyFailure) throw Error('synthetic-db-failure');
        return state.rows ?? (params[0] === shopId ? [{ id: shopId, is_internal_test_shop: state.flag }] : []);
      }
      await state.onRead?.(sql);
      if (sql.includes('FROM users')) return [{ id: 'owner', email: 'owner@example.invalid' }];
      if (sql.includes('FROM owner_activity_events')) return [];
      throw Error(`Unexpected dbAll: ${sql}`);
    },
    async dbGet(sql, params) {
      state.queries.push({ sql, params });
      await state.onRead?.(sql);
      if (sql.includes('FROM users')) return state.noUser ? null : { id: 'owner', email: 'owner@example.invalid', shop_id: shopId, name: 'Owner' };
      if (sql.includes('FROM password_reset_tokens')) return { id: 'reset', user_id: 'owner' };
      if (sql.includes('FROM shop_notification_preferences')) return {
        owner_activity_digest_enabled: true, owner_activity_immediate_alerts_enabled: true,
        owner_activity_digest_recipients: 'override@example.invalid' };
      if (sql.includes('FROM shops')) return { name: 'Synthetic Shop', id: shopId };
      if (sql.includes('FROM portal_tokens')) { state.tokens++; return { token: 'synthetic-tracking' }; }
      if (sql.includes('FROM repair_orders')) return ro;
      if (sql.includes('FROM customers')) return { email: ro.customer_email, name: 'Customer' };
      throw Error(`Unexpected dbGet: ${sql}`);
    },
    async dbRun(sql, params) { state.writes.push({ sql, params }); return { rowCount: 1 }; },
  };
  const cache = {};
  function load(file, mocks = {}, suffix = '') {
    const module = { exports: {} };
    const filename = path.join(root, file);
    vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n${suffix}\n})`, {
      console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => state.logs.push(args)])),
      process: { env }, Buffer, setTimeout, clearTimeout, AbortController,
      setImmediate: callback => state.pending.push(callback),
      fetch: async (url, options) => {
        state.fetches.push({ url, options });
        if (state.fetchError) throw Error('synthetic-network-error');
        return { ok: state.fetchOk !== false, status: state.fetchOk === false ? 429 : 200,
          json: async () => ({ id: '12345678-1234-1234-1234-123456789abc', message: 'synthetic-provider-error' }) };
      },
    }, { filename })(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === '../db') return db;
      if (name === 'crypto') return crypto;
      if (name === 'uuid') return { v4: () => 'synthetic-id' };
      if (name === 'nodemailer') {
        state.sdkLoads++;
        return { createTransport(options) {
          state.transports.push(options);
          return { async sendMail(message) {
            state.messages.push(message);
            await state.onSend?.();
            if (state.smtpError) throw Error('synthetic-smtp-error');
          } };
        } };
      }
      if (['./shopPolicy', '../services/shopPolicy', './mailer', '../services/mailer', './email',
        './emailTemplates', '../services/emailTemplates', '../utils/discord'].includes(name)) {
        const target = name.includes('discord') ? 'utils/discord.js' : `services/${path.basename(name)}.js`;
        return cache[target] ||= load(target);
      }
      throw Error(`Forbidden dependency: ${name} in ${file}`);
    }, module, module.exports);
    return module.exports;
  }
  async function drain() {
    while (state.pending.length) await state.pending.shift()();
    // A host event-loop turn drains the real fire-and-forget promise chains.
    // Counting microtasks is insufficient when a recipient adds another await.
    await new Promise(resolve => setImmediate(resolve));
  }
  const mailer = load('services/mailer.js');
  const email = load('services/email.js');
  function router(file, extra = {}, suffix = '') {
    const routes = [], r = { use() {} };
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) r[method] = (url, ...handlers) => routes.push({ method, url, handlers });
    const result = load(file, { express: { Router: () => r }, 'express-rate-limit': () => noop,
      '../middleware/auth': noop, '../middleware/roles': { requireAdmin: noop, requireTechnician: noop, ROLE_RANK: {} },
      bcryptjs: { hashSync: () => 'synthetic-hash', compare: async () => true },
      jsonwebtoken: { sign: () => 'synthetic-jwt' },
      '../services/publicShop': { newPublicIntakeSlug: () => 'synthetic-slug' }, ...extra }, suffix);
    return { result, async call(url, body = {}, user = { id: 'owner', shop_id: shopId }) {
      const handler = routes.find(r => r.method === 'post' && r.url === url)?.handlers.at(-1);
      assert.ok(handler, url);
      const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
      await handler({ body, user, params: { id: 'ro' }, headers: { 'stripe-signature': 'synthetic' } }, res);
      await drain();
      return res;
    } };
  }
  function billing() {
    return load('services/customerBilling.js', {
      './stripe': { getStripeClient() { assert.fail('No billing provider permitted'); } },
      './roMoney': {}, './paymentReservations': {},
    });
  }
  function ros() {
    return router('routes/ros.js', {
      '../services/customerConsent': {}, '../services/panelEstimatorEconomics': {
        selectedEconomics: async () => new Map(), redactSelectedRO: r => r },
      // This harness isolates email boundaries; profit policy is exercised by
      // remainingParityPolicy with the actual guarded calculator and DB rows.
      '../services/profit': { calculatePersistedProfit: async () => ({}) }, '../services/roMoney': {},
      '../services/paymentReservations': { PaymentError: class extends Error {},
        withLockedRo: async (_id, _shop, action) => action({ query: db.dbRun }, ro) },
      '../services/sms': {}, '../services/ownerActivity': {}, '../services/notifications': {},
      '../services/deliveryFees': {}, '../services/quickbooks': {}, '../services/customerOptInConfirmation': {},
      '../middleware/roLimitGuard': noop, './insuranceOcr': { insuranceOcrLimiter: noop },
      '../services/panelEstimatorApproval': { panelPublicHandler: () => noop, publicRequestError: () => noop },
      '../services/customerBilling': {
        ensureTrackingToken: async () => { state.tokens++; return 'synthetic-tracking'; },
        createPaymentCheckoutLinkForRo: async () => { state.checkouts++; return { ok: true, url: 'https://payment.example.invalid' }; },
      },
    }, 'module.exports.testQueues = { queueStatusEmail, queueClosedReviewEmail };');
  }
  return { state, env, ro, db, load, mailer, email, router, billing, ros, drain };
}
function zero(h) {
  assert.equal(h.state.sdkLoads, 0);
  assert.equal(h.state.transports.length, 0);
  assert.equal(h.state.messages.length, 0);
  assert.equal(h.state.fetches.length, 0);
}
async function deniedMail(h, id, reason) {
  await assert.rejects(h.mailer.sendMail('fixture+ordinary@example.invalid', 'Subject', '<p>Body</p>', id), error =>
    error.reason === reason && error.suppressed === true && error.provider_attempted === false);
  const result = await h.email.sendEmail('fixture+ordinary@example.invalid', 'Subject', '<p>Body</p>', id);
  assert.equal(result.reason, reason); assert.equal(result.provider_attempted, false);
  zero(h);
}

test('flagged transports deny before SDK import/construction/network regardless of recipient', async () => {
  await deniedMail(harness(true), shopId, 'INTERNAL_TEST_SHOP');
});
for (const id of [undefined, null, '', ' synthetic-shop', 1, { shopId, is_internal_test_shop: false, operational: true }]) {
  test(`untrusted or missing tenancy fails closed (${JSON.stringify(id)})`, async () => {
    await deniedMail(harness(), id, 'SHOP_POLICY_UNAVAILABLE');
  });
}
for (const rows of [[], [{ id: 'other', is_internal_test_shop: false }],
  [{ id: shopId, is_internal_test_shop: false }, { id: shopId, is_internal_test_shop: false }],
  ...[null, undefined, 0, 'false', {}].map(flag => [{ id: shopId, is_internal_test_shop: flag }])]) {
  test(`unresolved persisted policy fails closed (${JSON.stringify(rows)})`, async () => {
    const h = harness(); h.state.rows = rows;
    await deniedMail(h, shopId, 'SHOP_POLICY_UNAVAILABLE');
  });
}
test('database failure fails closed without external error notification', async () => {
  const h = harness(); h.state.policyFailure = true;
  await deniedMail(h, shopId, 'SHOP_POLICY_UNAVAILABLE');
});
test('ordinary Resend preserves payload, recipients and response', async () => {
  const h = harness();
  const recipients = ['fixture+test@example.invalid', 'staff@example.invalid'];
  assert.equal((await h.mailer.sendMail(recipients, 'Subject', '<p>Body</p>', shopId)).id, '12345678-1234-1234-1234-123456789abc');
  const call = h.state.fetches[0];
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.deepEqual(plain(call.options), { method: 'POST', headers: {
    Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'REVV <noreply@revvshop.app>', to: recipients, subject: 'Subject', html: '<p>Body</p>' }) });
  await h.mailer.sendMail(recipients[0], 'Subject', '<p>Body</p>', shopId);
  assert.deepEqual(JSON.parse(h.state.fetches[1].options.body).to, [recipients[0]]);
});
test('ordinary SMTP preserves options, content, return values and failure semantics', async () => {
  const h = harness();
  assert.deepEqual(plain(await h.email.sendEmail('owner@example.invalid', 'Subject', '<p>Body</p>', shopId)), { ok: true });
  assert.deepEqual(plain(h.state.transports), [{ host: 'smtp.example.invalid', port: 465, secure: true,
    auth: { user: 'synthetic-user', pass: 'synthetic-password' } }]);
  assert.deepEqual(plain(h.state.messages), [{ from: 'sender@example.invalid', to: 'owner@example.invalid', subject: 'Subject', html: '<p>Body</p>' }]);
  h.state.smtpError = true;
  assert.deepEqual(plain(await h.email.sendEmail('owner@example.invalid', 'Subject', 'Body', shopId)), { ok: false, error: 'send_failed' });
});
test('ordinary absent-provider behavior remains intact; fixture is suppressed even without config', async () => {
  for (const flag of [false, true]) {
    const h = harness(flag); delete h.env.EMAIL_HOST; delete h.env.RESEND_API_KEY;
    const mailer = h.load('services/mailer.js');
    if (flag) await assert.rejects(mailer.sendMail('x', 's', 'h', shopId), { reason: 'INTERNAL_TEST_SHOP' });
    else assert.equal(await mailer.sendMail('x', 's', 'h', shopId), null);
    const result = await h.email.sendEmail('x', 's', 'h', shopId);
    assert.equal(flag ? result.reason : result.error, flag ? 'INTERNAL_TEST_SHOP' : 'no_provider_configured');
    h.env.NODE_ENV = 'development';
    const dev = await h.email.sendEmail('x', 's', 'h', shopId);
    assert.equal(flag ? dev.suppressed : dev.simulated, true); zero(h);
  }
});
test('Resend failures retain rejection and never fall back to another provider', async () => {
  for (const failure of ['fetchError', 'fetchOk']) {
    const h = harness(); h.state[failure] = failure === 'fetchError';
    await assert.rejects(h.mailer.sendMail('x', 's', 'h', shopId));
    assert.equal(h.state.fetches.length, 1); assert.equal(h.state.sdkLoads, 0);
  }
});
test('SMTP status, estimate and review helpers forward tenancy and retain ordinary content', async () => {
  for (const flag of [false, true]) {
    const h = harness(flag);
    await h.email.sendStatusUpdate('c', 'Customer', 'RO-1', 'repair', 'Shop', shopId);
    await h.email.sendEstimateLink('c', 'Customer', '/estimate', 'Shop', 'Repair', 10, shopId);
    await h.email.sendReviewRequest('c', 'Customer', 'Shop', '/review', shopId);
    if (flag) zero(h);
    else {
      assert.equal(h.state.messages.length, 3);
      assert.match(h.state.messages[0].html, /in repair/);
      assert.match(h.state.messages[1].html, /\$10.00/);
      assert.match(h.state.messages[2].html, /href="\/review"/);
    }
  }
});
for (const flag of [false, true]) {
  test(`password reset uses persisted user tenancy and retains generic response/token semantics (${flag})`, async () => {
    const h = harness(flag), auth = h.router('routes/auth.js');
    const res = await auth.call('/forgot-password', { email: ' Owner@Example.invalid ', shop_id: 'forged', is_internal_test_shop: !flag });
    assert.equal(res.statusCode, 200); assert.deepEqual(plain(res.body), { ok: true });
    assert.equal(h.state.writes.length, 1); assert.match(h.state.writes[0].sql, /INSERT INTO password_reset_tokens/);
    assert.equal(h.state.writes[0].params[1], 'owner'); assert.equal(h.state.writes[0].params[2].length, 64);
    if (flag) zero(h);
    else {
      const payload = JSON.parse(h.state.fetches[0].options.body);
      assert.deepEqual(payload.to, ['owner@example.invalid']); assert.equal(payload.subject, 'Reset your REVV password');
      assert.match(payload.html, /This link expires in 1 hour/);
    }
    const reset = await auth.call('/reset-password', { token: 'synthetic', password: 'synthetic-password' });
    assert.deepEqual(plain(reset.body), { ok: true });
    assert.match(h.state.writes[1].sql, /UPDATE users SET password_hash/);
    assert.match(h.state.writes[2].sql, /UPDATE password_reset_tokens SET used = 1/);
  });
  test(`RO asynchronous status/review, invoice and manager email (${flag})`, async () => {
    const h = harness(flag), router = h.ros();
    router.result.testQueues.queueStatusEmail('ro', shopId, 'delivery');
    await h.drain();
    await router.result.testQueues.queueClosedReviewEmail('ro');
    await h.drain();
    const invoice = await router.call('/:id/email-invoice');
    assert.equal(invoice.statusCode, flag ? 409 : 200);
    if (flag) assert.deepEqual(plain(invoice.body), { error: 'INTERNAL_TEST_SHOP', excluded: true });
    const approval = await router.call('/:id/approve-estimate');
    assert.equal(approval.statusCode, 200);
    if (flag) { zero(h); assert.equal(h.state.tokens, 0); assert.equal(h.state.checkouts, 0); }
    else {
      assert.equal(h.state.fetches.length, 4);
      const payloads = h.state.fetches.map(c => JSON.parse(c.options.body));
      assert.deepEqual(payloads.map(p => p.to), [[h.ro.customer_email], [h.ro.customer_email], [h.ro.customer_email], ['owner@example.invalid']]);
      assert.match(payloads[1].html, /Leave a Star Rating/); assert.match(payloads[2].html, /123.45/);
      assert.equal(payloads[3].subject, 'Estimate Approved - RO-TEST');
    }
  });
  test(`closed-paid billing email including force records only permitted delivery (${flag})`, async () => {
    const h = harness(flag), billing = h.billing();
    if (flag) {
      await assert.rejects(billing.sendClosedPaidInvoiceEmail({ roId: 'ro', shopId, force: true }), { reason: 'INTERNAL_TEST_SHOP' });
      zero(h); assert.equal(h.state.tokens, 0); assert.equal(h.state.writes.length, 0);
    } else {
      assert.equal((await billing.sendClosedPaidInvoiceEmail({ roId: 'ro', shopId, force: true })).sent, true);
      assert.equal(h.state.fetches.length, 1); assert.equal(h.state.writes.length, 1);
      assert.match(h.state.writes[0].sql, /invoice_emailed_at.*WHERE id = \$2 AND shop_id = \$3/);
      h.ro.invoice_emailed_at = 'already';
      assert.equal((await billing.sendClosedPaidInvoiceEmail({ roId: 'ro', shopId })).reason, 'already_sent');
      assert.equal(h.state.fetches.length, 1);
    }
  });
  test(`owner digest override and fire-and-forget critical alert (${flag})`, async () => {
    const h = harness(flag), owner = h.load('services/ownerActivity.js');
    const result = await owner.sendOwnerActivityDigest({ shopId, since: '2026-10-20', until: '2026-10-21', recipientOverride: ['OVERRIDE@example.invalid'] });
    assert.equal(result.sent, flag ? 0 : 1);
    await owner.recordOwnerActivity({ shopId, eventType: 'closed', severity: 'critical', summary: 'Closed RO' });
    await h.drain();
    if (flag) zero(h);
    else {
      assert.deepEqual(h.state.messages.map(m => m.to), ['override@example.invalid', 'owner@example.invalid', 'override@example.invalid']);
      assert.match(h.state.messages[0].subject, /daily activity digest/);
      assert.match(h.state.messages[1].subject, /owner alert/);
    }
  });
}
test('unknown reset user retains generic response without side effects', async () => {
  const h = harness(); h.state.noUser = true;
  assert.deepEqual(plain((await h.router('routes/auth.js').call('/forgot-password', { email: 'missing@example.invalid' })).body), { ok: true });
  assert.equal(h.state.writes.length, 0); zero(h);
});
test('late fixture flag after RO preparation prevents send, including payment-link branch', async () => {
  const h = harness(), router = h.ros(); h.ro.payment_status = 'unpaid';
  h.state.onRead = async sql => { if (sql.includes('FROM repair_orders')) h.state.flag = true; };
  router.result.testQueues.queueStatusEmail('ro', shopId, 'delivery');
  await h.drain(); zero(h);
  assert.equal(h.state.checkouts, 0);
});
test('late billing policy change prevents invoice marker after asynchronous preparation', async () => {
  const h = harness(); h.state.onRead = async sql => { if (sql.includes('FROM portal_tokens')) h.state.flag = true; };
  await assert.rejects(h.billing().sendClosedPaidInvoiceEmail({ roId: 'ro', shopId }), { reason: 'INTERNAL_TEST_SHOP' });
  assert.equal(h.state.writes.length, 0); zero(h);
});
test('owner sends recheck after preference reads and between recipients', async () => {
  const h = harness(), owner = h.load('services/ownerActivity.js');
  h.state.onRead = async () => { h.state.flag = true; };
  const late = await owner.sendOwnerActivityDigest({ shopId, since: '2026-10-20', until: '2026-10-21' });
  assert.equal(late.ok, false); assert.equal(late.sent, 0); zero(h);
  h.state.onRead = null; h.state.flag = false; h.state.onSend = async () => { h.state.flag = true; };
  const between = await owner.sendImmediateOwnerActivityAlert({ shopId, summary: 'Synthetic' });
  assert.equal(between.sent, 1); assert.equal(between.ok, false); assert.equal(h.state.messages.length, 1);
});
test('Discord/ops deny flagged, unresolved, forged and late failure contexts before network/throttle', async () => {
  const h = harness(true), discord = h.load('utils/discord.js'), ops = h.load('services/notifyOps.js');
  const embed = { title: 'Synthetic', shopId, is_internal_test_shop: false, operational: true };
  for (const id of [shopId, undefined, 'unknown']) {
    assert.equal((await discord.sendDiscordEmbed(embed, id)).provider_attempted, false);
    assert.equal((await ops.notifyOps('high', 'SYNTHETIC_FAILURE', { shop_id: id })).provider_attempted, false);
  }
  zero(h);
  h.state.flag = false;
  await ops.notifyOps('high', 'SYNTHETIC_FAILURE', { shop_id: shopId, ro_id: 'ro' });
  assert.equal(h.state.fetches.length, 1, 'suppressed alerts did not consume throttle');
  h.state.flag = true; // Simulated async OCR failure after an earlier ordinary read.
  assert.equal((await ops.notifyOps('high', 'LATE_FAILURE', { shop_id: shopId })).reason, 'INTERNAL_TEST_SHOP');
  assert.equal(h.state.fetches.length, 1);
});
test('ordinary Discord and ops preserve payload, sanitization and cooldown', async () => {
  const h = harness(), discord = h.load('utils/discord.js'), ops = h.load('services/notifyOps.js');
  await discord.sendDiscordEmbed({ title: 'Title', description: 'Description', footer: 'Footer', fields: [{ name: 'Name', value: 'Value' }] }, shopId);
  const embed = JSON.parse(h.state.fetches[0].options.body).embeds[0];
  assert.equal(embed.title, 'Title'); assert.equal(embed.description, 'Description'); assert.equal(embed.footer.text, 'Footer');
  assert.equal(embed.color, 0x6366f1); assert.ok(embed.timestamp);
  await ops.notifyOps('high', 'SYNTHETIC', { shop_id: shopId, ro_id: 'ro', secret: 'never-external' });
  await ops.notifyOps('high', 'SYNTHETIC', { shop_id: shopId, ro_id: 'ro' });
  assert.equal(h.state.fetches.length, 2);
  assert.equal(JSON.parse(h.state.fetches[1].options.body).content, `[OPS:high] SYNTHETIC :: ${JSON.stringify({ shop_id: shopId, ro_id: 'ro' })}`);
});
test('public prospects retain alerts; body identity cannot suppress or classify test traffic', async () => {
  const h = harness();
  for (const file of ['routes/leads.js', 'routes/waitlist.js']) {
    const router = h.router(file, { '../db/postgres': { pool: null } });
    const result = await router.call('/', { name: 'Synthetic', email: 'fixture+test@example.invalid', shopId,
      shop_id: shopId, is_internal_test_shop: false, operational: true }, null);
    assert.equal(result.statusCode, 200);
  }
  assert.equal(h.state.fetches.length, 2, 'ordinary anonymous prospects retain Discord alerts');
  assert.equal(h.state.queries.length, 0, 'body tenancy never reaches the policy resolver');
  const hold = fs.readFileSync(path.join(root, 'db/internalTestShop.js'), 'utf8');
  assert.match(hold, /DROP CONSTRAINT shops_internal_test_shop_hold/);
  assert.doesNotMatch(hold, /verifyExistingFixtures/);
  const form = fs.readFileSync(path.join(root, '../../frontend/src/components/LeadCaptureForm.jsx'), 'utf8');
  assert.match(form, /addDoc/); // Explicit unresolved bypass: these public flows remain unsupported for fixtures.
});

test('payment receipt supports ordinary mail; fixture/unavailable callbacks stop before notifications', async () => {
  for (const flag of [false, true, null]) {
    const h = harness(flag);
    let notifications = 0, invoices = 0;
    const router = h.router('routes/payments.js', {
      '../services/notifications': { createNotification: async () => { notifications++; } },
      '../services/stripe': { constructWebhookEvent: () => ({ id: 'synthetic-event' }) },
      '../services/customerBilling': { sendClosedPaidInvoiceEmail: async () => { invoices++; } },
      '../services/paymentReservations': { settlePaymentEvent: async () => ({ roId: 'ro', shopId, ro: h.ro, amountPaid: 100 }) },
      '../services/roMoney': {},
    });
    const result = await router.call('/webhook');
    assert.equal(result.statusCode, flag === false ? 200 : flag === true ? 409 : 503);
    if (flag !== false) {
      zero(h);
      assert.equal(result.body.reason, flag === true ? 'INTERNAL_TEST_SHOP' : 'SHOP_POLICY_UNAVAILABLE');
      assert.equal(result.body.excluded, true);
      assert.equal(notifications, 0); assert.equal(invoices, 0); assert.equal(h.state.writes.length, 0);
    } else {
      assert.equal(h.state.fetches.length, 1);
      const payload = JSON.parse(h.state.fetches[0].options.body);
      assert.deepEqual(payload.to, [h.ro.customer_email]);
      assert.match(payload.html, /\$1\.00/);
      assert.equal(notifications, 1); assert.equal(invoices, 1);
      assert.ok(h.state.queries.filter(q => q.sql.includes('is_internal_test_shop')).every(q => q.params[0] === shopId));
    }
  }
});
test('parts email records ordinary acceptance; fixture/unavailable policy has zero effects', async () => {
  for (const flag of [false, true, null]) {
    const h = harness(flag);
    const parts = h.load('services/partsNotifications.js', {
      './customerConsent': h.load('services/customerConsent.js'),
      './partsDelivery': { ensureDelivery: async () => {} },
    });
    const before = { status: 'ordered', part_name: 'Synthetic part', quantity: 1 };
    const after = { ...before, status: 'shipped' };
    const writes = [];
    const db = { async query(sql, params) {
      if (sql.includes('is_internal_test_shop')) return { rows: await h.db.dbAll(sql, params) };
      if (sql.startsWith('SELECT e.')) return { rows: [{ before_state: before, after_state: after,
        customer_id: 'customer', email: 'customer@example.invalid', email_consent: true, preferred_contact_method: 'email' }] };
      writes.push({ sql, params });
      return { rowCount: 1, rows: [] };
    } };
    const result = await parts.notifyPartUpdate(db, shopId, { id: 'part', delivery_revision: 2 }, 1);
    if (flag !== false) {
      zero(h);
      assert.deepEqual(plain(result), { status: 'suppressed',
        reason: flag === true ? 'INTERNAL_TEST_SHOP' : 'SHOP_POLICY_UNAVAILABLE', channels: [] });
      assert.deepEqual(writes, []);
    } else {
      assert.equal(h.state.fetches.length, 1);
      assert.deepEqual(JSON.parse(h.state.fetches[0].options.body).to, ['customer@example.invalid']);
      assert.deepEqual(plain(result.channels.find(c => c.channel === 'email')),
        { channel: 'email', status: 'accepted', provider_reference: '12345678-1234-1234-1234-123456789abc' });
      const recorded = writes.find(w => w.sql.startsWith('UPDATE parts_delivery_notifications'));
      assert.deepEqual(JSON.parse(recorded.params[3]), plain(result));
      assert.equal(writes.some(w => w.sql.startsWith('DELETE FROM parts_notification_cooldowns')), false);
    }
  }
});
test('registration notification uses newly persisted shop ID, never body tenancy', async () => {
  const h = harness();
  h.state.noUser = true;
  h.state.rows = [{ id: 'synthetic-id', is_internal_test_shop: false }];
  const result = await h.router('routes/auth.js').call('/shop-register', {
    name: 'Owner', shop_name: 'Synthetic Shop', email: 'owner@example.invalid', password: 'synthetic-password',
    shopId: 'forged', shop_id: 'forged', is_internal_test_shop: true,
  });
  assert.equal(result.statusCode, 201);
  assert.match(h.state.writes[0].sql, /is_internal_test_shop\) VALUES.*FALSE/);
  assert.equal(h.state.fetches.length, 1);
  assert.equal(h.state.queries.find(q => q.sql.includes('is_internal_test_shop')).params[0], 'synthetic-id');
});
test('ops/Discord policy lookup failure has no global external fallback', async () => {
  const h = harness(); h.state.policyFailure = true;
  assert.equal((await h.load('services/notifyOps.js').notifyOps('high', 'SYNTHETIC', { shop_id: shopId })).reason, 'SHOP_POLICY_UNAVAILABLE');
  assert.equal((await h.load('utils/discord.js').sendDiscordEmbed({ title: 'Synthetic' }, shopId)).reason, 'SHOP_POLICY_UNAVAILABLE');
  zero(h);
});

test('ordinary unpaid status preserves checkout-link branch and email consent gates', async () => {
  for (const consent of [true, false]) {
    const h = harness(); h.ro.payment_status = 'unpaid'; h.ro.customer_email_consent = consent;
    h.ros().result.testQueues.queueStatusEmail('ro', shopId, 'delivery');
    await h.drain();
    assert.equal(h.state.checkouts, consent ? 1 : 0);
    assert.equal(h.state.fetches.length, consent ? 1 : 0);
    if (consent) assert.match(JSON.parse(h.state.fetches[0].options.body).html, /https:\/\/payment.example.invalid/);
  }
});
test('all SMTP helpers refuse omitted scope instead of simulating/sending', async () => {
  const h = harness();
  const results = await Promise.all([
    h.email.sendStatusUpdate('c', 'Customer', 'RO-1', 'repair', 'Shop'),
    h.email.sendEstimateLink('c', 'Customer', '/estimate', 'Shop', 'Repair', 10),
    h.email.sendReviewRequest('c', 'Customer', 'Shop', '/review'),
  ]);
  assert.ok(results.every(r => r.reason === 'SHOP_POLICY_UNAVAILABLE' && r.provider_attempted === false));
  zero(h);
});
