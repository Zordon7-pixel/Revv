'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { promisify } = require('node:util');
const { PDFDocument } = require('pdf-lib');

function load(relative, dependencies, env = {}) {
  const filename = path.resolve(__dirname, '..', relative), local = createRequire(filename);
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,process){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (['express', 'multer', 'express-rate-limit', 'os', 'path', 'crypto', 'util', 'pdf-lib',
      '../services/estimateFormat', '../services/cccExtractor', '../services/mitchellExtractor'].includes(name)) return local(name);
    throw new Error(`Forbidden dependency: ${name}`);
  }, module, module.exports, { env });
  return module.exports;
}

const line = { type: 'parts', description: 'Synthetic bumper', quantity: 1, unit_price: 100 };
const good = JSON.stringify({ line_items: [line] });
const empty = JSON.stringify({ line_items: [] });
const image = () => ({ name: 'synthetic.png', type: 'image/png', content: 'synthetic-image' });
const textPdf = text => ({ name: 'synthetic.pdf', type: 'application/pdf', content: text });
async function scannedPdf(pages) {
  const pdf = await PDFDocument.create();
  for (let n = 0; n < pages; n++) pdf.addPage([20, 20]);
  return { name: 'synthetic.pdf', type: 'application/pdf', content: Buffer.from(await pdf.save()) };
}

function fixture({ enabled = true, policyFailure, quota = false, responses = [good], pdfText,
  renderFailure = false, shortRender = false, configured = true } = {}) {
  const calls = [], admissions = [], renders = [], statements = [], originals = [], storage = new Map();
  const client = { release() {}, query: async (sql, args) => {
    statements.push(sql);
    if (policyFailure) throw new Error('Synthetic database failure');
    if (sql.startsWith('SELECT id::text')) {
      admissions.push(args[0]);
      return { rows: enabled === 'missing' ? [] : [{ id: args[0], estimate_ai_enabled: enabled }] };
    }
    if (sql.includes('clock_timestamp')) return { rows: [{ now: new Date(0) }] };
    if (sql.startsWith('SELECT window_started_at')) return { rows: quota ? [{ window_started_at: new Date(0), admission_count: 15 }] : [] };
    if (sql.startsWith('INSERT')) return { rowCount: 1, rows: [{ identity_type: 'text', window_started_at: args[1], admission_count: args[2] }] };
    return { rows: [] };
  } };
  const db = { pool: { connect: async () => client }, dbGet: async () => null };
  const policy = load('services/estimateAiPolicy.js', { '../db': db });
  const shared = load('services/openai.js', { openai: class {
    chat = { completions: { create: async (payload, options) => {
      calls.push({ payload, options });
      assert.deepEqual(options, { maxRetries: 0 });
      assert.equal(payload.max_completion_tokens, 4096);
      assert.equal(payload.store, false);
      assert.ok(calls.length <= 2, 'At most two attempted calls');
      const result = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (result instanceof Error) throw result;
      return { choices: [{ message: { content: result } }] };
    } } };
  } }, configured ? { OPENAI_API_KEY: 'synthetic-only' } : {});
  const execFile = () => assert.fail('Use promisified process fixture');
  execFile[promisify.custom] = async (command, args) => {
    if (command === 'pdftotext') return { stdout: '' };
    assert.equal(command, 'pdftoppm');
    const count = Number(args[args.indexOf('-l') + 1]);
    assert.ok(count > 0 && count <= 12);
    renders.push(count);
    if (renderFailure) throw new Error('Synthetic render failure');
    const prefix = args.at(-1);
    for (let i = 1; i <= count - (shortRender ? 1 : 0); i++) storage.set(`${prefix}-${i}.png`, Buffer.from('synthetic-page'));
    return { stdout: '' };
  };
  let user = 0, directory = 0;
  const router = load('routes/insuranceOcr.js', {
    '../db': db, '../services/openai': shared, '../services/estimateAiPolicy': policy,
    '../services/notifyOps': { notifyOps: async () => {} },
    '../middleware/auth': (req, res, next) => { req.user = { shop_id: 'persisted-shop', id: req.headers['x-user'] || `user-${++user}` }; next(); },
    'pdf-parse': async buffer => {
      originals.push(Buffer.from(buffer));
      return { text: pdfText === undefined ? (buffer.toString().startsWith('%PDF') ? '' : buffer.toString()) : pdfText };
    },
    'child_process': { execFile },
    'fs/promises': {
      mkdtemp: async () => `/synthetic-${++directory}`,
      writeFile: async (name, bytes) => storage.set(name, bytes),
      readFile: async name => storage.get(name),
      readdir: async dir => [...storage.keys()].filter(k => k.startsWith(`${dir}/`)).map(k => path.basename(k)),
      unlink: async name => { storage.delete(name); },
      rm: async dir => { for (const name of storage.keys()) if (name.startsWith(`${dir}/`)) storage.delete(name); },
    },
  });
  async function upload(files = [image()], fields = {}, id) {
    const before = calls.length;
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const file of files) form.append('estimate_images', new Blob([file.content], { type: file.type }), file.name);
    const request = new Request('http://synthetic.test/parse', { method: 'POST', body: form });
    const bytes = Buffer.from(await request.arrayBuffer());
    const req = Object.assign(Readable.from([bytes]), {
      method: 'POST', url: '/parse', ip: '127.0.0.1', app: { get: () => false },
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'content-type': request.headers.get('content-type'), 'content-length': String(bytes.length), ...(id ? { 'x-user': id } : {}) },
    });
    const response = await new Promise((resolve, reject) => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
        send(body) { resolve({ status: this.statusCode, body }); return this; },
      });
      router.handle(req, res, reject);
    });
    let chars = 0, pages = 0;
    for (const { payload } of calls.slice(before)) for (const message of payload.messages) {
      if (typeof message.content === 'string') chars += message.content.length;
      else for (const part of message.content) {
        if (part.type === 'text') chars += part.text.length;
        if (part.type === 'image_url') pages++;
      }
    }
    assert.ok(chars <= 120000, `Cumulative text ${chars}`);
    assert.ok(pages <= 12, `Cumulative pages ${pages}`);
    assert.ok(calls.length - before <= 2);
    return response;
  }
  return { upload, calls, admissions, renders, statements, originals };
}

