const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('every persistent multer route uses the durable media service', () => {
  const routes = [
    'routes/photos.js',
    'routes/portal.js',
    'routes/claimTracker.js',
    'routes/claimLinks.js',
    'routes/market.js',
  ];
  for (const route of routes) {
    const text = source(route);
    assert.match(text, /persistUploadedFile/, route);
    assert.match(text, /deleteStoredMedia|discardUploadedMedia/, route);
  }
});

test('media is mirrored before persistent metadata is written', () => {
  assert.match(source('routes/photos.js'), /await persistUploadedFile[\s\S]{0,300}await dbRun\([\s\S]{0,300}INSERT INTO ro_photos/);
  assert.match(source('routes/portal.js'), /await persistUploadedFile[\s\S]{0,300}await dbRun\([\s\S]{0,300}INSERT INTO ro_photos/);
  assert.match(source('routes/claimTracker.js'), /await persistUploadedFile[\s\S]{0,500}INSERT INTO ro_claim_evidence/);
  assert.match(source('routes/claimLinks.js'), /await persistUploadedFile[\s\S]{0,700}UPDATE claim_links SET/);
  assert.match(source('routes/market.js'), /await persistUploadedFile[\s\S]{0,300}UPDATE shops SET logo_url/);
});

test('uploaded-file fallback runs before the SPA fallback', () => {
  const app = source('app.js');
  const localUploads = app.indexOf("app.use('/uploads', express.static");
  const objectFallback = app.indexOf("app.get('/uploads/*'");
  const spaStatic = app.indexOf('app.use(express.static(frontendDist))');
  assert.ok(localUploads >= 0 && objectFallback > localUploads && spaStatic > objectFallback);
  assert.match(app, /setInterval\(runDailyMediaIntegrityAudit, MEDIA_INTEGRITY_AUDIT_MS\)\.unref\(\)/);
});
