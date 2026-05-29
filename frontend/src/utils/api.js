const BASE = process.env.NODE_ENV === 'production' 
  ? (process.env.REACT_APP_API_URL || '/api') 
  : `http://${window.location.hostname}:5000/api`;

function getToken() {
  return localStorage.getItem('token');
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function download(path, filename) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    }
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const api = {
  post: (path, body) => req('POST', path, body),
  get: (path) => req('GET', path),
  put: (path, body) => req('PUT', path, body),
  delete: (path) => req('DELETE', path),

  // Auth
  login: (creds) => api.post('/auth/login', creds),

  // Sessions
  todaySession: () => api.get('/sessions/today'),
  startDay: () => api.post('/sessions/start', {}),
  closeDay: () => api.post('/sessions/close', {}),

  // ─── Agent Endpoints ──────────────────────────────────────────────
  agentCacheCustomers: () => api.get('/agent/customers/cache'),
  agentEntries: (date) => api.get(`/agent/entries${date ? `?date=${date}` : ''}`),
  agentEntrySummary: (date) => api.get(`/agent/entries/summary${date ? `?date=${date}` : ''}`),
  agentSync: (entries) => api.post('/agent/sync', { entries }),

  // ─── Admin Endpoints ──────────────────────────────────────────────
  adminCustomers: (search) => api.get(`/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  adminCustomerDetail: (id) => api.get(`/admin/customers/${id}`),
  adminCreateCustomer: (data) => api.post('/admin/customers', data),
  adminUpdateCustomer: (id, data) => api.put(`/admin/customers/${id}`, data),
  adminAddAccount: (customerId, data) => api.post(`/admin/customers/${customerId}/accounts`, data),
  adminAdjustLoan: (accountId, amount) => api.put(`/admin/accounts/${accountId}/adjust-loan`, { amount }),
  adminIncreaseLoan: (accountId, amount) => api.put(`/admin/accounts/${accountId}/adjust-loan`, { amount }),
  adminCloseAccount: (accountId) => api.put(`/admin/accounts/${accountId}/close`),
  adminAgents: () => api.get('/admin/agents'),
  adminAgentReport: (id, date) => api.get(`/admin/agents/${id}/report${date ? `?date=${date}` : ''}`),
  adminDailyReport: (date) => api.get(`/admin/reports/daily/${date}`),
  adminReportHistory: ({ page = 1, pageSize = 10, cacheSize = 30 } = {}) =>
    api.get(`/admin/reports/history?page=${page}&pageSize=${pageSize}&cacheSize=${cacheSize}`),
  downloadAdminAgentReport: (agentId, date) =>
    download(`/admin/agents/${agentId}/report/download?date=${date}`, `agent_${agentId}_${date}.xlsx`),
  downloadAdminDailyReport: (date) =>
    download(`/admin/reports/daily/${date}/download`, `daily_report_${date}.xlsx`),
  adminMonthlyMasterPreview: (month) => api.get(`/admin/reports/monthly-master/preview?month=${month}`),
  downloadAdminMonthlyMaster: (month) =>
    download(`/admin/reports/monthly-master/download${month ? `?month=${month}` : ''}`, month ? `monthly_master_${month}.xlsx` : 'monthly_master_history.xlsx'),
  adminCreateUser: (data) => api.post('/admin/users', data),
  adminToggleUser: (id) => api.put(`/admin/users/${id}/toggle`),
  adminChangePassword: (id, password) => api.put(`/admin/users/${id}/password`, { password }),

  // Legacy endpoints (kept for backward compatibility)
  getCustomer: (code) => api.get(`/customers/${code}`),
  getCustomerDetails: (code) => api.get(`/customers/${code}/details`),
  getCustomers: () => api.get('/customers'),
  createCustomer: (data) => api.post('/customers', data),
  updateCustomer: (id, data) => api.put(`/customers/${id}`, data),
  addAccount: (customerId, data) => api.post(`/customers/${customerId}/accounts`, data),
  syncTransactions: (entries) => api.post('/transactions/sync', { entries }),
  myToday: () => api.get('/transactions/my/today'),
  dateTransactions: (date) => api.get(`/transactions/date/${date}`),
  dateSummary: (date) => api.get(`/transactions/summary/${date}`),
  customerLedger: (customerId) => api.get(`/transactions/customer/${customerId}`),
  getUsers: () => api.get('/users'),
  createUser: (data) => api.post('/users', data),
  toggleUser: (id) => api.put(`/users/${id}/toggle`),
  exportPreview: (date) => api.get(`/export/daily/${date}/preview`),

  // Excel download URLs (opened directly in browser)
  getAgentReportDownloadUrl: (agentId, date) =>
    `${BASE}/admin/agents/${agentId}/report/download?date=${date}&token=${getToken()}`,
  getDailyReportDownloadUrl: (date) =>
    `${BASE}/admin/reports/daily/${date}/download?token=${getToken()}`,
  getExportExcelUrl: (date) =>
    `${BASE}/export/daily/${date}?token=${getToken()}`
};
