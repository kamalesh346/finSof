import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';
import { useSync } from '../hooks/useSync';
import { api } from '../utils/api';
import {
  savePendingTransaction, getAllLocal, getCachedCustomer,
  getAllCachedCustomers, updateCachedAccountBalance, updatePendingTransaction, getCacheTimestamp
} from '../utils/offlineStore';
import toast from 'react-hot-toast';
import { formatAmount, roundAmount } from '../utils/money';

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const { isOnline, pendingCount, syncing, sync, refreshPending, cacheCustomers, cacheTime } = useSync();
  const [tab, setTab] = useState('entry');

  // Auto-cache customers on first login if no cache exists
  useEffect(() => {
    (async () => {
      const ts = await getCacheTimestamp();
      if (!ts && isOnline) {
        cacheCustomers();
      }
    })();
  }, [isOnline, cacheCustomers]);

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Status bar */}
      <div className="status-bar">
        <div className={`dot ${isOnline ? 'online' : 'offline'}`} />
        <span style={{ color: isOnline ? 'var(--success)' : 'var(--danger)' }}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
        {pendingCount > 0 && (
          <>
            <span style={{ color: 'var(--warning)', marginLeft: 8 }}>
              {pendingCount} pending
            </span>
            {isOnline && (
              <button
                onClick={sync}
                disabled={syncing}
                style={{ padding: '3px 10px', fontSize: 11, marginLeft: 4, borderRadius: 6 }}
                className="btn-primary"
              >
                {syncing ? 'Syncing...' : 'Sync to Admin'}
              </button>
            )}
          </>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>{user.name}</span>
        <button onClick={logout} style={{ padding: '4px 10px', fontSize: 11, marginLeft: 8, borderRadius: 6, background: 'var(--surface2)', color: 'var(--muted)' }}>
          Logout
        </button>
      </div>

      <div className="page">
        <div className="tabs">
          <div className={`tab ${tab === 'entry' ? 'active' : ''}`} onClick={() => setTab('entry')}>
            New Entry
          </div>
          <div className={`tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
            My Entries
          </div>
          <div className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
            Profile
          </div>
        </div>

        {tab === 'entry' && (
          <EntryTab
            user={user}
            today={today}
            isOnline={isOnline}
            refreshPending={refreshPending}
          />
        )}
        {tab === 'today' && (
          <MyEntriesTab
            user={user}
            isOnline={isOnline}
            pendingCount={pendingCount}
            syncing={syncing}
            sync={sync}
            refreshPending={refreshPending}
          />
        )}
        {tab === 'profile' && (
          <ProfileTab
            user={user}
            isOnline={isOnline}
            cacheCustomers={cacheCustomers}
            cacheTime={cacheTime}
          />
        )}
      </div>
    </div>
  );
}

// ─── Entry Tab ──────────────────────────────────────────────────────────

function EntryTab({ user, today, isOnline, refreshPending }) {
  const [form, setForm] = useState({ customer_code: '', account_id: '', amount: '', payment_mode: 'CASH' });
  const [customer, setCustomer] = useState(null);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Search customers from local cache as user types
  const handleCustomerCodeChange = useCallback(async (value) => {
    setCustomer(null);
    if (value.trim().length >= 1) {
      const all = await getAllCachedCustomers();
      const filtered = all.filter(c =>
        c.customer_code.toLowerCase().includes(value.toLowerCase()) ||
        c.name.toLowerCase().includes(value.toLowerCase()) ||
        (c.id + '').includes(value)
      ).slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const fetchCustomer = async (code) => {
    const lookup = code || form.customer_code.trim();
    if (!lookup) return;
    setFetchingCustomer(true);
    try {
      // Try local cache first (offline-first!)
      const cached = await getCachedCustomer(lookup);
      if (cached) {
        setCustomer(cached);
        setForm(f => ({
          ...f,
          customer_code: cached.customer_code,
          account_id: cached.accounts?.[0]?.id ? cached.accounts[0].id.toString() : ''
        }));
        setShowSuggestions(false);
      } else if (isOnline) {
        // Fallback to API if not in cache
        const data = await api.getCustomer(lookup);
        setCustomer(data);
        setForm(f => ({
          ...f,
          account_id: data.accounts?.[0]?.id ? data.accounts[0].id.toString() : ''
        }));
        setShowSuggestions(false);
      } else {
        toast.error('Customer not found in local cache');
      }
    } catch (err) {
      toast.error('Customer not found');
      setCustomer(null);
    } finally {
      setFetchingCustomer(false);
    }
  };

  const selectSuggestion = (c) => {
    setCustomer(c);
    setForm(f => ({
      ...f,
      customer_code: c.customer_code,
      account_id: c.accounts?.[0]?.id ? c.accounts[0].id.toString() : ''
    }));
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customer) { toast.error('Search customer first'); return; }
    if (!form.account_id) { toast.error('Select account'); return; }
    const amount = roundAmount(form.amount);
    if (!amount || amount <= 0) { toast.error('Invalid amount'); return; }

    setSubmitting(true);
    const selectedAccount = customer.accounts.find(a => a.id === parseInt(form.account_id));
    const entry = {
      offline_id: (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substr(2)),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_code: customer.customer_code,
      account_id: parseInt(form.account_id),
      amount,
      payment_mode: form.payment_mode,
      collected_at: new Date().toISOString(),
      agent_id: user.id,
      agent_name: user.name,
      remaining_balance: selectedAccount?.remaining_balance
    };

    await savePendingTransaction(entry);

    // Update cached balance locally for immediate feedback
    await updateCachedAccountBalance(customer.id, parseInt(form.account_id), amount);

    await refreshPending();

    setForm({ customer_code: '', account_id: '', amount: '', payment_mode: 'CASH' });
    setCustomer(null);
    setSubmitting(false);
    toast.success('Entry saved! Will sync to admin later.');
  };

  return (
    <div className="card">
      <div style={{ marginBottom: 16, color: 'var(--muted)', fontSize: 15 }}>{today}</div>
      <form onSubmit={handleSubmit}>
        <div className="form-group" style={{ position: 'relative' }}>
          <label>Customer ID / Code / Name</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                value={form.customer_code}
                onChange={e => {
                  setForm({ ...form, customer_code: e.target.value });
                  handleCustomerCodeChange(e.target.value);
                }}
                placeholder="Type to search (works offline)"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), fetchCustomer())}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                autoComplete="off"
              />
              {showSuggestions && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--surface)', border: '1px solid var(--surface2)',
                  borderRadius: '0 0 8px 8px', maxHeight: 200, overflowY: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                }}>
                  {suggestions.map(c => (
                    <div
                      key={c.id}
                      onClick={() => selectSuggestion(c)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                        borderBottom: '1px solid var(--surface2)',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => e.target.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.target.style.background = ''}
                    >
                      <span className="badge badge-blue" style={{ marginRight: 8 }}>{c.customer_code}</span>
                      <span>{c.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fetchCustomer()}
              disabled={fetchingCustomer || !form.customer_code}
              className="btn-secondary"
              style={{ whiteSpace: 'nowrap', padding: '12px 16px' }}
            >
              {fetchingCustomer ? '...' : 'Search'}
            </button>
          </div>
        </div>

        {customer && (
          <div style={{
            background: 'var(--surface2)', borderRadius: 8, padding: 12,
            marginBottom: 16, borderLeft: '3px solid var(--accent)'
          }}>
            <div style={{ fontWeight: 'bold', fontSize: 16 }}>{customer.name}</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {customer.customer_code} {customer.address ? `· ${customer.address}` : ''}
            </div>
            {customer.accounts?.map(acc => (
              <div key={acc.id} style={{ marginTop: 8, fontSize: 12 }}>
                <span className="badge badge-blue">Account #{acc.id}</span>
                <span style={{ marginLeft: 8 }}>
                  Balance: ₹{formatAmount(acc.remaining_balance || 0)}
                </span>
                <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
                  (Loan: ₹{formatAmount(acc.loan_amount || 0)})
                </span>
              </div>
            ))}
          </div>
        )}

        {customer?.accounts?.length > 0 && (
          <div className="form-group">
            <label>{customer.accounts.length > 1 ? 'Select Account' : 'Active Account'}</label>
            <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} required>
              {customer.accounts.map(a => (
                <option key={a.id} value={a.id}>
                  Account #{a.id} — Balance ₹{formatAmount(a.remaining_balance || 0)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Amount (₹)</label>
          <input
            type="number"
            step="1"
            min="1"
            value={form.amount}
            onChange={e => setForm({ ...form, amount: e.target.value })}
            placeholder="0"
            required
            style={{ fontSize: 24, fontWeight: 'bold' }}
          />
        </div>

        <div className="form-group">
          <label>Payment Mode</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['CASH', 'GPAY'].map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, payment_mode: mode })}
                style={{
                  flex: 1, padding: 14,
                  background: form.payment_mode === mode
                    ? (mode === 'CASH' ? 'var(--success)' : '#1e40af')
                    : 'var(--surface2)',
                  color: 'white',
                  borderRadius: 8,
                  border: form.payment_mode === mode ? '2px solid rgba(255,255,255,0.3)' : '2px solid transparent',
                  fontSize: 16,
                  fontWeight: 'bold'
                }}
              >
                {mode === 'CASH' ? 'Cash' : 'GPay'}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn-primary"
          style={{ width: '100%', padding: 16, fontSize: 16, marginTop: 8 }}
          disabled={submitting || !customer}
        >
          {submitting ? 'Saving...' : `COLLECT ₹${form.amount || '0'}`}
        </button>
      </form>
    </div>
  );
}

// ─── My Entries Tab ─────────────────────────────────────────────────────

function MyEntriesTab({ user, isOnline, pendingCount, syncing, sync, refreshPending }) {
  const [syncedEntries, setSyncedEntries] = useState([]);
  const [localEntries, setLocalEntries] = useState([]);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', payment_mode: 'CASH' });

  const loadEntries = useCallback(async () => {
    // Load local entries always
    const all = await getAllLocal();
    setLocalEntries(all);

    // Load synced entries from server if online
    if (isOnline) {
      try {
        const data = await api.agentEntries();
        setSyncedEntries(data);
      } catch {}
    }
  }, [isOnline]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const unsyncedEntries = localEntries.filter(e => !e.synced);
  const groupedUnsyncedEntries = Object.values(
    unsyncedEntries.reduce((acc, entry) => {
      const key = `${entry.customer_id}-${entry.account_id}`;
      if (!acc[key]) {
        acc[key] = {
          ...entry,
          amount: 0,
          cash_amount: 0,
          gpay_amount: 0,
          raw_entry_count: 0
        };
      }

      acc[key].amount += roundAmount(entry.amount || 0);
      acc[key].cash_amount += entry.payment_mode === 'CASH' ? roundAmount(entry.amount || 0) : 0;
      acc[key].gpay_amount += entry.payment_mode === 'GPAY' ? roundAmount(entry.amount || 0) : 0;
      acc[key].raw_entry_count += 1;

      if (new Date(entry.collected_at) > new Date(acc[key].collected_at)) {
        acc[key].collected_at = entry.collected_at;
      }

      return acc;
    }, {})
  );

  const startEditEntry = (entry) => {
    setEditingEntryId(entry.offline_id);
    setEditForm({
      amount: `${roundAmount(entry.amount || 0)}`,
      payment_mode: entry.payment_mode || 'CASH'
    });
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
    setEditForm({ amount: '', payment_mode: 'CASH' });
  };

  const saveEditEntry = async (entry) => {
    const nextAmount = roundAmount(editForm.amount);
    if (!nextAmount || nextAmount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    const previousAmount = roundAmount(entry.amount || 0);
    const deltaAmount = nextAmount - previousAmount;

    await updatePendingTransaction(entry.offline_id, {
      amount: nextAmount,
      payment_mode: editForm.payment_mode
    });

    if (deltaAmount !== 0) {
      await updateCachedAccountBalance(entry.customer_id, entry.account_id, deltaAmount);
    }

    cancelEditEntry();
    await refreshPending();
    await loadEntries();
    toast.success('Pending entry updated');
  };

  // Compute stats from both local and synced
  const localTotal = unsyncedEntries.reduce((s, t) => s + roundAmount(t.amount || 0), 0);
  const syncedTotal = syncedEntries.reduce((s, t) => s + roundAmount(t.amount || 0), 0);
  const localCash = unsyncedEntries.filter(e => e.payment_mode === 'CASH').reduce((s, t) => s + roundAmount(t.amount || 0), 0);
  const syncedCash = syncedEntries.reduce((s, t) => s + roundAmount(t.cash_amount || 0), 0);
  const localGpay = unsyncedEntries.filter(e => e.payment_mode === 'GPAY').reduce((s, t) => s + roundAmount(t.amount || 0), 0);
  const syncedGpay = syncedEntries.reduce((s, t) => s + roundAmount(t.gpay_amount || 0), 0);

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="value">{syncedEntries.length + groupedUnsyncedEntries.length}</div>
          <div className="label">Total Entries</div>
        </div>
        <div className="stat-card">
          <div className="value">₹{(localTotal + syncedTotal).toFixed(0)}</div>
          <div className="label">Total Collected</div>
        </div>
        <div className="stat-card">
          <div className="value">₹{(localCash + syncedCash).toFixed(0)}</div>
          <div className="label">Cash</div>
        </div>
        <div className="stat-card">
          <div className="value">₹{(localGpay + syncedGpay).toFixed(0)}</div>
          <div className="label">GPay</div>
        </div>
      </div>

      {/* Sync button */}
      {unsyncedEntries.length > 0 && isOnline && (
        <button
          onClick={async () => { await sync(); loadEntries(); }}
          disabled={syncing}
          className="btn-primary"
          style={{ width: '100%', padding: 14, fontSize: 15, marginBottom: 16 }}
        >
          {syncing ? 'Syncing...' : `Sync ${unsyncedEntries.length} Entries to Admin`}
        </button>
      )}

      {/* Unsynced entries */}
      {groupedUnsyncedEntries.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
            Pending Sync ({groupedUnsyncedEntries.length})
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
            These entries can be edited until they are synced to admin.
          </div>
          {groupedUnsyncedEntries.map(t => (
            <div key={`${t.customer_id}-${t.account_id}`} className="card" style={{ marginBottom: 8, borderLeft: '3px solid var(--warning)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 'bold' }}>{t.customer_name}</span>
                  <span className="badge badge-blue" style={{ marginLeft: 8, fontSize: 10 }}>{t.customer_code || ''}</span>
                  <span className="badge badge-yellow" style={{ marginLeft: 8 }}>#{t.account_id}</span>
                </div>
                <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>₹{formatAmount(t.amount)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>Cash: ₹{formatAmount(t.cash_amount || 0)}</span>
                <span>GPay: ₹{formatAmount(t.gpay_amount || 0)}</span>
                <span>Rows: {t.raw_entry_count}</span>
                <span>{new Date(t.collected_at).toLocaleTimeString('en-IN')}</span>
                <span className="badge badge-yellow" style={{ marginLeft: 8 }}>Not synced</span>
              </div>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {unsyncedEntries
                  .filter(entry => entry.customer_id === t.customer_id && entry.account_id === t.account_id)
                  .sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at))
                  .map(entry => (
                    <div key={entry.offline_id} style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 8, padding: 10 }}>
                      {editingEntryId === entry.offline_id ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={editForm.amount}
                              onChange={e => setEditForm(current => ({ ...current, amount: e.target.value }))}
                            />
                            <select
                              value={editForm.payment_mode}
                              onChange={e => setEditForm(current => ({ ...current, payment_mode: e.target.value }))}
                            >
                              <option value="CASH">Cash</option>
                              <option value="GPAY">GPay</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" className="btn-primary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={() => saveEditEntry(entry)}>Save</button>
                            <button type="button" className="btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={cancelEditEntry}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                            <span>{new Date(entry.collected_at).toLocaleTimeString('en-IN')}</span>
                            <span>{entry.payment_mode}</span>
                            <span style={{ fontWeight: 700 }}>₹{formatAmount(entry.amount || 0)}</span>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: 12 }}
                            onClick={() => startEditEntry(entry)}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Synced entries */}
      {syncedEntries.length > 0 && (
        <div>
          <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
            Synced ({syncedEntries.length})
          </div>
          {syncedEntries.map(t => (
            <div key={`${t.customer_id}-${t.account_id}`} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 'bold' }}>{t.customer_name}</span>
                  <span className="badge badge-blue" style={{ marginLeft: 8, fontSize: 10 }}>{t.customer_code || ''}</span>
                  <span className="badge badge-green" style={{ marginLeft: 8 }}>#{t.account_id}</span>
                </div>
                <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>₹{formatAmount(t.amount)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>Cash: ₹{formatAmount(t.cash_amount || 0)}</span>
                <span>GPay: ₹{formatAmount(t.gpay_amount || 0)}</span>
                <span>Rows: {t.raw_entry_count || 1}</span>
                <span>{new Date(t.collected_at).toLocaleTimeString('en-IN')}</span>
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  disabled
                >
                  Updated to Admin
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {syncedEntries.length === 0 && unsyncedEntries.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>
          No entries yet today. Start collecting!
        </div>
      )}
    </div>
  );
}

// ─── Profile Tab ────────────────────────────────────────────────────────

function ProfileTab({ user, isOnline, cacheCustomers, cacheTime }) {
  const [refreshing, setRefreshing] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);

  useEffect(() => {
    (async () => {
      const all = await getAllCachedCustomers();
      setCachedCount(all.length);
    })();
  }, [cacheTime]);

  const handleRefreshCache = async () => {
    setRefreshing(true);
    await cacheCustomers();
    const all = await getAllCachedCustomers();
    setCachedCount(all.length);
    setRefreshing(false);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          Agent Info
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)' }}>{user.name}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>ID: {user.id}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Role: {user.role}</div>
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          Customer Cache
        </div>
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="value">{cachedCount}</div>
            <div className="label">Customers Cached</div>
          </div>
          <div className="stat-card">
            <div className="value" style={{ fontSize: 14 }}>
              {cacheTime ? new Date(cacheTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}
            </div>
            <div className="label">Last Updated</div>
          </div>
        </div>
        <button
          onClick={handleRefreshCache}
          disabled={refreshing || !isOnline}
          className="btn-secondary"
          style={{ width: '100%', padding: 14 }}
        >
          {refreshing ? 'Downloading...' : 'Refresh Customer Data'}
        </button>
        {!isOnline && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8, textAlign: 'center' }}>
            Internet needed to refresh cache
          </div>
        )}
      </div>
    </div>
  );
}
