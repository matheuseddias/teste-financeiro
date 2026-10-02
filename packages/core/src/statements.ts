import { MAX_CENTS, parseBrl } from './index';
import type { Commitment, CostCategory, MonthProjection } from './planning';
export interface ImportRow { posted_date: string; amount_cents: number; description: string; external_id: string | null; source_key: string; fingerprint: string }
export interface BankTransaction extends ImportRow {
  id: string; tenant_id: string; account_id: string; classification: 'pendente' | 'operacional' | 'repasse' | 'transferencia' | 'aporte' | 'emprestimo';
  category: CostCategory | null; channel: string | null; version: number; deleted_at: string | null; rule_id?: string | null;
}
export interface Allocation { id: string; tenant_id: string; transaction_id: string; commitment_id: string; amount_cents: number; deleted_at: string | null }
export interface ColumnMapping { date: number; description: number; amount: number; debit: number; credit: number; external: number; start: number; fill_date: boolean; invert: boolean; format: 'br' | 'decimal' }
export interface ImportProfile { id: string; tenant_id: string; account_id: string; name: string; config: ColumnMapping; version: number; deleted_at: string | null }
export const defaultMapping: ColumnMapping = { date: 0, description: 1, amount: 2, debit: -1, credit: -1, external: -1, start: 1, fill_date: false, invert: false, format: 'br' };
export function statementDate(value: unknown): string | null {
  let text = String(value ?? '').trim();
  const localized = /^(\d{1,2})\s+(?:de\s+)?([a-zç]+)\.?\s+(?:de\s+)?(20\d{2})$/i.exec(text);
  if (localized) {
    const month = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(localized[2].toLowerCase().slice(0, 3));
    if (month >= 0) text = `${localized[3]}-${String(month + 1).padStart(2, '0')}-${localized[1].padStart(2, '0')}`;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) text = value.toISOString().slice(0, 10);
  else if (typeof value === 'number') { if (!Number.isFinite(value) || value < 36526 || value > 73050) return null; text = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10); }
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) text = text.split('/').reverse().join('-');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(text + 'T12:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().startsWith(text) ? text : null;
}
export function statementAmount(value: unknown, format: 'br' | 'decimal'): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number') { const cents = Math.round(value * 100); if (!Number.isFinite(value) || !Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS) throw new Error('Valor inválido.'); return cents; }
  const text = String(value).trim().replace(/^R\$\s*/, '').replaceAll('\u00a0', '').replace(/^\((.*)\)$/, '-$1');
  if (format === 'br') return parseBrl(text);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Valor decimal inválido.');
  return parseBrl(text.replace('.', ','));
}
export interface RowIssue { row: number; reason: string }
export function mapStatement(rows: unknown[][], m: ColumnMapping) {
  const valid: Omit<ImportRow, 'source_key' | 'fingerprint'>[] = []; const skipped: RowIssue[] = []; let lastDate: string | null = null;
  if (m.start < 0 || m.start > rows.length || m.date < 0 || m.description < 0 || (m.amount < 0 && (m.debit < 0 || m.credit < 0))) throw new Error('Mapeie data, descrição e valor (ou débito e crédito).');
  for (let i = m.start; i < rows.length; i++) {
    const row = rows[i]; if (!row.some(x => x !== null && x !== undefined && String(x).trim())) continue;
    const rawDate = row[m.date]; const parsed = statementDate(rawDate);
    if (parsed) lastDate = parsed;
    // Uma data preenchida inválida nunca herda a anterior.
    const date = parsed || (m.fill_date && !String(rawDate ?? '').trim() ? lastDate : null);
    const desc = String(row[m.description] ?? '').trim().slice(0, 500);
    try {
      const amount = m.amount >= 0 ? statementAmount(row[m.amount], m.format) : (() => { const debit = statementAmount(row[m.debit], m.format); const credit = statementAmount(row[m.credit], m.format); return debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0); })();
      if (amount === null && parsed) { skipped.push({ row: i + 1, reason: 'Cabeçalho de data sem valor' }); continue; }
      if (!date || !desc || !amount) { skipped.push({ row: i + 1, reason: !date ? 'Data ausente ou inválida' : !desc ? 'Descrição ausente' : 'Sem movimento monetário' }); continue; }
      if (/^saldo\s+(anterior|inicial|final|do dia|dispon[ií]vel)/i.test(desc)) { skipped.push({ row: i + 1, reason: 'Linha de saldo, não é movimento' }); continue; }
      valid.push({ posted_date: date, amount_cents: m.invert ? -amount : amount, description: desc, external_id: m.external < 0 ? null : String(row[m.external] ?? '').trim().slice(0, 150) || null });
    } catch { skipped.push({ row: i + 1, reason: 'Valor incompatível com o formato selecionado' }); }
  }
  return { valid, skipped };
}
function decode(text: string) { return text.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))); }
export function parseOfx(text: string) {
  if (!/<OFX[>\s]/i.test(text) || text.length > 12_000_000) throw new Error('Arquivo OFX inválido ou grande demais.');
  if ((text.match(/<BANKACCTFROM\b|<CCACCTFROM\b/gi) || []).length !== 1) throw new Error('Importe um OFX de uma única conta por vez.');
  const tag = (body: string, name: string) => decode(new RegExp('<' + name + '\\s*>([^<\\r\\n]*)', 'i').exec(body)?.[1]?.trim() || '');
  if (tag(text, 'CURDEF') !== 'BRL') throw new Error('Somente extratos em BRL são aceitos.');
  const rows: Omit<ImportRow, 'source_key' | 'fingerprint'>[] = []; const skipped: RowIssue[] = [];
  const blocks = [...text.matchAll(/<STMTTRN\s*>([\s\S]*?)(?:<\/STMTTRN\s*>|(?=<STMTTRN\s*>|<\/BANKTRANLIST\s*>))/gi)];
  for (const [i, match] of blocks.entries()) {
    const rawDate = tag(match[1], 'DTPOSTED'); const date = statementDate(rawDate.slice(0, 4) + '-' + rawDate.slice(4, 6) + '-' + rawDate.slice(6, 8));
    const amount = statementAmount(tag(match[1], 'TRNAMT'), 'decimal');
    const desc = [tag(match[1], 'NAME'), tag(match[1], 'MEMO')].filter(Boolean).join(' · ').slice(0, 500);
    if (!date || !amount || !desc) { skipped.push({ row: i + 1, reason: 'Movimento OFX incompleto (data, valor ou descrição)' }); continue; }
    rows.push({ posted_date: date, amount_cents: amount, description: desc, external_id: tag(match[1], 'FITID').slice(0, 150) || null });
  }
  if (!blocks.length) throw new Error('OFX sem movimentos reconhecidos.');
  return { valid: rows, skipped, account: tag(text, 'ACCTID'), bank: tag(text, 'BANKID') };
}
export async function identifyRows(rows: Omit<ImportRow, 'source_key' | 'fingerprint'>[]): Promise<ImportRow[]> {
  const counts = new Map<string, number>(); const result: ImportRow[] = [];
  for (const row of rows) {
    const identity = JSON.stringify([row.posted_date, row.amount_cents, row.description.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()]);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const count = (counts.get(hash) || 0) + 1; counts.set(hash, count);
    result.push({ ...row, fingerprint: hash, source_key: row.external_id ? 'id:' + row.external_id : 'hash:' + hash + ':' + count });
  }
  return result;
}
export function remainingCommitments(entries: Commitment[], allocations: Allocation[]): Commitment[] {
  return entries.map(c => ({ ...c, amount_cents: Math.max(0, c.amount_cents - allocations.filter(a => !a.deleted_at && a.commitment_id === c.id).reduce((s, a) => s + a.amount_cents, 0)) })).filter(c => c.amount_cents > 0);
}
export function actualByMonth(transactions: BankTransaction[], projections: MonthProjection[]) {
  return projections.map(p => {
    const rows = transactions.filter(t => !t.deleted_at && t.posted_date.startsWith(p.month.slice(0, 7)) && t.classification !== 'transferencia');
    const income = rows.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
    const expenses = -rows.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0);
    return { month: p.month, income, expenses, net: income - expenses, pending: rows.filter(t => t.classification === 'pendente').length };
  });
}
// Substitui parcelas previstas por movimentos reais sem contar a mesma alocação duas vezes.
// Valores não classificados entram no caixa realizado, mas não abatem estimativas por categoria.
export function updatedProjection(base: import('./planning').Projection, opening: number | null, entries: Commitment[], transactions: BankTransaction[], allocations: Allocation[]): import('./planning').Projection {
  const months = base.months.map(m => ({ ...m })); const map = new Map(months.map(m => [m.month.slice(0, 7), m]));
  const amounts = new Map<string, number>();
  const expenseKey = (category: CostCategory | null) => ({ fornecedores: 'suppliers', fixos: 'fixed', impostos: 'taxes', outros: 'otherExpenses' } as const)[category || 'outros'];
  for (const a of allocations) {
    if (a.deleted_at) continue;
    const t = transactions.find(t => t.id === a.transaction_id && !t.deleted_at);
    const c = entries.find(c => c.id === a.commitment_id && !c.deleted_at);
    if (!t || !c || t.classification === 'transferencia') continue;
    amounts.set(t.id, (amounts.get(t.id) || 0) + a.amount_cents);
    const m = map.get(c.due_date.slice(0, 7)); if (!m) continue;
    const key = c.direction === 'entrada' ? 'otherIncome' : expenseKey(c.category);
    m[key] = Math.max(0, m[key] - a.amount_cents);
  }
  // Abate primeiro o realizado das estimativas; soma todos os movimentos depois (a ordem não altera o resultado).
  for (const t of transactions) {
    if (t.deleted_at || t.classification === 'transferencia') continue;
    const m = map.get(t.posted_date.slice(0, 7)); if (!m) continue;
    const unmatched = Math.max(0, Math.abs(t.amount_cents) - (amounts.get(t.id) || 0));
    if (t.classification === 'repasse') m.receipts = Math.max(0, m.receipts - unmatched);
    else if (t.classification === 'operacional') {
      const key = t.amount_cents > 0 ? 'otherIncome' : expenseKey(t.category);
      if (t.amount_cents > 0 || t.category) m[key] = Math.max(0, m[key] - unmatched);
    }
  }
  for (const t of transactions) {
    if (t.deleted_at || t.classification === 'transferencia') continue;
    const m = map.get(t.posted_date.slice(0, 7)); if (!m) continue;
    const key = t.amount_cents > 0 ? t.classification === 'repasse' ? 'receipts' : 'otherIncome' : expenseKey(t.category);
    m[key] += Math.abs(t.amount_cents);
  }
  let balance = opening;
  for (const m of months) {
    m.income = m.receipts + m.otherIncome; m.expenses = m.suppliers + m.fixed + m.taxes + m.otherExpenses; m.net = m.income - m.expenses;
    balance = balance === null ? null : balance + m.net; m.closing = balance;
    if ([m.income, m.expenses, m.net, balance ?? 0].some(v => !Number.isSafeInteger(v) || Math.abs(v) > MAX_CENTS)) throw new Error('Movimentação excede o limite da projeção.');
  }
  return { ...base, months };
}
