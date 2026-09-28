const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { initFirebase, firebaseStatus } = require('../config/firebase');

// First-admin bootstrap: hashes a password from env into admins/{id}.
// There is intentionally NO public register route.
async function main() {
  const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '');
  const role = String(process.env.ADMIN_SEED_ROLE || 'superadmin').trim() || 'superadmin';
  if (!email || !password) {
    console.error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in backend/.env first (see .env.example).');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_SEED_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }
  let db;
  try {
    ({ db } = initFirebase());
  } catch (err) {
    console.error('Seed failed: Firebase is not configured (reason: ' + (firebaseStatus.reason || 'unknown') + '). Fix FIREBASE_SERVICE_ACCOUNT, redeploy, then re-run. Check server Logs for [config] lines and GET /health.');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const snap = await db.collection('admins').where('email', '==', email).limit(1).get();
  if (snap.empty) {
    await db.collection('admins').add({
      email,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    });
    console.log('Admin created for ' + email + '. You can now log in.');
  } else {
    await snap.docs[0].ref.update({ passwordHash, role });
    console.log('Admin password updated for ' + email + '. You can now log in.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
