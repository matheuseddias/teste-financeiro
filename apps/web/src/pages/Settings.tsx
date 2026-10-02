import { useEffect, useState } from 'react';
import type { Access, Area, AuditEvent, Membership } from '@eddias/core';
import { useStore } from '../domain/store';
import { useAuth } from '../app/auth';
import { message } from '../data/client';
import { Notice, Empty, useDraft } from '../ui';
type Person = Membership & { email?: string; version?: number };
export function Settings() {
  const { data, repo, mutate, busy } = useStore(); const { client, member } = useAuth();
  const draft = useDraft('fin:members:' + member.tenant_id + ':' + member.user_id, {
    email: '', role: 'membro', active: true, version: 0,
    permissions: { empresas: 'view', contas: 'view', auditoria: 'none', planejamento: 'none', extratos: 'none' } as Record<Area, Access>,
  });
  const { email, role, active, version, permissions } = draft.value;
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [backupBusy, setBackupBusy] = useState(false);
  return <><div className="page-heading"><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Configurações</h1><p>Controle quem acessa o financeiro e acompanhe a proteção dos dados.</p></div></div>
    {error && <Notice error>{error}</Notice>}{status && <Notice>{status}</Notice>}<section className="card"><h2>Pessoas e permissões</h2><p>O usuário precisa existir em Supabase Authentication. Nenhum convite é enviado por esta tela.</p>
      <div className="member-list">{(data?.memberships || []).map((m: Person) => <button className="secondary" key={m.user_id} onClick={() => {
        if (draft.dirty && !window.confirm('Trocar de usuário e substituir o rascunho atual?')) return;
        draft.update({ email: m.email || '', role: m.role, active: m.active, version: m.version || 1, permissions: { empresas: 'none', contas: 'none', auditoria: 'none', planejamento: 'none', extratos: 'none', ...m.permissions } });
      }}>{m.email || 'Usuário'} · {m.role} · {m.active ? 'Ativo' : 'Inativo'}</button>)}</div>
      <form data-dirty={draft.dirty} onSubmit={async e => { e.preventDefault(); setError(''); setStatus('');
        try { await mutate(() => repo.rpc('fin_save_member', { p_email: email, p_role: role, p_active: active, p_permissions: permissions, p_version: version })); draft.clear(); setStatus('Permissões salvas.'); }
        catch (e) { setError(message(e)); }
      }}><div className="form-grid"><label>E-mail do usuário<input type="email" required value={email} onChange={e => { draft.update({ ...draft.value, email: e.target.value, version: 0 }); }} /></label>
        <label>Perfil<select value={role} onChange={e => draft.update({ ...draft.value, role: e.target.value })}><option value="membro">Membro</option><option value="admin">Administrador</option></select></label>
        {role === 'membro' && (['empresas', 'contas', 'planejamento', 'extratos', 'auditoria'] as Area[]).map(area => <label key={area}>{area === 'contas' ? 'Contas bancárias' : area === 'empresas' ? 'Empresas' : area === 'planejamento' ? 'Planejamento e lançamentos' : area === 'extratos' ? 'Extratos e conciliação' : 'Auditoria'}<select value={permissions[area]} onChange={e => draft.update({ ...draft.value, permissions: { ...permissions, [area]: e.target.value as Access } })}><option value="none">Sem acesso</option><option value="view">Consultar</option>{area !== 'auditoria' && <option value="edit">Consultar e editar</option>}</select></label>)}</div>
        <label className="checkbox"><input type="checkbox" checked={active} onChange={e => draft.update({ ...draft.value, active: e.target.checked })} />Acesso ativo</label>
        {draft.storageError && <Notice error>Rascunho não salvo neste dispositivo.</Notice>}<div className="actions"><button disabled={busy}>Salvar permissões</button>{draft.dirty && <button type="button" className="secondary" onClick={() => { if (window.confirm('Descartar o rascunho de permissões?')) draft.clear(); }}>Descartar rascunho</button>}</div>
      </form></section>
    <section className="card"><h2>Backup</h2><p>Snapshots dos cadastros, cenários, lançamentos, permissões e histórico. São mantidos os 20 mais recentes.</p><button disabled={backupBusy} onClick={async () => {
      setBackupBusy(true); setError(''); setStatus('');
      try {
        const { data: auth } = await client.auth.getSession();
        const r = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.session?.access_token },
          body: JSON.stringify({ tenantId: member.tenant_id, runKey: crypto.randomUUID() }) });
        if (!r.ok) throw new Error('Não foi possível concluir o backup. Verifique a configuração do serviço.');
        setStatus('Backup concluído.');
      } catch (e) { setError(message(e)); } finally { setBackupBusy(false); }
    }}>{backupBusy ? 'Preparando backup…' : 'Criar backup agora'}</button></section></>;
}
export function Audit() {
  const { repo } = useStore(); const [events, setEvents] = useState<AuditEvent[]>([]); const [error, setError] = useState('');
  useEffect(() => { let alive = true; repo.audit().then(rows => { if (alive) setEvents(rows); }).catch(e => { if (alive) setError(message(e)); }); return () => { alive = false; }; }, [repo]);
  const entities: Record<string, string> = { fin_tenants: 'Grupo', fin_memberships: 'Permissões', fin_companies: 'Empresa', fin_bank_accounts: 'Conta bancária', fin_plans: 'Cenário', fin_commitments: 'Lançamento', fin_transactions: 'Movimento bancário', fin_allocations: 'Conciliação', fin_import_profiles: 'Perfil de importação', fin_rules: 'Regra de classificação' };
  return <><div className="page-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h1>Histórico de alterações</h1><p>Últimas 100 alterações registradas no grupo.</p></div></div>{error && <Notice error>{error}</Notice>}
    {!events.length ? <Empty title="Nenhuma alteração disponível">Os cadastros e as alterações de acesso serão registrados aqui.</Empty> :
      <div className="card list">{events.map(e => <div className="list-row" key={e.id}><div><h3>{entities[e.entity] || 'Cadastro'} · {e.action === 'INSERT' ? 'Criado' : 'Alterado'}</h3><p>{new Date(e.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p></div><span className="muted">{e.actor_id ? 'Por usuário autorizado' : 'Configuração do sistema'}</span></div>)}</div>}</>;
}
