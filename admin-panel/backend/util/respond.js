// Uniform { success, data, message } responses (rules.md section 4) plus a
// Firestore → plain-JSON converter (Timestamps become ISO strings).
function ok(res, data, message) {
  return res.status(200).json({ success: true, data: data == null ? {} : data, message: message || '' });
}

function created(res, data, message) {
  return res.status(201).json({ success: true, data: data == null ? {} : data, message: message || '' });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, data: null, message: message || 'Something went wrong.' });
}

function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = plain(value[key]);
    return out;
  }
  return value;
}

module.exports = { ok, created, fail, plain };
