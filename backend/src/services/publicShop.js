const { randomBytes } = require('node:crypto');
const { dbGet } = require('../db');

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const SLUG = /^[a-z2-7]{12,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newPublicIntakeSlug() {
  // 128 random bits, RFC 4648 base32 without padding.
  let bits = 0;
  let value = 0;
  let slug = '';
  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      slug += BASE32[(value >>> bits) & 31];
    }
  }
  if (bits) slug += BASE32[(value << (5 - bits)) & 31];
  return slug;
}

class PublicShopError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function resolvePublicShop(req) {
  // Path wins for metadata; POST bodies are never a routing authority.
  const link = req.params?.slug ?? req.query?.shop;
  if (link === undefined || link === null || link === '') {
    throw new PublicShopError(400, 'SHOP_LINK_REQUIRED', 'Shop link required');
  }
  const mode = typeof link === 'string' && SLUG.test(link) ? 'slug'
    : typeof link === 'string' && UUID.test(link) ? 'legacy_uuid' : null;
  if (!mode) throw new PublicShopError(404, 'SHOP_NOT_FOUND', 'Shop not found');
  // Legacy UUID links are accepted for one release only. Validate before any UUID query.
  const shop = await dbGet(mode === 'slug'
    ? 'SELECT id FROM shops WHERE public_intake_slug = $1'
    : 'SELECT id FROM shops WHERE id = $1', [link]);
  if (!shop) throw new PublicShopError(404, 'SHOP_NOT_FOUND', 'Shop not found');
  console.info('[Public Intake]', { mode, shop_id: shop.id });
  return shop.id;
}

function sendPublicIntakeError(res, err) {
  if (err instanceof PublicShopError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  // Database errors can contain input values; never log their message/detail here.
  console.error('[Public Intake] Internal server error');
  return res.status(500).json({ error: 'Internal server error' });
}

function validIntakePhotos(photos) {
  if (photos === undefined) return true;
  if (!Array.isArray(photos) || photos.length > 5) return false;
  return photos.every((photo) => {
    if (typeof photo !== 'string' || photo.length > 409600 + 23) return false;
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if (!match || match[1].length % 4 !== 0) return false;
    const bytes = Buffer.from(match[1], 'base64');
    return bytes.length > 0 && bytes.length <= 300 * 1024 && bytes.toString('base64') === match[1];
  });
}

module.exports = { resolvePublicShop, newPublicIntakeSlug, sendPublicIntakeError, validIntakePhotos };
