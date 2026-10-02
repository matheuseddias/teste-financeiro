import { useState } from 'react';
import { Upload, Link2 } from 'lucide-react';
import { access, money, parseBrl, remainingCommitments, type BankTransaction, type CostCategory } from '@eddias/core';
import { useStore } from '../../domain/store';
import { useAuth } from '../../app/auth';
import { message } from '../../data/client';
import { Empty, Notice, useDraft } from '../../ui';
import { categories } from '../planning/fields';
import { Archive } from '../Companies';
import { ImportStatement } from './ImportStatement';
const classes = { pendente: 'Não classificado', operacional: 'Operacional', repasse: 'Repasse de vendas', transferencia: 'Transferência entre contas próprias', aporte: 'Aporte', emprestimo: 'Empréstimo' };
export function Statements() {
  const { data } = useStore(); const { member } = useAuth(); const canEdit = access(member, 'extratos') === 'edit';
  const [importing, setImporting] = useState(false); const [selectedId, setSelected] = useState(''); const [account, setAccount] = useState(''); const [month, setMonth] = useState(''); const [pending, setPending] = useState(false); const [page, setPage] = useState(0);
  const rows = (data?.transactions || []).filter(t => (!account || t.account_id === account) && (!month || t.posted_date.startsWith(month)) && (!pending || t.classification === 'pendente')).sort((a, b) => b.posted_date.localeCompare(a.posted_date));
  const selected = data?.transactions.find(t => t.id === selectedId);
  function choose(id: string) { if (!document.querySelector('form[data-dirty="true"]') || window.confirm('Há alterações não salvas. Continuar?')) { setSelected(id); setImporting(false); return true; } return false; }
  return <><div className="page-heading"><div><p className="eyebrow">MOVIMENTAÇÃO BANCÁRIA</p><h1>Extratos e conciliação</h1><p>Confira movimentos e vincule pagamentos e recebimentos às previsões.</p></div>{canEdit && <button onClick={() => { if (choose('')) setImporting(true); }}><Upload size={17} />Importar extrato</button>}</div>
    {importing && <ImportStatement close={() => setImporting(false)} />}
    {selected && <Reconcile key={selected.id + ':' + selected.version} transaction={selected} canEdit={canEdit} close={() => setSelected('')} />}
    <div className="card"><div className="form-grid"><label>Conta bancária<select value={account} onChange={e => { setAccount(e.target.value); setPage(0); }}><option value="">Todas as contas</option>{data?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Mês do extrato<input type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(0); }} /></label></div>
      <label className="checkbox"><input type="checkbox" checked={pending} onChange={e => { setPending(e.target.checked); setPage(0); }} />Somente não classificados</label>
      <p>{rows.length} movimentos · entradas {money(rows.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0))} · saídas {money(-rows.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0))}. Totais do extrato incluem transferências.</p></div>
    {!rows.length ? <Empty title="Nenhum movimento neste período">Cadastre uma conta e importe seu extrato para começar.</Empty> : <section className="card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th>Valor</th><th>Classificação</th><th>Vinculado a previsões</th><th>Ação</th></tr></thead><tbody>{rows.slice(page * 100, page * 100 + 100).map(t => {
      const allocated = (data?.allocations || []).filter(a => a.transaction_id === t.id).reduce((s, a) => s + a.amount_cents, 0);
      return <tr key={t.id}><td>{t.posted_date.split('-').reverse().join('/')}</td><td className="transaction-description">{t.description}</td><td>{data?.accounts.find(a => a.id === t.account_id)?.name}</td><td className={t.amount_cents < 0 ? 'negative' : ''}>{money(t.amount_cents)}</td><td>{classes[t.classification]}{t.channel && <small className="block">{t.channel}</small>}</td><td>{money(allocated)} / {money(Math.abs(t.amount_cents))}</td><td><button className="secondary" onClick={() => choose(t.id)}><Link2 size={14} />{canEdit ? 'Conciliar' : 'Consultar'}</button></td></tr>;
    })}</tbody></table></div><div className="actions"><button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1}</span><button className="secondary" disabled={(page + 1) * 100 >= rows.length} onClick={() => setPage(page + 1)}>Próxima</button></div></section>}
  </>;
}
function Reconcile({ transaction: t, canEdit, close }: { transaction: BankTransaction; canEdit: boolean; close: () => void }) {
  const { member } = useAuth(); const { data, repo, mutate, busy } = useStore(); const [error, setError] = useState('');
  const links = (data?.allocations || []).filter(a => a.transaction_id === t.id);
  const available = Math.abs(t.amount_cents) - links.reduce((s, a) => s + a.amount_cents, 0);
  const account = data?.accounts.find(a => a.id === t.account_id);
  const options = remainingCommitments(data?.commitments || [], data?.allocations || []).filter(c => c.direction === (t.amount_cents > 0 ? 'entrada' : 'saida') && (!c.company_id || c.company_id === account?.company_id) && !links.some(a => a.commitment_id === c.id));
  const draft = useDraft('fin:reconcile:' + member.user_id + ':' + member.tenant_id + ':' + t.id, { version: t.version, classification: t.classification, category: t.category || 'outros', channel: t.channel || '', commitment: '', amount: '', allocationId: crypto.randomUUID() });
  const v = canEdit ? draft.value : { ...draft.value, classification: t.classification, category: t.category || 'outros', channel: t.channel || '' };
  return <section className="card editor"><h2>{t.description}</h2><p>{t.posted_date.split('-').reverse().join('/')} · {money(t.amount_cents)} · {account?.name}</p>
    {error && <Notice error>{error}</Notice>}<form data-dirty={canEdit && draft.dirty} onSubmit={async e => { e.preventDefault(); setError(''); try {
      await mutate(() => repo.rpc('fin_classify_transaction', { p_id: t.id, p_version: v.version, p_classification: v.classification, p_category: v.category, p_channel: v.channel || null })); draft.clear();
    } catch (e) { setError(message(e)); } }}><fieldset disabled={!canEdit || busy}><div className="form-grid"><label>Classificação<select value={v.classification} onChange={e => draft.update({ ...v, classification: e.target.value as BankTransaction['classification'] })}>{Object.entries(classes).filter(([key]) => key !== 'repasse' || t.amount_cents > 0).map(([k, label]) => <option value={k} key={k}>{label}</option>)}</select></label>
      <label>Categoria<select value={v.category} onChange={e => draft.update({ ...v, category: e.target.value as CostCategory })}>{Object.entries(categories).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
      {v.classification === 'repasse' && <label>Canal do repasse<input required maxLength={120} value={v.channel} placeholder="Ex.: Mercado Livre" onChange={e => draft.update({ ...v, channel: e.target.value })} /></label>}</div>
      {v.classification === 'transferencia' && <Notice>Use somente para transferências entre contas do próprio grupo. Classifique também a contrapartida; esses movimentos ficam fora das receitas e despesas consolidadas.</Notice>}
      {canEdit && <button disabled={busy}>Salvar classificação</button>}</fieldset></form>
    <h3 className="section-heading">Vínculos com lançamentos previstos</h3><p>Disponível para vincular: {money(available)}. Uma previsão pode ser paga em partes, e um movimento pode cobrir várias previsões.</p>
    {links.map(a => <div className="list-row" key={a.id}><span>{data?.commitments.find(c => c.id === a.commitment_id)?.name || 'Previsão'} · {money(a.amount_cents)}</span>{member.role === 'admin' && <Archive entity="allocations" id={a.id} name="vínculo de conciliação" />}</div>)}
    {canEdit && available > 0 && t.classification !== 'transferencia' && <div className="form-grid"><label>Previsão a vincular<select aria-label="Previsão a vincular" value={v.commitment} onChange={e => { const c = options.find(c => c.id === e.target.value); draft.update({ ...v, commitment: e.target.value, amount: c ? (Math.min(c.amount_cents, available) / 100).toFixed(2).replace('.', ',') : '', allocationId: crypto.randomUUID() }); }}><option value="">Selecione</option>{options.map(c => <option key={c.id} value={c.id}>{c.due_date} · {c.name} · {money(c.amount_cents)}</option>)}</select></label>
      <label>Valor a conciliar (R$)<input inputMode="decimal" value={v.amount} onChange={e => draft.update({ ...v, amount: e.target.value })} /></label><button disabled={busy || !v.commitment} onClick={async () => { setError(''); try {
        const cents = parseBrl(v.amount); if (!cents || cents <= 0) throw new Error('Informe um valor maior que zero.');
        await mutate(() => repo.rpc('fin_reconcile', { p_id: v.allocationId, p_transaction_id: t.id, p_commitment_id: v.commitment, p_amount_cents: cents })); draft.clear();
      } catch (e) { setError(message(e)); } }}>Confirmar conciliação</button></div>}
    {draft.storageError && <Notice error>Rascunho não salvo neste dispositivo.</Notice>}<div className="actions"><button className="secondary" onClick={() => { if (!draft.dirty || window.confirm('Fechar e manter rascunho?')) close(); }}>Fechar</button>{canEdit && draft.dirty && <button className="secondary" onClick={() => { if (window.confirm('Descartar rascunho?')) draft.clear(); }}>Descartar rascunho</button>}</div>
  </section>;
}
