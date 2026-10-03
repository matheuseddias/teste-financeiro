import { Database } from '../backup';
import { HttpError, json, uuid, type Env } from '../config';
import { kaminoTenant, readiness } from './client';
import { syncKamino } from './sync';
export async function kaminoRoute(request: Request,env:Env,db:Database) {
 if(request.method!=='POST')throw new HttpError(405,'Método não permitido.');
 const token=request.headers.get('Authorization');
 if(!token?.startsWith('Bearer ')||token.length>8192)throw new HttpError(401,'Entre para continuar.');
 const memberships=await db.request('rpc/fin_my_workspaces',{},token.slice(7));
 const raw=await request.text();if(raw.length>2048)throw new HttpError(413,'Solicitação muito grande.');
 let body;try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Solicitação inválida.');}
 if(!body||!uuid(body.tenantId)||body.tenantId!==kaminoTenant)throw new HttpError(403,'Conexão não liberada para este grupo.');
 if(!Array.isArray(memberships)||!memberships.some(m=>m.tenant_id===body.tenantId&&m.active===true&&m.role==='admin'))throw new HttpError(403,'Integração permitida somente a administradores.');
 const action=new URL(request.url).pathname.split('/').at(-1);
 if(action==='status')return json({principal:readiness(env,'principal'),home:readiness(env,'home')});
 if(!['probe','sync'].includes(action||'')||!['principal','home'].includes(body.slot)||!['pagamentos','notas'].includes(body.kind))throw new HttpError(400,'Operação inválida.');
 return json(await syncKamino(env,db,body.tenantId,body.slot,body.kind,action==='probe'));
}
