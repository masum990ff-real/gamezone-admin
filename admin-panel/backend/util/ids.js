// Firestore document-id guard for :id params. doc() throws on an empty id,
// an id containing '/', or an over-long id — that used to surface as a 500.
// Invalid ids are treated as "not found" so the contract stays byte-identical.
function isValidDocId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 500 && !id.includes('/');
}

module.exports = { isValidDocId };
