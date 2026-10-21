const jwt = require('jsonwebtoken');
const { dbGet } = require('../db');

async function authenticate(req, res, next, optional = false) {
  const reject = error => {
    if (optional) {
      delete req.user;
      return next();
    }
    return res.status(401).json({ error });
  };
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return reject('Unauthorized');
  let signatureVerified = false;
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    signatureVerified = true;

    // Check individual token revocation by jti
    if (decoded.jti) {
      const revoked = await dbGet('SELECT id FROM revoked_tokens WHERE token_jti = $1', [decoded.jti]);
      if (revoked) return reject('Session revoked. Please log in again.');
    }

    // Check revoke-all: token issued before the user's revoke_all_before timestamp
    if (decoded.iat) {
      const user = await dbGet('SELECT revoke_all_before FROM users WHERE id = $1', [decoded.id]);
      if (user?.revoke_all_before) {
        const revokeTs = Math.floor(new Date(user.revoke_all_before).getTime() / 1000);
        if (decoded.iat < revokeTs) {
          return reject('Session revoked. Please log in again.');
        }
      }
    }

    req.user = decoded;
    next();
  } catch {
    // A verification-store outage is not proof that a signed caller is ordinary.
    // Public intake may succeed, but its alert must remain fail-closed.
    if (optional && signatureVerified) req.prospectIdentityUnavailable = true;
    return reject('Invalid token');
  }
}

module.exports = (req, res, next) => authenticate(req, res, next);
module.exports.optional = (req, res, next) => authenticate(req, res, next, true);
