const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const mediaStorage = require('../services/mediaStorage');

const TEST_DIR = path.join(mediaStorage.UPLOAD_ROOT, '.media-storage-test');
const STORAGE_ENV = Object.freeze({
  MEDIA_BUCKET: 'revv-test',
  MEDIA_ENDPOINT: 'https://storage.test.invalid',
  MEDIA_ACCESS_KEY_ID: 'test-access-key',
  MEDIA_SECRET_ACCESS_KEY: 'test-secret-key',
  MEDIA_REGION: 'auto',
  MEDIA_REQUIRE_OBJECT_STORAGE: 'true',
});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createFakeObjectClient() {
  const objects = new Map();
  return {
    objects,
    client: {
      async send(command) {
        const name = command.constructor.name;
        const input = command.input;
        if (name === 'PutObjectCommand') {
          const body = await streamToBuffer(input.Body);
          objects.set(input.Key, {
            body,
            contentType: input.ContentType,
            metadata: input.Metadata || {},
          });
          return { ETag: 'test-etag' };
        }
        if (name === 'HeadObjectCommand') {
          const object = objects.get(input.Key);
          if (!object) {
            const error = new Error('Not found');
            error.name = 'NotFound';
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return {
            ContentLength: object.body.length,
            ContentType: object.contentType,
            Metadata: object.metadata,
          };
        }
        if (name === 'GetObjectCommand') {
          const object = objects.get(input.Key);
          if (!object) {
            const error = new Error('Not found');
            error.name = 'NoSuchKey';
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return {
            Body: Readable.from([object.body]),
            ContentLength: object.body.length,
            ContentType: object.contentType,
            Metadata: object.metadata,
          };
        }
        if (name === 'DeleteObjectCommand') {
          objects.delete(input.Key);
          return {};
        }
        throw new Error(`Unexpected command: ${name}`);
      },
    },
  };
}

async function writeTestMedia(name, contents) {
  const mediaUrl = `/uploads/.media-storage-test/${name}`;
  const filePath = mediaStorage.localPathForMedia(mediaUrl);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, contents);
  return { mediaUrl, filePath };
}

test.afterEach(async () => {
  mediaStorage._test.resetClientForTests();
  await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
});

test('persistUploadedFile mirrors bytes and verifies the object checksum', async () => {
  const fake = createFakeObjectClient();
  mediaStorage._test.setClientFactory(() => fake.client);
  const contents = Buffer.from('REVV durable media test');
  const { mediaUrl, filePath } = await writeTestMedia(`${crypto.randomUUID()}.jpg`, contents);

  const result = await mediaStorage.persistUploadedFile(
    { path: filePath, mimetype: 'image/jpeg' },
    mediaUrl,
    { env: STORAGE_ENV }
  );

  assert.equal(result.mirrored, true);
  assert.equal(result.bytes, contents.length);
  assert.equal(result.sha256, crypto.createHash('sha256').update(contents).digest('hex'));
  const object = fake.objects.get(mediaStorage.normalizeMediaKey(mediaUrl));
  assert.deepEqual(object.body, contents);
  assert.equal(object.contentType, 'image/jpeg');
  assert.equal(object.metadata.sha256, result.sha256);
});

test('bucket copy restores a missing volume file and deletion removes both copies', async () => {
  const fake = createFakeObjectClient();
  mediaStorage._test.setClientFactory(() => fake.client);
  const contents = Buffer.from('restore this exact file');
  const { mediaUrl, filePath } = await writeTestMedia(`${crypto.randomUUID()}.png`, contents);
  await mediaStorage.mirrorLocalFile(mediaUrl, { contentType: 'image/png', env: STORAGE_ENV });
  await fs.promises.unlink(filePath);

  const restored = await mediaStorage.restoreLocalFileFromObject(mediaUrl, { env: STORAGE_ENV });
  assert.equal(restored.restored, true);
  assert.deepEqual(await fs.promises.readFile(filePath), contents);

  await mediaStorage.deleteStoredMedia(mediaUrl, { env: STORAGE_ENV });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fake.objects.has(mediaStorage.normalizeMediaKey(mediaUrl)), false);
});

test('daily mirror restores a corrupted volume copy from the verified bucket object', async () => {
  const fake = createFakeObjectClient();
  mediaStorage._test.setClientFactory(() => fake.client);
  const original = Buffer.from('known-good-original');
  const { mediaUrl, filePath } = await writeTestMedia(`${crypto.randomUUID()}.jpg`, original);
  await mediaStorage.mirrorLocalFile(mediaUrl, { contentType: 'image/jpeg', env: STORAGE_ENV });
  await fs.promises.writeFile(filePath, 'corrupted-local-copy');

  const result = await mediaStorage.mirrorAllLocalMedia({ env: STORAGE_ENV, mediaUrls: [mediaUrl] });
  assert.deepEqual(result, { checked: 1, mirrored: 0, restored: 1, skipped: 0, configured: true });
  assert.deepEqual(await fs.promises.readFile(filePath), original);
  assert.deepEqual(fake.objects.get(mediaStorage.normalizeMediaKey(mediaUrl)).body, original);
});

test('required object storage fails closed and media keys cannot traverse upload root', async () => {
  const { mediaUrl, filePath } = await writeTestMedia(`${crypto.randomUUID()}.jpg`, 'local only');
  await assert.rejects(
    mediaStorage.mirrorLocalFile(mediaUrl, { env: { MEDIA_REQUIRE_OBJECT_STORAGE: 'true' } }),
    /media_object_storage_not_configured/
  );
  await assert.rejects(
    mediaStorage.deleteStoredMedia(mediaUrl, { env: { MEDIA_REQUIRE_OBJECT_STORAGE: 'true' } }),
    /media_object_storage_not_configured/
  );
  assert.equal(fs.existsSync(filePath), true, 'a failed user delete must preserve the volume copy');
  await mediaStorage.discardUploadedMedia(mediaUrl, { env: { MEDIA_REQUIRE_OBJECT_STORAGE: 'true' } });
  assert.equal(fs.existsSync(filePath), false, 'rejected multer uploads must still be rolled back locally');

  assert.throws(() => mediaStorage.normalizeMediaKey('/uploads/%2e%2e/private.txt'), /invalid_media_key/);
  assert.throws(() => mediaStorage.normalizeMediaKey('/uploads/photos/%2e%2e/%2e%2e/private.txt'), /invalid_media_key/);
  assert.throws(() => mediaStorage.localPathForMedia('../private.txt'), /invalid_media_key/);
});

test('extension inference preserves browser-safe content types for startup backfills', () => {
  assert.equal(mediaStorage.inferContentType('/uploads/photos/photo.JPG'), 'image/jpeg');
  assert.equal(mediaStorage.inferContentType('/uploads/claim-evidence/document.pdf'), 'application/pdf');
  assert.equal(mediaStorage.inferContentType('/uploads/claim-evidence/video.mov'), 'video/quicktime');
  assert.equal(mediaStorage.inferContentType('/uploads/assessments/no-extension'), 'application/octet-stream');
});