for (const [name, options, reason] of [
  ['off', { enabled: false }, 'ai_estimate_disabled'],
  ['truthy string', { enabled: 'true' }, 'ai_estimate_unavailable'],
  ['number', { enabled: 1 }, 'ai_estimate_unavailable'],
  ['null', { enabled: null }, 'ai_estimate_unavailable'],
  ['missing', { enabled: 'missing' }, 'ai_estimate_unavailable'],
  ['DB error', { policyFailure: true }, 'ai_estimate_unavailable'],
  ['quota', { quota: true }, 'ai_estimate_quota'],
  ['unconfigured', { configured: false }, 'ai_estimate_unavailable'],
]) test(`persisted ${name} refuses forged opt-in with honest manual fallback`, async () => {
  const f = fixture(options);
  for (const mode of ['estimate', 'intake']) {
    const r = await f.upload([image()], { mode, estimate_ai_enabled: 'true', shop_id: 'forged-shop' });
    assert.equal(r.status, 200);
    assert.equal(r.body.parsed.ai_fallback_reason, reason);
    assert.equal(r.body.needs_review, true);
    assert.deepEqual(r.body.parsed.line_items, []);
    assert.equal(f.calls.length, 0);
  }
  assert.ok(f.admissions.every(id => id === 'persisted-shop'));
});

for (const format of ['ccc', 'mitchell']) test(`${format} deterministic first, opt-out retains partial rows and intake`, async () => {
  const text = fs.readFileSync(path.join(__dirname, '../../test/fixtures', format === 'ccc' ? 'ccc-estimate-totals.txt' : 'mitchell-estimate-synthetic.txt'), 'utf8');
  const f = fixture({ enabled: false });
  const full = await f.upload([textPdf(text)]);
  assert.ok(full.body.parsed.line_items.length > 0);
  assert.equal(f.admissions.length, 0);
  const intake = await f.upload([textPdf(text)], { mode: 'intake' });
  assert.equal(intake.body.parsed.intake_only, true);
  assert.equal(f.admissions.length, 0);
  const partial = await f.upload([textPdf(text.replace(/^2\s+.+$/m, '2 unreadable estimate row'))]);
  assert.equal(partial.body.parsed.line_items.length, full.body.parsed.line_items.length - 1);
  assert.equal(partial.body.parsed.ai_fallback_reason, 'ai_estimate_disabled');
  assert.equal(f.calls.length, 0);
});

