const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearRouteCache(routeName) {
  const routeSegment = `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}${routeName}.js`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(routeSegment)) delete require.cache[key];
  }
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end() {},
  };
}

test('shop logo upload accepts only PDF-safe images and cannot target another shop', async () => {
  clearRouteCache('market');
  const calls = [];
  installMock(require.resolve('../db'), {
    async dbGet(sql, params) {
      calls.push({ kind: 'get', sql: String(sql), params });
      return { id: 'shop-a', logo_url: null };
    },
    async dbAll() { return []; },
    async dbRun(sql, params) {
      calls.push({ kind: 'run', sql: String(sql), params });
      return { rowCount: 1 };
    },
  });
  installMock(require.resolve('../middleware/auth'), (_req, _res, next) => next());
  installMock(require.resolve('../middleware/roles'), { requireAdmin: (_req, _res, next) => next() });
  installMock(require.resolve('../services/sms'), {
    getTwilioConfigForShop: async () => null,
    isConfiguredForShop: async () => false,
  });
  installMock(require.resolve('../services/mediaStorage'), {
    deleteStoredMedia: async () => ({ deleted: true }),
    discardUploadedMedia: async () => ({ discarded: true }),
    persistUploadedFile: async () => ({ mirrored: true }),
  });

  const router = require('../routes/market');
  assert.equal(router._test.isSupportedShopLogoMime('image/jpeg'), true);
  assert.equal(router._test.isSupportedShopLogoMime('image/png'), true);
  assert.equal(router._test.isSupportedShopLogoMime('image/svg+xml'), false);
  assert.equal(router._test.isSupportedShopLogoMime('text/html'), false);

  const layer = router.stack.find((entry) => entry.route?.path === '/shop/logo' && entry.route.methods.post);
  const handler = layer.route.stack.at(-1).handle;
  const req = {
    body: { shop_id: 'shop-b' },
    file: { filename: 'test-shop-logo.jpg' },
    user: { id: 'owner-a', role: 'owner', shop_id: 'shop-a' },
  };
  const res = responseRecorder();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.logo_url, '/uploads/shop-logos/test-shop-logo.jpg');
  const update = calls.find((call) => call.kind === 'run');
  assert.match(update.sql, /WHERE id::text = \$2::text/i);
  assert.deepEqual(update.params, ['/uploads/shop-logos/test-shop-logo.jpg', 'shop-a']);
  assert.equal(update.params.includes('shop-b'), false);
});

test('invoice and repair-order PDFs render exact roMoney cents plus the REVV footer', () => {
  clearRouteCache('invoice');
  const documents = [];
  class FakePdfDocument {
    constructor() {
      this.page = { height: 792 };
      this.y = 50;
      this.textValues = [];
      documents.push(this);
    }
    pipe() { return this; }
    image() { return this; }
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    text(value, x, y) {
      this.textValues.push(String(value));
      if (typeof y === 'number') this.y = y + 12;
      else this.y += 12;
      return this;
    }
    moveDown(amount = 1) { this.y += 12 * amount; return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    stroke() { return this; }
    addPage() { this.page = { height: 792 }; this.y = 50; return this; }
    end() { return this; }
  }

  installMock(require.resolve('pdfkit'), FakePdfDocument);
  installMock(require.resolve('../db'), {
    async dbGet() { return null; },
    async dbAll() { return []; },
  });
  installMock(require.resolve('../middleware/auth'), (_req, _res, next) => next());
  installMock(require.resolve('../services/deliveryFees'), {
    calculateDeliveryFeeBreakdown: async () => ({ total_fee: 0 }),
  });
  installMock(require.resolve('../services/roMoney'), {
    dollarsToCents(value) { return Math.round(Number(value || 0) * 100); },
    getRoMoneySummary: async () => ({ subtotalCents: 12345, taxCents: 678, totalCents: 13023 }),
  });

  const router = require('../routes/invoice');
  const context = {
    ro: {
      id: 'ro-1', ro_number: 'RO-1001', status: 'repair', created_at: '2026-07-10',
      insurance_company: 'Acme Insurance', claim_number: 'CLM-1', deductible: '500.00',
    },
    shop: { name: 'Miles Automotive', address: '100 Main St', city: 'Queens', state: 'NY', zip: '10001' },
    customer: { name: 'Alex Customer', phone: '555-0100', email: 'alex@example.com' },
    vehicle: { year: 2024, make: 'Honda', model: 'Accord', vin: 'VIN1', plate: 'NY1' },
    lineItems: [{ type: 'labor', description: 'Body labor', quantity: 1, unit_price: '123.45', total: '123.45' }],
    moneySummary: { subtotalCents: 12345, taxCents: 678, totalCents: 13023 },
    deliveryFeeBreakdown: { total_fee: 0 },
  };

  router._test.streamDocumentPdf(responseRecorder(), context);
  router._test.streamDocumentPdf(responseRecorder(), context, { documentType: 'repair-order' });

  for (const document of documents) {
    assert.ok(document.textValues.includes('$123.45'));
    assert.ok(document.textValues.includes('$6.78'));
    assert.ok(document.textValues.includes('$130.23'));
    assert.ok(document.textValues.includes('Estimated & tracked with REVV · revvshop.app'));
  }
  assert.ok(documents[1].textValues.includes('REPAIR ORDER'));
  assert.ok(documents[1].textValues.includes('Repair Authorization'));

  const source = fs.readFileSync(require.resolve('../routes/invoice'), 'utf8');
  assert.doesNotMatch(source, /centsToDollars|toMoney|toFixed\(2\)/);
  assert.doesNotMatch(source, /Number\(item\.(?:unit_price|total)/);
});
