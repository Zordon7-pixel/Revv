const fs = require('fs');
const { dbAll } = require('../db');
const {
  isObjectStorageConfigured,
  localPathForMedia,
  mirrorAllLocalMedia,
  mirrorLocalFile,
  objectHead,
  restoreLocalFileFromObject,
} = require('../services/mediaStorage');

async function safeRows(query, params = [], dbAllFn = dbAll) {
  try {
    return await dbAllFn(query, params);
  } catch (err) {
    if (['42P01', '42703'].includes(err.code)) return [];
    throw err;
  }
}

async function collectMediaReferences({ dbAllFn = dbAll } = {}) {
  const [photos, evidence, inspections, assessments, logos] = await Promise.all([
    safeRows(`SELECT photo_url AS media_url FROM ro_photos WHERE photo_url IS NOT NULL AND BTRIM(photo_url) <> ''`, [], dbAllFn),
    safeRows(`SELECT media_url FROM ro_claim_evidence WHERE media_url IS NOT NULL AND BTRIM(media_url) <> ''`, [], dbAllFn),
    safeRows(`SELECT ii.photo_url AS media_url
              FROM inspection_items ii
              JOIN inspections i ON i.id = ii.inspection_id
              WHERE ii.photo_url IS NOT NULL AND BTRIM(ii.photo_url) <> ''`, [], dbAllFn),
    safeRows(`SELECT '/uploads/assessments/' || assessment_filename AS media_url
              FROM claim_links
              WHERE assessment_filename IS NOT NULL AND BTRIM(assessment_filename) <> ''`, [], dbAllFn),
    safeRows(`SELECT logo_url AS media_url FROM shops WHERE logo_url IS NOT NULL AND BTRIM(logo_url) <> ''`, [], dbAllFn),
  ]);

  return [...new Set(
    [...photos, ...evidence, ...inspections, ...assessments, ...logos]
      .map((row) => String(row.media_url || '').trim())
      .map((url) => {
        if (url.startsWith('/uploads/')) return url;
        if (!/^https?:\/\//i.test(url)) return '';
        try {
          const pathname = new URL(url).pathname;
          return pathname.startsWith('/uploads/') ? pathname : '';
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  )];
}

async function reconcileReference(mediaUrl, dependencies = {}) {
  const existsSync = dependencies.existsSync || fs.existsSync;
  const configured = dependencies.isObjectStorageConfigured || isObjectStorageConfigured;
  const head = dependencies.objectHead || objectHead;
  const mirror = dependencies.mirrorLocalFile || mirrorLocalFile;
  const restore = dependencies.restoreLocalFileFromObject || restoreLocalFileFromObject;
  const localExists = existsSync(localPathForMedia(mediaUrl));
  const bucketConfigured = configured();

  if (localExists && !bucketConfigured) return { status: 'local_only' };
  if (localExists) {
    const object = await head(mediaUrl);
    if (object) return { status: 'healthy' };
    await mirror(mediaUrl);
    return { status: 'mirrored' };
  }
  if (!bucketConfigured) return { status: 'missing' };

  const object = await head(mediaUrl);
  if (!object) return { status: 'missing' };
  await restore(mediaUrl);
  return { status: 'restored' };
}

async function runMediaIntegrityAudit(dependencies = {}) {
  const mirrorLocalFiles = dependencies.mirrorAllLocalMedia || mirrorAllLocalMedia;
  const collectReferences = dependencies.collectMediaReferences || collectMediaReferences;
  const configured = dependencies.isObjectStorageConfigured || isObjectStorageConfigured;
  const reconcile = dependencies.reconcileReference
    || ((mediaUrl) => reconcileReference(mediaUrl, dependencies));
  const localMirror = await mirrorLocalFiles();
  const references = await collectReferences();
  const result = {
    configured: configured(),
    references: references.length,
    healthy: 0,
    mirrored: localMirror.mirrored || 0,
    restored: localMirror.restored || 0,
    localOnly: 0,
    missing: 0,
  };

  for (const mediaUrl of references) {
    const outcome = await reconcile(mediaUrl);
    if (outcome.status === 'healthy') result.healthy += 1;
    else if (outcome.status === 'mirrored') result.mirrored += 1;
    else if (outcome.status === 'restored') result.restored += 1;
    else if (outcome.status === 'local_only') result.localOnly += 1;
    else result.missing += 1;
  }
  return result;
}

module.exports = {
  collectMediaReferences,
  reconcileReference,
  runMediaIntegrityAudit,
};
