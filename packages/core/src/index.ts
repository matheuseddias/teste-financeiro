export type Role = 'admin' | 'membro';
export type Access = 'none' | 'view' | 'edit';
export type Area = 'empresas' | 'contas' | 'auditoria' | 'planejamento' | 'extratos';
export interface Membership {
  tenant_id: string; user_id: string; role: Role; active: boolean;
  permissions: Partial<Record<Area, Access>>; workspace_name?: string;
}
export interface Company {
  id: string; tenant_id: string; name: string; document: string | null;
  deleted_at: string | null; version: number;
}
export interface BankAccount {
  id: string; tenant_id: string; company_id: string; name: string;
  bank_name: string; bank_code: string; branch: string; account_number: string;
  kind: 'corrente' | 'pagamento' | 'poupanca'; currency: 'BRL';
  reference_date: string | null; reference_balance_cents: number | null;
  deleted_at: string | null; version: number;
}
export interface AuditEvent {
  id: number; entity: string; entity_id: string; action: string;
  actor_id: string | null; created_at: string;
}
export interface Snapshot {
  companies: Company[]; accounts: BankAccount[]; memberships: Membership[];
  plans: import('./planning').Plan[]; commitments: import('./planning').Commitment[];
  transactions: import('./statements').BankTransaction[]; allocations: import('./statements').Allocation[]; profiles: import('./statements').ImportProfile[];
  rules: import('./learning').ClassificationRule[];
}
export const MAX_CENTS = 9_000_000_000_000;
export function access(member: Membership | null, area: Area): Access {
  if (!member?.active) return 'none';
  return member.role === 'admin' ? 'edit' : member.permissions?.[area] || 'none';
}
export function money(cents: number | null): string {
  return cents === null ? 'Não informado' :
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
export function parseBrl(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value))
    throw new Error('Informe um valor como 1.234,56.');
  const normalized = value.replaceAll('.', '');
  const [integer, decimal = ''] = normalized.replace('-', '').split(',');
  const cents = (Number(integer) * 100 + Number(decimal.padEnd(2, '0'))) * (value.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS)
    throw new Error('O valor excede o limite permitido.');
  return cents;
}
export function canDelete(affected: number, total: number): boolean {
  return Number.isInteger(affected) && Number.isInteger(total) &&
    total > 0 && affected > 0 && affected <= total && affected / total <= 0.3;
}
export function validateAccount(value: Partial<BankAccount>): string | null {
  if (!value.company_id) return 'Selecione a empresa.';
  for (const field of ['name', 'bank_name', 'account_number'] as const)
    if (!value[field]?.trim()) return 'Preencha nome, banco e número da conta.';
  if (value.currency !== 'BRL') return 'Nesta versão, a moeda deve ser BRL.';
  if (!['corrente', 'pagamento', 'poupanca'].includes(value.kind || '')) return 'Tipo de conta inválido.';
  const amount = value.reference_balance_cents;
  if ((amount === null || amount === undefined) !== !value.reference_date)
    return 'Informe juntos a data e o saldo de referência.';
  if (amount !== null && amount !== undefined &&
      (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_CENTS)) return 'Saldo inválido.';
  if (value.reference_date && (!/^\d{4}-\d{2}-\d{2}$/.test(value.reference_date) ||
      Number.isNaN(Date.parse(value.reference_date)) ||
      new Date(value.reference_date).toISOString().slice(0, 10) !== value.reference_date))
    return 'Data de referência inválida.';
  return null;
}
export * from './planning';

export * from './statements';
export * from './learning';
