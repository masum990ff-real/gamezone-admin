const express = require('express');
const { login } = require('../controllers/authController');
const { loginLimiter } = require('../middleware/rateLimit');
const { validate, loginSchema } = require('../middleware/validate');

const router = express.Router();

router.post('/login', loginLimiter, validate(loginSchema), login);

module.exports = router;
