const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, settingsSchema } = require('../middleware/validate');
const { get, update } = require('../controllers/settingsController');

const router = express.Router();

router.use(requireAuth);

router.get('/', get);
router.put('/', validate(settingsSchema), update);

module.exports = router;
