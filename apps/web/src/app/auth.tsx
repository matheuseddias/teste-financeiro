import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Membership } from '@eddias/core';
import { runtime, message, type Runtime } from '../data/client';
import { Notice } from '../ui';
interface Auth { client: SupabaseClient; config: Runtime; session: Session; member: Membership; signOut: () => Promise<void> }
const Context = createContext<Auth | null>(null);
export function useAuth() { const value = useContext(Context); if (!value) throw new Error('Sessão indisponível.'); return value; }
export function AuthGate({ children }: { children: ReactNode }) {
  const [env, setEnv] = useState<Awaited<ReturnType<typeof runtime>>>();
  const [session, setSession] = useState<Session | null>();
  const [member, setMember] = useState<Membership | null>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true; let unsubscribe: (() => void) | undefined;
    runtime().then(async next => {
      if (!alive) return;
      setEnv(next);
      const sub = next.client.auth.onAuthStateChange((_event, s) => { if (alive) setSession(s); });
      unsubscribe = () => sub.data.subscription.unsubscribe();
      const result = await next.client.auth.getSession();
      if (result.error) throw result.error;
      if (alive) setSession(result.data.session);
    }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  useEffect(() => {
    let alive = true;
    setMember(undefined); setError('');
    if (!env || !session) return;
    env.client.rpc('fin_my_workspaces').then(({ data, error: e }) => {
      if (!alive) return;
      if (e) { setError(message(e)); return; }
      const members = Array.isArray(data) ? data as Membership[] : [];
      setMember(members.find(m => m.active && ['admin', 'membro'].includes(m.role)) || null);
    });
    return () => { alive = false; };
  }, [env, session?.access_token, retry]);
  async function signOut() {
    const result = await env?.client.auth.signOut();
    if (result?.error) { setError('Não foi possível sair. Tente novamente.'); return; }
    setMember(undefined);
  }
  if (!env || session === undefined) return <div className="center"><div className="card"><h1>Eddias Financeiro</h1>
    {error ? <Notice error>{error}<button onClick={() => location.reload()}>Tentar novamente</button></Notice> : <p>Preparando seu acesso…</p>}</div></div>;
  if (!session) return <Login client={env.client} preview={env.config.environment === 'preview'} />;
  if (!member || error) return <div className="center"><div className="card"><h1>{member === null ? 'Acesso não liberado' : 'Verificando acesso'}</h1>
    {error ? <Notice error>{error}</Notice> : <p>{member === null ? 'Peça ao administrador para liberar seu perfil neste financeiro.' : 'Conferindo suas permissões…'}</p>}
    {(error || member === null) && <><button onClick={() => setRetry(n => n + 1)}>Verificar novamente</button><button className="secondary" onClick={signOut}>Sair</button></>}</div></div>;
  return <Context.Provider value={{ ...env, session, member, signOut }}>{children}</Context.Provider>;
}
function Login({ client, preview }: { client: SupabaseClient; preview: boolean }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="login-layout"><aside className="login-brand"><span className="eyebrow">GRUPO EDDIAS</span><h1>O futuro do caixa<br />começa com clareza.</h1><p>Um lugar para organizar as contas e preparar o planejamento financeiro.</p></aside>
    <main className="login-form"><div><span className="brand">eddias<span> financeiro</span></span>{preview && <span className="badge">Ambiente de teste</span>}
      <h2>Entre no financeiro</h2><p>Use sua conta autorizada do Grupo Eddias.</p>
      <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError('');
        try { const r = await client.auth.signInWithPassword({ email: email.trim(), password }); if (r.error) throw r.error; }
        catch { setError('Não foi possível entrar. Confira seu e-mail e senha.'); } finally { setBusy(false); } }}>
        <label>E-mail<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Senha<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <Notice error>{error}</Notice>}<button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form></div></main></div>;
}
