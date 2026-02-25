const crypto = require('crypto');

function unauthorized(res, code, message, status = 401) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}

module.exports = function apiKeyAuth(req, res, next) {
  const configuredKey = process.env.REVV_AGENT_API_KEY;
  if (!configuredKey) {
    return unauthorized(res, 'API_KEY_NOT_CONFIGURED', 'Agent API is not configured on this server.', 503);
  }

  const headerKey = req.get('x-api-key') || '';
  const authHeader = req.get('authorization') || '';
  const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const providedKey = headerKey || bearerKey;

  if (!providedKey) {
    return unauthorized(res, 'API_KEY_REQUIRED', 'Provide an API key using x-api-key or Authorization: Bearer <key>.');
  }

  const expected = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return unauthorized(res, 'API_KEY_INVALID', 'Invalid API key.');
  }

  return next();
};
