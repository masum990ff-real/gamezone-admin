// express-rate-limit v8 guards. Login keeps the old 10-tries/IP/15min rule
// (previously a hand-rolled map, now the maintained middleware); the whole
// /api/v1 surface gets a generous global guard. trust proxy stays one
// Render hop (server.js), so the library's spoof warning is disabled.
const { rateLimit } = require('express-rate-limit');
const { fail } = require('../util/respond');

function jsonHandler(message) {
  return (req, res) => fail(res, 429, message);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: jsonHandler('Too many login attempts. Please try again in 15 minutes.'),
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: jsonHandler('Too many requests. Please slow down and try again.'),
});

module.exports = { loginLimiter, apiLimiter };
