import type { ProdioKind,ProdioSource } from '../../../../packages/core/src/prodio';
import { Database } from '../backup';
import { HttpError,type Env } from '../config';
import { obj } from '../kamino/map';
import { ProdioClient,ProdioError,configured,prodioTenant } from './client';
import { instant,page,profile } from './map';
const initial='2026-09-01T03:00:00.000Z';
export function requestCursor(kind:ProdioKind,cursor:Record<string,unknown>,probe:boolean){
 const next=probe?null:cursor.next??null;if(next!==null&&(typeof next!=='string'||!next||next.length>4096))throw new Error('Prodio: cursor inválido.');
 const since=probe?null:cursor.since??(kind==='pedidos'?initial:null);
 if(since!==null)instant(since,'cursor.since');
 const params:Record<string,string>={limite:probe?'1':'200'};if(next)params.cursor=next as string;if(since)params.atualizado_desde=since as string;
 return {params,next:next as string|null,since:since as string|null};
}
export async function syncProdio(env:Env,db:Database,tenant:string,kind:ProdioKind,probe=false,client?:ProdioClient){
 if(tenant!==prodioTenant)throw new HttpError(403,'Prodio não liberado para este grupo.');
 const api=client||new ProdioClient(env);const source=await db.request('rpc/fin_prodio_claim',{p_tenant_id:tenant,p_kind:kind,p_probe:probe});
 if(!obj(source)||typeof source.lease_id!=='string')throw new HttpError(409,'Aguarde a consulta anterior ou o intervalo de um minuto. Teste a conexão antes de sincronizar.');
 const finish=(extra:Record<string,unknown>)=>db.request('rpc/fin_prodio_finish',{p_tenant_id:tenant,p_kind:kind,p_lease:source.lease_id,p_probe:probe,p_documents:[],p_cursor:source.cursor,p_done:false,p_company_id:null,p_company_name:null,p_timezone:null,p_error:null,p_temporary:false,p_retry_seconds:60,...extra});
 try{
  // Confere a empresa em toda rodada: trocar o token nunca pode misturar empresas silenciosamente.
  const me=profile(await api.get('eu'));
  if(source.company_external_id?me.companyId!==source.company_external_id:me.name.normalize('NFKC').trim().toLowerCase()!=='eddias')throw new ProdioError('Empresa do token não corresponde à conexão Eddias. Confira antes de retomar.');
  const resource={pedidos:'pedidos',compras:'compras',notas:'notas'}[kind];
  if(!me.scopes.includes('custos:ler')||(!me.scopes.includes(resource+':ler')&&!me.scopes.includes(resource+':escrever')))throw new ProdioError('Escopos necessários: '+resource+':ler e custos:ler. Valores ocultos não serão tratados como zero.');
  const old=obj(source.cursor)?source.cursor:{};const window=requestCursor(kind,old,probe);
  const batch=await page(kind,await api.get(kind,window.params),me.timezone,window.next);
  const previousMax=old.max_updated_at==null?0:Date.parse(instant(old.max_updated_at,'cursor.max_updated_at'));
  const max=Math.max(previousMax,batch.maxUpdated);const done=batch.next===null;
  const since=done&&max?new Date(Math.max(window.since?Date.parse(window.since):0,max-60000)).toISOString():window.since;
  const cursor={next:batch.next,since,max_updated_at:max?new Date(max).toISOString():null};
  await finish({p_documents:probe?[]:batch.documents,p_cursor:probe?source.cursor:cursor,p_done:!probe&&done,p_company_id:me.companyId,p_company_name:me.name,p_timezone:me.timezone});
  return {ok:true,probe,received:batch.documents.length,cycleComplete:!probe&&done,company:me.name};
 }catch(e){
  const temporary=e instanceof ProdioError&&e.temporary;
  const seconds=Math.min(31536000,Math.max(e instanceof ProdioError?e.retrySeconds:60,temporary?Math.min(3600,60*2**Math.min(Number(source.failure_count)||0,6)):60));
  const safe=e instanceof ProdioError?e.message:e instanceof Error&&e.message.startsWith('Prodio:')?e.message:'Falha ao sincronizar o Prodio. O cursor foi preservado.';
  await finish({p_error:safe,p_temporary:temporary,p_retry_seconds:seconds});throw new HttpError(502,safe);
 }
}
export async function prodioCron(env:Env,db:Database){
 if(!configured(env))return;
 const sources=await db.rows('fin_prodio_sources',prodioTenant) as unknown as ProdioSource[];
 if(sources.some(s=>s.next_attempt_at&&Date.parse(s.next_attempt_at)>Date.now()))return;
 const next=sources.filter(s=>s.enabled&&s.validated_at&&!s.deleted_at&&(!s.next_attempt_at||Date.parse(s.next_attempt_at)<=Date.now()))
  .sort((a,b)=>Number(!!a.last_full_sync_at)-Number(!!b.last_full_sync_at)||(a.last_attempt_at||'').localeCompare(b.last_attempt_at||''))[0];
 if(next)await syncProdio(env,db,prodioTenant,next.kind);
}
