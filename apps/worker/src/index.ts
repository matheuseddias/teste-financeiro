import { config, HttpError, json, uuid, type Env } from './config';
import { backup, Database } from './backup';
import { kaminoRoute } from './kamino/routes';
import { kaminoCron } from './kamino/sync';
import { prodioRoute } from './prodio/routes';
import { prodioCron } from './prodio/sync';
export async function handle(request: Request, env: Env, db = new Database(env)) {
  try {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/kamino/')) return await kaminoRoute(request, env, db);
    if (path.startsWith('/api/prodio/')) return await prodioRoute(request, env, db);
    if (request.method === 'GET' && path === '/api/config') return json(config(env));
    if (request.method === 'GET' && path === '/api/health') { config(env); return json({ ok: true, version: '0.7.0', environment: env.ENVIRONMENT }); }
    if (path !== '/api/backup') return json({ error: 'Recurso não encontrado.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const token = request.headers.get('Authorization');
    if (!token?.startsWith('Bearer ') || token.length > 8192) throw new HttpError(401, 'Entre para continuar.');
    // JWT validado pelo Supabase; nenhuma consulta privilegiada antes desta validação.
    const memberships = await db.request('rpc/fin_my_workspaces', {}, token.slice(7));
    const raw = await request.text();
    if (raw.length > 2048) throw new HttpError(413, 'Solicitação muito grande.');
    let body: { tenantId?: string; runKey?: string };
    try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Solicitação inválida.'); }
    if (!body || !uuid(body.tenantId) || !uuid(body.runKey)) throw new HttpError(400, 'Solicitação inválida.');
    if (!Array.isArray(memberships) || !memberships.some(m => m.tenant_id === body.tenantId && m.active === true && m.role === 'admin'))
      throw new HttpError(403, 'Backup permitido somente a administradores.');
    return json(await backup(db, body.tenantId, body.runKey));
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : 'Serviço temporariamente indisponível.' }, error instanceof HttpError ? error.status : 503);
  }
}
export default {
  async fetch(request: Request, env: Env) {
    try { return await handle(request, env); } catch { return json({ error: 'Configuração do serviço indisponível.' }, 503); }
  },
  async scheduled(event: { scheduledTime: number; cron?: string }, env: Env) {
    if (env.ENVIRONMENT !== 'production') return;
    const db = new Database(env);
    if (event.cron === '*/2 * * * *') { await kaminoCron(env, db); return; }
    if (event.cron === '* * * * *') { await prodioCron(env, db); return; }
    const tenants = await db.rows('fin_tenants');
    for (const tenant of tenants) {
      if (!uuid(tenant.id)) throw new Error('Grupo inválido.');
      await backup(db, tenant.id, 'cron:' + event.scheduledTime);
    }
  },
};
