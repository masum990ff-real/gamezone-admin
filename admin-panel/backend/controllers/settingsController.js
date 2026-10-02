const { FieldValue } = require('firebase-admin/firestore');
const { initFirebase } = require('../config/firebase');
const { ok, fail, plain } = require('../util/respond');

// Public app config (feature 04): support/download links + latest version.
// Written ONLY here via the Admin SDK (clients have no write access per
// Records/firestore.rules); read by the app without login for the update check.
const DEFAULTS = {
  supportLink: '',
  downloadLink: '',
  latestVersionCode: 0,
  latestVersionName: '',
};

function shape(data) {
  const d = data || {};
  return {
    supportLink: typeof d.supportLink === 'string' ? d.supportLink : '',
    downloadLink: typeof d.downloadLink === 'string' ? d.downloadLink : '',
    latestVersionCode: typeof d.latestVersionCode === 'number' ? d.latestVersionCode : 0,
    latestVersionName: typeof d.latestVersionName === 'string' ? d.latestVersionName : '',
    updatedAt: plain(d.updatedAt) || null,
  };
}

async function get(req, res) {
  try {
    const { db } = initFirebase();
    const doc = await db.collection('app_config').doc('public').get();
    return ok(res, shape(doc.exists ? doc.data() : null), '');
  } catch (err) {
    return fail(res, 500, 'Could not load settings.');
  }
}

async function update(req, res) {
  const { supportLink, downloadLink, latestVersionCode, latestVersionName } = req.body || {};
  // Defense in depth — validate.js enforces the same rules at the edge.
  for (const [name, value] of [['Support link', supportLink], ['App download link', downloadLink]]) {
    const v = value == null ? '' : String(value);
    if (v && !v.startsWith('https://')) {
      return fail(res, 400, name + ' must start with https:// (or leave it empty).');
    }
    if (v.length > 2048) return fail(res, 400, name + ' is too long.');
  }
  const code = Number(latestVersionCode);
  if (!Number.isInteger(code) || code < 0) {
    return fail(res, 400, 'Latest version code must be a whole number 0 or higher.');
  }
  if (code > 1000000000) {
    return fail(res, 400, 'Latest version code is too large.');
  }
  const name = latestVersionName == null ? '' : String(latestVersionName);
  if (name.length > 32) return fail(res, 400, 'Latest version name must be 32 characters or fewer.');
  try {
    const { db } = initFirebase();
    const ref = db.collection('app_config').doc('public');
    await ref.set({
      supportLink: supportLink == null ? '' : String(supportLink).trim(),
      downloadLink: downloadLink == null ? '' : String(downloadLink).trim(),
      latestVersionCode: code,
      latestVersionName: name.trim(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const doc = await ref.get();
    return ok(res, shape(doc.exists ? doc.data() : null), 'Settings saved.');
  } catch (err) {
    return fail(res, 500, 'Could not save settings.');
  }
}

module.exports = { get, update };
