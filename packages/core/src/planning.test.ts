import { describe, expect, it } from 'vitest';
import { blankPlan, project, scenarioVariant, validPlan, type Commitment, type PlanInput } from './planning';
function plan(): PlanInput { return { ...blankPlan('2026-09-01'), months: 3, opening_cents: 10000, supplier_bps: 3000, tax_bps: 500, channels: [{ id: 'c1', name: 'Marketplace', net_bps: 8000, lag_days: 0, gmv_cents: [100000, 200000, 0] }] }; }
function commitment(amount: number, category: Commitment['category'] = 'fornecedores', direction: Commitment['direction'] = 'saida'): Commitment {
  return { id: 'a', tenant_id: 't', company_id: null, name: 'Teste', due_date: '2026-09-20', amount_cents: amount, direction, category, version: 1, deleted_at: null };
}
describe('projeção financeira', () => {
  it('converte GMV em caixa líquido e acumula obrigações sem descontar taxas duas vezes', () => {
    const r = project(plan());
    expect(r.months[0]).toMatchObject({ gmv: 100000, receipts: 80000, suppliers: 30000, taxes: 5000, net: 45000, closing: 55000 });
    expect(r.months[1].closing).toBe(145000); expect(r.netRateBps).toBe(8000);
  });
  it('contas conhecidas completam a estimativa de fornecedores sem somar em duplicidade', () => {
    expect(project(plan(), [commitment(20000)]).months[0].suppliers).toBe(30000);
    expect(project(plan(), [commitment(40000)]).months[0].suppliers).toBe(40000);
    expect(project(plan(), [commitment(12000, 'fixos')]).months[0].fixed).toBe(12000);
    expect(project(plan(), [commitment(12000, 'outros', 'entrada')]).months[0].income).toBe(92000);
  });
  it('desloca o repasse para os meses seguintes e preserva exatamente todos os centavos', () => {
    const p = plan(); p.channels[0].lag_days = 45; p.channels[0].gmv_cents = [123457, 0, 98765];
    const r = project(p); expect(r.months[0].receipts).toBe(0);
    expect(r.months.reduce((s, m) => s + m.receipts, 0) + r.receivableAfterHorizon).toBe(98766 + 79012);
    expect(r.receivableAfterHorizon).toBe(79012);
  });
  it('trata fevereiro, ano bissexto e virada de ano sem usar o fuso local', () => {
    const p = plan(); p.start_month = '2024-02-01'; p.channels[0].lag_days = 29; p.channels[0].gmv_cents = [2900, 0, 0]; p.channels[0].net_bps = 10000;
    expect(project(p).months.map(m => m.receipts)).toEqual([0, 2900, 0]);
    p.start_month = '2026-12-01'; expect(project(p).months.map(m => m.month)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
  });
  it('não inventa saldo inicial nem considera compromissos arquivados', () => {
    const p = plan(); p.opening_cents = null;
    expect(project(p).months.every(m => m.closing === null)).toBe(true);
    expect(project(p, [{ ...commitment(99999), deleted_at: '2026-01-01' }]).months[0].suppliers).toBe(30000);
  });
  it('cenário conservador altera apenas suas hipóteses e não o original', () => {
    const p = plan(); const v = scenarioVariant(p, 8000, -300, 7);
    expect(v.channels[0]).toMatchObject({ net_bps: 7700, lag_days: 7, gmv_cents: [80000, 160000, 0] });
    expect(p.channels[0].gmv_cents[0]).toBe(100000);
  });
  it('rejeita porcentagens impossíveis, fração de centavo, arrays incompletos e estouro acumulado', () => {
    const p = plan(); p.channels[0].net_bps = 10001; expect(validPlan(p)).not.toBeNull();
    p.channels[0].net_bps = 8000; p.channels[0].gmv_cents = [1.5, 0, 0]; expect(validPlan(p)).not.toBeNull();
    p.channels[0].gmv_cents = [1]; expect(() => project(p)).toThrow();
    p.channels[0].gmv_cents = [9000000000000, 9000000000000, 0]; expect(() => project(p)).toThrow(/limite/);
  });
});
