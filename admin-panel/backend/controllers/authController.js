const bcrypt = require('bcryptjs');
const { initFirebase, formatFirestoreError } = require('../config/firebase');
const { signToken, ok, fail } = require('../middleware/auth');

// Login brute-force protection lives in middleware/rateLimit.js
// (express-rate-limit, 10 tries/IP/15min) — applied on the route.

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 400, 'Email and password are required.');
  let db;
  try {
    ({ db } = initFirebase());
  } catch (ignored) {
    return fail(res, 500, 'Server not configured. Contact administrator.');
  }
  if (!process.env.JWT_SECRET) return fail(res, 500, 'Server not configured. Contact administrator.');
  try {
    const snap = await db.collection('admins').where('email', '==', String(email).trim().toLowerCase()).limit(1).get();
    if (snap.empty) return fail(res, 401, 'Invalid email or password.');
    const doc = snap.docs[0];
    const adminDoc = { id: doc.id, ...doc.data() };
    const match = await bcrypt.compare(String(password), adminDoc.passwordHash || '');
    if (!match) return fail(res, 401, 'Invalid email or password.');
    const token = signToken(adminDoc);
    return ok(res, { token, expiresIn: process.env.JWT_EXPIRES_IN || '7d' }, 'Login successful.');
  } catch (err) {
    // Log the FULL Firestore error (code + message + details): the resource
    // path in 5 NOT_FOUND errors names the missing database.
    console.error('Login error: ' + formatFirestoreError(err));
    return fail(res, 500, 'Login service error. Check server logs.');
  }
}

module.exports = { login };
