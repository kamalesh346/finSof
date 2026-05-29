import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../utils/AuthContext';
import { api } from '../utils/api';
import toast from 'react-hot-toast';
import { formatBusinessDate } from '../utils/date';
import { formatAmount, roundAmount } from '../utils/money';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const today = formatBusinessDate();

  const loadSession = useCallback(async () => {
    try { setSession(await api.todaySession()); } catch {}
  }, []);
  useEffect(() => { loadSession(); }, [loadSession]);

  const startDay = async () => {
    setSessionLoading(true);
    try { const r = await api.startDay(); toast.success(r.message || 'Day started!'); loadSession(); }
    catch (e) { toast.error(e.message); } finally { setSessionLoading(false); }
  };
  const closeDay = async () => {
    if (!window.confirm('Close day? This will lock all entries.')) return;
    setSessionLoading(true);
    try { await api.closeDay(); toast.success('Day closed'); loadSession(); }
    catch (e) { toast.error(e.message); } finally { setSessionLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--surface2)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ color: 'var(--accent)', fontWeight: 'bold', letterSpacing: 2 }}>FINANCE COLLECT</span>
          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>ADMIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {session?.status === 'OPEN' && <button onClick={closeDay} disabled={sessionLoading} className="btn-danger" style={{ padding: '8px 16px', fontSize: 13 }}>Close Day</button>}
          {session?.status !== 'OPEN' && <button onClick={startDay} disabled={sessionLoading} className="btn-success" style={{ padding: '8px 16px', fontSize: 13 }}>{session ? 'Reopen Day' : 'Start Day'}</button>}
          {session && <span className={`badge ${session.status === 'OPEN' ? 'badge-green' : 'badge-red'}`}>{session.status}</span>}
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{user.name}</span>
          <button onClick={logout} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, background: 'var(--surface2)', color: 'var(--muted)' }}>Logout</button>
        </div>
      </div>
      <div className="page" style={{ paddingTop: 20 }}>
        <div className="tabs">
          {['dashboard', 'customers', 'agents', 'report'].map(t => (
            <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>
        {tab === 'dashboard' && <DashboardTab today={today} />}
        {tab === 'customers' && <CustomersTab />}
        {tab === 'agents' && <AgentsTab today={today} />}
        {tab === 'report' && <ReportTab today={today} />}
      </div>
    </div>
  );
}

function DashboardTab({ today }) {
  const [report, setReport] = useState(null);
  const load = useCallback(() => {
    api.adminDailyReport(today).then(setReport).catch(() => {});
  }, [today]);
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);

  const gt = report?.grand_total || {};
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="page-title">TODAY - {today}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>Refresh</button>
          <button onClick={async () => {
            try { await api.downloadAdminDailyReport(today); }
            catch (e) { toast.error(e.message); }
          }} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>Download Excel</button>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="value">Rs {(gt.total_amount || 0).toFixed(0)}</div><div className="label">Total Collected</div></div>
        <div className="stat-card"><div className="value">Rs {(gt.cash_amount || 0).toFixed(0)}</div><div className="label">Cash</div></div>
        <div className="stat-card"><div className="value">Rs {(gt.gpay_amount || 0).toFixed(0)}</div><div className="label">GPay</div></div>
        <div className="stat-card"><div className="value">{gt.total_entries || 0}</div><div className="label">Entries</div></div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>AGENT SUMMARY</div>
      {!report?.agents?.length ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>No entries yet</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table><thead><tr><th>Agent</th><th>Entries</th><th>Cash</th><th>GPay</th><th>Total</th></tr></thead>
            <tbody>{report.agents.map(r => (
              <tr key={r.agent_id}><td>{r.agent_name}</td><td>{r.total_entries}</td>
                <td>Rs {formatAmount(r.cash_amount)}</td><td>Rs {formatAmount(r.gpay_amount)}</td>
                <td style={{ fontWeight: 'bold', color: 'var(--success)' }}>Rs {formatAmount(r.total_amount)}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </div>
  );
}

function CustomersTab() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ customer_code: '', name: '', address: '', phone: '' });
  const [accountForm, setAccountForm] = useState({ loan_amount: '', interest_rate: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadCustomers = useCallback(() => { api.adminCustomers(search).then(setCustomers).catch(() => {}); }, [search]);
  useEffect(() => { const t = setTimeout(loadCustomers, 300); return () => clearTimeout(t); }, [loadCustomers]);

  const addCustomer = async (e) => {
    e.preventDefault();
    try { await api.adminCreateCustomer(form); toast.success('Customer added'); setForm({ customer_code: '', name: '', address: '', phone: '' }); setShowAdd(false); loadCustomers(); }
    catch (e) { toast.error(e.message); }
  };
  const addAccount = async (cid) => {
    if (!accountForm.loan_amount) return;
    try { await api.adminAddAccount(cid, accountForm); toast.success('Account added'); setAccountForm({ loan_amount: '', interest_rate: '' }); setSelectedCustomer(null); }
    catch (e) { toast.error(e.message); }
  };
  const viewDetail = async (c) => {
    setLoadingDetail(true);
    try { setDetail(await api.adminCustomerDetail(c.id)); } catch (e) { toast.error(e.message); } finally { setLoadingDetail(false); }
  };
  const increaseLoan = async (accountId) => {
    const amt = window.prompt('Enter loan adjustment. Use a positive amount to add or a negative amount to reduce.', '');
    if (amt === null || amt.trim() === '') return;
    const value = roundAmount(amt);
    if (Number.isNaN(value) || value === 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.adminAdjustLoan(accountId, value);
      toast.success('Loan amount updated');
      viewDetail(detail); // refresh detail
      loadCustomers(); // refresh list
    } catch (e) { toast.error(e.message); }
  };

  const closeAccount = async (accountId) => {
    if (!window.confirm('Are you sure you want to close this account?')) return;
    try {
      await api.adminCloseAccount(accountId);
      toast.success('Account closed successfully');
      viewDetail(detail); // refresh detail
      loadCustomers(); // refresh list
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="page-title">CUSTOMERS</div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary" style={{ padding: '8px 16px' }}>+ Add</button>
      </div>
      <div className="form-group" style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code or phone..." />
      </div>
      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={addCustomer}>
            <div className="grid-2">
              <div className="form-group"><label>Code</label><input value={form.customer_code} onChange={e => setForm({...form, customer_code: e.target.value})} required /></div>
              <div className="form-group"><label>Name</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>Phone</label><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div className="form-group"><label>Address</label><input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
            </div>
            <button type="submit" className="btn-primary">Add Customer</button>
          </form>
        </div>
      )}
      {selectedCustomer && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div style={{ marginBottom: 12 }}>Add Account for <strong>{selectedCustomer.name}</strong></div>
          <div className="grid-2">
            <div className="form-group"><label>Loan Amount</label><input type="number" value={accountForm.loan_amount} onChange={e => setAccountForm({...accountForm, loan_amount: e.target.value})} /></div>
            <div className="form-group"><label>Interest %</label><input type="number" step="0.1" value={accountForm.interest_rate} onChange={e => setAccountForm({...accountForm, interest_rate: e.target.value})} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}><button onClick={() => addAccount(selectedCustomer.id)} className="btn-primary">Add</button><button onClick={() => setSelectedCustomer(null)} className="btn-secondary">Cancel</button></div>
        </div>
      )}
      {detail && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div><div className="page-title" style={{ margin: 0 }}>{detail.name}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{detail.customer_code} {detail.phone ? `- ${detail.phone}` : ''}</div></div>
            <button onClick={() => setDetail(null)} className="btn-secondary">Close</button>
          </div>
          {detail.accounts.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No accounts</div> : detail.accounts.map(acc => (
            <div key={acc.id} style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10, gap: 12 }}>
                <div><strong>Account #{acc.id}</strong></div>
                <div>Loan: Rs {formatAmount(acc.loan_amount||0)}</div>
                <div>Paid: Rs {formatAmount(acc.paid_amount||0)}</div>
                <div>Balance: Rs {formatAmount(acc.remaining_balance||0)}</div>
                {acc.status === 'ACTIVE' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => increaseLoan(acc.id)} className="btn-secondary" style={{ padding: '6px 10px', fontSize: 13 }}>Edit Loan (+/-)</button>
                    <button onClick={() => closeAccount(acc.id)} className="btn-danger" style={{ padding: '6px 10px', fontSize: 13 }}>Close Account</button>
                  </div>
                )}
              </div>
              {acc.payments.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table><thead><tr><th>Date</th><th>Cash</th><th>GPay</th><th>Total</th><th>Agent</th></tr></thead>
                    <tbody>{acc.payments.map(p => (
                      <tr key={`${p.account_id}-${p.session_date}`}><td>{p.session_date}</td><td>Rs {formatAmount(p.cash_amount || 0)}</td><td>Rs {formatAmount(p.gpay_amount || 0)}</td><td>Rs {formatAmount(p.amount)}</td><td>{p.agent_name}</td></tr>
                    ))}</tbody></table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Code</th><th>Name</th><th>Phone</th><th>Loan</th><th>Paid</th><th>Balance</th><th>Action</th></tr></thead>
          <tbody>{customers.map(c => (
            <tr key={c.id}>
              <td><span className="badge badge-blue">{c.customer_code}</span></td><td>{c.name}</td><td>{c.phone||'-'}</td>
              <td>Rs {parseFloat(c.total_loan||0).toFixed(0)}</td><td>Rs {parseFloat(c.total_paid||0).toFixed(0)}</td>
              <td style={{ color: parseFloat(c.total_remaining||0) > 0 ? 'var(--warning)' : 'var(--success)' }}>Rs {parseFloat(c.total_remaining||0).toFixed(0)}</td>
              <td>
                <button onClick={() => viewDetail(c)} disabled={loadingDetail} style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: '#163047', color: '#cfe8ff', marginRight: 8 }}>View</button>
                <button onClick={() => setSelectedCustomer(c)} style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)' }}>+ Account</button>
              </td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

const PAGE_SIZE_AGENTS = 10;
const PAGE_SIZE_ENTRIES = 15;
const REPORT_HISTORY_PAGE_SIZE = 10;
const REPORT_HISTORY_CACHE_SIZE = 30;
const MONTHLY_PREVIEW_PAGE_SIZE = 10;

function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }}>Prev</button>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }}>Next</button>
    </div>
  );
}

