import { openDB } from 'idb';
import { roundAmount } from './money';

const DB_NAME = 'finance_offline';
const DB_VERSION = 2;

let dbInstance = null;

async function getDB() {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Transactions store (existing)
      if (!db.objectStoreNames.contains('pending_transactions')) {
        const store = db.createObjectStore('pending_transactions', { keyPath: 'offline_id' });
        store.createIndex('synced', 'synced');
      }
      // Customer cache store (new in v2)
      if (!db.objectStoreNames.contains('customer_cache')) {
        db.createObjectStore('customer_cache', { keyPath: 'id' });
      }
      // Meta store for cache timestamps, etc (new in v2)
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    }
  });
  return dbInstance;
}

// ─── Transaction Store ────────────────────────────────────────────────

export async function savePendingTransaction(tx) {
  const db = await getDB();
  await db.put('pending_transactions', { ...tx, synced: false, created_at: new Date().toISOString() });
}

export async function getPendingTransactions() {
  const db = await getDB();
  const all = await db.getAll('pending_transactions');
  return all.filter(t => !t.synced);
}

export async function markSynced(offline_id) {
  const db = await getDB();
  const tx = await db.get('pending_transactions', offline_id);
  if (tx) await db.put('pending_transactions', { ...tx, synced: true });
}

export async function updatePendingTransaction(offline_id, updates) {
  const db = await getDB();
  const tx = await db.get('pending_transactions', offline_id);
  if (!tx) return null;

  const nextTx = {
    ...tx,
    ...updates,
    updated_at: new Date().toISOString()
  };

  await db.put('pending_transactions', nextTx);
  return nextTx;
}

export async function getAllLocal() {
  const db = await getDB();
  return db.getAll('pending_transactions');
}

export async function clearSynced() {
  const db = await getDB();
  const all = await db.getAll('pending_transactions');
  const synced = all.filter(t => t.synced);
  for (const t of synced) {
    await db.delete('pending_transactions', t.offline_id);
  }
}

// ─── Customer Cache Store ─────────────────────────────────────────────

export async function saveCustomerCache(customers) {
  const db = await getDB();
  const tx = db.transaction('customer_cache', 'readwrite');
  // Clear existing cache
  await tx.store.clear();
  // Bulk insert new data
  for (const c of customers) {
    await tx.store.put(c);
  }
  await tx.done;

  // Save cache timestamp
  await setMeta('customer_cache_updated', new Date().toISOString());
}

export async function getCachedCustomer(lookup) {
  const db = await getDB();
  // Try by ID first
  const numericId = Number.parseInt(lookup, 10);
  if (Number.isInteger(numericId) && `${numericId}` === `${lookup}`.trim()) {
    const byId = await db.get('customer_cache', numericId);
    if (byId) return byId;
  }
  // Fall back to scanning by customer_code
  const all = await db.getAll('customer_cache');
  return all.find(c => c.customer_code === `${lookup}`.trim()) || null;
}

export async function getAllCachedCustomers() {
  const db = await getDB();
  return db.getAll('customer_cache');
}

export async function getCacheTimestamp() {
  return getMeta('customer_cache_updated');
}

// After a local entry, update the cached customer's account balance locally
export async function updateCachedAccountBalance(customerId, accountId, amount) {
  const db = await getDB();
  const customer = await db.get('customer_cache', customerId);
  if (!customer) return;

  const account = customer.accounts?.find(a => a.id === accountId);
  if (account) {
    account.paid_amount = roundAmount(account.paid_amount || 0) + roundAmount(amount);
    account.remaining_balance = roundAmount(account.loan_amount || 0) - account.paid_amount;
    await db.put('customer_cache', customer);
  }
}

// ─── Meta Store ───────────────────────────────────────────────────────

async function setMeta(key, value) {
  const db = await getDB();
  await db.put('meta', { key, value });
}

async function getMeta(key) {
  const db = await getDB();
  const record = await db.get('meta', key);
  return record?.value || null;
}