test('opted-out totals-only CCC preserves honestly labeled summary', async () => {
  const f = fixture({ enabled: false });
  const text = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ccc-estimate-low-confidence.txt'), 'utf8');
  const r = await f.upload([textPdf(text)]);
  assert.deepEqual(r.body.parsed.line_items.map(i => i.description), ['Estimate totals - parts', 'Estimate totals - body labor']);
  assert.ok(r.body.parsed.review_reasons.includes('ccc_summary_items_from_totals'));
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_disabled');
});

for (const status of [401, 429, 500]) test(`provider ${status} consumes one bounded attempt`, async () => {
  const f = fixture({ responses: [Object.assign(new Error('synthetic provider error'), { status })] });
  const r = await f.upload();
  assert.equal(f.calls.length, 1);
  assert.equal(f.admissions.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_unavailable');
  assert.deepEqual(r.body.parsed.line_items, []);
});

test('zero-line image relaxed recovery stops at two attempts and one admission', async () => {
  const f = fixture({ responses: [empty] });
  const r = await f.upload();
  assert.equal(f.calls.length, 2);
  assert.equal(f.admissions.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_call_limit');
});

test('zero-line text visual recovery succeeds within two attempts', async () => {
  const f = fixture({ pdfText: 'Synthetic unknown-format text', responses: [empty, good] });
  const r = await f.upload([await scannedPdf(3)]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.admissions.length, 1);
  assert.deepEqual(f.renders, [3]);
  assert.equal(r.body.parsed.line_items[0].description, line.description);
});

test('empty text response visual retry still has only two attempts', async () => {
  const f = fixture({ pdfText: 'Synthetic text', responses: ['', empty] });
  const r = await f.upload([await scannedPdf(2)]);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.renders, [2]);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_call_limit');
});

test('unavailable rendering permits relaxed text as the second attempt', async () => {
  const f = fixture({ responses: [empty, good] });
  const r = await f.upload([textPdf('Synthetic plain text')]);
  assert.equal(f.calls.length, 2);
  assert.equal(r.body.parsed.line_items[0].description, line.description);
});

for (const second of [empty, new Error('We could not parse the JSON body of your request')]) test(`JSON transport repair shares the budget, second ${typeof second}`, async () => {
  const error = new Error('We could not parse the JSON body of your request');
  const f = fixture({ responses: [error, second], pdfText: 'Synthetic text' });
  const r = await f.upload([await scannedPdf(2)]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.admissions.length, 1);
  assert.deepEqual(f.renders, []);
  assert.deepEqual(r.body.parsed.line_items, []);
  assert.ok(['ai_estimate_call_limit', 'ai_estimate_unavailable'].includes(r.body.parsed.ai_fallback_reason));
});

test('malformed model JSON fails manually without fabricated rows', async () => {
  const f = fixture({ responses: ['not JSON'] });
  const r = await f.upload();
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_unavailable');
});

test('aggregate text overflow refuses whole batch without truncation', async () => {
  const f = fixture();
  const files = [textPdf('a'.repeat(65000)), textPdf('b'.repeat(65000))];
  const r = await f.upload(files);
  assert.equal(f.calls.length, 0);
  assert.equal(f.admissions.length, 0);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
  assert.deepEqual(f.originals, files.map(file => Buffer.from(file.content)));
});

test('repeated text and prompts count cumulatively and block second send', async () => {
  const f = fixture({ responses: [empty] });
  const r = await f.upload([textPdf('a'.repeat(65000))]);
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
});

test('mixed PDF and images retain all files and count repeated input', async () => {
  const f = fixture({ responses: [empty] });
  const r = await f.upload([textPdf('a'.repeat(65000)), image()]);
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
  assert.equal(f.calls[0].payload.messages[0].content.filter(p => p.type === 'image_url').length, 1);
});

test('13-page PDF and aggregate 7+6 pages refuse before rendering', async () => {
  for (const files of [[await scannedPdf(13)], [await scannedPdf(7), await scannedPdf(6)]]) {
    const f = fixture();
    const r = await f.upload(files);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.renders, []);
    assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
    assert.deepEqual(f.originals, files.map(file => file.content));
  }
});

