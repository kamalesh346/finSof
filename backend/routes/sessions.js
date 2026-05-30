const router = require('express').Router();
const db = require('../utils/db');
const auth = require('../middleware/auth');
const { formatLocalDate } = require('../utils/date');

router.get('/today', auth(), async (req, res) => {
  const today = formatLocalDate();
  const [rows] = await db.query(
    'SELECT * FROM daily_sessions WHERE session_date = ?',
    [today]
  );
  res.json(rows[0] || null);
});

router.post('/start', auth(['ADMIN']), async (req, res) => {
  const today = formatLocalDate();
  try {
    const [existing] = await db.query(
      'SELECT * FROM daily_sessions WHERE session_date = ?',
      [today]
    );
    if (!existing.length) {
      await db.query(
        "INSERT INTO daily_sessions (session_date, status, opened_by, closed_by, closed_at) VALUES (?, 'OPEN', ?, NULL, NULL)",
        [today, req.user.id]
      );
      return res.json({ success: true, message: 'Day started' });
    }

    if (existing[0].status === 'OPEN') {
      return res.json({ success: true, message: 'Day is already open' });
    }

    await db.query(
      `UPDATE daily_sessions
       SET status = 'OPEN', opened_by = ?, opened_at = NOW(), closed_by = NULL, closed_at = NULL
       WHERE session_date = ?`,
      [req.user.id, today]
    );

    res.json({ success: true, message: 'Day reopened' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/close', auth(['ADMIN']), async (req, res) => {
  const today = formatLocalDate();
  try {
    const [sessions] = await db.query(
      'SELECT * FROM daily_sessions WHERE session_date = ?',
      [today]
    );
    if (!sessions.length) {
      return res.status(400).json({ error: 'No session exists for today' });
    }
    if (sessions[0].status === 'CLOSED') {
      return res.json({ success: true, message: 'Day is already closed' });
    }

    await db.query(
      `UPDATE daily_sessions SET status = 'CLOSED', closed_by = ?, closed_at = NOW()
       WHERE session_date = ? AND status = 'OPEN'`,
      [req.user.id, today]
    );

    // Lock all today's transactions
    await db.query(
      'UPDATE transactions SET is_locked = TRUE WHERE session_date = ?',
      [today]
    );

    res.json({ success: true, message: 'Day closed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
