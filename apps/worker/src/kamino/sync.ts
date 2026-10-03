import { Database } from '../backup';
import { HttpError, type Env } from '../config';
import type { KaminoKind, KaminoSlot, KaminoSource, KaminoDocumentData } from '../../../../packages/core/src/kamino';
import { KaminoClient, KaminoError, kaminoTenant, readiness } from './client';
import { fingerprints, invoiceList, paymentPage, obj } from './map';
const start='2026-09-01T00:00:00';
const iso=(ms:number)=>new Date(ms).toISOString().slice(0,19);
export function requestWindow(kind: KaminoKind, cursor: Record<string,unknown>, probe: boolean, now=new Date()): {params:Record<string,string>;page:number;from:string;to:string;span:number} {
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(kind==='pagamentos') {
  const page=probe?1:Number(cursor.page || 1);if(!Number.isSafeInteger(page)||page<1)throw new Error('Cursor inválido.');
  return {params:{_pagina:String(page),_tamanhoPagina:probe?'1':'100',VencDe:'2026-09-01'},page,from:'',to:'',span:0};
 }
 const from=probe?today+'T00:00:00':typeof cursor.from==='string'?cursor.from:start;
 const span=probe?86400:Number(cursor.span || 86400);
 if(!Number.isSafeInteger(span)||span<60||span>86400||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(from)||from<start)throw new Error('Cursor inválido.');
 const to=iso(Math.min(Date.parse(from+'Z')+span*1000,Date.parse(today+'T23:59:59Z')));
 return {params:{DataHoraEmissaoDe:from,DataHoraEmissaoAte:to},page:0,from,to,span};
}
export async function syncKamino(env:Env,db:Database,tenant:string,slot:KaminoSlot,kind:KaminoKind,probe=false,client?:KaminoClient) {
 if(tenant!==kaminoTenant)throw new HttpError(403,'Conexão Kamino não liberada para este grupo.');
 const api=client || new KaminoClient(env,slot);
 const source=await db.request('rpc/fin_kamino_claim',{p_tenant_id:tenant,p_slot:slot,p_kind:kind,p_probe:probe});
 if(!obj(source)||typeof source.lease_id!=='string')throw new HttpError(409,'Aguarde a consulta anterior ou o intervalo de um minuto. Teste a conexão antes de sincronizar.');
 const finish=(extra:Record<string,unknown>)=>db.request('rpc/fin_kamino_finish',{p_tenant_id:tenant,p_slot:slot,p_kind:kind,p_lease:source.lease_id,p_probe:probe,p_documents:[],p_cursor:source.cursor,p_done:false,p_error:null,p_retry_seconds:60,...extra});
 try {
  const window=requestWindow(kind,obj(source.cursor)?source.cursor:{},probe);
  const body=await api.get(kind,window.params);
  let documents:KaminoDocumentData[];let cursor:Record<string,unknown>;let done=false;let shrinking=false;
  if(kind==='pagamentos') {const page=paymentPage(body,window.page,probe?1:100);documents=page.documents;if(documents.some(d=>d.due_date!<'2026-09-01'))throw new KaminoError('Kamino retornou pagamentos fora do período solicitado. Confira o filtro.');done=page.done;cursor={page:done?1:window.page+1};}
  else {
   documents=invoiceList(body);
   if(documents.some(d=>d.issue_date!<window.from.slice(0,10)||d.issue_date!>window.to.slice(0,10)))throw new KaminoError('Kamino retornou notas fora do período solicitado. Confira o filtro.');
   if(documents.length>=100 && !probe){
    if(window.span<=60)throw new KaminoError('Janela de notas cheia mesmo em um minuto. Cobertura incompleta; cursor preservado para revisão.');
    cursor={from:window.from,span:Math.max(60,Math.floor(window.span/2))};documents=[];shrinking=true;
   }else{
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    done=window.to>=today+'T23:59:59';cursor={from:done?start:window.to,span:86400};
   }
  }
  await finish({p_documents:probe?[]:await fingerprints(documents),p_cursor:probe?source.cursor:cursor,p_done:!probe&&done});
  return {ok:true,probe,received:documents.length,cycleComplete:!probe&&done,shrinking};
 }catch(e){
  const safe=e instanceof KaminoError?e.message:e instanceof Error&&e.message.startsWith('Kamino:')?e.message:'Falha ao sincronizar. O cursor foi preservado; confira a conexão antes de retomar.';
  await finish({p_error:safe,p_retry_seconds:e instanceof KaminoError?Math.min(31536000,e.retrySeconds):60});
  throw new HttpError(502,safe);
 }
}
export async function kaminoCron(env:Env,db:Database) {
 const sources=await db.rows('fin_kamino_sources',kaminoTenant) as unknown as KaminoSource[];
 const next=sources.filter(s=>s.enabled&&s.validated_at&&!s.deleted_at&&readiness(env,s.slot).configured)
  .sort((a,b)=>(a.last_attempt_at||'').localeCompare(b.last_attempt_at||''))[0];
 if(next)await syncKamino(env,db,kaminoTenant,next.slot,next.kind);
}
