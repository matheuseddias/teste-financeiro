import { MAX_CENTS } from './index';
export type CostCategory = 'fornecedores' | 'fixos' | 'impostos' | 'outros';
export interface ChannelPlan { id: string; name: string; net_bps: number; lag_days: number; gmv_cents: number[] }
export interface RecurringCost { id: string; name: string; category: CostCategory; amounts: number[] }
export interface PlanInput {
  start_month: string; months: number; opening_cents: number | null;
  channels: ChannelPlan[]; costs: RecurringCost[]; supplier_bps: number; tax_bps: number; notes: string;
}
export interface Plan { id: string; tenant_id: string; name: string; config: PlanInput; version: number; deleted_at: string | null }
export interface Commitment {
  id: string; tenant_id: string; company_id: string | null; name: string; due_date: string;
  amount_cents: number; direction: 'entrada' | 'saida'; category: CostCategory;
  version: number; deleted_at: string | null;
}
export interface MonthProjection {
  month: string; gmv: number; receipts: number; otherIncome: number; suppliers: number;
  fixed: number; taxes: number; otherExpenses: number; income: number; expenses: number;
  net: number; closing: number | null;
}
export interface Projection { months: MonthProjection[]; receivableAfterHorizon: number; netRateBps: number | null }
export function monthAfter(start: string, offset: number): string {
  const d = new Date(start + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}
function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function validPlan(p: PlanInput): string | null {
  if (!p || !/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(p.start_month) || !integer(p.months, 1, 24)) return 'Informe o mês inicial e um horizonte de 1 a 24 meses.';
  if (p.opening_cents !== null && !integer(p.opening_cents, -MAX_CENTS, MAX_CENTS)) return 'Saldo inicial inválido.';
  if (!integer(p.supplier_bps, 0, 10000) || !integer(p.tax_bps, 0, 10000)) return 'Percentuais devem ficar entre 0% e 100%.';
  if (!Array.isArray(p.channels) || !Array.isArray(p.costs) || p.channels.length > 50 || p.costs.length > 100 || typeof p.notes !== 'string' || p.notes.length > 4000) return 'Premissas inválidas ou extensas demais.';
  const ids = new Set<string>();
  for (const row of [...p.channels, ...p.costs]) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120) return 'Informe nomes e identificadores únicos para as premissas.';
    ids.add(row.id);
    const amounts = 'gmv_cents' in row ? row.gmv_cents : row.amounts;
    if (!Array.isArray(amounts) || amounts.length !== p.months || amounts.some(v => !integer(v, 0, MAX_CENTS))) return 'Preencha valores válidos em todos os meses.';
    if ('gmv_cents' in row && (!integer(row.net_bps, 0, 10000) || !integer(row.lag_days, 0, 180))) return 'Confira o percentual líquido e o prazo de repasse (0 a 180 dias).';
    if ('amounts' in row && !['fornecedores', 'fixos', 'impostos', 'outros'].includes(row.category)) return 'Categoria inválida.';
  }
  return null;
}
// Multiplicação em bigint evita perder centavos em somas/multiplicações próximas ao limite.
export function percent(cents: number, bps: number): number { return Number((BigInt(cents) * BigInt(bps) + 5000n) / 10000n); }
function safe(value: number): number { if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS) throw new Error('A projeção ultrapassa o limite de valores. Reduza o horizonte ou os montantes.'); return value; }
export function project(p: PlanInput, commitments: Commitment[] = []): Projection {
  const invalid = validPlan(p); if (invalid) throw new Error(invalid);
  const months: MonthProjection[] = Array.from({ length: p.months }, (_, i) => ({ month: monthAfter(p.start_month, i), gmv: 0, receipts: 0, otherIncome: 0, suppliers: 0, fixed: 0, taxes: 0, otherExpenses: 0, income: 0, expenses: 0, net: 0, closing: null }));
  let receivableAfterHorizon = 0; let allNet = 0; let allGmv = 0;
  const map = new Map(months.map(m => [m.month.slice(0, 7), m]));
  for (const channel of p.channels) for (let i = 0; i < p.months; i++) {
    const gmv = channel.gmv_cents[i]; const net = percent(gmv, channel.net_bps);
    months[i].gmv = safe(months[i].gmv + gmv); allNet = safe(allNet + net); allGmv = safe(allGmv + gmv);
    const first = new Date(months[i].month + 'T12:00:00Z');
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    // Distribuição uniforme diária, incluindo o resíduo de centavos, seguida do prazo em dias corridos.
    for (let day = 0; day < days; day++) {
      const cents = Math.floor(net / days) + (day < net % days ? 1 : 0);
      const receipt = new Date(first); receipt.setUTCDate(1 + day + channel.lag_days);
      const target = map.get(receipt.toISOString().slice(0, 7));
      if (target) target.receipts = safe(target.receipts + cents);
      else receivableAfterHorizon = safe(receivableAfterHorizon + cents);
    }
  }
  const addExpense = (m: MonthProjection, category: CostCategory, amount: number) => {
    const key = ({ fornecedores: 'suppliers', fixos: 'fixed', impostos: 'taxes', outros: 'otherExpenses' } as const)[category];
    m[key] = safe(m[key] + amount);
  };
  for (const cost of p.costs) cost.amounts.forEach((amount, i) => addExpense(months[i], cost.category, amount));
  for (const c of commitments) {
    if (c.deleted_at) continue;
    const m = map.get(c.due_date.slice(0, 7)); if (!m) continue;
    if (!integer(c.amount_cents, 1, MAX_CENTS)) throw new Error('Lançamento com valor inválido.');
    if (c.direction === 'entrada') m.otherIncome = safe(m.otherIncome + c.amount_cents);
    else addExpense(m, c.category, c.amount_cents);
  }
  let balance = p.opening_cents;
  for (const m of months) {
    // Percentuais completam a lacuna, sem somar novamente obrigações já conhecidas no mesmo mês.
    m.suppliers = Math.max(m.suppliers, percent(m.gmv, p.supplier_bps));
    m.taxes = Math.max(m.taxes, percent(m.gmv, p.tax_bps));
    m.income = safe(m.receipts + m.otherIncome); m.expenses = safe(m.suppliers + m.fixed + m.taxes + m.otherExpenses);
    m.net = safe(m.income - m.expenses); balance = balance === null ? null : safe(balance + m.net); m.closing = balance;
  }
  return { months, receivableAfterHorizon, netRateBps: allGmv ? Number((BigInt(allNet) * 10000n + BigInt(Math.floor(allGmv / 2))) / BigInt(allGmv)) : null };
}
export function blankPlan(start = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()) + '-01'): PlanInput {
  return { start_month: start, months: 6, opening_cents: null, channels: [], costs: [], supplier_bps: 0, tax_bps: 0, notes: '' };
}
export function resizePlan(p: PlanInput, months: number): PlanInput {
  const resize = (a: number[]) => Array.from({ length: months }, (_, i) => a[i] ?? a.at(-1) ?? 0);
  return { ...p, months, channels: p.channels.map(c => ({ ...c, gmv_cents: resize(c.gmv_cents) })), costs: p.costs.map(c => ({ ...c, amounts: resize(c.amounts) })) };
}
export function scenarioVariant(p: PlanInput, gmvBps: number, netDeltaBps: number, lagExtra: number): PlanInput {
  return { ...p, channels: p.channels.map(c => ({ ...c, gmv_cents: c.gmv_cents.map(v => safe(percent(v, gmvBps))), net_bps: Math.max(0, Math.min(10000, c.net_bps + netDeltaBps)), lag_days: Math.max(0, Math.min(180, c.lag_days + lagExtra)) })) };
}
