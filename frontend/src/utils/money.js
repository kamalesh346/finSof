export function roundAmount(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric);
}

export function formatAmount(value) {
  return `${roundAmount(value)}`;
}