function AgentsTab({ today }) {
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'AGENT' });
  const [showAdd, setShowAdd] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [agentEntries, setAgentEntries] = useState([]);
  const [agentPage, setAgentPage] = useState(1);
  const [entryPage, setEntryPage] = useState(1);

  useEffect(() => { api.adminAgents().then(setAgents).catch(() => {}); }, []);
  const addUser = async (e) => {
    e.preventDefault();
    try { await api.adminCreateUser(form); toast.success('User created'); setForm({ name: '', username: '', password: '', role: 'AGENT' }); setShowAdd(false); api.adminAgents().then(setAgents); }
    catch (e) { toast.error(e.message); }
  };
  const toggle = async (id) => { try { await api.adminToggleUser(id); api.adminAgents().then(setAgents); } catch (e) { toast.error(e.message); } };
  const viewReport = async (agent) => {
    if (expandedAgent === agent.id) { setExpandedAgent(null); return; }
    try { const r = await api.adminAgentReport(agent.id, today); setAgentEntries(r.entries); setExpandedAgent(agent.id); setEntryPage(1); } catch (e) { toast.error(e.message); }
  };

  const totalAgentPages = Math.ceil(agents.length / PAGE_SIZE_AGENTS);
  const pagedAgents = agents.slice((agentPage - 1) * PAGE_SIZE_AGENTS, agentPage * PAGE_SIZE_AGENTS);
  const totalEntryPages = Math.ceil(agentEntries.length / PAGE_SIZE_ENTRIES);
  const pagedEntries = agentEntries.slice((entryPage - 1) * PAGE_SIZE_ENTRIES, entryPage * PAGE_SIZE_ENTRIES);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="page-title">AGENTS & ADMINS</div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary" style={{ padding: '8px 16px' }}>+ Add User</button>
      </div>
      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={addUser}>
            <div className="grid-2">
              <div className="form-group"><label>Name</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
              <div className="form-group"><label>Username</label><input value={form.username} onChange={e => setForm({...form, username: e.target.value})} required /></div>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>Password</label><input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required /></div>
              <div className="form-group"><label>Role</label><select value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option value="AGENT">Agent</option><option value="ADMIN">Admin</option></select></div>
            </div>
            <button type="submit" className="btn-primary">Create User</button>
          </form>
        </div>
      )}
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Today's Entries</th><th>Today's Total</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{pagedAgents.map(u => (
          <tr key={u.id} style={{ cursor: u.role === 'AGENT' ? 'pointer' : '' }} onClick={() => u.role === 'AGENT' && viewReport(u)}>
            <td>{u.name}</td><td>{u.username}</td>
            <td><span className={`badge ${u.role === 'ADMIN' ? 'badge-blue' : 'badge-green'}`}>{u.role}</span></td>
            <td>{u.today_stats?.total_entries || 0}</td>
            <td style={{ fontWeight: 'bold', color: 'var(--success)' }}>Rs {parseFloat(u.today_stats?.total_amount || 0).toFixed(0)}</td>
            <td><span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
            <td onClick={e => e.stopPropagation()}>
              {u.role !== 'ADMIN' && <button onClick={() => toggle(u.id)} style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: u.is_active ? '#4c1d1d' : '#15532a', color: u.is_active ? 'var(--danger)' : 'var(--success)' }}>{u.is_active ? 'Deactivate' : 'Activate'}</button>}
            </td>
          </tr>
        ))}</tbody></table>
      <Pagination page={agentPage} totalPages={totalAgentPages} onPageChange={setAgentPage} />
      {expandedAgent && agentEntries.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>AGENT ENTRIES - {today} ({agentEntries.length} total)</div>
            <button onClick={async () => {
              try { await api.downloadAdminAgentReport(expandedAgent, today); }
              catch (e) { toast.error(e.message); }
            }} style={{ fontSize: 12, color: 'var(--accent)', background: 'transparent', padding: 0 }}>Download Excel</button>
          </div>
          <table><thead><tr><th>Customer ID</th><th>Customer</th><th>Amount</th><th>Time</th><th>Rows</th></tr></thead>
            <tbody>{pagedEntries.map(t => (
              <tr key={`${t.account_id}-${t.customer_id}`}><td>{t.customer_code}</td><td>{t.customer_name}</td>
                <td style={{ fontWeight: 'bold' }}>Rs {formatAmount(t.amount)}</td><td style={{ fontSize: 12 }}>{new Date(t.collected_at).toLocaleTimeString('en-IN')}</td><td>{t.raw_entry_count}</td></tr>
            ))}</tbody></table>
          <Pagination page={entryPage} totalPages={totalEntryPages} onPageChange={setEntryPage} />
        </div>
      )}
    </div>
  );
}

