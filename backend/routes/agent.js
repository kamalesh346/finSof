const router = require('express').Router();
const db = require('../utils/db');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { formatLocalDate } = require('../utils/date');
const {
  encryptMoney,
  hydrateAccount,
  hydrateTransaction,
  roundMoney,
  sumAmounts
} = require('../utils/secureAmounts');

function buildGroupedEntries(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const entry = hydrateTransaction(row);
    const key = `${entry.customer_id}-${entry.account_id}`;
    const current = grouped.get(key) || {
      customer_id: entry.customer_id,
      account_id: entry.account_id,
      customer_code: entry.customer_code,
      customer_name: entry.customer_name,
      agent_name: entry.agent_name,
      raw_entry_count: 0,
      amount: 0,
      cash_amount: 0,
      gpay_amount: 0,
      collected_at: entry.collected_at,
      session_date: entry.session_date
    };

    current.raw_entry_count += 1;
    current.amount = roundMoney(current.amount + entry.amount);
    current.cash_amount = roundMoney(current.cash_amount + (entry.payment_mode === 'CASH' ? entry.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (entry.payment_mode === 'GPAY' ? entry.amount : 0));

    if (!current.collected_at || new Date(entry.collected_at) > new Date(current.collected_at)) {
      current.collected_at = entry.collected_at;
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values()).sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
}

// GET /api/agent/customers/cache
// Returns ALL active customers + their active accounts for offline caching
router.get('/customers/cache', auth(['AGENT']), async (req, res) => {
  try {
    const [customers] = await db.query(
      'SELECT id, customer_code, name, address, phone FROM customers WHERE is_active = TRUE ORDER BY customer_code'
    );
    const [accounts] = await db.query(
      `SELECT id, customer_id, loan_amount_enc, paid_amount_enc, interest_rate, status
       FROM accounts WHERE status = 'ACTIVE' ORDER BY customer_id, id DESC`
    );

    const accountMap = {};
    for (const acc of accounts) {
      if (!accountMap[acc.customer_id]) accountMap[acc.customer_id] = [];
      const hydrated = hydrateAccount(acc);
      accountMap[acc.customer_id].push({
        id: hydrated.id,
        loan_amount: hydrated.loan_amount,
        paid_amount: hydrated.paid_amount,
        remaining_balance: hydrated.remaining_balance,
        interest_rate: hydrated.interest_rate,
        status: hydrated.status
      });
    }

    const result = customers.map(c => ({
      ...c,
      accounts: accountMap[c.id] || []
    }));

    logger.info('Agent customer cache downloaded', {
      agentId: req.user.id,
      customerCount: result.length
    });

    res.json({ customers: result, cached_at: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to fetch customer cache', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/entries?date=YYYY-MM-DD
// Returns agent's own entries for a given date (defaults to today)
router.get('/entries', auth(['AGENT']), async (req, res) => {
  try {
    const date = req.query.date || formatLocalDate();
    const [rows] = await db.query(
      `SELECT
        t.customer_id,
        t.account_id,
        c.customer_code,
        t.customer_name,
        t.agent_name,
        t.amount_enc,
        t.payment_mode,
        t.collected_at,
        t.session_date
       FROM transactions t
       JOIN customers c ON t.customer_id = c.id
       WHERE t.agent_id = ? AND t.session_date = ?
       ORDER BY t.collected_at DESC`,
      [req.user.id, date]
    );
    res.json(buildGroupedEntries(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/entries/summary?date=YYYY-MM-DD
// Returns agent's summary stats for a date
router.get('/entries/summary', auth(['AGENT']), async (req, res) => {
  try {
    const date = req.query.date || formatLocalDate();
    const [rows] = await db.query(
      `SELECT
        account_id,
        amount_enc,
        payment_mode
       FROM transactions
       WHERE agent_id = ? AND session_date = ?`,
      [req.user.id, date]
    );
    const hydrated = rows.map(hydrateTransaction);
    res.json({
      total_entries: new Set(hydrated.map((row) => row.account_id)).size,
      total_amount: sumAmounts(hydrated),
      cash_amount: sumAmounts(hydrated, (row) => (row.payment_mode === 'CASH' ? row.amount : 0)),
      gpay_amount: sumAmounts(hydrated, (row) => (row.payment_mode === 'GPAY' ? row.amount : 0))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/sync
// Sync offline entries to the server
router.post('/sync', auth(['AGENT']), async (req, res) => {
  const entries = req.body.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'No entries provided' });
  }

  const today = formatLocalDate();
  const [sessions] = await db.query(
    "SELECT * FROM daily_sessions WHERE session_date = ? AND status = 'OPEN'",
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
      await logSync(req.user.id, offline_id, 'DUPLICATE');
      results.push({ offline_id, status: 'DUPLICATE' });
      continue;
    }

    try {
      const sessionDate = formatLocalDate(collected_at);
      // Convert ISO string to MySQL-compatible datetime format
      const mysqlCollectedAt = new Date(collected_at).toISOString().slice(0, 19).replace('T', ' ');
      const [result] = await db.query(
        `INSERT INTO transactions 
         (offline_id, customer_id, customer_name, account_id, agent_id, agent_name, 
          amount_enc, payment_mode, session_date, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [offline_id, customer_id, customer_name, account_id, req.user.id, req.user.name,
         encryptMoney(amount), payment_mode, sessionDate, mysqlCollectedAt]
      );

      const [accountRows] = await db.query(
        'SELECT id, paid_amount_enc FROM accounts WHERE id = ?',
        [account_id]
      );
      if (!accountRows.length) {
        throw new Error('Account not found');
      }

      const account = hydrateAccount({ id: accountRows[0].id, loan_amount_enc: '0.00', paid_amount_enc: accountRows[0].paid_amount_enc });
      const nextPaidAmount = roundMoney(account.paid_amount + amount);

      // Update account paid amount
      await db.query(
        'UPDATE accounts SET paid_amount_enc = ? WHERE id = ?',
        [encryptMoney(nextPaidAmount), account_id]
      );

      await logSync(req.user.id, offline_id, 'SUCCESS');
      results.push({ offline_id, status: 'SUCCESS', id: result.insertId });
    } catch (err) {
      logger.error('Sync entry failed', {
        offline_id, customer_id, account_id, amount,
        error: err.message, code: err.code
      });
      await logSync(req.user.id, offline_id, 'FAILED', err.message);
      results.push({ offline_id, status: 'FAILED', error: err.message });
    }
  }

  logger.info('Agent sync completed', {
    agentId: req.user.id,
    total: entries.length,
    success: results.filter(r => r.status === 'SUCCESS').length,
    alreadySynced: results.filter(r => r.status === 'DUPLICATE').length,
    failed: results.filter(r => r.status === 'FAILED').length
  });

  res.json({ results });
});

async function logSync(agentId, offlineId, status, errorMsg = null) {
  await db.query(
    'INSERT INTO sync_logs (agent_id, offline_id, status, error_message) VALUES (?, ?, ?, ?)',
    [agentId, offlineId, status, errorMsg]
  );
}

module.exports = router;
