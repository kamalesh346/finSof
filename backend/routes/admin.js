const router = require('express').Router();
const ExcelJS = require('exceljs');
const db = require('../utils/db');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { formatLocalDate } = require('../utils/date');
const formatSheetDate = formatLocalDate;
const {
  encryptMoney,
  formatMoney,
  hydrateAccount,
  hydrateTransaction,
  roundMoney,
  sumAmounts
} = require('../utils/secureAmounts');

function padMonth(month) {
  return `${month}`.padStart(2, '0');
}

function formatMonthKey(date) {
  return formatLocalDate(date).slice(0, 7);
}

function normalizeDateKey(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.slice(0, 10);
  return formatLocalDate(date);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function getMonthBounds(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end, daysInMonth: end.getDate() };
}

function groupTransactionsByAccountAndDay(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${tx.account_id}-${normalizeDateKey(tx.session_date)}`;
    const current = grouped.get(key) || {
      account_id: tx.account_id,
      session_date: normalizeDateKey(tx.session_date),
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

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      agent_name: Array.from(row.agent_name).sort().join(', ')
    }))
    .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
}

function groupTransactionsByAgent(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${normalizeDateKey(tx.session_date)}-${tx.agent_id}`;
    const current = grouped.get(key) || {
      session_date: normalizeDateKey(tx.session_date),
      agent_id: tx.agent_id,
      agent_name: tx.agent_name,
      account_ids: new Set(),
      total_amount: 0,
      cash_amount: 0,
      gpay_amount: 0
    };

    current.account_ids.add(tx.account_id);
    current.total_amount = roundMoney(current.total_amount + tx.amount);
    current.cash_amount = roundMoney(current.cash_amount + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (tx.payment_mode === 'GPAY' ? tx.amount : 0));

    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .map((row) => ({
      session_date: row.session_date,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      total_entries: row.account_ids.size,
      total_amount: row.total_amount,
      cash_amount: row.cash_amount,
      gpay_amount: row.gpay_amount
    }))
    .sort((a, b) => a.agent_name.localeCompare(b.agent_name));
}

