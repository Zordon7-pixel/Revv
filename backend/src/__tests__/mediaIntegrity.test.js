const assert = require('node:assert/strict');
const test = require('node:test');
const {
  collectMediaReferences,
  reconcileReference,
  runMediaIntegrityAudit,
} = require('../jobs/mediaIntegrity');

test('collectMediaReferences keeps only deduplicated REVV-managed upload paths', async () => {
  const dbAllFn = async (sql) => {
    const query = String(sql);
    if (query.includes('FROM ro_photos')) {
      return [
        { media_url: '/uploads/photos/a.jpg' },
        { media_url: 'https://revvshop.app/uploads/photos/a.jpg?cache=1' },
        { media_url: 'https://external.example/customer-photo.jpg' },
      ];
    }
    if (query.includes('FROM ro_claim_evidence')) return [{ media_url: '/uploads/claim-evidence/b.pdf' }];
    if (query.includes('FROM inspection_items')) return [{ media_url: 'https://cdn.example/uploads/inspections/c.jpg' }];
    if (query.includes('FROM claim_links')) return [{ media_url: '/uploads/assessments/d.pdf' }];
    if (query.includes('FROM shops')) return [{ media_url: '/uploads/shop-logos/e.png' }];
    return [];
  };

  assert.deepEqual(await collectMediaReferences({ dbAllFn }), [
    '/uploads/photos/a.jpg',
    '/uploads/claim-evidence/b.pdf',
    '/uploads/inspections/c.jpg',
    '/uploads/assessments/d.pdf',
    '/uploads/shop-logos/e.png',
  ]);
});

test('reconcileReference mirrors local-only objects and restores bucket-only files', async () => {
  let mirrored = 0;
  let restored = 0;
  const base = {
    isObjectStorageConfigured: () => true,
    mirrorLocalFile: async () => { mirrored += 1; },
    restoreLocalFileFromObject: async () => { restored += 1; },
  };

  assert.deepEqual(await reconcileReference('/uploads/photos/local.jpg', {
    ...base,
    existsSync: () => true,
    objectHead: async () => null,
  }), { status: 'mirrored' });
  assert.equal(mirrored, 1);

  assert.deepEqual(await reconcileReference('/uploads/photos/bucket.jpg', {
    ...base,
    existsSync: () => false,
    objectHead: async () => ({ ContentLength: 10 }),
  }), { status: 'restored' });
  assert.equal(restored, 1);

  assert.deepEqual(await reconcileReference('/uploads/photos/missing.jpg', {
    ...base,
    existsSync: () => false,
    objectHead: async () => null,
  }), { status: 'missing' });
});

test('runMediaIntegrityAudit reports repair and loss counts without mutating database rows', async () => {
  const outcomes = ['healthy', 'mirrored', 'restored', 'local_only', 'missing'];
  let index = 0;
  const result = await runMediaIntegrityAudit({
    mirrorAllLocalMedia: async () => ({ mirrored: 2, restored: 1 }),
    collectMediaReferences: async () => outcomes.map((status) => `/uploads/photos/${status}.jpg`),
    isObjectStorageConfigured: () => true,
    reconcileReference: async () => ({ status: outcomes[index++] }),
  });

  assert.deepEqual(result, {
    configured: true,
    references: 5,
    healthy: 1,
    mirrored: 3,
    restored: 2,
    localOnly: 1,
    missing: 1,
  });
});
