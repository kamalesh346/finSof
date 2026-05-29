const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_SOURCE =
  process.env.APP_ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  'development-only-insecure-key-change-me';

function getKey() {
  return crypto.createHash('sha256').update(String(KEY_SOURCE)).digest();
}

function roundMoney(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('Invalid money value');
  }
  return Math.round(numeric);
}

function encryptMoney(value) {
  const normalized = `${roundMoney(value)}`;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

function decryptMoney(payload) {
  if (payload === null || payload === undefined || payload === '') {
    return 0;
  }

  if (typeof payload === 'number') {
    return roundMoney(payload);
  }

  const raw = typeof payload === 'string' ? payload : `${payload}`;

  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) {
    return roundMoney(raw);
  }

  const parsed = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(parsed.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final()
  ]).toString('utf8');

  return roundMoney(decrypted);
}

function hydrateAccount(row) {
  const loanAmount = decryptMoney(row.loan_amount_enc ?? row.loan_amount);
  const paidAmount = decryptMoney(row.paid_amount_enc ?? row.paid_amount);

  return {
    ...row,
    loan_amount: loanAmount,
    paid_amount: paidAmount,
    remaining_balance: roundMoney(Math.max(loanAmount - paidAmount, 0))
  };
}

function hydrateTransaction(row) {
  return {
    ...row,
    amount: decryptMoney(row.amount_enc ?? row.amount)
  };
}

function sumAmounts(rows, selector = (row) => row.amount) {
  return roundMoney(
    rows.reduce((total, row) => total + roundMoney(selector(row) || 0), 0)
  );
}

function formatMoney(value) {
  return `${roundMoney(value)}`;
}

module.exports = {
  decryptMoney,
  encryptMoney,
  formatMoney,
  hydrateAccount,
  hydrateTransaction,
  roundMoney,
  sumAmounts
};
