const router = require('express').Router();
const bcrypt = require('bcrypt');
const db = require('../utils/db');
const auth = require('../middleware/auth');

router.get('/', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, name, username, role, is_active, created_at FROM users ORDER BY role, name'
  );
  res.json(rows);
});

router.post('/', auth(['ADMIN']), async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (!['ADMIN', 'AGENT'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
    const [result] = await db.query(
      'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, username, hash, role]
    );
    res.json({ id: result.insertId, name, username, role });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/toggle', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (rows[0].role === 'ADMIN') return res.status(403).json({ error: 'Cannot deactivate admin' });

  await db.query('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.put('/:id/password', auth(['ADMIN']), async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
