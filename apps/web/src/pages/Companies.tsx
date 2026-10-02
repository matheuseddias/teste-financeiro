import { useState } from 'react';
import { Plus, Pencil, Archive as ArchiveIcon } from 'lucide-react';
import { access, type Company } from '@eddias/core';
import { useAuth } from '../app/auth';
import { useStore } from '../domain/store';
import { message } from '../data/client';
import { Empty, Notice, useDraft } from '../ui';
export function Companies() {
  const { member } = useAuth(); const { data } = useStore();
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const canEdit = access(member, 'empresas') === 'edit';
  return <><div className="page-heading"><div><p className="eyebrow">GRUPO EDDIAS</p><h1>Empresas</h1><p>Cadastre as empresas para separar suas contas e movimentos.</p></div>{canEdit && <button onClick={() => setEditing('new')}><Plus size={18} />Cadastrar empresa</button>}</div>
    {editing && <CompanyForm key={editing === 'new' ? 'new' : editing.id} company={editing === 'new' ? null : editing} close={() => setEditing(null)} />}
    {!data?.companies.length ? <Empty title="Comece pelas empresas">Cadastre Eddias e Eddias Home conforme a estrutura do grupo.</Empty> :
      <div className="card list">{data.companies.map(c => <div className="list-row" key={c.id}><div><h3>{c.name}</h3><p>{c.document || 'CNPJ não informado'}</p></div>
        <div className="actions">{canEdit && <button className="secondary" onClick={() => setEditing(c)}><Pencil size={15} />Editar</button>}{member.role === 'admin' && <Archive entity="companies" id={c.id} name={c.name} />}</div></div>)}</div>}</>;
}
function CompanyForm({ company, close }: { company: Company | null; close: () => void }) {
  const { session, member } = useAuth(); const { repo, mutate, busy } = useStore();
  const initial = { version: company?.version || 0, id: company?.id || crypto.randomUUID(), name: company?.name || '', document: company?.document || '' };
  const draft = useDraft('fin:company:' + session.user.id + ':' + member.tenant_id + ':' + (company?.id || 'new'), initial);
  const [error, setError] = useState('');
  return <section className="card editor"><h2>{company ? 'Editar empresa' : 'Cadastrar empresa'}</h2><form data-dirty={draft.dirty} onSubmit={async e => {
    e.preventDefault(); setError('');
    try { await mutate(() => repo.saveCompany({ ...draft.value, version: draft.value.version })); draft.clear(); close(); }
    catch (e) { setError(message(e)); }
  }}><div className="form-grid"><label>Nome da empresa<input required maxLength={120} value={draft.value.name} onChange={e => draft.update({ ...draft.value, name: e.target.value })} /></label>
      <label>CNPJ (opcional)<input value={draft.value.document} inputMode="numeric" maxLength={18} onChange={e => draft.update({ ...draft.value, document: e.target.value })} /></label></div>
      {error && <Notice error>{error}</Notice>}{draft.storageError && <Notice error>Rascunho não salvo neste dispositivo.</Notice>}
      <div className="actions">{draft.dirty && <button type="button" className="secondary" onClick={() => { if (window.confirm('Descartar este rascunho e recuperar os valores carregados?')) draft.clear(); }}>Descartar rascunho</button>}<button disabled={busy}>Salvar empresa</button><button className="secondary" type="button" onClick={() => { if (!draft.dirty || window.confirm('Fechar e manter o rascunho?')) close(); }}>Fechar</button></div></form></section>;
}
export function Archive({ entity, id, name }: { entity: string; id: string; name: string }) {
  const { repo, mutate, busy } = useStore(); const [error, setError] = useState('');
  return <div><button className="secondary" disabled={busy} onClick={async () => {
    setError('');
    try {
      const plan = await repo.archive(entity, id, true);
      if (plan.blocked) throw new Error('Arquivamento bloqueado: atingiria mais de 30% dos cadastros ativos.');
      if (window.confirm('Arquivar "' + name + '"? A simulação afeta ' + plan.affected + ' de ' + plan.total + ' cadastros. O histórico será preservado.'))
        await mutate(() => repo.archive(entity, id, false));
    } catch (e) { setError(message(e)); }
  }}><ArchiveIcon size={15} />Arquivar</button>{error && <Notice error>{error}</Notice>}</div>;
}
