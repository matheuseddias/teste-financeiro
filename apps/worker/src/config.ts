export interface Env {
  ENVIRONMENT: 'production' | 'preview';
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  KAMINO_API_BASE?: string; KAMINO_APP?: string; KAMINO_CN?: string; KAMINO_IDUSR?: string; KAMINO_USR?: string; KAMINO_HASH?: string;
  KAMINO_HOME_API_BASE?: string; KAMINO_HOME_APP?: string; KAMINO_HOME_CN?: string; KAMINO_HOME_IDUSR?: string; KAMINO_HOME_USR?: string; KAMINO_HOME_HASH?: string;
}
export const productionUrl = 'https://dheunohtkgvgqzwsauqt.supabase.co';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function config(env: Env) {
  const url = new URL(env.SUPABASE_URL);
  if (!['production', 'preview'].includes(env.ENVIRONMENT) || url.protocol !== 'https:' ||
      !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/' || !env.SUPABASE_PUBLISHABLE_KEY ||
      !env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') ||
      (env.ENVIRONMENT === 'production' ? url.origin !== productionUrl : url.origin === productionUrl))
    throw new HttpError(503, 'Configuração do ambiente indisponível.');
  return { environment: env.ENVIRONMENT, supabaseUrl: url.origin, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY };
}
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
