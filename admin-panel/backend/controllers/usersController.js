const { FieldValue } = require('firebase-admin/firestore');
const { initFirebase } = require('../config/firebase');
const { ok, fail, plain } = require('../util/respond');

function pageParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit };
}

// Newest first via single-field orderBy(createdAt desc) — no composite index needed.
async function list(req, res) {
  const { page, limit } = pageParams(req);
  try {
    const { db } = initFirebase();
    const base = db.collection('users').orderBy('createdAt', 'desc');
    const totalSnap = await db.collection('users').count().get();
    const snap = await base.offset((page - 1) * limit).limit(limit).get();
    const users = snap.docs.map((d) => plain({ id: d.id, ...d.data() }));
    return ok(res, { users, page, limit, total: totalSnap.data().count });
  } catch (err) {
    return fail(res, 500, 'Could not load users.');
  }
}

async function detail(req, res) {
  try {
    const { db } = initFirebase();
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists) return fail(res, 404, 'User not found.');
    return ok(res, plain({ id: doc.id, ...doc.data() }));
  } catch (err) {
    return fail(res, 500, 'Could not load user.');
  }
}

async function ban(req, res) {
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return fail(res, 400, 'A ban reason is required.');
  try {
    const { db, auth } = initFirebase();
    const ref = db.collection('users').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 404, 'User not found.');
    await ref.update({
      isBanned: true,
      banReason: reason,
      bannedAt: FieldValue.serverTimestamp(),
    });
    try {
      await auth.revokeRefreshTokens(req.params.id);
    } catch (ignored) {
      // Token revocation is defense-in-depth only; the app checks isBanned anyway.
    }
    return ok(res, { id: req.params.id, isBanned: true }, 'User banned.');
  } catch (err) {
    return fail(res, 500, 'Could not ban user.');
  }
}

async function unban(req, res) {
  try {
    const { db } = initFirebase();
    const ref = db.collection('users').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 404, 'User not found.');
    await ref.update({
      isBanned: false,
      banReason: '',
      unbannedAt: FieldValue.serverTimestamp(),
    });
    return ok(res, { id: req.params.id, isBanned: false }, 'User unbanned.');
  } catch (err) {
    return fail(res, 500, 'Could not unban user.');
  }
}

module.exports = { list, detail, ban, unban };
