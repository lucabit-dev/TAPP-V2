const jwt = require('jsonwebtoken');
const User = require('./user.model');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const secret = process.env.JWT_SECRET || 'dev_secret';
    const payload = jwt.verify(token, secret);
    const user = await User.findById(payload.sub).select('_id email name');
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = { id: user._id.toString(), email: user.email, name: user.name || '' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };


