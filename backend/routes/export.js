const router = require('express').Router();
const ExcelJS = require('exceljs');
const db = require('../utils/db');
const jwt = require('jsonwebtoken');
const { hydrateTransaction, roundMoney } = require('../utils/secureAmounts');

const exportAuth = (req, res, next) => {
  const token = req.query.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
};

function groupDailyRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const key = `${row.customer_id}-${row.account_id}`;
    const current = grouped.get(key) || {
      customer_id: row.customer_id,
      customer_code: row.customer_code,
      customer_name: row.customer_name,
      account_id: row.account_id,
      agent_names: new Set(),
      cash_amount: 0,
      gpay_amount: 0,
      amount_collected: 0,
      collected_at: row.collected_at
    };

    if (row.agent_name) current.agent_names.add(row.agent_name);
    current.cash_amount = roundMoney(current.cash_amount + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.gpay_amount = roundMoney(current.gpay_amount + (tx.payment_mode === 'GPAY' ? tx.amount : 0));
    current.amount_collected = roundMoney(current.amount_collected + tx.amount);
    if (!current.collected_at || new Date(row.collected_at) > new Date(current.collected_at)) {
      current.collected_at = row.collected_at;
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.customer_code === b.customer_code) return a.account_id - b.account_id;
    return String(a.customer_code).localeCompare(String(b.customer_code));
  });
}

function groupAgentSummary(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tx = hydrateTransaction(row);
    const current = grouped.get(row.agent_name) || {
      Agent: row.agent_name,
      accountIds: new Set(),
      Total: 0,
      Cash: 0,
      GPay: 0
    };

    current.accountIds.add(row.account_id);
    current.Total = roundMoney(current.Total + tx.amount);
    current.Cash = roundMoney(current.Cash + (tx.payment_mode === 'CASH' ? tx.amount : 0));
    current.GPay = roundMoney(current.GPay + (tx.payment_mode === 'GPAY' ? tx.amount : 0));
    grouped.set(row.agent_name, current);
  });

  return Array.from(grouped.values()).map((row) => ({
    Agent: row.Agent,
    Entries: row.accountIds.size,
    Total: row.Total,
    Cash: row.Cash,
    GPay: row.GPay
  }));
}

router.get('/daily/:date', exportAuth, async (req, res) => {
  const { date } = req.params;

  const [rows] = await db.query(
    `SELECT 
      t.customer_id,
      c.customer_code,
      t.customer_name,
      t.account_id,
      t.agent_name,
      t.payment_mode,
      t.amount_enc,
      t.collected_at
    FROM transactions t
    JOIN customers c ON t.customer_id = c.id
    WHERE t.session_date = ?
    ORDER BY t.collected_at, c.customer_code`,
    [date]
  );
  const groupedRows = groupDailyRows(rows).map((row) => ({
    'Customer ID': row.customer_code,
    'Customer Name': row.customer_name,
    'Account ID': row.account_id,
    Agent: Array.from(row.agent_names).sort().join(', '),
    Cash: row.cash_amount,
    GPay: row.gpay_amount,
    Total: row.amount_collected,
    'Last Collected At': row.collected_at 
      ? new Date(row.collected_at).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata', 
          dateStyle: 'short', 
          timeStyle: 'short' 
        }) 
      : null
  }));

  const workbook = new ExcelJS.Workbook();
  const collectionsSheet = workbook.addWorksheet(`Collections ${date}`);

  addJsonSheetData(collectionsSheet, groupedRows, [
    15, 25, 12, 20, 12, 12, 12, 22
  ]);

  // Summary sheet
  const [summary] = await db.query(
    `SELECT agent_name, account_id, payment_mode, amount_enc
     FROM transactions WHERE session_date = ?`,
    [date]
  );
  const summarySheet = workbook.addWorksheet('Summary');
  addJsonSheetData(summarySheet, groupAgentSummary(summary));

  const buf = Buffer.from(await workbook.xlsx.writeBuffer());
  res.setHeader('Content-Disposition', `attachment; filename=collections_${date}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/daily/:date/preview', exportAuth, async (req, res) => {
  const { date } = req.params;

  const [rows] = await db.query(
    `SELECT
      t.customer_id,
      c.customer_code,
      t.customer_name,
      t.account_id,
      t.payment_mode,
      t.amount_enc,
      t.collected_at
    FROM transactions t
    JOIN customers c ON t.customer_id = c.id
    WHERE t.session_date = ?
    ORDER BY c.customer_code, t.account_id, t.collected_at`,
    [date]
  );

  res.json(groupDailyRows(rows).map((row) => ({
    customer_id: row.customer_code,
    customer_name: row.customer_name,
    account_id: row.account_id,
    cash_amount: row.cash_amount,
    gpay_amount: row.gpay_amount,
    amount_collected: row.amount_collected
  })));
});

function addJsonSheetData(worksheet, rows, widths = []) {
  const headers = rows.length ? Object.keys(rows[0]) : [];

  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: widths[index] || Math.max(header.length + 2, 12)
  }));

  rows.forEach((row) => worksheet.addRow(row));
}

module.exports = router;
