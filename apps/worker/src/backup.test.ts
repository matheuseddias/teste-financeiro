import { describe, it, expect, vi } from 'vitest';
import worker, { handle } from './index';
import { config, type Env } from './config';
import { backup, Database } from './backup';
const env: Env = { ENVIRONMENT: 'production', SUPABASE_URL: 'https://dheunohtkgvgqzwsauqt.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'private-test' };
const tenantId = 'edd1a500-0000-4000-8000-000000000001';
const deps = (fn: typeof fetch) => ({ fetch: fn, sleep: vi.fn(async () => {}) });
describe('isolamento de ambientes e credenciais', () => {
  it('preview não usa produção nem configurações ausentes', async () => {
    expect(() => config({ ...env, ENVIRONMENT: 'preview' })).toThrow();
    expect(() => config({ ...env, SUPABASE_URL: 'https://fake.supabase.co@evil.example/' })).toThrow();
    const response = await worker.fetch(new Request('https://local/api/config'), env);
    const body = await response.text(); expect(body).not.toContain('private-test'); expect(body).toContain('sb_publishable_test');
    expect((await worker.fetch(new Request('https://local/api/config'), { ...env, SUPABASE_URL: '' })).status).toBe(503);
  });
  it('nega backup sem sessão e não faz leitura privilegiada', async () => {
    const fetcher = vi.fn<typeof fetch>(); const db = new Database(env, deps(fetcher));
    expect((await handle(new Request('https://local/api/backup', { method: 'POST' }), env, db)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json([{ tenant_id: tenantId, role: 'membro', active: true }]));
    const r = await handle(new Request('https://local/api/backup', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: JSON.stringify({ tenantId, runKey: crypto.randomUUID() }) }), env, db);
    expect(r.status).toBe(403); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ apikey: 'sb_publishable_test', Authorization: 'Bearer session' });
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });
});
describe('snapshots completos', () => {
  it('pagina sem truncar e tenta falhas transitórias até três vezes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(Array.from({ length: 1000 }, (_, id) => ({ id }))))
      .mockResolvedValueOnce(Response.json([{ id: 1000 }]));
    const d = deps(fetcher); const rows = await new Database(env, d).rows('fin_companies', tenantId);
    expect(rows).toHaveLength(1001); expect(d.sleep).toHaveBeenCalledWith(2000);
    expect(fetcher.mock.calls[2][0]).toContain('offset=1000');
  });
  it('não repete autorização negada e não salva coleta parcial', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
    await expect(new Database(env, deps(fetcher)).rows('fin_companies', tenantId)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('interrompe após três erros e evita gravar se revisão mudou', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    await expect(new Database(env, deps(fetcher)).rows('fin_companies', tenantId)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(3);
    const db = new Database(env, deps(fetcher));
    const req = vi.spyOn(db, 'request').mockResolvedValueOnce('1:1').mockResolvedValueOnce('2:2');
    vi.spyOn(db, 'rows').mockResolvedValue([{ id: tenantId }]);
    await expect(backup(db, tenantId, 'run')).rejects.toThrow('alterados'); expect(req).toHaveBeenCalledTimes(2);
  });
  it('grava só depois das cinco tabelas e confirmação de revisão', async () => {
    const db = new Database(env); const req = vi.spyOn(db, 'request').mockResolvedValueOnce('1:1').mockResolvedValueOnce('1:1').mockResolvedValueOnce('snapshot');
    const rows = vi.spyOn(db, 'rows').mockResolvedValue([{ id: tenantId }]);
    expect(await backup(db, tenantId, 'run')).toEqual({ id: 'snapshot' }); expect(rows).toHaveBeenCalledTimes(5);
    expect(req.mock.calls[2][1]).toMatchObject({ p_run_key: 'run', p_revision: '1:1' });
  });
});
