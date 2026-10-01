const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, banSchema } = require('../middleware/validate');
const { list, detail, ban, unban } = require('../controllers/usersController');

const router = express.Router();

router.use(requireAuth);

router.get('/', list);
router.get('/:id', detail);
router.post('/:id/ban', validate(banSchema), ban);
router.post('/:id/unban', unban);

module.exports = router;
