require('dotenv').config();
const db = require('../utils/db');
const { encryptMoney } = require('../utils/secureAmounts');

async function main() {
  const [accounts] = await db.query(
    `SELECT id, loan_amount, paid_amount
     FROM accounts
     WHERE loan_amount_enc IS NULL OR paid_amount_enc IS NULL`
  );

  for (const account of accounts) {
    await db.query(
      'UPDATE accounts SET loan_amount_enc = ?, paid_amount_enc = ? WHERE id = ?',
      [encryptMoney(account.loan_amount), encryptMoney(account.paid_amount || 0), account.id]
    );
  }

  const [transactions] = await db.query(
    `SELECT id, amount
     FROM transactions
     WHERE amount_enc IS NULL`
  );

  for (const transaction of transactions) {
    await db.query(
      'UPDATE transactions SET amount_enc = ? WHERE id = ?',
      [encryptMoney(transaction.amount), transaction.id]
    );
  }

  console.log(`Backfilled ${accounts.length} accounts and ${transactions.length} transactions.`);
  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
