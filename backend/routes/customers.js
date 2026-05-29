const router = require('express').Router();
const db = require('../utils/db');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const {
  encryptMoney,
  hydrateAccount,
  hydrateTransaction,
  roundMoney
} = require('../utils/secureAmounts');

function groupPayments(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${tx.account_id}-${String(tx.session_date).slice(0, 10)}`;
    const current = grouped.get(key) || {
      account_id: tx.account_id,
      session_date: String(tx.session_date).slice(0, 10),
      amount: 0,
      cash_amount: 0,
      gpay_amount: 0,
      agent_name: new Set(),
      collected_at: tx.collected_at
    };

    current.amount = roundMoney(current.amount + tx.amount);
    current.cash_amount = roundMoney(current.cash_amount + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (tx.payment_mode === 'GPAY' ? tx.amount : 0));
    if (tx.agent_name) current.agent_name.add(tx.agent_name);
    if (!current.collected_at || new Date(tx.collected_at) > new Date(current.collected_at)) {
      current.collected_at = tx.collected_at;
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    agent_name: Array.from(row.agent_name).sort().join(', ')
  }));
}

router.get('/', auth(), async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM customers WHERE is_active = TRUE ORDER BY customer_code'
  );
  res.json(rows);
});

router.get('/:code/details', auth(['ADMIN']), async (req, res) => {
  const rawCode = `${req.params.code}`.trim();
  const numericId = Number.parseInt(rawCode, 10);
  const isNumericLookup = Number.isInteger(numericId) && `${numericId}` === rawCode;

  const [customerRows] = await db.query(
    `SELECT * FROM customers
     WHERE is_active = TRUE AND (customer_code = ? OR (? IS NOT NULL AND id = ?))
     LIMIT 1`,
    [rawCode, isNumericLookup ? numericId : null, isNumericLookup ? numericId : null]
  );

  if (!customerRows.length) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const customer = customerRows[0];
  const [accountRows] = await db.query(
    `SELECT id, loan_amount_enc, paid_amount_enc, interest_rate, status, created_at
     FROM accounts
     WHERE customer_id = ?
     ORDER BY created_at DESC, id DESC`,
    [customer.id]
  );

  const [paymentRows] = await db.query(
    `SELECT
       t.account_id,
       t.session_date,
       t.amount_enc,
       t.payment_mode,
       t.agent_name,
       t.collected_at
     FROM transactions t
     WHERE t.customer_id = ?
     ORDER BY t.collected_at DESC`,
    [customer.id]
  );

  const groupedPayments = groupPayments(paymentRows);
  const accounts = accountRows.map((account) => ({
    ...hydrateAccount(account),
    payments: groupedPayments.filter((payment) => payment.account_id === account.id)
  }));

  res.json({
    id: customer.id,
    customer_code: customer.customer_code,
    name: customer.name,
    address: customer.address,
    phone: customer.phone,
    accounts
  });
});

router.get('/:code', auth(), async (req, res) => {
  const rawCode = `${req.params.code}`.trim();
  const numericId = Number.parseInt(rawCode, 10);
  const isNumericLookup = Number.isInteger(numericId) && `${numericId}` === rawCode;

  const [rows] = await db.query(
    `SELECT c.*, a.id as account_id, a.loan_amount_enc, a.paid_amount_enc,
     a.interest_rate, a.status as account_status
     FROM customers c
     LEFT JOIN accounts a ON c.id = a.customer_id AND a.status = 'ACTIVE'
     WHERE c.is_active = TRUE AND (c.customer_code = ? OR (? IS NOT NULL AND c.id = ?))
     ORDER BY a.created_at DESC, a.id DESC`,
    [rawCode, isNumericLookup ? numericId : null, isNumericLookup ? numericId : null]
  );
  if (!rows.length) {
    logger.warn('Customer lookup failed', {
      lookup: rawCode,
      lookupType: isNumericLookup ? 'id-or-code' : 'code',
      userId: req.user?.id
    });
    return res.status(404).json({ error: 'Customer not found' });
  }
  
  const customer = {
    id: rows[0].id,
    customer_code: rows[0].customer_code,
    name: rows[0].name,
    address: rows[0].address,
    phone: rows[0].phone,
    accounts: rows.filter(r => r.account_id).map(r => {
      const hydrated = hydrateAccount({
        id: r.account_id,
        loan_amount_enc: r.loan_amount_enc,
        paid_amount_enc: r.paid_amount_enc,
        interest_rate: r.interest_rate,
        status: r.account_status
      });

      return {
        id: hydrated.id,
        loan_amount: hydrated.loan_amount,
        paid_amount: hydrated.paid_amount,
        remaining_balance: hydrated.remaining_balance,
        interest_rate: hydrated.interest_rate,
        status: hydrated.status
      };
    })
  };

  logger.info('Customer lookup successful', {
    lookup: rawCode,
    customerId: customer.id,
    userId: req.user?.id
  });

  res.json(customer);
});

router.post('/', auth(['ADMIN']), async (req, res) => {
  const { customer_code, name, address, phone } = req.body;
  if (!customer_code || !name) return res.status(400).json({ error: 'Code and name required' });
  try {
    const [result] = await db.query(
      'INSERT INTO customers (customer_code, name, address, phone) VALUES (?, ?, ?, ?)',
      [customer_code, name, address, phone]
    );
    res.json({ id: result.insertId, customer_code, name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Customer code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth(['ADMIN']), async (req, res) => {
  const { name, address, phone } = req.body;
  await db.query(
    'UPDATE customers SET name=?, address=?, phone=? WHERE id=?',
    [name, address, phone, req.params.id]
  );
  res.json({ success: true });
});

// Accounts
router.post('/:id/accounts', auth(['ADMIN']), async (req, res) => {
  const { loan_amount, interest_rate } = req.body;
  const [result] = await db.query(
    'INSERT INTO accounts (customer_id, loan_amount_enc, paid_amount_enc, interest_rate) VALUES (?, ?, ?, ?)',
    [req.params.id, encryptMoney(loan_amount), encryptMoney(0), interest_rate || 0]
  );
  res.json({ id: result.insertId });
});

module.exports = router;
