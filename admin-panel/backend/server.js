require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { fail } = require('./util/respond');
const { initFirebase, firebaseStatus } = require('./config/firebase');

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

app.get('/health', (req, res) => {
  let firebase = false;
  try {
    initFirebase();
    firebase = true;
  } catch (ignored) {
    firebase = false;
  }
  const firebaseReason = firebase ? null : firebaseStatus.reason;
  return res.json({
    success: true,
    data: { ok: true, firebase, firebaseReason },
    message: firebase ? '' : 'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT.',
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
app.listen(PORT, () => {
  console.log('GameZone admin backend listening on port ' + PORT);
  autoSeedAdmin(); // free-plan first run: no Shell needed
});

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
  if (!process.env.ADMIN_SEED_EMAIL) console.error('[config] ADMIN_SEED_EMAIL is not set. First-run auto-seed is disabled (or run npm run seed:admin in Shell).');
  if (!process.env.ADMIN_SEED_PASSWORD) console.error('[config] ADMIN_SEED_PASSWORD is not set. First-run auto-seed is disabled (or run npm run seed:admin in Shell).');
}

// Free-plan first-run bootstrap (no Shell needed): if ADMIN_SEED_EMAIL +
// ADMIN_SEED_PASSWORD (8+ chars) are set AND the admins collection is EMPTY,
// create the first admin once. Non-empty collection -> do nothing, log nothing.
// Passwords are never logged — only the email, and only on creation.
async function autoSeedAdmin() {
  const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '');
  if (!email || password.length < 8) return;
  let seedDb;
  try {
    ({ db: seedDb } = initFirebase());
  } catch (ignored) {
    return; // cause already logged by checkEnv() and visible in GET /health
  }
  try {
    const snap = await seedDb.collection('admins').limit(1).get();
    if (!snap.empty) return;
    const role = String(process.env.ADMIN_SEED_ROLE || 'superadmin').trim() || 'superadmin';
    const passwordHash = await bcrypt.hash(password, 10);
    await seedDb.collection('admins').add({
      email,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    });
    console.log('Admin auto-created for ' + email + ' (first run only)');
  } catch (err) {
    const msg = String((err && err.message) || 'unknown error').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120);
    console.error('Admin auto-seed skipped (' + (msg || 'unknown error') + '). Fix env vars and redeploy, or run npm run seed:admin in Shell.');
  }
}
