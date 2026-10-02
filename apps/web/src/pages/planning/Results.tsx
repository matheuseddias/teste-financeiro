import { money, type Projection, type PlanInput, type MonthProjection } from '@eddias/core';
import { monthLabel } from './fields';
export function BalanceChart({ result }: { result: Projection }) {
  const hasBalance = result.months[0]?.closing !== null;
  const values = result.months.map(m => hasBalance ? m.closing! : m.net);
  const low = Math.min(0, ...values), high = Math.max(1, ...values); const span = high - low;
  const x = (i: number) => 75 + i * 770 / Math.max(1, values.length - 1);
  const y = (v: number) => 190 - (v - low) / span * 145;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return <section className="card"><h2>{hasBalance ? 'Evolução do saldo projetado' : 'Movimentação líquida por mês'}</h2><p>{hasBalance ? 'Saldo inicial + entradas − saídas acumuladas.' : 'Informe o saldo inicial para visualizar o saldo acumulado.'}</p>
    <svg className="projection-chart" viewBox="0 0 920 245" role="img" aria-label={hasBalance ? 'Gráfico do saldo projetado. Valores detalhados na tabela abaixo.' : 'Gráfico da movimentação líquida mensal. Valores detalhados na tabela abaixo.'}>
      <line x1="75" x2="845" y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="5 4" />
      <text x="10" y={y(high)} fill="var(--muted)" fontSize="11">{money(high).replace(',00', '')}</text><text x="10" y={y(low)} fill="var(--muted)" fontSize="11">{money(low).replace(',00', '')}</text>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="3" />
      {values.map((v, i) => <g key={i}><circle cx={x(i)} cy={y(v)} r="4" fill={v < 0 ? 'var(--danger)' : 'var(--accent)'}><title>{monthLabel(result.months[i].month)}: {money(v)}</title></circle>{(values.length <= 12 || i % 2 === 0) && <text x={x(i)} y="230" textAnchor="middle" fontSize="11" fill="var(--muted)">{monthLabel(result.months[i].month)}</text>}</g>)}
    </svg></section>;
}
const rows: [string, keyof MonthProjection][] = [['GMV projetado', 'gmv'], ['Repasses líquidos projetados', 'receipts'], ['Outras entradas previstas', 'otherIncome'], ['Total de entradas', 'income'], ['Fornecedores', 'suppliers'], ['Custos fixos', 'fixed'], ['Impostos', 'taxes'], ['Outras saídas', 'otherExpenses'], ['Total de saídas', 'expenses'], ['Geração / consumo de caixa', 'net'], ['Saldo ao fim do mês', 'closing']];
export function Results({ result, p, name }: { result: Projection; p: PlanInput; name: string }) {
  const lowest = p.opening_cents === null ? null : Math.min(p.opening_cents, ...result.months.map(m => m.closing!));
  const short = result.months.find(m => m.closing !== null && m.closing < 0);
  const cells = [['Indicador', ...result.months.map(m => monthLabel(m.month))], ...rows.map(([label, key]) => [label, ...result.months.map(m => m[key] === null ? '' : (Number(m[key]) / 100).toFixed(2).replace('.', ','))])];
  function download() {
    const quote = (s: string) => '"' + (/^[=+@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
    const blob = new Blob(['\uFEFF' + cells.map(r => r.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'projecao-caixa.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><div className="stats projection-stats"><div className="card stat"><span>Saldo final projetado</span><strong className={(result.months.at(-1)?.closing ?? 0) < 0 ? 'negative' : ''}>{money(result.months.at(-1)?.closing ?? null)}</strong><small>{name}</small></div>
    <div className="card stat"><span>Menor saldo mensal / inicial</span><strong className={(lowest ?? 0) < 0 ? 'negative' : ''}>{money(lowest)}</strong><small>{short ? 'Primeiro mês negativo: ' + monthLabel(short.month) : 'Visão mensal; não mede falta de caixa intramês'}</small></div>
    <div className="card stat"><span>GMV que vira repasse</span><strong>{result.netRateBps === null ? '—' : (result.netRateBps / 100).toLocaleString('pt-BR') + '%'}</strong><small>Premissa ponderada pelo GMV, ainda não histórica</small></div></div>
    <BalanceChart result={result} /><section className="card"><div className="page-heading"><div><h2>Fluxo de caixa projetado</h2><p>Consolidado do grupo · valores em reais</p></div><div className="actions"><button className="secondary" onClick={download}>Exportar CSV</button><button className="secondary" onClick={() => window.print()}>Imprimir / PDF</button></div></div>
      <div className="table-scroll"><table className="data-table financial-table"><thead><tr><th>Indicador</th>{result.months.map(m => <th key={m.month}>{monthLabel(m.month)}</th>)}</tr></thead><tbody>{rows.map(([label, key]) => <tr key={key} className={['income', 'expenses', 'net', 'closing'].includes(key) ? 'total-row' : ''}><th scope="row">{label}</th>{result.months.map(m => <td key={m.month} className={typeof m[key] === 'number' && Number(m[key]) < 0 ? 'negative' : ''}>{money(m[key] as number | null)}</td>)}</tr>)}</tbody></table></div>
      <p className="muted">Vendas distribuídas uniformemente nos dias do mês; repasses deslocados pelo prazo em dias corridos. Fora deste horizonte: {money(result.receivableAfterHorizon)} em repasses das vendas projetadas. Recebíveis de vendas anteriores devem ser incluídos em lançamentos previstos.</p>
    </section></>;
}
