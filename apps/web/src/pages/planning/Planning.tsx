import { useState } from 'react';
import { Plus, TrendingUp } from 'lucide-react';
import { access, blankPlan, money, project, scenarioVariant, type Plan, type PlanInput, type Projection } from '@eddias/core';
import { useStore } from '../../domain/store';
import { useAuth } from '../../app/auth';
import { message } from '../../data/client';
import { Empty, Notice, useDraft } from '../../ui';
import { Premises } from './Premises';
import { Results } from './Results';
import { monthLabel } from './fields';
export function Planning() {
  const { data } = useStore(); const { member } = useAuth();
  const [selected, setSelected] = useState<string | null>(null); const plans = data?.plans || [];
  const active = selected === 'new' ? null : plans.find(p => p.id === selected) || plans[0];
  const canEdit = access(member, 'planejamento') === 'edit';
  function select(id: string) { if (!document.querySelector('form[data-dirty="true"]') || window.confirm('Trocar de cenário? O rascunho ficará salvo neste dispositivo.')) setSelected(id); }
  return <><div className="page-heading"><div><p className="eyebrow">PLANEJE OS PRÓXIMOS MESES</p><h1>Projeções de caixa</h1><p>Do GMV ao dinheiro que chega à conta.</p></div>{canEdit && <button onClick={() => select('new')}><Plus size={18} />Novo cenário</button>}</div>
    <Notice>Premissas manuais · consolidado do grupo. A integração de vendas e a conciliação bancária ainda não alimentam automaticamente esta projeção.</Notice>
    {!!plans.length && <div className="scenario-bar"><label>Cenário<select aria-label="Cenário" value={selected === 'new' ? 'new' : active?.id || ''} onChange={e => select(e.target.value)}>{selected === 'new' && <option value="new">Novo cenário</option>}{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span className="badge"><TrendingUp size={14} />{plans.length} cenário(s) salvo(s)</span></div>}
    {!active && selected !== 'new' ? <Empty title="Seu primeiro cenário de caixa">Crie um cenário, informe o GMV dos canais e o percentual que efetivamente chega ao banco. Depois acrescente custos e fornecedores.</Empty> : <Workspace key={active ? active.id + ':' + active.version : 'new'} plan={active || null} canEdit={canEdit} saved={setSelected} />}
  </>;
}
function Workspace({ plan, canEdit, saved }: { plan: Plan | null; canEdit: boolean; saved: (id: string) => void }) {
  const { member } = useAuth(); const { data, repo, mutate, busy } = useStore();
  const draft = useDraft('fin:plan:' + member.user_id + ':' + member.tenant_id + ':' + (plan?.id || 'new'), {
    id: plan?.id || crypto.randomUUID(), version: plan?.version || 0, name: plan?.name || 'Cenário base', config: plan?.config || blankPlan(),
  });
  const v = canEdit ? draft.value : { id: plan!.id, version: plan!.version, name: plan!.name, config: plan!.config };
  const [error, setError] = useState(''); const [compareId, setCompareId] = useState('');
  let result: Projection | undefined; let calculationError = '';
  try { result = project(v.config, data?.commitments); } catch (e) { calculationError = message(e); }
  function change(config: PlanInput) { draft.update({ ...v, config }); }
  async function clone(kind: 'copy' | 'stress' | 'growth') {
    setError('');
    try {
      const config = kind === 'copy' ? v.config : scenarioVariant(v.config, kind === 'stress' ? 8000 : 11000, kind === 'stress' ? -300 : 0, kind === 'stress' ? 7 : 0);
      project(config, data?.commitments);
      const id = crypto.randomUUID();
      await mutate(() => repo.rpc('fin_save_plan', { p_id: id, p_name: (v.name.slice(0, 85) + (kind === 'copy' ? ' · cópia' : kind === 'stress' ? ' · conservador' : ' · crescimento')), p_config: config, p_version: 0 }));
      saved(id);
    } catch (e) { setError(message(e)); }
  }
  const other = data?.plans.find(p => p.id === compareId);
  let comparison: Projection | undefined; try { if (other) comparison = project(other.config, data?.commitments); } catch { /* O próprio cenário mostra o erro ao ser aberto. */ }
  return <>{error && <Notice error>{error}</Notice>}<details className="card" open={!plan || undefined}><summary><strong>Premissas · {v.name}</strong><span className="muted">{draft.dirty && canEdit ? 'Rascunho não salvo' : canEdit ? 'Abrir para editar' : 'Consultar premissas'}</span></summary>
    <form data-dirty={canEdit && draft.dirty} onSubmit={async e => { e.preventDefault(); setError(''); try {
      project(v.config, data?.commitments);
      await mutate(() => repo.rpc('fin_save_plan', { p_id: v.id, p_name: v.name, p_config: v.config, p_version: v.version }));
      draft.clear(); saved(v.id);
    } catch (e) { setError(message(e)); } }}><fieldset disabled={!canEdit || busy}><label>Nome do cenário<input required maxLength={120} value={v.name} onChange={e => draft.update({ ...v, name: e.target.value })} /></label>
      <Premises p={v.config} change={change} />
      {canEdit && <div className="actions"><button disabled={busy || !!calculationError}>{busy ? 'Salvando…' : 'Salvar cenário'}</button>{draft.dirty && <button type="button" className="secondary" onClick={() => { if (window.confirm('Descartar o rascunho e voltar às premissas carregadas?')) draft.clear(); }}>Descartar rascunho</button>}</div>}
    </fieldset></form>{draft.storageError && <Notice error>Não foi possível guardar o rascunho neste dispositivo.</Notice>}</details>
    {calculationError && <Notice error>{calculationError}</Notice>}
    {result && <><div className="projection-context"><span>{draft.dirty && canEdit ? 'Prévia do rascunho' : plan ? 'Cenário salvo' : 'Prévia ainda não salva'} · {v.name}</span>{canEdit && <div className="actions"><button className="secondary" disabled={busy || draft.dirty || !plan} onClick={() => void clone('copy')}>Duplicar cenário</button><button className="secondary" disabled={busy || draft.dirty || !plan} onClick={() => void clone('stress')}>Criar conservador</button><button className="secondary" disabled={busy || draft.dirty || !plan} onClick={() => void clone('growth')}>Criar crescimento</button></div>}</div>
      {canEdit && <p className="muted">Conservador: GMV −20%, líquido −3 pontos percentuais e repasse +7 dias. Crescimento: GMV +10%. São hipóteses editáveis, não recomendações.</p>}
      {v.config.opening_cents === null && <Notice>Saldo inicial não informado. A movimentação mensal é calculada, mas o saldo acumulado permanece indisponível.</Notice>}
      {v.config.channels.some(c => c.net_bps === 0 && c.gmv_cents.some(n => n > 0)) && <Notice error>Há canal com GMV e percentual líquido de 0%. Confira essa premissa antes de usar a projeção.</Notice>}
      <Results result={result} p={v.config} name={v.name} />
      {!!data?.plans.filter(p => p.id !== plan?.id).length && <section className="card"><h2>Comparar com outro cenário</h2><label>Cenário de comparação<select aria-label="Cenário de comparação" value={compareId} onChange={e => setCompareId(e.target.value)}><option value="">Selecione</option>{data?.plans.filter(p => p.id !== plan?.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {comparison && <div className="table-scroll"><table className="data-table"><thead><tr><th>Mês</th><th>{v.name} · saldo</th><th>{other?.name} · saldo</th><th>Diferença</th></tr></thead><tbody>{result.months.map(m => { const b = comparison.months.find(b => b.month === m.month); return <tr key={m.month}><th>{monthLabel(m.month)}</th><td>{money(m.closing)}</td><td>{b ? money(b.closing) : 'Fora do período'}</td><td>{money(b && b.closing !== null && m.closing !== null ? m.closing - b.closing : null)}</td></tr>; })}</tbody></table></div>}
      </section>}</>}
  </>;
}
