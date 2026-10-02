import type { BankTransaction } from './statements';
export interface ClassificationRule {
  id: string; tenant_id: string; account_id: string; description_key: string; direction: number;
  classification: 'operacional' | 'repasse'; category: BankTransaction['category']; channel: string | null;
  example_ids: string[]; active: boolean; version: number; deleted_at: string | null;
}
export const normalizedDescription = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export function matchesRule(t: BankTransaction, r: ClassificationRule): boolean {
  return !t.deleted_at && r.active && !r.deleted_at && t.tenant_id === r.tenant_id && t.account_id === r.account_id &&
    Math.sign(t.amount_cents) === r.direction && normalizedDescription(t.description) === r.description_key;
}
export function learnedCandidates(transactions: BankTransaction[], rules: ClassificationRule[]) {
  const groups = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.deleted_at || t.rule_id || t.classification === 'pendente') continue;
    const key = JSON.stringify([t.tenant_id, t.account_id, Math.sign(t.amount_cents), normalizedDescription(t.description)]);
    groups.set(key, [...groups.get(key) || [], t]);
  }
  return [...groups.values()].filter(rows => {
    const first = rows[0];
    return ['operacional','repasse'].includes(first.classification) && rows.length >= 3 && new Set(rows.map(t => t.posted_date)).size >= 2 &&
      rows.every(t => t.classification === first.classification && t.category === first.category && t.channel === first.channel) &&
      !rules.some(r => matchesRule(first, r));
  }).map(rows => {
    const first = rows[0], secondDate = rows.find(t => t.posted_date !== first.posted_date)!;
    const examples = [first, secondDate, ...rows.filter(t => t.id !== first.id && t.id !== secondDate.id)].slice(0, 100);
    return { transaction: first, examples, count: rows.length };
  });
}