test('12 pages may be sent once, repeated images exceed aggregate budget', async () => {
  const f = fixture({ responses: [empty] });
  const r = await f.upload([await scannedPdf(6), await scannedPdf(5), image()]);
  assert.deepEqual(f.renders, [6, 5]);
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
});

test('6 images can be retried exactly once; 7 images cannot', async () => {
  for (const count of [6, 7]) {
    const f = fixture({ responses: [empty] });
    const r = await f.upload(Array.from({ length: count }, image));
    assert.equal(f.calls.length, count === 6 ? 2 : 1);
    assert.equal(r.body.parsed.ai_fallback_reason, count === 6 ? 'ai_estimate_call_limit' : 'ai_estimate_input_limit');
  }
});

for (const options of [{ renderFailure: true }, { shortRender: true }]) test('incomplete scanned PDF cannot silently omit files', async () => {
  const f = fixture(options);
  const r = await f.upload([image(), await scannedPdf(2)]);
  assert.equal(f.calls.length, 0);
  assert.equal(r.body.parsed.ai_fallback_reason, 'estimate_pages_unreadable');
  assert.deepEqual(r.body.parsed.line_items, []);
});

test('per-user 15/10 minute limiter remains before admission', async () => {
  const f = fixture({ enabled: false });
  for (let n = 0; n < 15; n++) assert.equal((await f.upload([image()], {}, 'same-user')).status, 200);
  assert.equal((await f.upload([image()], {}, 'same-user')).status, 429);
  assert.equal(f.admissions.length, 15);
  assert.equal((await f.upload([image()], {}, 'other-user')).status, 200);
  assert.equal(f.calls.length, 0);
});

test('prompt characters count at the exact 120000 input boundary', async () => {
  const probe = fixture();
  await probe.upload([textPdf('x')]);
  const overhead = probe.calls[0].payload.messages[0].content.length - 1;
  for (const extra of [0, 1]) {
    const f = fixture();
    const r = await f.upload([textPdf('x'.repeat(120000 - overhead + extra))]);
    assert.equal(f.calls.length, extra ? 0 : 1);
    if (extra) assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
    else assert.equal(f.calls[0].payload.messages[0].content.length, 120000);
  }
});

test('successful JSON transport repair uses one admission and two attempted calls', async () => {
  const f = fixture({ responses: [new Error('We could not parse the JSON body of your request'), good] });
  const r = await f.upload([textPdf('Synthetic text')]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.admissions.length, 1);
  assert.equal(r.body.parsed.line_items[0].description, line.description);
});

test('intake empty-text visual recovery remains metadata-only and bounded', async () => {
  const f = fixture({ pdfText: 'Synthetic intake text', responses: ['', JSON.stringify({ customer_name: 'Synthetic customer', line_items: [line] })] });
  const r = await f.upload([await scannedPdf(1)], { mode: 'intake' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.admissions.length, 1);
  assert.equal(r.body.parsed.customer_name, 'Synthetic customer');
  assert.deepEqual(r.body.parsed.line_items, []);
  assert.equal(r.body.parsed.estimate_totals, null);
  assert.match(f.calls[1].payload.messages[0].content[0].text, /metadata only/);
});

test('oversized visual retry does not render or spend the second attempt', async () => {
  const f = fixture({ pdfText: 'Synthetic text', responses: [empty] });
  const r = await f.upload([await scannedPdf(13)]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.renders, []);
  assert.equal(r.body.parsed.ai_fallback_reason, 'ai_estimate_input_limit');
});
