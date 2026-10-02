import { config, HttpError, type Env } from './config';
export type Dependencies = { fetch: typeof fetch; sleep: (ms: number) => Promise<void> };
const defaults: Dependencies = { fetch: (...args) => fetch(...args), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
export class Database {
  private origin: string;
  constructor(private env: Env, private deps: Dependencies = defaults) { this.origin = config(env).supabaseUrl; }
  async request(path: string, body?: unknown, jwt?: string, retry = false): Promise<unknown> {
    const key = jwt ? this.env.SUPABASE_PUBLISHABLE_KEY : this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new HttpError(503, 'Serviço de backup ainda não configurado.');
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
      let r: Response;
      try {
        r = await this.deps.fetch(this.origin + '/rest/v1/' + path, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
          headers: { apikey: key, Authorization: 'Bearer ' + (jwt || key), 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (!retry || attempt === 2) throw new HttpError(502, 'Banco indisponível. Tente novamente.');
        await this.deps.sleep(2000); continue;
      }
      if (r.ok) return r.json();
      if (retry && attempt < 2 && (r.status === 429 || r.status >= 500)) { await this.deps.sleep(2000); continue; }
      throw new HttpError(r.status === 401 || r.status === 403 ? 403 : 502, 'Não foi possível concluir a operação no banco.');
    }
    throw new HttpError(502, 'Banco indisponível.');
  }
  async rows(table: string, tenantId?: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const filter = !tenantId ? '' : table === 'fin_tenants' ? '&id=eq.' + tenantId : '&tenant_id=eq.' + tenantId;
      const order = table === 'fin_memberships' ? 'user_id' : 'id';
      const page = await this.request(table + '?select=*&order=' + order + '.asc&limit=1000&offset=' + offset + filter, undefined, undefined, true);
      if (!Array.isArray(page) || page.some(r => !r || typeof r !== 'object')) throw new HttpError(502, 'Resposta inválida do banco.');
      rows.push(...page);
      if (page.length < 1000) return rows;
      if (offset >= 99_000) throw new HttpError(503, 'Backup excedeu o limite desta etapa. Nenhum snapshot foi gravado.');
    }
  }
}
export async function backup(db: Database, tenantId: string, runKey: string) {
  const revision = await db.request('rpc/fin_backup_revision', { p_tenant_id: tenantId });
  const data: Record<string, unknown> = {};
  // Sequencial: uma falha interrompe a coleta, sem produzir snapshot parcial.
  for (const table of ['fin_tenants', 'fin_memberships', 'fin_companies', 'fin_bank_accounts', 'fin_plans', 'fin_commitments', 'fin_transactions', 'fin_allocations', 'fin_import_profiles', 'fin_audit_log'])
    data[table] = await db.rows(table, tenantId);
  const after = await db.request('rpc/fin_backup_revision', { p_tenant_id: tenantId });
  if (typeof revision !== 'string' || revision !== after) throw new HttpError(409, 'Cadastros alterados durante o backup. Tente novamente.');
  const id = await db.request('rpc/fin_store_backup', { p_tenant_id: tenantId, p_run_key: runKey, p_revision: revision, p_data: data });
  return { id };
}
