import { describe, expect, it } from 'vitest';
import { blankPlan, project, type Commitment } from './planning';
import { defaultMapping, identifyRows, mapStatement, parseOfx, statementDate, updatedProjection, type BankTransaction, type Allocation } from './statements';
const base = { posted_date: '2026-09-10', amount_cents: -10000, description: 'Pagamento fornecedor', external_id: null };
const transaction: BankTransaction = { ...base, id: 't1', tenant_id: 't', account_id: 'a', source_key: 'k', fingerprint: 'f', classification: 'operacional', category: 'fornecedores', channel: null, version: 1, deleted_at: null };
const entry: Commitment = { id: 'c1', tenant_id: 't', company_id: null, name: 'Fornecedor', due_date: '2026-10-10', amount_cents: 20000, direction: 'saida', category: 'fornecedores', version: 1, deleted_at: null };
const allocation: Allocation = { id: 'a1', tenant_id: 't', transaction_id: 't1', commitment_id: 'c1', amount_cents: 10000, deleted_at: null };
describe('extratos e realizado', () => {
 it('mapeia cabeçalhos de data, sinais, saldos e linhas inválidas sem herdar data preenchida inválida', () => {
  const rows = [['Data','Descrição','Valor'],['01 set 2026','',''],['','Saldo anterior','100,00'],['','Pagamento','-50,25'],['31/02/2026','Inválido','12,00'],['','Recebimento','80,00']];
  const r = mapStatement(rows, { ...defaultMapping, fill_date: true });
  expect(r.valid.map(x => x.amount_cents)).toEqual([-5025, 8000]); expect(r.skipped).toHaveLength(3);
  expect(statementDate('31/02/2026')).toBeNull(); expect(statementDate(9999999999999)).toBeNull();
  expect(r.valid[0].posted_date).toBe('2026-09-01');
  expect(statementDate('2 de março de 2026')).toBe('2026-03-02');
 });
 it('débito/crédito e valores numéricos de Excel não são reinterpretados como milhar', () => {
  const r = mapStatement([['2026-09-01','Pix',12.45,0],['2026-09-02','Crédito',0,50.01]], { ...defaultMapping, start: 0, amount: -1, debit: 2, credit: 3 });
  expect(r.valid.map(x => x.amount_cents)).toEqual([-1245, 5001]);
 });
 it('aceita OFX SGML/XML, preserva FITID, moeda e identidade da conta', () => {
  for (const close of ['', '</TRNAMT>']) {
   const s = '<OFX><CURDEF>BRL< BANK></BANK><BANKACCTFROM><BANKID>123<ACCTID>0001</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260901120000[-3:BRT]<TRNAMT>-12.45'+close+'<FITID>abc<NAME>Pix &amp; Taxa</STMTTRN></BANKTRANLIST></OFX>';
   const r = parseOfx(s); expect(r.account).toBe('0001'); expect(r.valid[0]).toMatchObject({ posted_date: '2026-09-01', amount_cents: -1245, external_id: 'abc', description: 'Pix & Taxa' });
   expect(() => parseOfx(s.replace('BRL','USD'))).toThrow(/BRL/);
   expect(() => parseOfx(s.replace('</OFX>','<BANKACCTFROM></BANKACCTFROM></OFX>'))).toThrow(/única/);
  }
 });
 it('identifica reimportação e preserva duas ocorrências iguais no mesmo arquivo', async () => {
  const a = await identifyRows([base, base]); const b = await identifyRows([base, base]);
  expect(a).toEqual(b); expect(a[0].source_key).not.toBe(a[1].source_key); expect(a[0].fingerprint).toBe(a[1].fingerprint);
  expect((await identifyRows([{ ...base, external_id: 'bank-01' }]))[0].source_key).toBe('id:bank-01');
 });
 it('pagamento adiantado substitui só a parcela prevista e mantém o saldo remanescente', () => {
  const p = { ...blankPlan('2026-09-01'), months: 3, opening_cents: 50000 };
  const baseline = project(p, [entry]); const r = updatedProjection(baseline, p.opening_cents, [entry], [transaction], [allocation]);
  expect(r.months.map(m => m.expenses)).toEqual([10000,10000,0]); expect(r.months.at(-1)?.closing).toBe(30000);
 });
 it('pagamento de obrigação anterior ao horizonte não abate outra previsão atual', () => {
  const p = { ...blankPlan('2026-10-01'), months: 3, opening_cents: 50000, costs: [{ id:'cost',name:'Outubro',category:'fornecedores' as const,amounts:[20000,0,0] }] };
  const past = { ...entry, due_date: '2026-09-01' }; const t = { ...transaction, posted_date:'2026-10-01' };
  const r = updatedProjection(project(p,[past]), p.opening_cents,[past],[t],[allocation]);
  expect(r.months[0].expenses).toBe(30000);
 });
 it('repasse realizado não soma duas vezes à projeção; transferências ficam fora', () => {
  const p = { ...blankPlan('2026-09-01'), months: 3, opening_cents: 0, channels:[{id:'c',name:'Canal',net_bps:8000,lag_days:0,gmv_cents:[10000,0,0]}] };
  const t = { ...transaction, amount_cents:5000, classification:'repasse' as const, channel:'Canal',category:null };
  expect(updatedProjection(project(p),0,[],[t],[]).months[0].income).toBe(8000);
  expect(updatedProjection(project(p),0,[],[{ ...t,amount_cents:9000 }],[]).months[0].income).toBe(9000);
  expect(updatedProjection(project(p),0,[],[{ ...t,classification:'transferencia' }],[]).months[0].income).toBe(8000);
 });
});
