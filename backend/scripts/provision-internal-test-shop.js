#!/usr/bin/env node
'use strict';

// This file is the only production entry. Importing it never loads configuration,
// a password, a database adapter, or a provider. There is no HTTP/public setter.
const { provision } = require('../src/services/internalTestShopProvisioning');
async function main({ env = process.env, argv = process.argv.slice(2), write = text => process.stdout.write(text), adapters } = {}) {
  let pool, poolFailed = false;
  const onPoolError = () => { poolFailed = true; };
  try {
    const result = await provision({ env, argv,
      pool: { async connect() {
        pool = adapters ? adapters.pool : require('../src/db/postgres').pool;
        pool.on?.('error', onPoolError);
        return pool.connect();
      } },
      hashPassword: (password, cost) => adapters ? adapters.hashPassword(password, cost) : require('bcryptjs').hash(password, cost),
      validateSchema: client => adapters ? adapters.validateSchema(client) : require('../src/db/internalTestShop').validateSchema(client),
    });
    if (pool) { await pool.end(); pool.removeListener?.('error', onPoolError); pool = undefined; }
    if (poolFailed) throw new Error('PROVISIONING_FAILED');
    write(JSON.stringify(result) + '\n');
    return 0;
  } catch (error) {
    const allowed = ['INVALID_ARGUMENTS', 'INVALID_EMAIL', 'INVALID_PASSWORD', 'FIXTURE_COLLISION'];
    write(JSON.stringify({ error: allowed.includes(error?.code) ? error.code : 'PROVISIONING_FAILED' }) + '\n');
    return 1;
  } finally {
    delete env.REVV_INTERNAL_TEST_SHOP_PASSWORD;
    if (pool) {
      try { await pool.end(); } catch { /* Failure already reported; no raw DB output. */ }
      pool.removeListener?.('error', onPoolError);
    }
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main };
