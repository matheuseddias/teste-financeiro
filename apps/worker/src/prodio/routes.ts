import { Database } from '../backup';
import { HttpError,json,uuid,type Env } from '../config';
import { configured,prodioTenant } from './client';
import { syncProdio } from './sync';
export async function prodioRoute(request:Request,env:Env,db:Database){
 if(request.method!=='POST')throw new HttpError(405,'Método não permitido.');
 const token=request.headers.get('Authorization');if(!token?.startsWith('Bearer ')||token.length>8192)throw new HttpError(401,'Entre para continuar.');
 const memberships=await db.request('rpc/fin_my_workspaces',{},token.slice(7));
 const raw=await request.text();if(raw.length>2048)throw new HttpError(413,'Solicitação muito grande.');
 let body;try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Solicitação inválida.');}
 if(!body||!uuid(body.tenantId)||body.tenantId!==prodioTenant)throw new HttpError(403,'Conexão não liberada para este grupo.');
 if(!Array.isArray(memberships)||!memberships.some(m=>m.tenant_id===body.tenantId&&m.active===true&&m.role==='admin'))throw new HttpError(403,'Integração permitida somente a administradores.');
 const action=new URL(request.url).pathname.split('/').at(-1);
 if(action==='status')return json({configured:configured(env),requiredScopes:['pedidos:ler','compras:ler','notas:ler','custos:ler'],contract:'1.0-rascunho, 03/10/2026'});
 if(!['probe','sync'].includes(action||'')||!['pedidos','compras','notas'].includes(body.kind))throw new HttpError(400,'Operação inválida.');
 return json(await syncProdio(env,db,body.tenantId,body.kind,action==='probe'));
}
