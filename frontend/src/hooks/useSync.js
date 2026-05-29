import { useState, useEffect, useCallback } from 'react';
import { getPendingTransactions, markSynced, saveCustomerCache, getCacheTimestamp } from '../utils/offlineStore';
import { api } from '../utils/api';
import toast from 'react-hot-toast';

export function useSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [cacheTime, setCacheTime] = useState(null);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const refreshPending = useCallback(async () => {
    const pending = await getPendingTransactions();
    setPendingCount(pending.length);
  }, []);

  const refreshCacheTime = useCallback(async () => {
    const ts = await getCacheTimestamp();
    setCacheTime(ts);
  }, []);

  useEffect(() => { refreshPending(); refreshCacheTime(); }, [refreshPending, refreshCacheTime]);

  // Download and cache all customer data for offline use
  const cacheCustomers = useCallback(async () => {
    if (!isOnline) {
      toast.error('Need internet to refresh customer data');
      return false;
    }
    try {
      const data = await api.agentCacheCustomers();
      await saveCustomerCache(data.customers);
      await refreshCacheTime();
      toast.success(`${data.customers.length} customers cached`);
      return true;
    } catch (err) {
      toast.error('Failed to cache customers: ' + err.message);
      return false;
    }
  }, [isOnline, refreshCacheTime]);

  // Sync pending entries to server (agent triggers manually)
  const sync = useCallback(async () => {
    if (!isOnline || syncing) return;
    const pending = await getPendingTransactions();
    if (!pending.length) {
      toast('Nothing to sync', { icon: '✓' });
      return;
    }

    setSyncing(true);
    try {
      const results = await api.agentSync(pending);
      let success = 0;
      for (const r of results.results) {
        if (r.status === 'SUCCESS' || r.status === 'DUPLICATE') {
          await markSynced(r.offline_id);
          if (r.status === 'SUCCESS') success++;
        }
      }
      await refreshPending();
      if (success > 0) toast.success(`${success} entries synced to admin`);

      const failed = results.results.filter(r => r.status === 'FAILED');
      if (failed.length > 0) {
        toast.error(`${failed.length} entries failed to sync`);
      }
    } catch (err) {
      toast.error('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  }, [isOnline, syncing, refreshPending]);

  return { isOnline, pendingCount, syncing, sync, refreshPending, cacheCustomers, cacheTime };
}
