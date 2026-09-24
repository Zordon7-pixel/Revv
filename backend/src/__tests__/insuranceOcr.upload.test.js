const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');

function mock(moduleName, value) {
  const id = require.resolve(moduleName);
  require.cache[id] = { id, filename: id, loaded: true, exports: value };
}

let aiCalls = [];
let aiResult;
let aiRaw;
mock('../middleware/auth', (req, _res, next) => {
  req.user = { id: 'test-user', shop_id: 'test-shop' };
  next();
});
mock('pdf-parse', async (buffer) => ({ text: buffer.toString('utf8') }));
mock('openai', class {
  chat = { completions: { create: async (payload) => {
    aiCalls.push(payload);
    return { choices: [{ message: { content: aiRaw ?? JSON.stringify(aiResult) } }] };
  } } };
});

const router = require('../routes/insuranceOcr');
const { parseCccEstimate } = require('../services/cccExtractor');
const ccc = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ccc-estimate-totals.txt'), 'utf8');

async function upload(files, run) {
  const app = express();
  app.use('/parse-estimate', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    for (const file of files) {
      form.append('estimate_images', new Blob([file.content], { type: file.type }), file.name);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/parse-estimate/parse`, {
      method: 'POST', body: form,
    });
    await run(response, await response.json());
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('estimate uploads retain all sources and report actionable upload errors', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });

  await t.test('partial CCC rows enter AI recovery', async () => {
    aiCalls = [];
    aiResult = parseCccEstimate(ccc);
    await upload([{ name: 'estimate.pdf', type: 'application/pdf', content: ccc.replace(/^2\s+.+$/m, '2 unreadable estimate row') }], async (res, body) => {
      assert.equal(res.status, 200);
      assert.equal(aiCalls.length, 1);
      assert.equal(body.parsed.line_items.length, 8);
      assert.ok(body.parsed.line_items.some((item) => item.description === 'Refinish front bumper cover'));
      assert.equal(body.needs_review, true);
    });
  });

  await t.test('a shorter recovery response preserves the already readable rows', async () => {
    aiCalls = [];
    aiResult = { line_items: [{ description: 'Only one recovered row', type: 'labor', quantity: 1, unit_price: 50 }] };
    await upload([{ name: 'estimate.pdf', type: 'application/pdf', content: ccc.replace(/^2\s+.+$/m, '2 unreadable estimate row') }], async (res, body) => {
      assert.equal(res.status, 200);
      assert.equal(aiCalls.length, 1);
      assert.equal(body.parsed.line_items.length, 7);
      assert.ok(body.parsed.review_reasons.includes('line_item_recovery_incomplete'));
    });
  });

  await t.test('empty recovery and unavailable PDF rendering preserve readable rows', async () => {
    const oldRenderer = process.env.PDFTOPPM_BIN;
    process.env.PDFTOPPM_BIN = '/nonexistent-revv-test-pdftoppm';
    aiRaw = '';
    try {
      await upload([{ name: 'estimate.pdf', type: 'application/pdf', content: ccc.replace(/^2\s+.+$/m, '2 unreadable estimate row') }], async (res, body) => {
        assert.equal(res.status, 200);
        assert.equal(body.parsed.line_items.length, 7);
        assert.ok(body.parsed.review_reasons.includes('low_confidence_line_2'));
        assert.equal(body.needs_review, true);
      });
    } finally {
      aiRaw = undefined;
      if (oldRenderer === undefined) delete process.env.PDFTOPPM_BIN;
      else process.env.PDFTOPPM_BIN = oldRenderer;
    }
  });

  await t.test('unconfigured recovery preserves readable rows', async () => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await upload([{ name: 'estimate.pdf', type: 'application/pdf', content: ccc.replace(/^2\s+.+$/m, '2 unreadable estimate row') }], async (res, body) => {
        assert.equal(res.status, 200);
        assert.equal(body.parsed.line_items.length, 7);
        assert.equal(body.needs_review, true);
      });
    } finally {
      process.env.OPENAI_API_KEY = 'test-only';
      if (anthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = anthropicKey;
    }
  });

  await t.test('PDF plus photo includes both in the extraction request', async () => {
    aiCalls = [];
    aiResult = { line_items: [{ description: 'Bumper', type: 'parts', quantity: 1, unit_price: 100 }] };
    await upload([
      { name: 'estimate.pdf', type: 'application/pdf', content: ccc },
      { name: 'supplement.png', type: 'image/png', content: 'synthetic-image' },
    ], async (res) => {
      assert.equal(res.status, 200);
      assert.equal(aiCalls.length, 1);
      const content = aiCalls[0].messages[0].content;
      assert.ok(content.some((part) => part.type === 'image_url'));
      assert.ok(content.some((part) => part.type === 'text' && part.text.includes('Grille assembly')));
    });
  });

  await t.test('two PDFs include the second estimate grid', async () => {
    aiCalls = [];
    await upload([
      { name: 'estimate.pdf', type: 'application/pdf', content: ccc },
      { name: 'supplement.pdf', type: 'application/pdf', content: ccc.replace('Grille assembly', 'Supplement-only part') },
    ], async (res) => {
      assert.equal(res.status, 200);
      assert.equal(aiCalls.length, 1);
      assert.match(aiCalls[0].messages[0].content, /Supplement-only part/);
    });
  });

  await t.test('unsupported files return a readable JSON error', async () => {
    await upload([{ name: 'estimate.txt', type: 'text/plain', content: 'estimate' }], async (res, body) => {
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
      assert.match(body.error, /PDF or image/);
    });
  });

  await t.test('oversized files explain the 10MB limit', async () => {
    await upload([{ name: 'large.pdf', type: 'application/pdf', content: Buffer.alloc(10 * 1024 * 1024 + 1) }], async (res, body) => {
      assert.equal(res.status, 400);
      assert.match(body.error, /10MB/);
    });
  });
});
