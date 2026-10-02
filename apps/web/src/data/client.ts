import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export interface Runtime {
  environment: 'production' | 'preview'; supabaseUrl: string; supabasePublishableKey: string;
}
let pending: Promise<{ client: SupabaseClient; config: Runtime }> | undefined;
export function runtime() {
  pending ??= (async () => {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('O ambiente ainda precisa ser configurado.');
    const config: Runtime = await response.json();
    if (!['production', 'preview'].includes(config.environment) ||
        !config.supabaseUrl?.startsWith('https://') || !config.supabasePublishableKey)
      throw new Error('A configuração do ambiente está incompleta.');
    return { config, client: createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { storageKey: 'eddias-financeiro-v2-' + config.environment, detectSessionInUrl: false },
    }) };
  })();
  return pending;
}
export function message(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e.code === '23505') return 'Já existe um cadastro com essa identificação.';
  if (e.code === '42501') return 'Seu acesso não permite esta operação.';
  if (e.code === '40001') return 'Os dados mudaram. Atualize a página antes de salvar novamente.';
  if (e.code === 'PGRST202' || e.code === '42P01') return 'O banco ainda precisa receber as migrações da nova versão.';
  if (e.code === '23514' || e.code === '23502') return 'Confira os campos obrigatórios e os valores informados.';
  if (e.code === '22023' && e.message) return e.message;
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
}
