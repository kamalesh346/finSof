const router = require('express').Router();
const db = require('../utils/db');
const auth = require('../middleware/auth');
const { formatLocalDate } = require('../utils/date');
const {
  decryptMoney,
  encryptMoney,
  hydrateAccount,
  hydrateTransaction,
  roundMoney
} = require('../utils/secureAmounts');

function groupTransactions(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${tx.customer_id}-${tx.account_id}-${String(tx.session_date).slice(0, 10)}-${tx.agent_id || ''}`;
    const current = grouped.get(key) || {
      ...tx,
      raw_entry_count: 0,
      amount: 0,
      cash_amount: 0,
      gpay_amount: 0
    };

    current.raw_entry_count += 1;
    current.amount = roundMoney(current.amount + tx.amount);
    current.cash_amount = roundMoney(current.cash_amount + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (tx.payment_mode === 'GPAY' ? tx.amount : 0));
    if (!current.collected_at || new Date(tx.collected_at) > new Date(current.collected_at)) {
      current.collected_at = tx.collected_at;
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values()).sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
}

// Sync batch (offline -> online)
router.post('/sync', auth(['AGENT']), async (req, res) => {
  const entries = req.body.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'No entries provided' });
  }

  const today = formatLocalDate();
  const [sessions] = await db.query(
    'SELECT * FROM daily_sessions WHERE session_date = ? AND status = "OPEN"',
    [today]
  );
  if (!sessions.length) return res.status(403).json({ error: 'No open session' });

  const results = [];

  for (const entry of entries) {
    const { offline_id, customer_id, customer_name, account_id, amount, payment_mode, collected_at } = entry;

    // Check duplicate offline_id
    const [existing] = await db.query(
      'SELECT id FROM transactions WHERE offline_id = ?',
      [offline_id]
    );
    if (existing.length) {
      await logSync(db, req.user.id, offline_id, 'DUPLICATE');
      results.push({ offline_id, status: 'DUPLICATE' });
      continue;
    }

    try {
      const sessionDate = formatLocalDate(collected_at);
      const [result] = await db.query(
        `INSERT INTO transactions 
         (offline_id, customer_id, customer_name, account_id, agent_id, agent_name, 
          amount_enc, payment_mode, session_date, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [offline_id, customer_id, customer_name, account_id, req.user.id, req.user.name,
         encryptMoney(amount), payment_mode, sessionDate, collected_at]
      );

      const txId = result.insertId;

      // Duplicate detection: same customer+account same day
      const [dupes] = await db.query(
        `SELECT id FROM transactions 
         WHERE customer_id = ? AND account_id = ? AND session_date = ? AND id != ?`,
        [customer_id, account_id, sessionDate, txId]
      );

      let isDuplicate = false;
      if (dupes.length > 0) {
        isDuplicate = true;
        await db.query('UPDATE transactions SET duplicate_flag = TRUE WHERE id = ?', [txId]);
        await db.query(
          'INSERT INTO duplicate_flags (transaction_id, original_transaction_id) VALUES (?, ?)',
          [txId, dupes[0].id]
        );
      }

      // Update account paid amount
      const [accountRows] = await db.query(
        'SELECT id, paid_amount_enc FROM accounts WHERE id = ?',
        [account_id]
      );
      if (!accountRows.length) throw new Error('Account not found');
      const nextPaidAmount = roundMoney(decryptMoney(accountRows[0].paid_amount_enc) + amount);
      await db.query(
        'UPDATE accounts SET paid_amount_enc = ? WHERE id = ?',
        [encryptMoney(nextPaidAmount), account_id]
      );

      await logSync(db, req.user.id, offline_id, 'SUCCESS');
      results.push({ offline_id, status: 'SUCCESS', id: txId, duplicate: isDuplicate });
    } catch (err) {
      await logSync(db, req.user.id, offline_id, 'FAILED', err.message);
      results.push({ offline_id, status: 'FAILED', error: err.message });
    }
  }

  res.json({ results });
});

async function logSync(db, agentId, offlineId, status, errorMsg = null) {
  await db.query(
    'INSERT INTO sync_logs (agent_id, offline_id, status, error_message) VALUES (?, ?, ?, ?)',
    [agentId, offlineId, status, errorMsg]
  );
}

