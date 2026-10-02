import { MAX_CENTS, monthAfter, type PlanInput } from '@eddias/core';
export const categories = { fornecedores: 'Fornecedores', fixos: 'Custos fixos', impostos: 'Impostos', outros: 'Outros' };
export function monthLabel(month: string) { return new Date(month + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }); }
export function Amount({ value, onChange, label, optional = false, signed = false }: { value: number | null; onChange: (n: number | null) => void; label: string; optional?: boolean; signed?: boolean }) {
  return <input aria-label={label} type="number" inputMode="decimal" step="0.01" min={signed ? -MAX_CENTS / 100 : 0} max={MAX_CENTS / 100} required={!optional}
    value={value === null ? '' : value / 100} placeholder={optional ? 'Não informado' : '0,00'} onChange={e => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))} />;
}
export function MonthlyGrid({ p, name, amounts, change }: { p: PlanInput; name: string; amounts: number[]; change: (a: number[]) => void }) {
  return <div className="table-scroll"><table className="data-table monthly-inputs"><caption>Valores mensais · {name} (R$)</caption><thead><tr>{amounts.map((_, i) => <th key={i}>{monthLabel(monthAfter(p.start_month, i))}</th>)}</tr></thead><tbody><tr>{amounts.map((v, i) => <td key={i}><Amount value={v} label={name + ' ' + monthLabel(monthAfter(p.start_month, i))} onChange={n => change(amounts.map((x, j) => j === i ? n ?? 0 : x))} /></td>)}</tr></tbody></table></div>;
}
