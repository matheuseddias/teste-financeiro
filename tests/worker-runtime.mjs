import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
let prodio = false; let prodioReads = 0; let prodioFinishes = 0;
let outbound = 0; let redirect = false; let kamino = false; let externalReads = 0; let finishes = 0;
const tenantId = 'edd1a500-0000-4000-8000-000000000001';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: 'apps/worker/.data/workerd/index.js', compatibilityDate: '2026-10-01',
  bindings: { ENVIRONMENT: 'production', SUPABASE_URL: 'https://dheunohtkgvgqzwsauqt.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    PRODIO_API_TOKEN: 'prodio_live_' + 'x'.repeat(43), KAMINO_API_BASE: 'https://sandbox.kamino.tech', KAMINO_APP: 'synthetic-app', KAMINO_CN: 'synthetic-cn', KAMINO_IDUSR: 'synthetic-id', KAMINO_USR: 'synthetic-user', KAMINO_HASH: 'synthetic-hash' },
  outboundService: async request => {
    outbound++;
    const url = new URL(request.url);
    if (prodio) {
      if (url.hostname === 'api.prodio.com.br') {
        prodioReads++; assert.equal(request.method, 'GET'); assert.equal(request.headers.get('Authorization'), 'Bearer prodio_live_' + 'x'.repeat(43));
        if (url.pathname === '/v1/eu') return Response.json({ empresa: { id: tenantId, nome: 'Eddias', fuso: 'America/Sao_Paulo' }, token: { escopos: ['pedidos:ler', 'custos:ler'] } });
        assert.equal(url.pathname, '/v1/pedidos'); assert.equal(url.searchParams.get('cursor'), 'opaque+/=');
        return Response.json({ dados: [{ id: tenantId, externo_id: '123', total: 42.12, significado: 'enviado', confirmado_em: '2026-09-15T12:00:00Z', atualizado_em: '2026-10-01T12:00:00Z' }], proximo_cursor: null });
      }
      assert.equal(url.hostname, 'dheunohtkgvgqzwsauqt.supabase.co');
      if (url.pathname.endsWith('/fin_my_workspaces')) return Response.json([{ tenant_id: tenantId, role: 'admin', active: true }]);
      if (url.pathname.endsWith('/fin_prodio_claim')) return Response.json({ lease_id: crypto.randomUUID(), cursor: { next: 'opaque+/=' } });
      if (url.pathname.endsWith('/fin_prodio_finish')) { prodioFinishes++; const body = await request.json(); assert.equal(body.p_error, null); assert.equal(body.p_documents[0].amount_cents, 4212); return new Response(null, { status: 204 }); }
      throw new Error('Rota sintética Prodio inesperada.');
    }
    if (kamino) {
      if (url.hostname === 'sandbox.kamino.tech') {
        externalReads++; assert.equal(request.method, 'GET'); assert.equal(request.headers.get('App'), 'synthetic-app');
        assert.equal(url.searchParams.get('_pagina'), '2');
        return Response.json({ PaginaAtual: 2, TamanhoPagina: 100, TotalLinhas: 101, TotalPaginas: 2, Dados: [{ ID: 101, DataVencimento: '2026-09-10', Situacao: 1, SimbMoeda: 'R$', ValorVencimento: 10.01 }] });
      }
      assert.equal(url.hostname, 'dheunohtkgvgqzwsauqt.supabase.co');
      if (url.pathname.endsWith('/fin_my_workspaces')) return Response.json([{ tenant_id: tenantId, role: 'admin', active: true }]);
      if (url.pathname.endsWith('/fin_kamino_claim')) return Response.json({ lease_id: crypto.randomUUID(), cursor: { page: 2 } });
      if (url.pathname.endsWith('/fin_kamino_finish')) { finishes++; const body = await request.json(); assert.equal(body.p_error, null); assert.equal(body.p_documents[0].amount_cents, 1001); return new Response(null, { status: 204 }); }
      throw new Error('Rota sintética inesperada.');
    }
    assert.equal(new URL(request.url).hostname, 'dheunohtkgvgqzwsauqt.supabase.co');
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } });
    return Response.json([]);
  },
}));
try {
  assert.equal((await mf.dispatchFetch('https://test/api/health')).status, 200);
  const cfg = await (await mf.dispatchFetch('https://test/api/config')).json();
  assert.equal(cfg.supabasePublishableKey, 'sb_publishable_synthetic');
  assert.equal((await mf.dispatchFetch('https://test/api/backup', { method: 'POST' })).status, 401); assert.equal(outbound, 0);
  const request = { method: 'POST', headers: { Authorization: 'Bearer synthetic-session' }, body: JSON.stringify({ tenantId: 'edd1a500-0000-4000-8000-000000000001', runKey: crypto.randomUUID() }) };
  assert.equal((await mf.dispatchFetch('https://test/api/backup', request)).status, 403); assert.equal(outbound, 1);
  redirect = true;
  assert.equal((await mf.dispatchFetch('https://test/api/backup', request)).status, 502); assert.equal(outbound, 2);
  kamino = true; redirect = false;
  const synced = await mf.dispatchFetch('https://test/api/kamino/sync', { ...request, body: JSON.stringify({ tenantId, slot: 'principal', kind: 'pagamentos' }) });
  assert.equal(synced.status, 200, 'Sincronização deve funcionar também no runtime Workers.');
  assert.equal((await synced.json()).received, 1); assert.equal(externalReads, 1); assert.equal(finishes, 1);
  prodio = true;
  const prodioResponse = await mf.dispatchFetch('https://test/api/prodio/sync', { ...request, body: JSON.stringify({ tenantId, kind: 'pedidos' }) });
  assert.equal(prodioResponse.status, 200); assert.equal((await prodioResponse.json()).received, 1); assert.equal(prodioReads, 2); assert.equal(prodioFinishes, 1);
  console.log('Workerd real: configuração, saúde, autorização, redirect e sincronização Kamino/Prodio com confirmação 204 aprovados.');
} finally { await mf.dispose(); }
