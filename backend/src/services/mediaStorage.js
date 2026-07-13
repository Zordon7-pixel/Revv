const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');
const DEFAULT_CACHE_CONTROL = 'private, max-age=86400';
const CONTENT_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
});

let cachedClient = null;
let cachedClientSignature = null;
let clientFactory = (config) => new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  forcePathStyle: config.forcePathStyle,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
});

function firstValue(...values) {
  return values.find((value) => String(value || '').trim())?.trim() || '';
}

function resolveObjectStorageConfig(env = process.env) {
  const config = {
    bucket: firstValue(env.MEDIA_BUCKET, env.AWS_S3_BUCKET_NAME, env.BUCKET),
    endpoint: firstValue(env.MEDIA_ENDPOINT, env.AWS_ENDPOINT_URL, env.ENDPOINT),
    accessKeyId: firstValue(env.MEDIA_ACCESS_KEY_ID, env.AWS_ACCESS_KEY_ID, env.ACCESS_KEY_ID),
    secretAccessKey: firstValue(env.MEDIA_SECRET_ACCESS_KEY, env.AWS_SECRET_ACCESS_KEY, env.SECRET_ACCESS_KEY),
    region: firstValue(env.MEDIA_REGION, env.AWS_DEFAULT_REGION, env.AWS_REGION, env.REGION, 'auto'),
    forcePathStyle: firstValue(env.MEDIA_URL_STYLE, env.AWS_S3_URL_STYLE).toLowerCase() === 'path',
  };

  if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
    return null;
  }
  return config;
}

function objectStorageRequired(env = process.env) {
  return String(env.MEDIA_REQUIRE_OBJECT_STORAGE || '').toLowerCase() === 'true';
}

function isObjectStorageConfigured(env = process.env) {
  return Boolean(resolveObjectStorageConfig(env));
}

function getObjectStorageClient(env = process.env) {
  const config = resolveObjectStorageConfig(env);
  if (!config) return null;

  const signature = JSON.stringify({
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretFingerprint: crypto.createHash('sha256').update(config.secretAccessKey).digest('hex'),
    region: config.region,
    forcePathStyle: config.forcePathStyle,
  });
  if (!cachedClient || signature !== cachedClientSignature) {
    cachedClient = clientFactory(config);
    cachedClientSignature = signature;
  }
  return { client: cachedClient, config };
}

function normalizeMediaKey(mediaUrl) {
  let raw = String(mediaUrl || '').trim();
  if (!raw) throw new Error('media_url_required');

  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname;
  } catch {
    throw new Error('invalid_media_url');
  }

  raw = raw.split(/[?#]/, 1)[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    throw new Error('invalid_media_url_encoding');
  }

  raw = raw.replace(/^\/+/, '');
  if (raw.startsWith('uploads/')) raw = raw.slice('uploads/'.length);
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('invalid_media_key');
  }
  if (normalized.split('/').includes('..') || normalized.includes('\0')) {
    throw new Error('invalid_media_key');
  }
  return normalized;
}

function mediaUrlForKey(key) {
  return `/uploads/${normalizeMediaKey(key)}`;
}

function localPathForMedia(mediaUrl) {
  const key = normalizeMediaKey(mediaUrl);
  const candidate = path.resolve(UPLOAD_ROOT, key);
  if (candidate !== UPLOAD_ROOT && !candidate.startsWith(`${UPLOAD_ROOT}${path.sep}`)) {
    throw new Error('invalid_media_path');
  }
  return candidate;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  return hash.digest('hex');
}

function inferContentType(mediaUrl) {
  return CONTENT_TYPES[path.extname(normalizeMediaKey(mediaUrl)).toLowerCase()] || 'application/octet-stream';
}

function isMissingObjectError(err) {
  const status = err?.$metadata?.httpStatusCode;
  return status === 404 || ['NoSuchKey', 'NotFound'].includes(err?.name) || err?.Code === 'NoSuchKey';
}

