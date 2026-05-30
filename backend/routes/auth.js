const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const logger = require('../utils/logger');
const { formatLocalDate } = require('../utils/date');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    logger.warn('Login rejected: missing credentials', { username });
    return res.status(400).json({ error: 'Missing credentials' });
  }

  try {
    const normalizedUsername = username.trim();
    const isDummyLogin = process.env.NODE_ENV !== 'production' && normalizedUsername === 'dummy' && password === '1234';
    if (isDummyLogin) {
      await ensureDummyUser();
      logger.info('Dummy user ensured for login');
    }

    const [rows] = await db.query(
      'SELECT * FROM users WHERE username = ? AND is_active = TRUE',
      [normalizedUsername]
    );
    const user = rows[0];
    if (!user) {
      logger.warn('Login failed: user not found', { username: normalizedUsername });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = isDummyLogin ? true : await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn('Login failed: invalid password', { username: normalizedUsername, userId: user.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Agents require open session
    if (user.role === 'AGENT') {
      const today = formatLocalDate();
      const [sessions] = await db.query(
        "SELECT * FROM daily_sessions WHERE session_date = ? AND status = 'OPEN'",
        [today]
      );
      if (!sessions.length) {
        logger.warn('Login blocked: no open session for agent', {
          username: normalizedUsername,
          userId: user.id,
          date: today
        });
        return res.status(403).json({ error: 'Day not started. Contact admin.' });
      }
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    logger.info('Login successful', {
      username: normalizedUsername,
      userId: user.id,
      role: user.role
    });

    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    logger.error('Login failed with server error', { username, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

async function ensureDummyUser() {
  const passwordHash = await bcrypt.hash('1234', parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);
  const [existingRows] = await db.query('SELECT id FROM users WHERE username = ?', ['dummy']);

  if (existingRows.length) {
    await db.query(
      'UPDATE users SET name = ?, password_hash = ?, role = ?, is_active = TRUE WHERE username = ?',
      ['Dummy Admin', passwordHash, 'ADMIN', 'dummy']
    );
    return existingRows[0].id;
  }

  const [result] = await db.query(
    'INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, TRUE)',
    ['Dummy Admin', 'dummy', passwordHash, 'ADMIN']
  );

  return result.insertId;
}

module.exports = router;
