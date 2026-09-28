const admin = require('firebase-admin');
const { initFirebase } = require('../config/firebase');
const { ok, created, fail, plain } = require('../util/respond');

function pageParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit };
}

// NOTE: the legacy sendToTopic() API was removed from firebase-admin (v13+),
// so broadcasts use send({ topic }) which returns a message ID, not per-device
// counts. History records accepted(1)/failed(1) for the fan-out request itself.
async function send(req, res) {
  const { title, body, imageUrl } = req.body || {};
  if (!title || !String(title).trim() || !body || !String(body).trim()) {
    return fail(res, 400, 'Title and body are required.');
  }
  const cleanTitle = String(title).trim();
  const cleanBody = String(body).trim();
  const cleanImage = imageUrl ? String(imageUrl).trim() : '';
  try {
    const { db, messaging } = initFirebase();
    const message = {
      topic: 'all_users',
      notification: { title: cleanTitle, body: cleanBody },
      data: { title: cleanTitle, body: cleanBody },
      android: { priority: 'high', notification: { channelId: 'gamezone_updates' } },
    };
    if (cleanImage) {
      message.notification.imageUrl = cleanImage;
      message.data.imageUrl = cleanImage;
      message.android.notification.imageUrl = cleanImage;
    }
    const messageId = await messaging.send(message);
    const record = {
      title: cleanTitle,
      body: cleanBody,
      imageUrl: cleanImage,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy: (req.admin && req.admin.email) || 'admin',
      successCount: 1,
      failureCount: 0,
      messageId,
    };
    await db.collection('notifications_history').add(record);
    return ok(res, { messageId, successCount: 1, failureCount: 0 }, 'Notification sent.');
  } catch (err) {
    try {
      const { db } = initFirebase();
      await db.collection('notifications_history').add({
        title: cleanTitle,
        body: cleanBody,
        imageUrl: cleanImage,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: (req.admin && req.admin.email) || 'admin',
        successCount: 0,
        failureCount: 1,
        error: String((err && err.message) || err),
      });
    } catch (ignored) {
      // History logging must never mask the original send error.
    }
    return fail(res, 500, 'Notification could not be sent.');
  }
}

async function history(req, res) {
  const { page, limit } = pageParams(req);
  try {
    const { db } = initFirebase();
    const base = db.collection('notifications_history').orderBy('sentAt', 'desc');
    const totalSnap = await db.collection('notifications_history').count().get();
    const snap = await base.offset((page - 1) * limit).limit(limit).get();
    const items = snap.docs.map((d) => plain({ id: d.id, ...d.data() }));
    return ok(res, { notifications: items, page, limit, total: totalSnap.data().count });
  } catch (err) {
    return fail(res, 500, 'Could not load notification history.');
  }
}

async function listTemplates(req, res) {
  try {
    const { db } = initFirebase();
    const snap = await db.collection('notification_templates').orderBy('createdAt', 'desc').limit(100).get();
    return ok(res, snap.docs.map((d) => plain({ id: d.id, ...d.data() })));
  } catch (err) {
    return fail(res, 500, 'Could not load templates.');
  }
}

async function createTemplate(req, res) {
  const { title, body, imageUrl } = req.body || {};
  if (!title || !String(title).trim() || !body || !String(body).trim()) {
    return fail(res, 400, 'Title and body are required.');
  }
  try {
    const { db } = initFirebase();
    const ref = await db.collection('notification_templates').add({
      title: String(title).trim(),
      body: String(body).trim(),
      imageUrl: imageUrl ? String(imageUrl).trim() : '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const doc = await ref.get();
    return created(res, plain({ id: doc.id, ...doc.data() }), 'Template saved.');
  } catch (err) {
    return fail(res, 500, 'Could not save template.');
  }
}

async function deleteTemplate(req, res) {
  try {
    const { db } = initFirebase();
    const ref = db.collection('notification_templates').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 404, 'Template not found.');
    await ref.delete();
    return ok(res, { id: req.params.id }, 'Template deleted.');
  } catch (err) {
    return fail(res, 500, 'Could not delete template.');
  }
}

module.exports = { send, history, listTemplates, createTemplate, deleteTemplate };
