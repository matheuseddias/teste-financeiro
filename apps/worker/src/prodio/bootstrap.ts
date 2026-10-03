import { Database } from '../backup';
import { config,type Env } from '../config';
import { configured,prodioTenant } from './client';
import { syncProdio } from './sync';
import type { ProdioSource } from '../../../../packages/core/src/prodio';
async function main(){
 const env={...process.env,ENVIRONMENT:process.env.DEPLOY_ENVIRONMENT} as Env;config(env);
 if(!configured(env)){console.log('Prodio: token ainda não cadastrado; integração preparada, sem consulta real.');return;}
 const db=new Database(env);const before=await db.rows('fin_prodio_sources',prodioTenant) as unknown as ProdioSource[];
 const resume=process.env.PRODIO_RESUME==='true';
 async function wait(){for(let i=0;i<8;i++){
  const rows=await db.rows('fin_prodio_sources',prodioTenant);const until=Math.max(Date.now(),...rows.flatMap(r=>[Date.parse(String(r.next_attempt_at||0)),Date.parse(String(r.lease_until||0))]).filter(Number.isFinite));
  if(until<=Date.now())return;console.log('Prodio: respeitando intervalo entre consultas.');await new Promise(r=>setTimeout(r,Math.min(60000,until-Date.now()+1500)));
 }throw new Error('Prodio: intervalo prolongado; retome pela tela.');}
 const initialized=[];
 for(const kind of ['pedidos','compras','notas'] as const){
  if(!resume&&before.some(s=>s.kind===kind))continue;
  await wait();await syncProdio(env,db,prodioTenant,kind,true);console.log('Prodio: empresa, escopos e leitura validados para '+kind+'.');
  await wait();await syncProdio(env,db,prodioTenant,kind);initialized.push(kind);console.log('Prodio: primeiro lote persistido para '+kind+'.');
 }
 for(const kind of initialized)await db.request('rpc/fin_prodio_bootstrap_enable',{p_tenant_id:prodioTenant,p_kind:kind});
 console.log('Prodio: inicialização concluída. A cobertura do histórico depende do fim de cada ciclo.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Prodio: inicialização interrompida.');process.exitCode=1;});
