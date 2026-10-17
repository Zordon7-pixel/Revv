const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

// The fake node executable runs this branch, never a real app/seed dependency.
if (process.argv[2] === '--fake-runtime') {
  const record = event => fs.appendFileSync(process.env.STARTUP_EVENTS, `${JSON.stringify(event)}\n`);
  const seedWrite = () => {
    record('seed/credential-write');
    fs.writeFileSync(process.env.STARTUP_WRITE_MARKER, 'synthetic write only');
  };
  const args = process.argv.slice(3);
  record({ runtime: args, cwd: path.basename(process.cwd()) });
  if (args[0] === 'src/db/seed.js') {
    seedWrite();
    process.exit(93);
  }
  assert.deepEqual(args, ['src/app.js'], 'only the reviewed entrypoint is allowed');
  const noop = () => {};
  const app = { use: noop, get: noop, set: noop, listen: () => record('listen') };
  const express = Object.assign(() => app, { raw: noop, json: noop, static: noop });
  const stubs = {
    dotenv: { config: noop }, // No .env reads.
    express,
    cors: noop,
    path,
    helmet: noop,
    'express-rate-limit': noop,
    './lib/sentry': { init: noop, requestHandler: noop, errorHandler: noop },
    './services/mediaStorage': {},
    './services/panelEstimatorApproval': {},
    './services/smsProvisioningEvents': { router: noop },
    './db': {
      async initDb() {
        record('initDb');
        if (process.env.STARTUP_FAILURE === 'init') throw new Error('synthetic init failure');
      },
    },
    './db/migrate': {
      async runMigrations() {
        record('migrations');
        if (process.env.STARTUP_FAILURE === 'migration') {
          throw Object.assign(new Error('synthetic required migration failure'), {
            code: 'SHOP_TWILIO_SCHEMA_REQUIRED',
          });
        }
      },
    },
  };
  vm.runInNewContext(fs.readFileSync('src/app.js', 'utf8'), {
    __dirname: path.resolve('src'),
    console: { log: noop, error: noop },
    process: {
      env: { NODE_ENV: 'production', JWT_SECRET: 'synthetic-only', DATABASE_URL: 'synthetic-only' },
      exit(code) { record({ exit: code }); process.exit(code); },
    },
    require(id) {
      if (/seed/i.test(id)) {
        record('seed-module-load');
        return { runSeed: seedWrite };
      }
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id.startsWith('./routes/') || id.startsWith('./jobs/')) return {};
      throw new Error(`Unmocked dependency forbidden: ${id}`);
    },
  }, { filename: 'src/app.js', timeout: 1000 });
} else {
  const test = require('node:test');
  const root = path.resolve(__dirname, '../..');
  const appSource = fs.readFileSync(path.join(root, 'backend/src/app.js'), 'utf8');

  // Validate the entire current string-only TOML subset. Reject unfamiliar syntax,
  // duplicate keys/tables and environment overrides instead of ignoring them.
  function startupCommand() {
    const tables = new Map();
    let table;
    for (const raw of fs.readFileSync(path.join(root, 'railway.toml'), 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (['[build]', '[deploy]', '[[services]]'].includes(line)) {
        assert.ok(!tables.has(line), `duplicate table: ${line}`);
        table = new Map();
        tables.set(line, table);
        continue;
      }
      const match = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*("[^"\\]*")$/.exec(line);
      assert.ok(table && match, `unsupported Railway config syntax: ${line}`);
      assert.ok(!table.has(match[1]), `duplicate key: ${match[1]}`);
      table.set(match[1], JSON.parse(match[2]));
    }
    const command = tables.get('[deploy]')?.get('startCommand');
    assert.equal(typeof command, 'string', 'deploy.startCommand is required');
    return command;
  }

  function runStartup(t, { command = startupCommand(), failure = '', source = appSource, backend = true } = {}) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'revv-startup-'));
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const bin = path.join(fixture, 'bin');
    const eventsFile = path.join(fixture, 'events.jsonl');
    const marker = path.join(fixture, 'synthetic-credential-write');
    fs.mkdirSync(bin);
    if (backend) {
      fs.mkdirSync(path.join(fixture, 'backend/src'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'backend/src/app.js'), source);
    }
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    fs.writeFileSync(path.join(bin, 'node'),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(__filename)} --fake-runtime "$@"\n`, { mode: 0o755 });
    const result = spawnSync('/bin/sh', ['-c', command], {
      cwd: fixture,
      // Deliberately no inherited environment, real runtime options, DB or provider configuration.
      env: { PATH: bin, HOME: fixture, NODE_ENV: 'production', STARTUP_EVENTS: eventsFile,
        STARTUP_WRITE_MARKER: marker, STARTUP_FAILURE: failure },
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, events: fs.existsSync(eventsFile)
      ? fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    wroteCredentials: fs.existsSync(marker) };
  }

  const entrypoint = { runtime: ['src/app.js'], cwd: 'backend' };
  function assertSeedless(result, status, events) {
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(result.events, events, 'exactly one app attempt; no seed or unexpected startup path');
    assert.equal(result.wroteCredentials, false, 'no synthetic seed/credential writes');
  }

  test('Railway configuration directly execs the reviewed app', () => {
    assert.equal(startupCommand(), 'cd backend && exec node src/app.js');
    const syntax = spawnSync('/bin/sh', ['-n', '-c', startupCommand()], { env: {}, encoding: 'utf8' });
    assert.ifError(syntax.error);
    assert.equal(syntax.status, 0, syntax.stderr);
  });

  test('Nixpacks startup execs only the app without seeding', t => {
    const config = fs.readFileSync(path.join(root, 'nixpacks.toml'), 'utf8');
    const sections = config.split(/^\[start\][ \t]*\r?$/m);
    assert.equal(sections.length, 2, 'exactly one Nixpacks start section is required');
    const start = sections[1].split(/^\[/m)[0];
    const commands = [...start.matchAll(/^cmd\s*=\s*("[^"\\\r\n]*")[ \t]*\r?$/gm)];
    assert.equal(commands.length, 1, 'one literal Nixpacks start command is required');
    const command = JSON.parse(commands[0][1]);
    assert.equal(command, 'cd backend && exec node src/app.js');
    assert.doesNotMatch(command, /seed/i);
    assertSeedless(runStartup(t, { command }), 0, [entrypoint, 'initDb', 'migrations', 'listen']);
  });

  test('production startup initializes and migrates once without any seed/credential path', t => {
    assertSeedless(runStartup(t), 0, [entrypoint, 'initDb', 'migrations', 'listen']);
  });

  test('app init failure exits nonzero without migrations, seed, listen or a second process', t => {
    assertSeedless(runStartup(t, { failure: 'init' }), 1, [entrypoint, 'initDb', { exit: 1 }]);
  });

  test('required migration failure retains the existing fail-closed behavior', t => {
    assertSeedless(runStartup(t, { failure: 'migration' }), 1,
      [entrypoint, 'initDb', 'migrations', { exit: 1 }]);
  });

  test('failed backend directory change cannot launch any process', t => {
    const result = runStartup(t, { backend: false });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, []);
    assert.equal(result.wroteCredentials, false);
  });

  test('negative control detects the former seed subprocess even when its failure is masked', t => {
    const result = runStartup(t, { command: 'cd backend && node src/db/seed.js; node src/app.js' });
    assert.equal(result.status, 0);
    assert.equal(result.wroteCredentials, true);
    assert.throws(() => assertSeedless(result, 0, [entrypoint, 'initDb', 'migrations', 'listen']));
  });

  test('negative control detects an in-process seed/credential-write path', t => {
    const source = appSource.replace('    app.listen(', "    await require('./db/seed').runSeed();\n    app.listen(");
    assert.notEqual(source, appSource);
    const result = runStartup(t, { source });
    assert.equal(result.status, 0);
    assert.ok(result.events.includes('seed-module-load'));
    assert.equal(result.wroteCredentials, true);
    assert.throws(() => assertSeedless(result, 0, [entrypoint, 'initDb', 'migrations', 'listen']));
  });
}