function ReportTab({ today }) {
  const [date, setDate] = useState(today);
  const [report, setReport] = useState(null);
  const [expandedEntry, setExpandedEntry] = useState(null);
  const [agentEntries, setAgentEntries] = useState([]);
  const [agentPage, setAgentPage] = useState(1);
  const [entryPage, setEntryPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyReports, setHistoryReports] = useState([]);
  const [historyMeta, setHistoryMeta] = useState({
    page: 1,
    pageSize: REPORT_HISTORY_PAGE_SIZE,
    totalItems: 0,
    totalPages: 0
  });
  const [queuedReportCount, setQueuedReportCount] = useState(0);
  const [previewMonth, setPreviewMonth] = useState(today.slice(0, 7));
  const [monthlyPreview, setMonthlyPreview] = useState({ headers: [], rows: [], totalsRow: {} });
  const [monthlyPreviewPage, setMonthlyPreviewPage] = useState(1);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const historyCacheRef = useRef(new Map());

  const load = useCallback(() => {
    api.adminDailyReport(date).then(r => {
      setReport(r);
      setAgentPage(1);
      setExpandedEntry(null);
      setEntryPage(1);
    }).catch(() => {});
  }, [date]);

  const loadHistory = useCallback(() => {
    api.adminReportHistory({
      page: historyPage,
      pageSize: REPORT_HISTORY_PAGE_SIZE,
      cacheSize: REPORT_HISTORY_CACHE_SIZE
    }).then(data => {
      setHistoryMeta(data.pagination || {
        page: historyPage,
        pageSize: REPORT_HISTORY_PAGE_SIZE,
        totalItems: 0,
        totalPages: 0
      });
      setQueuedReportCount(data.queue?.loadedReports || 0);

      const nextCache = new Map(historyCacheRef.current);
      (data.reports || []).forEach(item => {
        nextCache.set(item.date, item);
      });

      const sortedDates = Array.from(nextCache.keys()).sort((a, b) => new Date(b) - new Date(a));
      const trimmedDates = sortedDates.slice(0, REPORT_HISTORY_CACHE_SIZE);
      historyCacheRef.current = new Map(trimmedDates.map(itemDate => [itemDate, nextCache.get(itemDate)]));
      setHistoryReports((data.reports || []).map(item => historyCacheRef.current.get(item.date) || item));
    }).catch(() => {});
  }, [historyPage]);

  const loadMonthlyPreview = useCallback(() => {
    setMonthlyLoading(true);
    api.adminMonthlyMasterPreview(previewMonth).then(data => {
      setMonthlyPreview(data || { headers: [], rows: [], totalsRow: {} });
      setMonthlyPreviewPage(1);
    }).catch((e) => {
      toast.error(e.message);
    }).finally(() => {
      setMonthlyLoading(false);
    });
  }, [previewMonth]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadHistory();
    const id = setInterval(loadHistory, 10000);
    return () => clearInterval(id);
  }, [loadHistory]);
  useEffect(() => { loadMonthlyPreview(); }, [loadMonthlyPreview]);

  const viewAgentEntries = async (agent, selectedDate = date) => {
    const expandedKey = `${selectedDate}-${agent.agent_id}`;
    if (expandedEntry?.key === expandedKey) { setExpandedEntry(null); return; }
    try {
      const r = await api.adminAgentReport(agent.agent_id, selectedDate);
      setAgentEntries(r.entries);
      setExpandedEntry({ key: expandedKey, agentId: agent.agent_id, date: selectedDate });
      setEntryPage(1);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const agents = report?.agents || [];
  const totalAgentPages = Math.ceil(agents.length / PAGE_SIZE_AGENTS);
  const pagedAgents = agents.slice((agentPage - 1) * PAGE_SIZE_AGENTS, agentPage * PAGE_SIZE_AGENTS);
  const totalEntryPages = Math.ceil(agentEntries.length / PAGE_SIZE_ENTRIES);
  const pagedEntries = agentEntries.slice((entryPage - 1) * PAGE_SIZE_ENTRIES, entryPage * PAGE_SIZE_ENTRIES);
  const gt = report?.grand_total || {};
  const previewRows = monthlyPreview?.rows || [];
  const previewHeaders = monthlyPreview?.headers || [];
  const previewTotalPages = Math.ceil(previewRows.length / MONTHLY_PREVIEW_PAGE_SIZE);
  const pagedPreviewRows = previewRows.slice((monthlyPreviewPage - 1) * MONTHLY_PREVIEW_PAGE_SIZE, monthlyPreviewPage * MONTHLY_PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div className="page-title" style={{ margin: 0 }}>REPORT</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
        <button
          onClick={async () => {
            try { await api.downloadAdminDailyReport(date); }
            catch (e) { toast.error(e.message); }
          }}
          className="btn-secondary"
          style={{ padding: '8px 16px', fontSize: 13, marginLeft: 'auto' }}
        >
          Download Day Report
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="value">Rs {(gt.total_amount || 0).toFixed(0)}</div><div className="label">Total</div></div>
        <div className="stat-card"><div className="value">{gt.total_entries || 0}</div><div className="label">Entries</div></div>
        <div className="stat-card"><div className="value">{agents.length}</div><div className="label">Agents</div></div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>AGENT-WISE SUMMARY (click to expand)</div>
      {pagedAgents.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table><thead><tr><th>Agent</th><th>Entries</th><th>Cash</th><th>GPay</th><th>Total</th><th>Download</th></tr></thead>
            <tbody>{pagedAgents.map(r => {
              const isExpanded = expandedEntry?.key === `${date}-${r.agent_id}`;
              return (
                <tr key={r.agent_id} style={{ cursor: 'pointer', background: isExpanded ? 'var(--surface2)' : '' }} onClick={() => viewAgentEntries(r)}>
                  <td>{r.agent_name} {isExpanded ? 'v' : '>'}</td>
                  <td>{r.total_entries}</td>
                  <td>Rs {formatAmount(r.cash_amount)}</td>
                  <td>Rs {formatAmount(r.gpay_amount)}</td>
                  <td style={{ fontWeight: 'bold', color: 'var(--success)' }}>Rs {formatAmount(r.total_amount)}</td>
                  <td onClick={e => e.stopPropagation()}><button onClick={async () => {
                    try { await api.downloadAdminAgentReport(r.agent_id, date); }
                    catch (e) { toast.error(e.message); }
                  }} style={{ fontSize: 12, color: 'var(--accent)', background: 'transparent', padding: 0 }}>Download</button></td>
                </tr>
              );
            })}</tbody></table>
        </div>
      )}
      <Pagination page={agentPage} totalPages={totalAgentPages} onPageChange={setAgentPage} />
      {expandedEntry && agentEntries.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>INDIVIDUAL ENTRIES ({agentEntries.length} total)</div>
            <button onClick={async () => {
              try { await api.downloadAdminAgentReport(expandedEntry.agentId, expandedEntry.date); }
              catch (e) { toast.error(e.message); }
            }} style={{ fontSize: 12, color: 'var(--accent)', background: 'transparent', padding: 0 }}>Download Excel</button>
          </div>
          <table><thead><tr><th>Customer ID</th><th>Customer</th><th>Amount</th><th>Time</th><th>Rows</th></tr></thead>
            <tbody>{pagedEntries.map(t => (
              <tr key={`${t.account_id}-${t.customer_id}`}><td>{t.customer_code}</td><td>{t.customer_name}</td>
                <td style={{ fontWeight: 'bold' }}>Rs {formatAmount(t.amount)}</td><td style={{ fontSize: 12 }}>{new Date(t.collected_at).toLocaleTimeString('en-IN')}</td><td>{t.raw_entry_count}</td></tr>
            ))}</tbody></table>
          <Pagination page={entryPage} totalPages={totalEntryPages} onPageChange={setEntryPage} />
        </div>
      )}
      {agents.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 20, fontSize: 13 }}>No data for this date</div>}

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="page-title" style={{ margin: 0 }}>MONTHLY MASTER</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Admin-only monthly ledger preview and secure Excel export with one sheet per month.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="month" value={previewMonth} onChange={e => setPreviewMonth(e.target.value)} style={{ width: 160 }} />
            <button onClick={loadMonthlyPreview} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
              {monthlyLoading ? 'Loading...' : 'Refresh Preview'}
            </button>
            <button
              onClick={async () => {
                try { await api.downloadAdminMonthlyMaster(previewMonth); }
                catch (e) { toast.error(e.message); }
              }}
              className="btn-secondary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              Download This Month
            </button>
            <button
              onClick={async () => {
                try { await api.downloadAdminMonthlyMaster(); }
                catch (e) { toast.error(e.message); }
              }}
              className="btn-primary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              Download Full History
            </button>
          </div>
        </div>

        {previewHeaders.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 20, fontSize: 13 }}>
            No monthly account data available for {previewMonth}
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>{previewHeaders.map(header => <th key={header}>{header}</th>)}</tr>
                </thead>
                <tbody>
                  {pagedPreviewRows.map((row, index) => (
                    <tr key={`${previewMonth}-${index}`}>
                      {previewHeaders.map(header => <td key={header}>{row[header] ?? ''}</td>)}
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 'bold', background: 'var(--surface2)' }}>
                    {previewHeaders.map(header => <td key={header}>{monthlyPreview?.totalsRow?.[header] ?? ''}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <Pagination page={monthlyPreviewPage} totalPages={previewTotalPages} onPageChange={setMonthlyPreviewPage} />
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="page-title" style={{ margin: 0 }}>RECENT REPORT HISTORY</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Showing {REPORT_HISTORY_PAGE_SIZE} report days per page with the latest {queuedReportCount || REPORT_HISTORY_CACHE_SIZE} days queued for quick refresh.
            </div>
          </div>
          <button onClick={loadHistory} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>Refresh History</button>
        </div>

        {historyReports.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 20, fontSize: 13 }}>No previous reports available yet</div>
        ) : historyReports.map(dayReport => (
          <div key={dayReport.date} style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{dayReport.date}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {dayReport.agents.length} agents - {dayReport.grand_total.total_entries} entries - Rs {formatAmount(dayReport.grand_total.total_amount || 0)}
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table><thead><tr><th>Agent</th><th>Entries</th><th>Cash</th><th>GPay</th><th>Total</th><th>Download</th></tr></thead>
                <tbody>{dayReport.agents.map(agent => {
                  const historyKey = `${dayReport.date}-${agent.agent_id}`;
                  const isExpanded = expandedEntry?.key === historyKey;
                  return (
                    <tr key={historyKey} style={{ cursor: 'pointer', background: isExpanded ? 'var(--surface2)' : '' }} onClick={() => viewAgentEntries(agent, dayReport.date)}>
                      <td>{agent.agent_name} {isExpanded ? 'v' : '>'}</td>
                      <td>{agent.total_entries}</td>
                      <td>Rs {formatAmount(agent.cash_amount || 0)}</td>
                      <td>Rs {formatAmount(agent.gpay_amount || 0)}</td>
                      <td style={{ fontWeight: 'bold', color: 'var(--success)' }}>Rs {formatAmount(agent.total_amount || 0)}</td>
                      <td onClick={e => e.stopPropagation()}><button onClick={async () => {
                        try { await api.downloadAdminAgentReport(agent.agent_id, dayReport.date); }
                        catch (e) { toast.error(e.message); }
                      }} style={{ fontSize: 12, color: 'var(--accent)', background: 'transparent', padding: 0 }}>Download</button></td>
                    </tr>
                  );
                })}</tbody></table>
            </div>
          </div>
        ))}

        <Pagination page={historyMeta.page || historyPage} totalPages={historyMeta.totalPages || 0} onPageChange={setHistoryPage} />
      </div>
    </div>
  );
}
