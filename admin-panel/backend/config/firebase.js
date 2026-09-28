const admin = require('firebase-admin');

// Singleton: initialized once, reused everywhere (rules.md section 4).
let db = null;
let messaging = null;
let auth = null;

function initFirebase() {
  if (db) return { db, messaging, auth };
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. ' +
      'Paste the service-account JSON (single line) or a file path into the env var. ' +
      'See .env.example — the real secret is never committed.'
    );
  }
  // Env holds either the full JSON or a path to the JSON file.
  const serviceAccount = raw.startsWith('{') ? JSON.parse(raw) : require(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  messaging = admin.messaging();
  auth = admin.auth();
  return { db, messaging, auth };
}

module.exports = { initFirebase };
