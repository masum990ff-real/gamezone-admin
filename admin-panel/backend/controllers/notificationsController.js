const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { initFirebase, formatFirestoreError } = require('../config/firebase');
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
  if (cleanTitle.length > 200) return fail(res, 400, 'Title must be 200 characters or fewer.');
  if (cleanBody.length > 2000) return fail(res, 400, 'Message must be 2000 characters or fewer.');
  const cleanImage = imageUrl ? String(imageUrl).trim() : '';
  // FCM imageUrl must be an https URL — an empty, http-only, or non-URL
  // string fails FCM payload validation and rejects the WHOLE send, so only
  // a non-empty https URL may enter the payload.
  const hasImage = cleanImage.startsWith('https://');
  if (cleanImage && !hasImage) {
    return fail(res, 400, 'Image URL must start with https:// (or leave it empty).');
  }
  // Request id: ties the Render log line to the history row and the response.
  const sendId = crypto.randomUUID();
  try {
    const { db, messaging } = initFirebase();
    const message = {
      topic: 'all_users',
      notification: { title: cleanTitle, body: cleanBody },
      data: { title: cleanTitle, body: cleanBody },
      android: {
        priority: 'high',
        ttl: 60000,
        notification: {
          channelId: 'gamezone_fcm',
          sound: 'default',
          visibility: 'public',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1, 'mutable-content': 1 } },
      },
    };
    if (hasImage) {
      message.notification.imageUrl = cleanImage;
      message.data.imageUrl = cleanImage;
      message.android.notification.imageUrl = cleanImage;
    }
    const messageId = await messaging.send(message);
    const record = {
      title: cleanTitle,
      body: cleanBody,
      imageUrl: cleanImage,
      sendId,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: (req.admin && req.admin.email) || 'admin',
      successCount: 1,
      failureCount: 0,
      messageId,
    };
    await db.collection('notifications_history').add(record);
    return ok(res, { messageId, successCount: 1, failureCount: 0, sendId }, 'Notification sent.');
  } catch (err) {
    const reason = formatFirestoreError(err);
    console.error('Broadcast send failed [sendId=' + sendId + ']: ' + reason);
    try {
      const { db } = initFirebase();
      await db.collection('notifications_history').add({
        title: cleanTitle,
        body: cleanBody,
        imageUrl: cleanImage,
        sendId,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: (req.admin && req.admin.email) || 'admin',
        successCount: 0,
        failureCount: 1,
        error: String((err && err.message) || err).slice(0, 500),
      });
    } catch (ignored) {
      // History logging must never mask the original send error.
    }
    return fail(res, 500, 'Notification could not be sent: ' + reason);
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
      createdAt: FieldValue.serverTimestamp(),
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
