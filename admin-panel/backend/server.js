require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const { fail } = require('./util/respond');
const logger = require('./util/logger');
const { apiLimiter } = require('./middleware/rateLimit');
const { initFirebase, firebaseStatus, formatFirestoreError } = require('./config/firebase');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Render's proxy (rate limiters)
// Request id on every request (Render logs + X-Request-Id header).
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
// Security headers. CSP allows our own inline scripts/styles, Google Fonts,
// and https: images (notification thumbnail previews); COEP stays off so
// cross-origin previews still render.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
app.use(cors({ origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: '256kb' }));

const frontendDir = path.join(__dirname, '..', 'frontend');
// Static files only from frontend/ (index:false keeps / mapped to login.html below).
app.use(express.static(frontendDir, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

// Lightweight liveness probe (no Firebase touch) for uptime monitors.
app.get('/healthz', (req, res) => res.json({ success: true, data: { ok: true }, message: '' }));

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

app.use('/api/v1', apiLimiter);
// EXTENSION POINTS (future tournament/wallet endpoints slot in here):
// - Add routes/<name>.js + controllers/<name>Controller.js, then mount as
//   app.use('/api/v1/<kebab-name>', <name>Routes) on these same lines.
// - Keep the contract: {success,data,message} via util/respond + kebab-case
//   paths; add one Zod schema per write endpoint in middleware/validate.js.
// - List endpoints MUST take page/limit and use cursor pagination
//   (orderBy + startAfter + limit), never offset over large collections.
// - Multi-field filter/sort queries need Firestore COMPOSITE INDEXES deployed
//   in the console first (e.g. tournaments by status+startTime, wallet ledger
//   by uid+createdAt) — single-field orderBy/where needs no composite index.
// - Batch related reads (whereIn / Promise.all), never N+1 per-item gets.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/settings', settingsRoutes);

app.use('/api', (req, res) => fail(res, 404, 'Route not found.'));
app.get(/.*/, (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
// Central error handler (Express 5 also forwards async rejections here):
// consistent JSON, never a stack trace to the client.
app.use((err, req, res, next) => {
  // Malformed JSON bodies used to surface as a generic 500; they are a bad
  // request, so answer 400 in the same {success,data,message} contract.
  // (body-parser marks them with status 400 + entity.parse.failed.)
  if (err && err.status === 400 && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'Invalid request body.');
  }
  logger.error('Unhandled error', { reqId: req && req.id, route: req && req.path });
  return fail(res, 500, 'Something went wrong.');
});

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
  const server = app.listen(PORT, () => {
    console.log('GameZone admin backend listening on port ' + PORT);
  });
  // Graceful shutdown: stop taking traffic, then exit.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
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
