import { it, expect, vi } from 'vitest';
import { onRequest } from '../apps/web/functions/api/[[path]]';
it('gateway bloqueia preview ligado por engano ao Worker de produção', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ environment: 'production' }));
  const response = await onRequest({ request: new Request('https://branch.eddias-financeiro.pages.dev/api/backup', { method: 'POST' }), env: { ENVIRONMENT: 'preview', FINANCEIRO_API: { fetch } } });
  expect(response.status).toBe(503); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0].headers.has('Authorization')).toBe(false);
});
it('gateway falha fechado quando o binding fica indisponível', async () => {
  const response = await onRequest({ request: new Request('https://financeiro.eddias.com.br/api/config'), env: { ENVIRONMENT: 'production', FINANCEIRO_API: { fetch: async () => { throw new Error('offline'); } } } });
  expect(response.status).toBe(503);
});
it('nega URL de branch mesmo com binding de produção configurado por engano', async () => {
  const fetch = vi.fn();
  const response = await onRequest({ request: new Request('https://branch.eddias-financeiro.pages.dev/api/config'), env: { ENVIRONMENT: 'production', FINANCEIRO_API: { fetch } } });
  expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
});
