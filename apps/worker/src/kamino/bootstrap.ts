// Executado somente no GitHub após publicação, com os mesmos segredos do Worker.
// Inicializa fontes novas. Retomada de fontes existentes exige opção explícita no Actions.
import { Database } from '../backup';
import { config, type Env } from '../config';
import { kaminoTenant,readiness } from './client';
import { syncKamino } from './sync';
import type { KaminoSource } from '../../../../packages/core/src/kamino';
async function main() {
 const env={...process.env,ENVIRONMENT:process.env.DEPLOY_ENVIRONMENT} as Env;config(env);
 if(!readiness(env,'principal').configured){console.log('Kamino: credenciais não disponíveis neste deploy; nenhuma consulta iniciada.');return;}
 const db=new Database(env);const before=await db.rows('fin_kamino_sources',kaminoTenant) as unknown as KaminoSource[];
 const resume=process.env.KAMINO_RESUME_SLOT||'nenhuma';
 if(!['nenhuma','principal','home'].includes(resume))throw new Error('Opção de retomada inválida.');
 const initialized:{slot:string;kind:string}[]=[];
 async function waitForSlot() {
  for(let attempt=0;attempt<8;attempt++){
   const sources=await db.rows('fin_kamino_sources',kaminoTenant);
   const until=Math.max(Date.now(),...sources.flatMap(s=>[Date.parse(String(s.next_attempt_at||0)),Date.parse(String(s.lease_until||0))]).filter(Number.isFinite));
   if(until<=Date.now())return;
   const ms=Math.min(60000,until-Date.now()+1500);console.log('Kamino: respeitando intervalo entre consultas.');await new Promise(r=>setTimeout(r,ms));
  }
  throw new Error('Kamino: consulta concorrente ou intervalo prolongado; retome pela tela.');
 }
 for(const slot of ['principal','home'] as const)for(const kind of ['pagamentos','notas'] as const){
  if(!readiness(env,slot).configured||(resume!==slot&&before.some(s=>s.slot===slot&&s.kind===kind)))continue;
  await waitForSlot();await syncKamino(env,db,kaminoTenant,slot,kind,true);console.log('Kamino: leitura validada para '+slot+'/'+kind+'.');
  await waitForSlot();await syncKamino(env,db,kaminoTenant,slot,kind,false);console.log('Kamino: primeiro lote armazenado para '+slot+'/'+kind+'.');
  initialized.push({slot,kind});
 }
 for(const source of initialized)await db.request('rpc/fin_kamino_bootstrap_enable',{p_tenant_id:kaminoTenant,p_slot:source.slot,p_kind:source.kind});
 console.log('Kamino: inicialização concluída; fontes novas serão lidas pelo cron. Revisão financeira disponível na tela.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Kamino: falha na inicialização.');process.exitCode=1;});
