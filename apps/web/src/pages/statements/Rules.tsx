import { useState } from 'react';
import { learnedCandidates, matchesRule, money } from '@eddias/core';
import { useStore } from '../../domain/store';
import { Notice } from '../../ui';
import { message } from '../../data/client';
export function Rules() {
  const { data, repo, mutate, busy } = useStore(); const [error, setError] = useState(''); const [confirmed, setConfirmed] = useState('');
  const [preview, setPreview] = useState<{ ids: string[]; affected: number } | null>(null); const [status, setStatus] = useState('');
  if (!data) return null;
  const suggestions = learnedCandidates(data.transactions, data.rules);
  const pending = data.transactions.filter(t => t.classification === 'pendente' && data.rules.some(r => matchesRule(t, r))).slice(0, 2000);
  async function run(action: () => Promise<unknown>) { setError(''); setStatus(''); try { await mutate(action); setPreview(null); setConfirmed(''); } catch (e) { setError(message(e)); } }
  return <section className="card editor"><h2>Regras e sugestões</h2><p>O sistema observa classificações manuais repetidas. Uma sugestão exige pelo menos três confirmações consistentes em duas datas. Nenhuma sugestão atua antes da aprovação administrativa.</p>
    <Notice>Regras usam a mesma conta, o sinal e a descrição completa, ignorando caixa e espaços repetidos. Classificam novos movimentos automaticamente; não vinculam pagamentos às previsões. Revise descrições genéricas como “PIX” antes de aprovar.</Notice>
    {error && <Notice error>{error}</Notice>}{status && <Notice>{status}</Notice>}
    <h3 className="section-heading">Padrões observados</h3>
    {!suggestions.length && <p>Nenhum padrão consistente disponível. Confirme as classificações dos movimentos para formar sugestões.</p>}
    {suggestions.map(s => <div className="card" key={s.transaction.id}><strong>{s.transaction.description}</strong><p>{data.accounts.find(a => a.id === s.transaction.account_id)?.name} · {s.transaction.amount_cents > 0 ? 'Entradas' : 'Saídas'} · {s.count} confirmações · {s.transaction.classification === 'repasse' ? 'Repasse: ' + s.transaction.channel : 'Operacional: ' + s.transaction.category}</p>
      <details><summary>Conferir exemplos</summary><ul>{s.examples.slice(0, 10).map(t => <li key={t.id}>{t.posted_date} · {money(t.amount_cents)} · {t.description}</li>)}</ul></details>
      <label className="checkbox"><input type="checkbox" checked={confirmed === s.transaction.id} onChange={e => setConfirmed(e.target.checked ? s.transaction.id : '')} />Revisei os exemplos e autorizo classificar novos movimentos com este padrão.</label>
      <button disabled={busy || confirmed !== s.transaction.id} onClick={() => void run(() => repo.rpc('fin_approve_rule', { p_id: crypto.randomUUID(), p_examples: s.examples.map(t => t.id) }))}>Aprovar regra</button></div>)}
    <h3 className="section-heading">Regras aprovadas</h3>
    {!data.rules.length && <p>Nenhuma regra aprovada.</p>}
    {data.rules.map(r => <div className="list-row" key={r.id}><div><strong>{r.description_key}</strong><p>{data.accounts.find(a => a.id === r.account_id)?.name} · {r.direction > 0 ? 'Entrada' : 'Saída'} · {r.classification === 'repasse' ? r.channel : r.category} · {r.active ? 'Ativa' : 'Pausada'}</p></div><button className="secondary" disabled={busy} onClick={() => { if (window.confirm(r.active ? 'Pausar a classificação automática deste padrão?' : 'Reativar esta regra após revisar as classificações?')) void run(() => repo.rpc('fin_toggle_rule', { p_id: r.id, p_active: !r.active, p_version: r.version })); }}>{r.active ? 'Pausar' : 'Reativar'}</button></div>)}
    <p>Uma correção manual que contradiz uma regra ativa pausa essa regra. Movimentos classificados pela automação não geram novos exemplos de aprendizagem.</p>
    <h3 className="section-heading">Aplicar aos movimentos pendentes</h3><p>{pending.length} movimentos elegíveis neste lote (até 2000). Classificações já confirmadas não serão sobrescritas.</p>
    {!!pending.length && <details><summary>Conferir movimentos elegíveis</summary><ul>{pending.slice(0, 100).map(t => <li key={t.id}>{t.posted_date} · {t.description} · {money(t.amount_cents)}</li>)}</ul>{pending.length > 100 && <p>Lista mostra os primeiros 100; o total acima inclui todo o lote.</p>}</details>}
    <button className="secondary" disabled={busy || !pending.length} onClick={async () => { setError(''); try { const ids = pending.map(t => t.id); const result = await repo.rpc<{ affected: number }>('fin_apply_rules', { p_ids: ids, p_dry_run: true }); setPreview({ ids, affected: result.affected }); } catch (e) { setError(message(e)); } }}>Simular aplicação</button>
    {preview && <div><p>Simulação: {preview.affected} classificações. Nenhum valor ou vínculo financeiro será alterado.</p><button disabled={busy || !preview.affected} onClick={() => void run(async () => { const result = await repo.rpc<{ affected: number }>('fin_apply_rules', { p_ids: preview.ids, p_dry_run: false }); setStatus(result.affected + ' movimentos classificados.'); })}>Confirmar classificações</button></div>}
  </section>;
}
