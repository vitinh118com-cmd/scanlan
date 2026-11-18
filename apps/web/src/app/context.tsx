import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { agent, AgentError, type AgentHealth, type AgentInterface } from '../infrastructure/agent/client';
import { db, lsGet, lsSet } from '../infrastructure/db/db';
import type { NetworkRec } from '../core/domain/types';

export type AgentStatus = 'checking' | 'not-installed' | 'permission-needed' | 'unpaired' | 'connected' | 'error';
interface AgentCtx { status: AgentStatus; health: AgentHealth | null; interfaces: AgentInterface[]; error?: string; wsConnected: boolean; refresh: () => Promise<void>; pair: (code: string) => Promise<void>; revoke: () => Promise<void>; has: (cap: string) => boolean }
const Ctx = createContext<AgentCtx>(null as never);
export const useAgent = () => useContext(Ctx);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus>('checking');
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [interfaces, setIfaces] = useState<AgentInterface[]>([]);
  const [error, setError] = useState<string>();
  const [, force] = useState(0);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try {
      const h = await agent.health(); setHealth(h); setError(undefined);
      if (!agent.paired) { setStatus('unpaired'); setIfaces([]); }
      else { try { setIfaces(await agent.interfaces()); setStatus('connected'); } catch (e) { if (e instanceof AgentError && e.code === 'AGENT_NOT_PAIRED') setStatus('unpaired'); else throw e; } }
    } catch (e) {
      setHealth(null);
      if (e instanceof AgentError && e.code === 'AGENT_UNREACHABLE') { setStatus('not-installed'); setError(e.message); }
      else { setStatus('error'); setError((e as Error).message); }
    } finally { busy.current = false; }
  }, []);

  useEffect(() => { agent.onChange = () => force((n) => n + 1); void refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, [refresh]);
  const value = useMemo<AgentCtx>(() => ({
    status, health, interfaces, error, wsConnected: agent.wsConnected, refresh,
    pair: async (code) => { await agent.pair(code); await refresh(); },
    revoke: async () => { await agent.revoke(); await refresh(); },
    has: (cap) => !!health?.capabilities.includes(cap) && status === 'connected',
  }), [status, health, interfaces, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---- Theme ----
type Theme = 'light' | 'dark' | 'system';
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => lsGet<Theme>('theme', 'system'));
  useEffect(() => {
    const apply = () => { const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; };
    apply(); const m = matchMedia('(prefers-color-scheme: dark)'); m.addEventListener('change', apply); return () => m.removeEventListener('change', apply);
  }, [theme]);
  // Nhiều nơi (Header, Cài đặt) dùng hook này: đồng bộ qua sự kiện để các bản sao state luôn khớp nhau.
  useEffect(() => { const h = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail); window.addEventListener('hachihi-theme', h); return () => window.removeEventListener('hachihi-theme', h); }, []);
  const setTheme = useCallback((t: Theme) => { lsSet('theme', t); window.dispatchEvent(new CustomEvent('hachihi-theme', { detail: t })); }, []);
  return [theme, setTheme] as const;
}

// ---- Current network ----
interface NetCtx { networks: NetworkRec[]; current?: NetworkRec; setCurrentId: (id: string) => void }
const NCtx = createContext<NetCtx>({ networks: [], setCurrentId: () => {} });
export const useNetwork = () => useContext(NCtx);
export function NetworkProvider({ children }: { children: ReactNode }) {
  const networks = useLiveQuery(async () => (await db.networks.toArray()).sort((a, b) => b.lastSeenAt - a.lastSeenAt), [], [] as NetworkRec[]);
  const [id, setId] = useState<string | undefined>(() => lsGet<string | undefined>('currentNetwork', undefined));
  const current = networks.find((n) => n.id === id) ?? networks[0];
  return <NCtx.Provider value={{ networks, current, setCurrentId: (v) => { setId(v); lsSet('currentNetwork', v); } }}>{children}</NCtx.Provider>;
}