async function objectHead(mediaUrl, env = process.env) {
  const storage = getObjectStorageClient(env);
  if (!storage) return null;
  const Key = normalizeMediaKey(mediaUrl);
  try {
    return await storage.client.send(new HeadObjectCommand({ Bucket: storage.config.bucket, Key }));
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

async function mirrorLocalFile(mediaUrl, { contentType, env = process.env } = {}) {
  const storage = getObjectStorageClient(env);
  if (!storage) {
    if (objectStorageRequired(env)) throw new Error('media_object_storage_not_configured');
    return { mirrored: false, reason: 'not_configured' };
  }

  const Key = normalizeMediaKey(mediaUrl);
  const filePath = localPathForMedia(mediaUrl);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('media_local_file_missing');
  const sha256 = await hashFile(filePath);

  await storage.client.send(new PutObjectCommand({
    Bucket: storage.config.bucket,
    Key,
    Body: fs.createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: contentType || inferContentType(mediaUrl),
    CacheControl: DEFAULT_CACHE_CONTROL,
    Metadata: { sha256 },
  }));

  const head = await objectHead(mediaUrl, env);
  if (!head || Number(head.ContentLength) !== stat.size) {
    throw new Error('media_object_verification_failed');
  }
  if (head.Metadata?.sha256 && head.Metadata.sha256 !== sha256) {
    throw new Error('media_object_checksum_mismatch');
  }

  return { mirrored: true, key: Key, bytes: stat.size, sha256 };
}

async function persistUploadedFile(file, mediaUrl, options = {}) {
  if (!file?.path) throw new Error('uploaded_file_path_required');
  const expectedPath = localPathForMedia(mediaUrl);
  if (path.resolve(file.path) !== expectedPath) throw new Error('uploaded_file_path_mismatch');
  return mirrorLocalFile(mediaUrl, { ...options, contentType: options.contentType || file.mimetype });
}

async function removeLocalMedia(mediaUrl) {
  try {
    await fs.promises.unlink(localPathForMedia(mediaUrl));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function deleteStoredMedia(mediaUrl, { env = process.env } = {}) {
  const storage = getObjectStorageClient(env);
  if (!storage && objectStorageRequired(env)) throw new Error('media_object_storage_not_configured');
  let objectError = null;
  if (storage) {
    try {
      await storage.client.send(new DeleteObjectCommand({
        Bucket: storage.config.bucket,
        Key: normalizeMediaKey(mediaUrl),
      }));
    } catch (err) {
      objectError = err;
    }
  }
  let localError = null;
  try {
    await removeLocalMedia(mediaUrl);
  } catch (err) {
    localError = err;
  }
  if (objectError || localError) {
    const error = new Error('media_delete_failed');
    error.cause = objectError || localError;
    throw error;
  }
  return { deleted: true };
}

async function discardUploadedMedia(mediaUrl, { env = process.env } = {}) {
  const storage = getObjectStorageClient(env);
  let objectError = null;
  if (storage) {
    try {
      await storage.client.send(new DeleteObjectCommand({
        Bucket: storage.config.bucket,
        Key: normalizeMediaKey(mediaUrl),
      }));
    } catch (err) {
      objectError = err;
    }
  }
  let localError = null;
  try {
    await removeLocalMedia(mediaUrl);
  } catch (err) {
    localError = err;
  }
  if (objectError || localError) {
    const error = new Error('media_upload_rollback_failed');
    error.cause = objectError || localError;
    throw error;
  }
  return { discarded: true };
}

async function getObjectMedia(mediaUrl, { range, env = process.env } = {}) {
  const storage = getObjectStorageClient(env);
  if (!storage) return null;
  try {
    return await storage.client.send(new GetObjectCommand({
      Bucket: storage.config.bucket,
      Key: normalizeMediaKey(mediaUrl),
      ...(range ? { Range: range } : {}),
    }));
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

async function restoreLocalFileFromObject(mediaUrl, { env = process.env } = {}) {
  const object = await getObjectMedia(mediaUrl, { env });
  if (!object?.Body) return { restored: false, reason: 'not_found' };

  const destination = localPathForMedia(mediaUrl);
  const tempPath = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  try {
    await pipeline(object.Body, fs.createWriteStream(tempPath, { flags: 'wx' }));
    const stat = await fs.promises.stat(tempPath);
    if (object.ContentLength != null && stat.size !== Number(object.ContentLength)) {
      throw new Error('media_object_restore_size_mismatch');
    }
    if (object.Metadata?.sha256 && await hashFile(tempPath) !== object.Metadata.sha256) {
      throw new Error('media_object_restore_checksum_mismatch');
    }
    await fs.promises.rename(tempPath, destination);
    return { restored: true, path: destination };
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }
}

async function listLocalMediaUrls(root = UPLOAD_ROOT) {
  const urls = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) urls.push(mediaUrlForKey(path.relative(root, fullPath).split(path.sep).join('/')));
    }
  }
  await walk(root);
  return urls.sort();
}

async function mirrorAllLocalMedia({ env = process.env, mediaUrls } = {}) {
  if (!isObjectStorageConfigured(env)) {
    if (objectStorageRequired(env)) throw new Error('media_object_storage_not_configured');
    return { checked: 0, mirrored: 0, restored: 0, skipped: 0, configured: false };
  }

  const urls = mediaUrls || await listLocalMediaUrls();
  let mirrored = 0;
  let restored = 0;
  let skipped = 0;
  for (const mediaUrl of urls) {
    try {
      const head = await objectHead(mediaUrl, env);
      const filePath = localPathForMedia(mediaUrl);
      const stat = await fs.promises.stat(filePath);
      const checksumMatches = head?.Metadata?.sha256
        ? await hashFile(filePath) === head.Metadata.sha256
        : false;
      if (head && Number(head.ContentLength) === stat.size && checksumMatches) {
        skipped += 1;
        continue;
      }
      if (head?.Metadata?.sha256) {
        await restoreLocalFileFromObject(mediaUrl, { env });
        restored += 1;
        continue;
      }
      await mirrorLocalFile(mediaUrl, { env });
      mirrored += 1;
    } catch (err) {
      if (err?.code === 'ENOENT') {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { checked: urls.length, mirrored, restored, skipped, configured: true };
}

function resetClientForTests() {
  cachedClient = null;
  cachedClientSignature = null;
  clientFactory = (config) => new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

module.exports = {
  UPLOAD_ROOT,
  deleteStoredMedia,
  discardUploadedMedia,
  getObjectMedia,
  inferContentType,
  isObjectStorageConfigured,
  listLocalMediaUrls,
  localPathForMedia,
  mediaUrlForKey,
  mirrorAllLocalMedia,
  mirrorLocalFile,
  normalizeMediaKey,
  objectHead,
  objectStorageRequired,
  persistUploadedFile,
  removeLocalMedia,
  resolveObjectStorageConfig,
  restoreLocalFileFromObject,
  _test: {
    resetClientForTests,
    setClientFactory(factory) {
      clientFactory = factory;
      cachedClient = null;
      cachedClientSignature = null;
    },
  },
};
