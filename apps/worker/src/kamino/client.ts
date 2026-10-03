import { HttpError, type Env } from '../config';
import type { KaminoSlot } from '../../../../packages/core/src/kamino';
export const kaminoTenant = 'edd1a500-0000-4000-8000-000000000001';
const suffixes = ['API_BASE','APP','CN','IDUSR','USR','HASH'] as const;
export class KaminoError extends HttpError {
 constructor(message: string, public retrySeconds = 60) { super(502,message); }
}
export function readiness(env: Env, slot: KaminoSlot) {
 const prefix = slot === 'principal' ? 'KAMINO_' : 'KAMINO_HOME_';
 const values = env as unknown as Record<string,string | undefined>;
 const missing = suffixes.map(k=>prefix+k).filter(k=>!values[k]?.trim());
 return { configured:missing.length === 0, missing };
}
export class KaminoClient {
 private base: URL; private headers: Record<string,string>;
 // Wrapper preserva o contexto global exigido por fetch no runtime Workers.
 constructor(env: Env, slot: KaminoSlot, private fetcher: typeof fetch = (...args) => fetch(...args)) {
  if (!readiness(env,slot).configured) throw new HttpError(503,'Credenciais Kamino ainda não configuradas para esta conexão.');
  const values=env as unknown as Record<string,string>; const prefix=slot==='principal'?'KAMINO_':'KAMINO_HOME_';
  try { this.base=new URL(values[prefix+'API_BASE']); } catch { throw new HttpError(503,'URL da API Kamino inválida.'); }
  if (this.base.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.kamino\.tech$/i.test(this.base.hostname) || this.base.port || this.base.username || this.base.password || this.base.pathname!=='/' || this.base.search || this.base.hash)
   throw new HttpError(503,'URL da API Kamino inválida.');
  this.headers={ Accept:'application/json',App:values[prefix+'APP'],CN:values[prefix+'CN'],IDUsr:values[prefix+'IDUSR'],Usr:values[prefix+'USR'],Hash:values[prefix+'HASH'] };
 }
 async get(kind: 'pagamentos' | 'notas', params: Record<string,string>): Promise<unknown> {
  const path=kind==='pagamentos'?'/api/financeiro/pagamento/lista/paginada':'/api/notafiscal/entrada/lista';
  const url=new URL(path,this.base);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  let r: Response;
  try { r=await this.fetcher(url,{method:'GET',headers:this.headers,redirect:'manual',signal:AbortSignal.timeout(20000)}); }
  catch { throw new KaminoError('Kamino indisponível. A sincronização foi pausada.'); }
  if(r.status===429) { const n=Number(r.headers.get('RateLimit-Reset') || r.headers.get('Retry-After'));throw new KaminoError('Limite de consultas da Kamino atingido. Aguarde antes de testar novamente.',Number.isFinite(n)&&n>0?Math.ceil(n)+2:60); }
  if(!r.ok)throw new KaminoError(r.status===401||r.status===403?'Kamino recusou as credenciais ou a permissão de leitura.':'Kamino retornou HTTP '+r.status+'. Sincronização pausada.');
  const length=Number(r.headers.get('Content-Length'));
  if(length>4_000_000){await r.body?.cancel();throw new KaminoError('Resposta Kamino muito grande. Reduza a janela de consulta.');}
  const reader=r.body?.getReader();if(!reader)throw new KaminoError('Kamino retornou resposta vazia.');
  const chunks: Uint8Array[]=[];let size=0;
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4_000_000){await reader.cancel();throw new KaminoError('Resposta Kamino muito grande. Sincronização pausada.');}chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new KaminoError('Kamino não retornou JSON reconhecível.'); }
 }
}
