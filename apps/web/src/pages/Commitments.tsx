import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { access, money, parseBrl, type Commitment, type CostCategory } from '@eddias/core';
import { useAuth } from '../app/auth';
import { useStore } from '../domain/store';
import { message } from '../data/client';
import { Empty, Notice, useDraft } from '../ui';
import { Archive } from './Companies';
import { categories } from './planning/fields';
export function Commitments() {
  const { member } = useAuth(); const { data } = useStore();
  const [editing, setEditing] = useState<Commitment | 'new' | null>(null); const [month, setMonth] = useState('');
  const canEdit = access(member, 'planejamento') === 'edit';
  const rows = (data?.commitments || []).filter(c => !month || c.due_date.startsWith(month)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  return <><div className="page-heading"><div><p className="eyebrow">OBRIGAÇÕES E OUTRAS ENTRADAS</p><h1>Lançamentos previstos</h1><p>Valores com data definida entram em todos os cenários do grupo.</p></div>{canEdit && <button onClick={() => setEditing('new')}><Plus size={18} />Novo lançamento</button>}</div>
    <Notice>Registre fornecedores, contas fixas, impostos e entradas que não estejam no GMV projetado. Valores realizados serão reconhecidos pela conciliação de extratos.</Notice>
    {editing && <EntryForm key={editing === 'new' ? 'new' : editing.id} entry={editing === 'new' ? null : editing} close={() => setEditing(null)} />}
    <label className="month-filter">Filtrar mês<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
    {!rows.length ? <Empty title="Nenhum lançamento neste período">Inclua as obrigações conhecidas. As projeções completam eventuais lacunas com as premissas do cenário.</Empty> : <section className="card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Empresa</th><th>Categoria</th><th>Valor</th><th>Ações</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td>{c.due_date.split('-').reverse().join('/')}</td><td>{c.name}<small className="block">{c.direction === 'entrada' ? 'Entrada prevista' : 'Saída prevista'}</small></td><td>{data?.companies.find(v => v.id === c.company_id)?.name || 'Consolidado / não identificada'}</td><td>{categories[c.category]}</td><td className={c.direction === 'saida' ? 'negative' : ''}>{money(c.amount_cents)}</td><td><div className="actions">{canEdit && <button className="secondary" onClick={() => setEditing(c)}><Pencil size={14} />Editar</button>}{member.role === 'admin' && <Archive entity="commitments" id={c.id} name={c.name} />}</div></td></tr>)}</tbody></table></div></section>}
  </>;
}
function EntryForm({ entry, close }: { entry: Commitment | null; close: () => void }) {
  const { member } = useAuth(); const { data, repo, mutate, busy } = useStore();
  const draft = useDraft('fin:commitment:' + member.user_id + ':' + member.tenant_id + ':' + (entry?.id || 'new'), {
    id: entry?.id || crypto.randomUUID(), version: entry?.version || 0, name: entry?.name || '', company_id: entry?.company_id || '', due_date: entry?.due_date || '',
    amount: entry ? (entry.amount_cents / 100).toFixed(2).replace('.', ',') : '', direction: entry?.direction || 'saida', category: entry?.category || 'fornecedores',
  });
  const v = draft.value; const [error, setError] = useState('');
  return <section className="card editor"><h2>{entry ? 'Editar lançamento' : 'Novo lançamento previsto'}</h2><form data-dirty={draft.dirty} onSubmit={async e => {
    e.preventDefault(); setError(''); try {
      const amount = parseBrl(v.amount); if (amount === null || amount <= 0) throw new Error('Informe um valor maior que zero.');
      await mutate(() => repo.rpc('fin_save_commitment', { p_id: v.id, p_version: v.version, p_data: { name: v.name.trim(), company_id: v.company_id || null, due_date: v.due_date, amount_cents: amount, direction: v.direction, category: v.category } }));
      draft.clear(); close();
    } catch (e) { setError(message(e)); }
  }}><div className="form-grid"><label>Descrição<input required maxLength={120} value={v.name} onChange={e => draft.update({ ...v, name: e.target.value })} /></label>
    <label>Empresa<select value={v.company_id} onChange={e => draft.update({ ...v, company_id: e.target.value })}><option value="">Consolidado / não identificada</option>{data?.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Vencimento<input type="date" required min="2000-01-01" max="2099-12-31" value={v.due_date} onChange={e => draft.update({ ...v, due_date: e.target.value })} /></label>
    <label>Valor (R$)<input required inputMode="decimal" value={v.amount} onChange={e => draft.update({ ...v, amount: e.target.value })} /></label>
    <label>Tipo<select value={v.direction} onChange={e => draft.update({ ...v, direction: e.target.value as 'entrada' | 'saida' })}><option value="saida">Saída prevista</option><option value="entrada">Outra entrada prevista</option></select></label>
    <label>Categoria<select value={v.category} onChange={e => draft.update({ ...v, category: e.target.value as CostCategory })}>{Object.entries(categories).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label></div>
    {error && <Notice error>{error}</Notice>}{draft.storageError && <Notice error>Rascunho não salvo neste dispositivo.</Notice>}
    <div className="actions"><button disabled={busy}>Salvar lançamento</button><button type="button" className="secondary" onClick={() => { if (!draft.dirty || window.confirm('Fechar e manter rascunho?')) close(); }}>Fechar</button>{draft.dirty && <button type="button" className="secondary" onClick={() => { if (window.confirm('Descartar rascunho?')) draft.clear(); }}>Descartar rascunho</button>}</div></form></section>;
}
