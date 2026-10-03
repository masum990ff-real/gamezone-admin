const jwt = require('jsonwebtoken');
const { ok, fail } = require('../util/respond');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, 'Missing admin token. Please log in again.');
  try {
    // HS256 only: tokens are HMAC-signed with JWT_SECRET (signToken below).
    req.admin = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch (err) {
    return fail(res, 401, 'Session expired. Please log in again.');
  }
}

function signToken(adminDoc) {
  return jwt.sign(
    { uid: adminDoc.id, email: adminDoc.email, role: adminDoc.role || 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: 'HS256' }
  );
}

module.exports = { requireAuth, signToken, ok, fail };
