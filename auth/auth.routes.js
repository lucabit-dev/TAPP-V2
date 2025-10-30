const express = require('express');
const { register, login, me } = require('./auth.controller');
const { requireAuth } = require('./auth.middleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);

module.exports = router;


