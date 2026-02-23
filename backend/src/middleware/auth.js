const jwt = require('jsonwebtoken');
const { dbGet } = require('../db');

module.exports = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);

    // Check individual token revocation by jti
    if (decoded.jti) {
      const revoked = await dbGet('SELECT id FROM revoked_tokens WHERE token_jti = $1', [decoded.jti]);
      if (revoked) return res.status(401).json({ error: 'Session revoked. Please log in again.' });
    }

    // Check revoke-all: token issued before the user's revoke_all_before timestamp
    if (decoded.iat) {
      const user = await dbGet('SELECT revoke_all_before FROM users WHERE id = $1', [decoded.id]);
      if (user?.revoke_all_before) {
        const revokeTs = Math.floor(new Date(user.revoke_all_before).getTime() / 1000);
        if (decoded.iat < revokeTs) {
          return res.status(401).json({ error: 'Session revoked. Please log in again.' });
        }
      }
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