// Get today's transactions for agent
router.get('/my/today', auth(['AGENT']), async (req, res) => {
  const today = formatLocalDate();
  const [rows] = await db.query(
    `SELECT t.*, c.customer_code FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.agent_id = ? AND t.session_date = ?
     ORDER BY t.collected_at DESC`,
    [req.user.id, today]
  );
  res.json(groupTransactions(rows));
});

// Admin: all transactions for a date
router.get('/date/:date', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.*, c.customer_code FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.session_date = ?
     ORDER BY t.agent_name, t.collected_at`,
    [req.params.date]
  );
  res.json(rows.map(hydrateTransaction));
});

// Agent summary per day per agent
router.get('/summary/:date', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT agent_id, agent_name, account_id, amount_enc, payment_mode, duplicate_flag
     FROM transactions WHERE session_date = ?`,
    [req.params.date]
  );
  const grouped = new Map();
  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${tx.agent_id}`;
    const current = grouped.get(key) || {
      agent_id: tx.agent_id,
      agent_name: tx.agent_name,
      account_ids: new Set(),
      total_amount: 0,
      cash_amount: 0,
      gpay_amount: 0,
      duplicates: 0
    };
    current.account_ids.add(tx.account_id);
    current.total_amount = roundMoney(current.total_amount + tx.amount);
    current.cash_amount = roundMoney(current.cash_amount + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (tx.payment_mode === 'GPAY' ? tx.amount : 0));
    current.duplicates += tx.duplicate_flag ? 1 : 0;
    grouped.set(key, current);
  });
  res.json(Array.from(grouped.values()).map((row) => ({
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    total_entries: row.account_ids.size,
    total_amount: row.total_amount,
    cash_amount: row.cash_amount,
    gpay_amount: row.gpay_amount,
    duplicates: row.duplicates
  })));
});

// Customer ledger
router.get('/customer/:customerId', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.*, a.loan_amount_enc, a.paid_amount_enc, c.customer_code
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     JOIN customers c ON t.customer_id = c.id
     WHERE t.customer_id = ?
     ORDER BY t.collected_at DESC LIMIT 100`,
    [req.params.customerId]
  );
  res.json(rows.map((row) => ({
    ...hydrateTransaction(row),
    ...hydrateAccount(row)
  })));
});

// Duplicate flags
router.get('/duplicates/:date', auth(['ADMIN', 'AGENT']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT df.*, 
     t.amount_enc, t.payment_mode, t.customer_name, t.agent_name, t.collected_at,
     ot.amount_enc as orig_amount_enc, ot.payment_mode as orig_mode, ot.collected_at as orig_at
     FROM duplicate_flags df
     JOIN transactions t ON df.transaction_id = t.id
     JOIN transactions ot ON df.original_transaction_id = ot.id
     WHERE t.session_date = ?`,
    [req.params.date]
  );
  res.json(rows.map((row) => ({
    ...row,
    amount: decryptMoney(row.amount_enc),
    orig_amount: decryptMoney(row.orig_amount_enc)
  })));
});

// Resolve duplicate
router.post('/duplicates/:id/resolve', auth(['ADMIN', 'AGENT']), async (req, res) => {
  const { resolution } = req.body;
  if (!['ACCEPTED', 'REJECTED'].includes(resolution)) {
    return res.status(400).json({ error: 'Invalid resolution' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [df] = await conn.query('SELECT * FROM duplicate_flags WHERE id = ?', [req.params.id]);
    if (!df.length) return res.status(404).json({ error: 'Not found' });

    await conn.query(
      'UPDATE duplicate_flags SET resolved=TRUE, resolution=?, resolved_by=?, resolved_at=NOW() WHERE id=?',
      [resolution, req.user.id, req.params.id]
    );

    if (resolution === 'REJECTED') {
      const tx = df[0];
      // Reverse the amount
      const [txRow] = await conn.query('SELECT * FROM transactions WHERE id = ?', [tx.transaction_id]);
      const [accountRows] = await conn.query('SELECT id, paid_amount_enc FROM accounts WHERE id = ?', [txRow[0].account_id]);
      const nextPaidAmount = roundMoney(
        decryptMoney(accountRows[0].paid_amount_enc) - decryptMoney(txRow[0].amount_enc)
      );
      await conn.query(
        'UPDATE accounts SET paid_amount_enc = ? WHERE id = ?',
        [encryptMoney(nextPaidAmount), txRow[0].account_id]
      );
      await conn.query('DELETE FROM transactions WHERE id = ?', [tx.transaction_id]);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
