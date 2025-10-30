const jwt = require('jsonwebtoken');
const User = require('./user.model');

function signJwt(user) {
  const payload = { sub: user._id.toString(), email: user.email, name: user.name || '' };
  const secret = process.env.JWT_SECRET || 'dev_secret';
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

async function register(req, res) {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({ email, passwordHash, name });

    const token = signJwt(user);
    return res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Registration error:', err);
    const isDev = process.env.NODE_ENV !== 'production';
    return res.status(500).json({ 
      error: isDev ? err.message : 'Registration failed. Please try again.' 
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    // Explicitly select passwordHash in case schema changes to select: false in future
    const user = await User.findOne({ email }).select('email name passwordHash');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Guard against legacy users without a passwordHash
    if (!user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await user.validatePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signJwt(user);
    return res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    const isDev = process.env.NODE_ENV !== 'production';
    return res.status(500).json({ 
      error: isDev ? err.message : 'Login failed. Please try again.' 
    });
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = { register, login, me };


