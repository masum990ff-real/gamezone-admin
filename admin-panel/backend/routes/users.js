const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { list, detail, ban, unban } = require('../controllers/usersController');

const router = express.Router();

router.use(requireAuth);

router.get('/', list);
router.get('/:id', detail);
router.post('/:id/ban', ban);
router.post('/:id/unban', unban);

module.exports = router;
