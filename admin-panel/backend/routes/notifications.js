const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, sendSchema, templateSchema } = require('../middleware/validate');
const { send, history, listTemplates, createTemplate, deleteTemplate } = require('../controllers/notificationsController');

const router = express.Router();

router.use(requireAuth);

router.post('/send', validate(sendSchema), send);
router.get('/history', history);
router.get('/templates', listTemplates);
router.post('/templates', validate(templateSchema), createTemplate);
router.delete('/templates/:id', deleteTemplate);

module.exports = router;
