const bcrypt = require('bcryptjs');
const { initFirebase } = require('../config/firebase');
const { signToken, ok, fail } = require('../middleware/auth');

// Tiny in-code login throttle (keeps deps minimal — no extra package):
// max 10 attempts per IP per 15 minutes, then 429.
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 15 * 60 * 1000;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > 10;
}

async function login(req, res) {
  if (throttled(req.ip)) return fail(res, 429, 'Too many login attempts. Please try again in 15 minutes.');
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 400, 'Email and password are required.');
  try {
    const { db } = initFirebase();
    const snap = await db.collection('admins').where('email', '==', String(email).trim().toLowerCase()).limit(1).get();
    if (snap.empty) return fail(res, 401, 'Invalid email or password.');
    const doc = snap.docs[0];
    const adminDoc = { id: doc.id, ...doc.data() };
    const match = await bcrypt.compare(String(password), adminDoc.passwordHash || '');
    if (!match) return fail(res, 401, 'Invalid email or password.');
    const token = signToken(adminDoc);
    return ok(res, { token, expiresIn: process.env.JWT_EXPIRES_IN || '2h' }, 'Login successful.');
  } catch (err) {
    return fail(res, 500, 'Login failed. Please try again.');
  }
}

module.exports = { login };
