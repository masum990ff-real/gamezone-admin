const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { stats } = require('../controllers/dashboardController');

const router = express.Router();

router.use(requireAuth);

router.get('/stats', stats);

module.exports = router;
