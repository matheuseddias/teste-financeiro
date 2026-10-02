import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '@eddias/core';
import { useAuth } from '../app/auth';
import { Repo } from '../data/repo';
import { message } from '../data/client';
interface Store { data: Snapshot | null; error: string; busy: boolean; repo: Repo; refresh: () => Promise<void>; mutate: (job: () => Promise<unknown>) => Promise<void> }
const Context = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const { client, member } = useAuth();
  const repo = useMemo(() => new Repo(client, member), [client, member]);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try { const next = await repo.load(); if (version === generation.current) { setData(next); setError(''); } }
    catch (e) { if (version === generation.current) setError(message(e)); throw e; }
  }, [repo]);
  useEffect(() => { setData(null); void refresh().catch(() => {}); return () => { generation.current++; }; }, [refresh]);
  async function mutate(job: () => Promise<unknown>) {
    setBusy(true);
    try { await job(); await refresh(); } finally { setBusy(false); }
  }
  return <Context.Provider value={{ data, error, busy, repo, refresh, mutate }}>{children}</Context.Provider>;
}
export function useStore() { const value = useContext(Context); if (!value) throw new Error('Dados indisponíveis.'); return value; }
