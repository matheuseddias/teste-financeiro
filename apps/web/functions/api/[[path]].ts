interface Bindings { FINANCEIRO_API: { fetch(request: Request): Promise<Response> }; ENVIRONMENT: 'production' | 'preview' }
export async function onRequest(context: { request: Request; env: Bindings }) {
  const { request, env } = context;
  if (!env.FINANCEIRO_API || !['production', 'preview'].includes(env.ENVIRONMENT))
    return new Response('Serviço não configurado.', { status: 503 });
  const url = new URL(request.url);
  // Somente os endereços de produção recebem o binding do banco atual.
  if (env.ENVIRONMENT === 'production' && !['financeiro.eddias.com.br', 'eddias-financeiro.pages.dev', 'localhost', '127.0.0.1'].includes(url.hostname))
    return new Response('Publicação de preview desabilitada.', { status: 503 });
  try {
  const check = await env.FINANCEIRO_API.fetch(new Request(new URL('/api/config', url)));
  if (!check.ok) return new Response('Serviço indisponível.', { status: 503 });
  const cfg = await check.json() as { environment?: string };
  if (cfg.environment !== env.ENVIRONMENT) return new Response('Ambiente incompatível.', { status: 503 });
  return await env.FINANCEIRO_API.fetch(request);
  } catch { return new Response('Serviço indisponível.', { status: 503 }); }
}
