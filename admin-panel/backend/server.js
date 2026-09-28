require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { fail } = require('./util/respond');
const { initFirebase, firebaseStatus, formatFirestoreError } = require('./config/firebase');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Render's proxy (login throttle)
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
app.use(cors({ origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: '256kb' }));

const frontendDir = path.join(__dirname, '..', 'frontend');
// Static files only from frontend/ (index:false keeps / mapped to login.html below).
app.use(express.static(frontendDir, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

app.get('/health', async (req, res) => {
  let firebase = false;
  let db = null;
  try {
    ({ db } = initFirebase());
    firebase = true;
  } catch (ignored) {
    firebase = false;
  }
  const firebaseReason = firebase ? null : firebaseStatus.reason;
  // Firestore reachability: cheap admins limit(1) read. Init can succeed
  // while every data call fails (e.g. gRPC 5 NOT_FOUND when the target
  // database does not exist), so report reachability separately.
  let firestore = false;
  let firestoreReason = null;
  if (db) {
    try {
      await db.collection('admins').limit(1).get();
      firestore = true;
    } catch (err) {
      firestoreReason = formatFirestoreError(err);
      console.error('Health Firestore check failed: ' + firestoreReason);
    }
  } else {
    firestoreReason = firebaseReason;
  }
  return res.json({
    success: true,
    data: { ok: true, firebase, firebaseReason, firestore, firestoreReason },
    message: firebase ? (firestore ? '' : 'Firestore is not reachable. Check server logs.') : 'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT.',
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use('/api', (req, res) => fail(res, 404, 'Route not found.'));
app.get(/.*/, (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.use((err, req, res, next) => fail(res, 500, 'Something went wrong.'));

const PORT = parseInt(process.env.PORT, 10) || 3000;
checkEnv();
// Await the seed read-then-write BEFORE listening so the first login attempt
// never races the first-run admin creation. The server still starts even if
// the seed check fails, so GET /health stays checkable.
start();
async function start() {
  try {
    await autoSeedAdmin(); // free-plan first run: no Shell needed
  } catch (err) {
    console.error('Auto-seed check failed.');
  }
  app.listen(PORT, () => {
    console.log('GameZone admin backend listening on port ' + PORT);
  });
}

// Boot-time config check: one clear single-line error per missing/invalid env.
// Names and reasons only — never secret values.
// The server still starts so GET /health can report firebase:false in a browser.
function checkEnv() {
  if (!process.env.JWT_SECRET) console.error('[config] JWT_SECRET is not set. Set a long random string (see .env.example).');
  try {
    initFirebase();
  } catch (ignored) {
    // firebaseStatus.reason now holds the precise cause.
  }
  if (!firebaseStatus.initialized) {
    const r = firebaseStatus.reason || 'unknown';
    if (r === 'missing_env') {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT is not set. Paste the service-account JSON on one line (see .env.example).');
    } else if (r === 'bad_json') {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT is not valid JSON (or base64/file-path). Re-paste the service-account file content on one line.');
    } else if (r.startsWith('missing_field:')) {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT ' + r + '. Re-paste the FULL service-account JSON with no edits.');
    } else if (r.startsWith('bad_key:')) {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT ' + r + '. Check the private_key newlines (see .env.example).');
    } else if (r.startsWith('wrong_project:')) {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT ' + r + '. Expected project game-zone-esports-77.');
    } else {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT not configured (' + r + ').');
    }
  }
  if (!process.env.ADMIN_SEED_EMAIL) console.error('[config] ADMIN_SEED_EMAIL is not set. First-run auto-seed is disabled.');
  if (!process.env.ADMIN_SEED_PASSWORD) console.error('[config] ADMIN_SEED_PASSWORD is not set. First-run auto-seed is disabled.');
}

// Free-plan first-run bootstrap (no Shell needed): upserts the seed admin by
// EXACT email on every boot — creates the doc if missing, leaves an existing
// one untouched. Every outcome logs one clear line (names only, never secrets)
// so free-plan Logs alone diagnose login failures. Fixing a typo'd
// ADMIN_SEED_EMAIL means correcting the env var and redeploying, which then
// creates the correct admin. Passwords are never logged — only the email, and
// only on creation. NOTE: scripts/seedAdmin.js (Shell) instead RESETS the
// password on an existing email — intentionally different; do not "align" this.
async function autoSeedAdmin() {
  const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('Auto-seed skipped: ADMIN_SEED_EMAIL is not a valid email address');
    return;
  }
  if (password.length < 8) {
    console.log('Auto-seed skipped: ADMIN_SEED_PASSWORD must be at least 8 characters.');
    return;
  }
  let seedDb;
  try {
    ({ db: seedDb } = initFirebase());
  } catch (ignored) {
    console.error('Auto-seed skipped: Firebase not configured (' + (firebaseStatus.reason || 'unknown') + ').');
    return; // cause already logged by checkEnv() and visible in GET /health
  }
  try {
    const snap = await seedDb.collection('admins').where('email', '==', email).limit(1).get();
    if (!snap.empty) {
      console.log('Admin ' + email + ' already exists (not modified)');
      return;
    }
    const role = String(process.env.ADMIN_SEED_ROLE || 'superadmin').trim() || 'superadmin';
    const passwordHash = await bcrypt.hash(password, 10);
    await seedDb.collection('admins').add({
      email,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    });
    console.log('Admin auto-created for ' + email);
  } catch (err) {
    // Log the FULL Firestore error (code + message + details): the resource
    // path in 5 NOT_FOUND errors names the missing database. Free plan has
    // no Shell — fix env vars and redeploy.
    console.error('Admin auto-seed skipped (' + formatFirestoreError(err) + '). Fix env vars and redeploy.');
  }
}
