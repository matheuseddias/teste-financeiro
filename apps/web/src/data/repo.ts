import type { SupabaseClient } from '@supabase/supabase-js';
import { access, type Membership, type Company, type BankAccount, type Snapshot, type AuditEvent, type Plan, type Commitment, type BankTransaction, type Allocation, type ImportProfile, type ClassificationRule, type KaminoSource, type KaminoDocument } from '@eddias/core';
export class Repo {
  constructor(readonly client: SupabaseClient, readonly member: Membership) {}
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, { p_tenant_id: this.member.tenant_id, ...args });
    if (error) throw error;
    return data as T;
  }
  async all<T>(table: string): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.client.from(table).select('*')
        .eq('tenant_id', this.member.tenant_id).is('deleted_at', null).order('id').range(from, from + 999);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('O servidor retornou dados incompletos.');
      all.push(...data as T[]);
      if (data.length < 1000) return all;
    }
  }
  async load(): Promise<Snapshot> {
    const [companies, accounts, memberships, plans, commitments, transactions, allocations, profiles, rules, kaminoSources, kaminoDocuments] = await Promise.all([
      access(this.member, 'empresas') !== 'none' || access(this.member, 'contas') !== 'none' || access(this.member, 'planejamento') !== 'none' || access(this.member, 'extratos') !== 'none'
        ? this.all<Company>('fin_companies') : [],
      access(this.member, 'contas') !== 'none' || access(this.member, 'extratos') !== 'none' ? this.all<BankAccount>('fin_bank_accounts') : [],
      this.member.role === 'admin' ? this.rpc<Membership[]>('fin_members') : [],
      access(this.member, 'planejamento') !== 'none' ? this.all<Plan>('fin_plans') : [],
      access(this.member, 'planejamento') !== 'none' || access(this.member, 'extratos') !== 'none' ? this.all<Commitment>('fin_commitments') : [],
      access(this.member, 'planejamento') !== 'none' || access(this.member, 'extratos') !== 'none' ? this.all<BankTransaction>('fin_transactions') : [],
      access(this.member, 'planejamento') !== 'none' || access(this.member, 'extratos') !== 'none' ? this.all<Allocation>('fin_allocations') : [],
      access(this.member, 'extratos') !== 'none' ? this.all<ImportProfile>('fin_import_profiles') : [],
      access(this.member, 'extratos') !== 'none' ? this.all<ClassificationRule>('fin_rules') : [],
      this.member.role === 'admin' ? this.all<KaminoSource>('fin_kamino_sources') : [],
      this.member.role === 'admin' ? this.all<KaminoDocument>('fin_kamino_documents') : [],
    ]);
    return { companies, accounts, memberships, plans, commitments, transactions, allocations, profiles, rules, kaminoSources, kaminoDocuments };
  }
  saveCompany(value: { id: string; name: string; document: string; version: number }) {
    return this.rpc<Company>('fin_save_company', { p_id: value.id, p_name: value.name,
      p_document: value.document || null, p_version: value.version });
  }
  saveAccount(id: string, data: Partial<BankAccount>, version: number) {
    return this.rpc<BankAccount>('fin_save_account', { p_id: id, p_data: data, p_version: version });
  }
  archive(entity: string, id: string, dryRun: boolean) {
    return this.rpc<{ affected: number; total: number; blocked: boolean }>('fin_archive',
      { p_entity: entity, p_ids: [id], p_dry_run: dryRun });
  }
  async audit(): Promise<AuditEvent[]> {
    const { data, error } = await this.client.from('fin_audit_log')
      .select('id,entity,entity_id,action,actor_id,created_at').eq('tenant_id', this.member.tenant_id)
      .order('id', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  }
}
