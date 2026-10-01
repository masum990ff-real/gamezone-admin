// Minimal structured logger (no dependency): single-line JSON with a
// request id. Names/reasons/counts only — never pass secrets, tokens, or
// passwords as msg or fields.
function line(level, msg, fields) {
  try {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: String(msg),
      ...(fields || {}),
    }) + '\n');
  } catch (ignored) {
    // Logging must never crash the process.
  }
}

function info(msg, fields) {
  line('info', msg, fields);
}

function error(msg, fields) {
  line('error', msg, fields);
}

module.exports = { info, error };
