ALTER TABLE accounts
  ADD COLUMN loan_amount_enc TEXT NULL,
  ADD COLUMN paid_amount_enc TEXT NULL;

ALTER TABLE transactions
  ADD COLUMN amount_enc TEXT NULL;

-- Backfill the encrypted values from the application layer before making these NOT NULL.
-- After backfill, you can safely drop the old plaintext columns:
-- ALTER TABLE accounts DROP COLUMN loan_amount, DROP COLUMN paid_amount, DROP COLUMN remaining_balance;
-- ALTER TABLE transactions DROP COLUMN amount;
