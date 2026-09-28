// firebase-admin 14 modular API (verified against the installed 14.3.0
// runtime): the default entry has NO .credential/.firestore/.auth/.messaging
// namespaces, so init + services come from the documented subpath modules.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

// Expected GCP project — compared by NAME only. Never log secrets.
const EXPECTED_PROJECT_ID = 'game-zone-esports-77';

// Firestore database ID — defaults to '(default)'. Set FIRESTORE_DATABASE_ID
// only if the Firebase console shows a different database ID for this project.
// NOTE: only Standard edition databases are reachable by this backend;
// Enterprise edition databases are NOT reachable via getFirestore().
function getFirestoreDatabaseId() {
  const raw = String(process.env.FIRESTORE_DATABASE_ID || '').trim();
  return raw || '(default)';
}

// Module-level status: names/reasons only, never secret values.
// reason: null | 'missing_env' | 'bad_json' | 'missing_field:<name>'
//       | 'bad_key:<sanitized-msg>' | 'wrong_project:<id>'
const firebaseStatus = { initialized: false, reason: null };

// Singleton: initialized once, reused everywhere (rules.md section 4).
let db = null;
let messaging = null;
let auth = null;

// Keep boot logs safe: first line only, collapsed whitespace, truncated,
// and stripped of anything resembling key material.
function sanitizeMsg(msg) {
  let s = String(msg || 'unknown error').split('\n')[0];
  s = s.replace(/-----BEGIN[^-]*-----/g, '[key]')
    .replace(/-----END[^-]*-----/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 120) s = s.slice(0, 120);
  return s || 'unknown error';
}

// Full Firestore error formatter for server logs (seed/login/health paths).
// Firestore error messages contain resource paths, never credentials, so the
// FULL code + message + details are logged — earlier 120-char truncation hid
// the database/resource name in gRPC 5 NOT_FOUND errors. Never pass env
// values or key material into this; err objects only.
function formatFirestoreError(err) {
  const code = err && err.code !== undefined ? String(err.code) : 'unknown';
  let msg = String((err && err.message) || 'unknown error');
  msg = msg.replace(/-----BEGIN[^-]*-----/g, '[key]')
    .replace(/-----END[^-]*-----/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim();
  let details = '';
  try {
    if (err && err.details !== undefined && err.details !== null && String(err.details).trim()) {
      details = ' | details: ' + String(err.details).replace(/\s+/g, ' ').trim();
    }
  } catch (ignored) {
    // details are best-effort only
  }
  return 'code ' + code + ': ' + (msg || 'unknown error') + details;
}

// Strip ONE layer of surrounding matching single/double quotes.
function stripOuterQuotes(s) {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1).trim();
    }
  }
  return s;
}

// Parse FIREBASE_SERVICE_ACCOUNT in every common paste format:
// (a) single-line JSON, (b) pretty-printed multi-line JSON (JSON.parse
// tolerates whitespace), (c) value wrapped in surrounding quotes,
// (d) base64-encoded JSON (fallback). Legacy: absolute file path.
function parseServiceAccount(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return { account: null, reason: 'missing_env' };
  }
  const candidate = stripOuterQuotes(trimmed);

  // 1) Direct JSON.parse (covers single-line AND multi-line).
  try {
    const parsed = JSON.parse(candidate);
    return { account: parsed, reason: null };
  } catch (ignored) {
    // fall through to base64 / file-path fallbacks
  }

  // 2) Base64-encoded JSON fallback.
  try {
    const decoded = Buffer.from(candidate, 'base64').toString('utf8').trim();
    if (decoded && decoded !== candidate) {
      const parsed = JSON.parse(stripOuterQuotes(decoded));
      return { account: parsed, reason: null };
    }
  } catch (ignored) {
    // fall through
  }

  // 3) Legacy absolute file path (local dev).
  if (!candidate.startsWith('{')) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const fromFile = require(candidate);
      return { account: fromFile && fromFile.default ? fromFile.default : fromFile, reason: null };
    } catch (ignored) {
      // fall through to bad_json below
    }
  }

  return { account: null, reason: 'bad_json' };
}

function initFirebase() {
  if (db) {
    firebaseStatus.initialized = true;
    firebaseStatus.reason = null;
    return { db, messaging, auth };
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  const { account: serviceAccount, reason: parseReason } = parseServiceAccount(raw);
  if (parseReason) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = parseReason;
    throw new Error('Firebase not configured (' + parseReason + ').');
  }
  if (!serviceAccount || typeof serviceAccount !== 'object') {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'bad_json';
    throw new Error('Firebase not configured (bad_json).');
  }
  // Validate required fields — record WHICH check failed (name only).
  if (serviceAccount.type !== 'service_account') {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'missing_field:type';
    throw new Error('Firebase not configured (missing_field:type).');
  }
  if (!serviceAccount.project_id) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'missing_field:project_id';
    throw new Error('Firebase not configured (missing_field:project_id).');
  }
  if (!serviceAccount.private_key) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'missing_field:private_key';
    throw new Error('Firebase not configured (missing_field:private_key).');
  }
  if (!serviceAccount.client_email) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'missing_field:client_email';
    throw new Error('Firebase not configured (missing_field:client_email).');
  }
  // Verify the project matches (name only, never secrets).
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'wrong_project:' + String(serviceAccount.project_id);
    throw new Error('Firebase not configured (wrong_project).');
  }
  // Classic newline bug: double-escaped pastes carry literal backslash-n.
  // A valid PEM never contains a literal backslash, so this is safe.
  if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  try {
    // initializeApp with a credential is not idempotent — guard with getApps().
    let app;
    if (getApps().length === 0) {
      app = initializeApp({ credential: cert(serviceAccount) });
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app, getFirestoreDatabaseId());
    messaging = getMessaging(app);
    auth = getAuth(app);
  } catch (err) {
    firebaseStatus.initialized = false;
    firebaseStatus.reason = 'bad_key:' + sanitizeMsg(err && err.message);
    throw new Error('Firebase not configured (bad_key).');
  }
  firebaseStatus.initialized = true;
  firebaseStatus.reason = null;
  return { db, messaging, auth };
}

module.exports = { initFirebase, firebaseStatus, EXPECTED_PROJECT_ID, getFirestoreDatabaseId, formatFirestoreError };
