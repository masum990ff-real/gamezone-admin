const { initFirebase } = require('../config/firebase');
const { ok, fail } = require('../util/respond');

// Server-side counts via Admin SDK count() aggregation (performance.md Rule 2:
// the index does the work — single-field createdAt filters need no composite index).
async function stats(req, res) {
  try {
    const { db } = initFirebase();
    const users = db.collection('users');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalSnap, todaySnap, weekSnap] = await Promise.all([
      users.count().get(),
      users.where('createdAt', '>=', startOfDay).count().get(),
      users.where('createdAt', '>=', weekAgo).count().get(),
    ]);
    return ok(res, {
      totalUsers: totalSnap.data().count,
      joinedToday: todaySnap.data().count,
      joinedWeek: weekSnap.data().count,
    });
  } catch (err) {
    return fail(res, 500, 'Could not load dashboard stats.');
  }
}

module.exports = { stats };