function groupAgentCustomerEntries(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${tx.customer_id}-${tx.account_id}`;
    const current = grouped.get(key) || {
      customer_id: tx.customer_id,
      account_id: tx.account_id,
      customer_code: tx.customer_code,
      customer_name: tx.customer_name,
      agent_name: tx.agent_name,
      raw_entry_count: 0,
      amount: 0,
      cash_amount: 0,
      gpay_amount: 0,
      collected_at: tx.collected_at,
      session_date: normalizeDateKey(tx.session_date)
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

function buildMonthlyMasterRows(accounts, transactionRows, monthKey) {
  const { start: monthStart, end: monthEnd, daysInMonth } = getMonthBounds(monthKey);
  const startOfMonth = formatSheetDate(monthStart);
  const endOfMonth = formatSheetDate(monthEnd);
  const dayHeaders = Array.from({ length: daysInMonth }, (_, index) => `${index + 1}`);
  const headers = [
    'ACCOUNT NO.',
    'DEBIT',
    'ADAPPU',
    'AMOUNT',
    'BALANCE',
    'OP.DATE',
    'CL.DATE',
    ...dayHeaders,
    'TOTAL CREDIT',
    'BALANCE DEBIT'
  ];

  const accountTransactions = new Map();
  transactionRows.forEach((row) => {
    if (!accountTransactions.has(row.account_id)) {
      accountTransactions.set(row.account_id, []);
    }
    accountTransactions.get(row.account_id).push({
      sessionDate: normalizeDateKey(row.session_date),
      amount: parseFloat(row.amount || 0)
    });
  });

  const rows = [];
  const totals = {
    adapppu: 0,
    amount: 0,
    balance: 0,
    totalCredit: 0,
    balanceDebit: 0,
    dayTotals: Array(daysInMonth).fill(0)
  };

  // Group accounts by customer_id
  const customerAccounts = new Map();
  accounts.forEach((account) => {
    const cId = account.customer_id;
    if (!customerAccounts.has(cId)) {
      customerAccounts.set(cId, []);
    }
    customerAccounts.get(cId).push(account);
  });

  // Get unique customer IDs and sort by customer_code
  const uniqueCustomerIds = Array.from(customerAccounts.keys());
  const customerInfo = new Map();
  accounts.forEach(acc => {
    if (!customerInfo.has(acc.customer_id)) {
      customerInfo.set(acc.customer_id, {
        customer_code: acc.customer_code,
        name: acc.name
      });
    }
  });

  const sortedCustomerIds = uniqueCustomerIds.sort((a, b) => {
    const codeA = customerInfo.get(a)?.customer_code || '';
    const codeB = customerInfo.get(b)?.customer_code || '';
    return String(codeA).localeCompare(String(codeB));
  });

  sortedCustomerIds.forEach((customerId) => {
    const customerAccs = customerAccounts.get(customerId) || [];
    
    // Filter to active accounts for this month
    const activeAccounts = customerAccs.filter((account) => {
      const openDate = formatSheetDate(account.created_at);
      if (openDate > endOfMonth) return false;

      const transactions = accountTransactions.get(account.id) || [];
      let creditBeforeMonth = 0;
      let monthlyCredit = 0;
      transactions.forEach((t) => {
        if (t.sessionDate < startOfMonth) creditBeforeMonth += t.amount;
        else if (t.sessionDate <= endOfMonth) monthlyCredit += t.amount;
      });

      const openingBalance = Math.max(0, parseFloat(account.loan_amount || 0) - creditBeforeMonth);
      if (account.status === 'ACTIVE') return true;
      return openingBalance > 0 || monthlyCredit > 0;
    });

    if (activeAccounts.length === 0) return;

    activeAccounts.forEach((account, idx) => {
      const isNewLoanRow = idx > 0;
      const accountNo = isNewLoanRow ? `c/${account.customer_code}` : account.customer_code;

      const openDate = formatSheetDate(account.created_at);
      const closeDate = formatSheetDate(addDays(account.created_at, 99));

      const transactions = accountTransactions.get(account.id) || [];
      const dayValues = Array(daysInMonth).fill('');
      let creditBeforeMonth = 0;
      let monthlyCredit = 0;

      transactions.forEach((transaction) => {
        if (transaction.sessionDate < startOfMonth) {
          creditBeforeMonth += transaction.amount;
          return;
        }
        if (transaction.sessionDate > endOfMonth) return;

        const dayIndex = Number.parseInt(transaction.sessionDate.slice(8, 10), 10) - 1;
        if (Number.isNaN(dayIndex) || dayIndex < 0 || dayIndex >= daysInMonth) return;
        const currentValue = parseFloat(dayValues[dayIndex] || 0);
        dayValues[dayIndex] = `${roundMoney(currentValue + transaction.amount)}`;
        monthlyCredit += transaction.amount;
        totals.dayTotals[dayIndex] += transaction.amount;
      });

      const openedThisMonth = openDate.startsWith(monthKey);
      const adappuVal = openedThisMonth ? parseFloat(account.loan_amount || 0) : 0;
      const openingBalance = Math.max(0, parseFloat(account.loan_amount || 0) - creditBeforeMonth);
      const closingBalance = Math.max(0, openingBalance - monthlyCredit);

      totals.adapppu += adappuVal;
      totals.amount += parseFloat(account.loan_amount || 0);
      totals.balance += openingBalance;
      totals.totalCredit += monthlyCredit;
      totals.balanceDebit += closingBalance;

      rows.push({
        'ACCOUNT NO.': accountNo,
        DEBIT: `${account.name}${account.address ? ` | ${account.address}` : ''}`,
        ADAPPU: openedThisMonth ? `${roundMoney(account.loan_amount || 0)}` : '',
        AMOUNT: `${roundMoney(account.loan_amount || 0)}`,
        BALANCE: `${roundMoney(openingBalance)}`,
        'OP.DATE': openDate,
        'CL.DATE': closeDate,
        ...Object.fromEntries(dayHeaders.map((header, index) => [header, dayValues[index]])),
        'TOTAL CREDIT': `${roundMoney(monthlyCredit)}`,
        'BALANCE DEBIT': `${roundMoney(closingBalance)}`
      });
    });
  });

  const totalsRow = {
    'ACCOUNT NO.': '',
    DEBIT: 'TOTAL',
    ADAPPU: totals.adapppu ? `${roundMoney(totals.adapppu)}` : '',
    AMOUNT: `${roundMoney(totals.amount)}`,
    BALANCE: `${roundMoney(totals.balance)}`,
    'OP.DATE': '',
    'CL.DATE': '',
    ...Object.fromEntries(dayHeaders.map((header, index) => [header, totals.dayTotals[index] ? `${roundMoney(totals.dayTotals[index])}` : ''])),
    'TOTAL CREDIT': `${roundMoney(totals.totalCredit)}`,
    'BALANCE DEBIT': `${roundMoney(totals.balanceDebit)}`
  };

  return {
    month: monthKey,
    sheetName: monthKey,
    headers,
    rows,
    totalsRow
  };
}

async function getMonthlyMasterDataset(monthKey = null) {
  const [accounts] = await db.query(
    `SELECT a.id, a.customer_id, a.status, a.loan_amount_enc, a.paid_amount_enc, a.created_at, c.name, c.address, c.customer_code
     FROM accounts a
     JOIN customers c ON c.id = a.customer_id
     ORDER BY a.created_at ASC, a.id ASC`
  );

  const [transactions] = await db.query(
    `SELECT account_id, session_date, amount_enc
     FROM transactions
     ORDER BY session_date ASC, account_id ASC`
  );

  const hydratedAccounts = accounts.map(hydrateAccount);
  const hydratedTransactions = groupTransactionsByAccountAndDay(transactions);

  if (!hydratedAccounts.length) {
    return { months: [], sheets: [] };
  }

  const accountMonths = hydratedAccounts.map(account => formatMonthKey(account.created_at));
  const transactionMonths = hydratedTransactions.map(transaction => normalizeDateKey(transaction.session_date).slice(0, 7)).filter(Boolean);
  const allMonths = [...accountMonths, ...transactionMonths, formatMonthKey(new Date())].sort();
  const firstMonth = allMonths[0];
  const lastMonth = allMonths[allMonths.length - 1];

  const months = [];
  if (monthKey) {
    months.push(monthKey);
  } else {
    const [startYear, startMonth] = firstMonth.split('-').map(Number);
    const [endYear, endMonth] = lastMonth.split('-').map(Number);
    let year = startYear;
    let month = startMonth;
    while (year < endYear || (year === endYear && month <= endMonth)) {
      months.push(`${year}-${padMonth(month)}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  return {
    months,
    sheets: months.map(item => buildMonthlyMasterRows(hydratedAccounts, hydratedTransactions, item))
  };
}
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/admin/customers
// All customers with account summary info
router.get('/customers', auth(['ADMIN']), async (req, res) => {
  try {
    const search = req.query.search?.trim();
    let query = `
      SELECT c.id, c.customer_code, c.name, c.address, c.phone, c.is_active,
        a.id as account_id, a.loan_amount_enc, a.paid_amount_enc
      FROM customers c
      LEFT JOIN accounts a ON c.id = a.customer_id
      WHERE c.is_active = TRUE
    `;
    const params = [];

    if (search) {
      query += ` AND (c.customer_code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY c.customer_code, a.id`;

    const [rows] = await db.query(query, params);
    const customers = new Map();

    rows.forEach((row) => {
      const current = customers.get(row.id) || {
        id: row.id,
        customer_code: row.customer_code,
        name: row.name,
        address: row.address,
        phone: row.phone,
        is_active: row.is_active,
        account_count: 0,
        total_loan: 0,
        total_paid: 0,
        total_remaining: 0
      };

      if (row.account_id) {
        const account = hydrateAccount(row);
        current.account_count += 1;
        current.total_loan = roundMoney(current.total_loan + account.loan_amount);
        current.total_paid = roundMoney(current.total_paid + account.paid_amount);
        current.total_remaining = roundMoney(current.total_remaining + account.remaining_balance);
      }

      customers.set(row.id, current);
    });

    res.json(Array.from(customers.values()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/customers/:id
// Single customer with all accounts and their payment histories
router.get('/customers/:id', auth(['ADMIN']), async (req, res) => {
  try {
    const rawId = `${req.params.id}`.trim();
    const numericId = Number.parseInt(rawId, 10);
    const isNumericLookup = Number.isInteger(numericId) && `${numericId}` === rawId;

    const [customerRows] = await db.query(
      `SELECT * FROM customers
       WHERE is_active = TRUE AND (customer_code = ? OR (? IS NOT NULL AND id = ?))
       LIMIT 1`,
      [rawId, isNumericLookup ? numericId : null, isNumericLookup ? numericId : null]
    );

    if (!customerRows.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customerRows[0];
    const [accountRows] = await db.query(
      `SELECT id, loan_amount_enc, paid_amount_enc, interest_rate, status, created_at
       FROM accounts WHERE customer_id = ? ORDER BY created_at DESC, id DESC`,
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

    const groupedPayments = groupTransactionsByAccountAndDay(paymentRows);
    const accounts = accountRows.map(account => ({
      ...hydrateAccount(account),
      payments: groupedPayments.filter(payment => payment.account_id === account.id)
    }));

    res.json({
      id: customer.id,
      customer_code: customer.customer_code,
      name: customer.name,
      address: customer.address,
      phone: customer.phone,
      accounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/customers
// Create a new customer
router.post('/customers', auth(['ADMIN']), async (req, res) => {
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

// PUT /api/admin/customers/:id
// Update customer info
router.put('/customers/:id', auth(['ADMIN']), async (req, res) => {
  const { name, address, phone } = req.body;
  await db.query(
    'UPDATE customers SET name=?, address=?, phone=? WHERE id=?',
    [name, address, phone, req.params.id]
  );
  res.json({ success: true });
});

// POST /api/admin/customers/:id/accounts
// Add an account to a customer
router.post('/customers/:id/accounts', auth(['ADMIN']), async (req, res) => {
  const { loan_amount, interest_rate } = req.body;
  if (!loan_amount) return res.status(400).json({ error: 'Loan amount required' });
  try {
    const [result] = await db.query(
      'INSERT INTO accounts (customer_id, loan_amount_enc, paid_amount_enc, interest_rate) VALUES (?, ?, ?, ?)',
      [req.params.id, encryptMoney(loan_amount), encryptMoney(0), interest_rate || 0]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/accounts/:id/adjust-loan
// Adjust the loan amount of an active account using a positive or negative delta
router.put('/accounts/:id/adjust-loan', auth(['ADMIN']), async (req, res) => {
  const numericAmount = Number.parseFloat(req.body.amount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) {
    return res.status(400).json({ error: 'Enter a valid amount to add or subtract' });
  }

  try {
    const [accountRows] = await db.query(
      'SELECT id, loan_amount_enc, paid_amount_enc FROM accounts WHERE id = ? AND status = "ACTIVE"',
      [req.params.id]
    );

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Active account not found' });
    }

    const account = hydrateAccount(accountRows[0]);
    const nextLoanAmount = roundMoney(account.loan_amount + numericAmount);
    const paidAmount = roundMoney(account.paid_amount || 0);

    if (nextLoanAmount < 0) {
      return res.status(400).json({ error: 'Loan amount cannot be negative' });
    }

    if (nextLoanAmount < paidAmount) {
      return res.status(400).json({ error: 'Loan amount cannot be less than paid amount' });
    }

    await db.query(
      'UPDATE accounts SET loan_amount_enc = ? WHERE id = ?',
      [encryptMoney(nextLoanAmount), req.params.id]
    );

    res.json({
      success: true,
      message: numericAmount > 0 ? 'Loan amount increased successfully' : 'Loan amount reduced successfully',
      loan_amount: nextLoanAmount
    });
  } catch (err) {
    logger.error('Error adjusting loan amount', { error: err.message, accountId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/accounts/:id/close
// Mark an account as CLOSED
router.put('/accounts/:id/close', auth(['ADMIN']), async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE accounts SET status = "CLOSED" WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ success: true, message: 'Account marked as CLOSED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/agents
// All agents with today's collection stats
router.get('/agents', auth(['ADMIN']), async (req, res) => {
  try {
    const today = formatLocalDate();
    const [users] = await db.query(
      'SELECT id, name, username, role, is_active, created_at FROM users ORDER BY role, name'
    );
    const [stats] = await db.query(
      `SELECT agent_id,
        account_id,
        amount_enc,
        payment_mode
       FROM transactions WHERE session_date = ?
       ORDER BY agent_id, account_id`,
      [today]
    );

    const statsMap = {};
    groupTransactionsByAgent(stats).forEach((row) => {
      statsMap[row.agent_id] = row;
    });

    const result = users.map(u => ({
      ...u,
      today_stats: statsMap[u.id] || { total_entries: 0, total_amount: 0, cash_amount: 0, gpay_amount: 0 }
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/agents/:id/report?date=YYYY-MM-DD
// Individual agent's entries for a date
router.get('/agents/:id/report', auth(['ADMIN']), async (req, res) => {
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
      [req.params.id, date]
    );

    const entries = groupAgentCustomerEntries(rows);
    res.json({
      entries,
      summary: {
        total_entries: entries.length,
        total_amount: sumAmounts(entries),
        cash_amount: sumAmounts(entries, (row) => row.cash_amount),
        gpay_amount: sumAmounts(entries, (row) => row.gpay_amount)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/agents/:id/report/download?date=YYYY-MM-DD
// Download individual agent's report as Excel
router.get('/agents/:id/report/download', auth(['ADMIN']), async (req, res) => {
  try {
    const date = req.query.date || formatLocalDate();
    const [agentRows] = await db.query('SELECT name FROM users WHERE id = ?', [req.params.id]);
    const agentName = agentRows[0]?.name || 'Unknown';

    const [rows] = await db.query(
      `SELECT
        c.customer_code,
        t.customer_id,
        t.customer_name,
        t.account_id,
        t.amount_enc,
        t.payment_mode,
        t.collected_at
       FROM transactions t
       JOIN customers c ON t.customer_id = c.id
       WHERE t.agent_id = ? AND t.session_date = ?
       ORDER BY t.collected_at, c.customer_code`,
      [req.params.id, date]
    );
    const groupedRows = groupAgentCustomerEntries(rows).map((row) => ({
      'Customer ID': row.customer_code,
      'Customer Name': row.customer_name,
      Amount: row.amount,
      Time: new Date(row.collected_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
    }));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${agentName} - ${date}`);

    if (groupedRows.length) {
      const headers = Object.keys(groupedRows[0]);
      sheet.columns = headers.map(h => ({
        header: h, key: h, width: Math.max(h.length + 2, 15)
      }));
      groupedRows.forEach(row => sheet.addRow(row));

      // Style header row
      sheet.getRow(1).font = { bold: true };
    }

    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', `attachment; filename=${agentName.replace(/\s/g, '_')}_${date}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reports/daily/:date
// Daily summary grouped by agent
router.get('/reports/daily/:date', auth(['ADMIN']), async (req, res) => {
  try {
    const { date } = req.params;
    const [rows] = await db.query(
      `SELECT agent_id, agent_name, account_id, amount_enc, payment_mode, session_date
       FROM transactions WHERE session_date = ?
       ORDER BY agent_name`,
      [date]
    );
    const summary = groupTransactionsByAgent(rows);

    const grandTotal = {
      total_entries: summary.reduce((s, r) => s + r.total_entries, 0),
      total_amount: summary.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0),
      cash_amount: summary.reduce((s, r) => s + parseFloat(r.cash_amount || 0), 0),
      gpay_amount: summary.reduce((s, r) => s + parseFloat(r.gpay_amount || 0), 0)
    };

    res.json({ agents: summary, grand_total: grandTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reports/history?page=1&pageSize=10&cacheSize=30
// Recent daily reports with per-agent summaries
router.get('/reports/history', auth(['ADMIN']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 10;
    const requestedCacheSize = parseInt(req.query.cacheSize, 10) || 30;
    const cacheSize = Math.min(30, Math.max(pageSize, requestedCacheSize));
    const offset = (page - 1) * pageSize;

    const [countRows] = await db.query(
      'SELECT COUNT(DISTINCT session_date) AS total_dates FROM transactions'
    );
    const totalDates = countRows[0]?.total_dates || 0;

    if (!totalDates) {
      return res.json({
        reports: [],
        pagination: {
          page,
          pageSize,
          totalItems: 0,
          totalPages: 0
        },
        queue: {
          maxReports: cacheSize,
          loadedReports: 0
        }
      });
    }

    const [dateRows] = await db.query(
      `SELECT session_date
       FROM transactions
       GROUP BY session_date
       ORDER BY session_date DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    const dates = dateRows.map(row => formatLocalDate(row.session_date));

    if (!dates.length) {
      return res.json({
        reports: [],
        pagination: {
          page,
          pageSize,
          totalItems: totalDates,
          totalPages: Math.ceil(totalDates / pageSize)
        },
        queue: {
          maxReports: cacheSize,
          loadedReports: 0
        }
      });
    }

    const placeholders = dates.map(() => '?').join(', ');
    const [summaryRows] = await db.query(
      `SELECT session_date, agent_id, agent_name, account_id, amount_enc, payment_mode
       FROM transactions
       WHERE session_date IN (${placeholders})
       ORDER BY session_date DESC, agent_name ASC`,
      dates
    );
    const groupedSummaryRows = groupTransactionsByAgent(summaryRows);

    const reportsMap = {};
    for (const date of dates) {
      reportsMap[date] = {
        date,
        agents: [],
        grand_total: {
          total_entries: 0,
          total_amount: 0,
          cash_amount: 0,
          gpay_amount: 0
        }
      };
    }

    for (const row of groupedSummaryRows) {
      const reportDate = formatLocalDate(row.session_date);
      const report = reportsMap[reportDate];
      if (!report) continue;

      report.agents.push(row);
      report.grand_total.total_entries += row.total_entries;
      report.grand_total.total_amount += parseFloat(row.total_amount || 0);
      report.grand_total.cash_amount += parseFloat(row.cash_amount || 0);
      report.grand_total.gpay_amount += parseFloat(row.gpay_amount || 0);
    }

    res.json({
      reports: dates.map(date => reportsMap[date]),
      pagination: {
        page,
        pageSize,
        totalItems: totalDates,
        totalPages: Math.ceil(totalDates / pageSize)
      },
      queue: {
        maxReports: cacheSize,
        loadedReports: Math.min(totalDates, cacheSize)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reports/monthly-master/preview?month=YYYY-MM
// Month-wise account ledger preview for admins only
router.get('/reports/monthly-master/preview', auth(['ADMIN']), async (req, res) => {
  try {
    const month = (req.query.month || formatMonthKey(new Date())).slice(0, 7);
    const dataset = await getMonthlyMasterDataset(month);
    res.json(dataset.sheets[0] || {
      month,
      sheetName: month,
      headers: [],
      rows: [],
      totalsRow: {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reports/monthly-master/download?month=YYYY-MM
// Downloads either a single month sheet or a full workbook with one sheet per month
router.get('/reports/monthly-master/download', auth(['ADMIN']), async (req, res) => {
  try {
    const month = req.query.month ? `${req.query.month}`.slice(0, 7) : null;
    const dataset = await getMonthlyMasterDataset(month);
    const workbook = new ExcelJS.Workbook();

    if (!dataset.sheets.length) {
      const worksheet = workbook.addWorksheet(month || 'Monthly History');
      worksheet.addRow(['No monthly account data available']);
    }

    dataset.sheets.forEach((sheetData) => {
      const worksheet = workbook.addWorksheet(sheetData.sheetName);
      worksheet.columns = sheetData.headers.map((header) => ({
        header,
        key: header,
        width: header.length <= 2 ? 10 : header === 'DEBIT' ? 38 : 14
      }));

      sheetData.rows.forEach((row) => worksheet.addRow(row));
      worksheet.addRow(sheetData.totalsRow);

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 7 }];

      const totalsRowNumber = sheetData.rows.length + 2;
      worksheet.getRow(totalsRowNumber).font = { bold: true };

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
          if (typeof cell.value === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(cell.value) && cell.col > 3) {
            cell.numFmt = '0';
          }
        });
      });
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = month ? `monthly_master_${month}.xlsx` : `monthly_master_history.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/reports/daily/:date/download
// Download full daily report Excel with agent-wise sheets
router.get('/reports/daily/:date/download', auth(['ADMIN']), async (req, res) => {
  try {
    const { date } = req.params;

    // Summary sheet data
    const [summary] = await db.query(
      `SELECT agent_id, agent_name, account_id, amount_enc, payment_mode, session_date
       FROM transactions WHERE session_date = ?
       ORDER BY agent_name`,
      [date]
    );
    const summaryRows = groupTransactionsByAgent(summary).map((row) => ({
      Agent: row.agent_name,
      Entries: row.total_entries,
      Total: row.total_amount,
      Cash: row.cash_amount,
      GPay: row.gpay_amount
    }));

    // All transactions
    const [rows] = await db.query(
      `SELECT
        c.customer_code,
        t.customer_id,
        t.customer_name,
        t.account_id,
        t.agent_name,
        t.amount_enc,
        t.payment_mode,
        t.collected_at
       FROM transactions t
       JOIN customers c ON t.customer_id = c.id
       WHERE t.session_date = ?
       ORDER BY t.collected_at, c.customer_code`,
      [date]
    );
    const groupedCollections = groupAgentCustomerEntries(rows).map((row) => ({
      'Customer ID': row.customer_code,
      'Customer Name': row.customer_name,
      'Account ID': row.account_id,
      Agent: row.agent_name,
      Cash: row.cash_amount,
      GPay: row.gpay_amount,
      Total: row.amount,
      'Last Collected At': row.collected_at
    }));

    const workbook = new ExcelJS.Workbook();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    if (summaryRows.length) {
      const headers = Object.keys(summaryRows[0]);
      summarySheet.columns = headers.map(h => ({
        header: h, key: h, width: Math.max(h.length + 2, 15)
      }));
      summaryRows.forEach(row => summarySheet.addRow(row));
      summarySheet.getRow(1).font = { bold: true };
    }

    // All collections sheet
    const collectionsSheet = workbook.addWorksheet(`Collections ${date}`);
    if (groupedCollections.length) {
      const headers = Object.keys(groupedCollections[0]);
      collectionsSheet.columns = headers.map(h => ({
        header: h, key: h, width: Math.max(h.length + 2, 15)
      }));
      groupedCollections.forEach(row => collectionsSheet.addRow(row));
      collectionsSheet.getRow(1).font = { bold: true };
    }

    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', `attachment; filename=daily_report_${date}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/reports/sync-master
// Reads uploaded CHENTHUR master excel, appends transactions for today, and returns the updated file

router.post('/reports/sync-master', auth(['ADMIN']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Master Excel file is required' });

    // Automatically use today's date
    const date = formatLocalDate(); // 'YYYY-MM-DD' in local time (using APP_TIMEZONE)

    // Fetch transactions for today
    const [transactions] = await db.query(
      `SELECT c.customer_code, t.amount_enc
       FROM transactions t
       JOIN customers c ON t.customer_id = c.id
       WHERE t.session_date = ?
       ORDER BY c.customer_code`,
      [date]
    );
    const groupedTransactions = new Map();
    transactions.forEach((row) => {
      const current = groupedTransactions.get(row.customer_code) || 0;
      groupedTransactions.set(row.customer_code, roundMoney(current + hydrateTransaction(row).amount));
    });
    const transactionTotals = Array.from(groupedTransactions.entries()).map(([customer_code, amount]) => ({
      customer_code,
      amount
    }));

    if (transactionTotals.length === 0) {
      return res.status(404).json({ error: 'No transactions found for today to sync' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const [year, month, day] = date.split('-');
    const dayInt = parseInt(day, 10);
    const targetColumnIndex = dayInt + 7; // Day 1 is Column H (index 8), so day + 7

    let updatedCount = 0;
    const notFoundAccounts = [];

    // Parse the date to find the right sheet (Assuming sheet names contain month name or number)
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const targetMonthName = monthNames[parseInt(month, 10) - 1];

    let targetSheet = null;
    workbook.eachSheet((sheet) => {
      if (sheet.name.toUpperCase().includes(targetMonthName)) {
        targetSheet = sheet;
      }
    });

    if (!targetSheet) {
        targetSheet = workbook.worksheets[workbook.worksheets.length - 1];
    }

    transactionTotals.forEach(tx => {
      let rowFound = false;
      targetSheet.eachRow((row) => {
        const acNo = row.getCell(3).value; // A/C.NO. is Column 3 (C)
        if (acNo && acNo.toString() === tx.customer_code.toString()) {
            rowFound = true;
            const cell = row.getCell(targetColumnIndex);
            const currentVal = typeof cell.value === 'number' ? cell.value : 0;
            cell.value = currentVal + parseFloat(tx.amount);
            updatedCount++;
        }
      });
      if (!rowFound) {
          notFoundAccounts.push(tx.customer_code);
      }
    });

    // Write back to a buffer
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    
    res.setHeader('Content-Disposition', `attachment; filename=Master_Sync_${date}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    logger.error('Error syncing to master excel', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// User management endpoints (moved here for admin namespace)

// POST /api/admin/users
router.post('/users', auth(['ADMIN']), async (req, res) => {
  const bcrypt = require('bcrypt');
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

// PUT /api/admin/users/:id/toggle
router.put('/users/:id/toggle', auth(['ADMIN']), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  if (rows[0].role === 'ADMIN') return res.status(403).json({ error: 'Cannot deactivate admin' });

  await db.query('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PUT /api/admin/users/:id/password
router.put('/users/:id/password', auth(['ADMIN']), async (req, res) => {
  const bcrypt = require('bcrypt');
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
