import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
let outbound = 0; let redirect = false;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: 'apps/worker/.data/workerd/index.js', compatibilityDate: '2026-10-01',
  bindings: { ENVIRONMENT: 'production', SUPABASE_URL: 'https://dheunohtkgvgqzwsauqt.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' },
  outboundService: async request => {
    outbound++;
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
  console.log('Workerd real: configuração, saúde, autorização e rejeição de redirect aprovados.');
} finally { await mf.dispose(); }
