require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { fail } = require('./util/respond');
const { initFirebase } = require('./config/firebase');

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
  return res.json({
    success: true,
    data: { ok: true, firebase },
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
});

// Boot-time config check: one clear single-line error per missing/invalid env.
// The server still starts so GET /health can report firebase:false in a browser.
function checkEnv() {
  if (!process.env.JWT_SECRET) console.error('[config] JWT_SECRET is not set. Set a long random string (see .env.example).');
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) {
    console.error('[config] FIREBASE_SERVICE_ACCOUNT is not set. Paste the service-account JSON on one line (see .env.example).');
  } else if (raw.startsWith('{')) {
    try {
      JSON.parse(raw);
    } catch (ignored) {
      console.error('[config] FIREBASE_SERVICE_ACCOUNT is not valid JSON. Re-paste the service-account file content on one line.');
    }
  }
  if (!process.env.ADMIN_SEED_EMAIL) console.error('[config] ADMIN_SEED_EMAIL is not set. Seed (npm run seed:admin) cannot run without it.');
  if (!process.env.ADMIN_SEED_PASSWORD) console.error('[config] ADMIN_SEED_PASSWORD is not set. Seed (npm run seed:admin) cannot run without it.');
}
