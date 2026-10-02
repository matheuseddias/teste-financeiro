import { money, actualByMonth, type Projection } from '@eddias/core';
import { useStore } from '../../domain/store';
import { monthLabel } from './fields';
export function Actuals({ projection }: { projection: Projection }) {
  const { data } = useStore(); const actual = actualByMonth(data?.transactions || [], projection.months);
  return <section className="card"><h2>Projetado × realizado nos extratos</h2><p>Realizado inclui os movimentos importados e exclui transferências classificadas entre contas próprias. Ausência de importação não comprova ausência de movimentação.</p>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Mês</th><th>Entradas projetadas</th><th>Entradas realizadas</th><th>Saídas projetadas</th><th>Saídas realizadas</th><th>Caixa realizado</th><th>Sem classificação</th></tr></thead><tbody>{actual.map((a, i) => <tr key={a.month}><th>{monthLabel(a.month)}</th><td>{money(projection.months[i].income)}</td><td>{money(a.income)}</td><td>{money(projection.months[i].expenses)}</td><td>{money(a.expenses)}</td><td className={a.net < 0 ? 'negative' : ''}>{money(a.net)}</td><td>{a.pending}</td></tr>)}</tbody></table></div>
  </section>;
}
