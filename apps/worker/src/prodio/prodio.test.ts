import { describe,it,expect,vi } from 'vitest';
import { ProdioClient,prodioTenant } from './client';
import { page,record,profile,instant } from './map';
import { requestCursor,syncProdio,prodioCron } from './sync';
import { Database } from '../backup';
import { handle } from '../index';
import type { Env } from '../config';
const env:Env={ENVIRONMENT:'production',SUPABASE_URL:'https://dheunohtkgvgqzwsauqt.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',PRODIO_API_TOKEN:'prodio_live_'+'x'.repeat(43)};
const id='11111111-1111-4111-8111-111111111111';
const raw={id,externo_id:'123',total:1234.565,significado:'enviado',confirmado_em:'2026-10-01T01:00:00Z',atualizado_em:'2026-10-02T03:00:00Z',plataforma:'baselinker',cliente:'ignorar dado pessoal'};
const me={empresa:{id,nome:'Eddias',fuso:'America/Sao_Paulo'},token:{escopos:['pedidos:ler','compras:ler','notas:ler','custos:ler']}};
describe('Prodio contrato v1',()=>{
 it('mantém origem fixa, cursor opaco, GET e token apenas no cabeçalho; não segue redirect',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({dados:[],proximo_cursor:null}));
  await new ProdioClient(env,fetcher).get('pedidos',{cursor:'a+/b==?x&y',limite:'200'});
  const [url,init]=fetcher.mock.calls[0];expect(new URL(String(url)).origin).toBe('https://api.prodio.com.br');expect(new URL(String(url)).searchParams.get('cursor')).toBe('a+/b==?x&y');expect(String(url)).not.toContain(env.PRODIO_API_TOKEN);
  expect(init).toMatchObject({method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.PRODIO_API_TOKEN}});
  fetcher.mockResolvedValue(new Response('sensitive body',{status:302}));await expect(new ProdioClient(env,fetcher).get('eu')).rejects.toThrow('HTTP 302');
  expect(()=>new ProdioClient({...env,PRODIO_API_TOKEN:''})).toThrow('Configure');
 });
 it('distingue E2 ausente, erro temporário e corpo inválido sem vazar corpo privado',async()=>{
  for(const [status,message] of [[404,'E2'],[401,'token'],[500,'temporariamente']] as const){
   const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('segredo privado',{status}));
   await expect(new ProdioClient(env,fetcher).get('eu')).rejects.toThrow(message);
  }
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid JSON'));await expect(new ProdioClient(env,f).get('eu')).rejects.toThrow('JSON');
 });
 it('normaliza data no fuso da empresa, centavos e nenhum canal inventado da plataforma',()=>{
  expect(profile(me)).toMatchObject({companyId:id,name:'Eddias'});
  const d=record('pedidos',raw,'America/Sao_Paulo');expect(d).toMatchObject({business_date:'2026-09-30',amount_cents:123457,channel_name:null,channel_key:null});expect(d).not.toHaveProperty('cliente');
  expect(record('pedidos',{...raw,origem:'ml',origem_nome:'Mercado Livre'},'America/Sao_Paulo').channel_name).toBe('Mercado Livre');
  expect(()=>record('pedidos',{...raw,total:null},'UTC')).toThrow('custos:ler');
  expect(()=>record('pedidos',{...raw,significado:'desconhecido'},'UTC')).toThrow('significado');
  expect(()=>instant('2026-02-31T12:00:00Z','data')).toThrow();
 });
 it('recusa paginação sem avanço e mantém notas/ordens como referências sem criar vencimentos',async()=>{
  await expect(page('pedidos',{dados:[raw,raw],proximo_cursor:null},'UTC',null)).rejects.toThrow('repetido');
  await expect(page('pedidos',{dados:[],proximo_cursor:'x'},'UTC',null)).rejects.toThrow('sem avanço');
  await expect(page('pedidos',{dados:[raw],proximo_cursor:'x'},'UTC','x')).rejects.toThrow('sem avanço');
  const po=record('compras',{...raw,numero:42,status:'aberta',criada_em:'2026-09-01T12:00:00Z',entrega_prevista:'2026-10-10',condicao_pagamento:[30,60],fornecedor_id:id},'UTC');expect(po).toMatchObject({payment_terms:[30,60],expected_date:'2026-10-10'});expect(po).not.toHaveProperty('due_date');
  const nf=record('notas',{...raw,status:'recebida',chave:'1'.repeat(44),emissao:'2026-09-02',valor_total:42.12,ordens_compra:[id]},'UTC');expect(nf).toMatchObject({purchase_ids:[id],invoice_key:'1'.repeat(44),amount_cents:4212});
 });
 it('só avança o cursor junto ao lote persistido; fecha ciclo com sobreposição e preserva lista vazia',async()=>{
  const db=new Database(env),req=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{next:'opaque',since:'2026-09-01T03:00:00Z'},company_external_id:id}).mockResolvedValue(null);
  const api=new ProdioClient(env);const get=vi.spyOn(api,'get').mockResolvedValueOnce(me).mockResolvedValueOnce({dados:[raw],proximo_cursor:null});
  await syncProdio(env,db,prodioTenant,'pedidos',false,api);
  expect(get.mock.calls[1][1]).toMatchObject({cursor:'opaque',atualizado_desde:'2026-09-01T03:00:00Z'});
  expect(req.mock.calls[1][1]).toMatchObject({p_done:true,p_cursor:{next:null,since:'2026-10-02T02:59:00.000Z'},p_documents:[{amount_cents:123457}]});
  req.mockReset().mockResolvedValueOnce({lease_id:'lease',cursor:{}}).mockResolvedValue(null);get.mockReset().mockResolvedValueOnce(me).mockResolvedValueOnce({dados:[],proximo_cursor:null});
  await syncProdio(env,db,prodioTenant,'pedidos',false,api);expect(req.mock.calls[1][1]).toMatchObject({p_documents:[],p_done:true});
  expect(requestCursor('compras',{},false).params).not.toHaveProperty('atualizado_desde');
 });
 it('empresa diferente ou valores ocultos não avançam cursor nem consultam outra empresa',async()=>{
  for(const changed of [{...me,empresa:{...me.empresa,nome:'Outra'}},{...me,token:{escopos:['pedidos:ler']}}]){
   const db=new Database(env),req=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{next:'keep'}}).mockResolvedValue(null);
   const api=new ProdioClient(env),get=vi.spyOn(api,'get').mockResolvedValue(changed);
   await expect(syncProdio(env,db,prodioTenant,'pedidos',false,api)).rejects.toThrow();expect(get).toHaveBeenCalledTimes(1);expect(req.mock.calls[1][1]).toMatchObject({p_cursor:{next:'keep'},p_documents:[],p_done:false});
  }
 });
 it('429 respeita Retry-After sem repetir; cron respeita intervalo global e token ausente',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('private',{status:429,headers:{'Retry-After':'120'}}));
  const db=new Database(env),req=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{next:'keep'}}).mockResolvedValue(null);
  await expect(syncProdio(env,db,prodioTenant,'pedidos',false,new ProdioClient(env,fetcher))).rejects.toThrow('Limite');expect(fetcher).toHaveBeenCalledTimes(1);expect(req.mock.calls[1][1]).toMatchObject({p_retry_seconds:121,p_temporary:true,p_cursor:{next:'keep'}});expect(JSON.stringify(req.mock.calls)).not.toContain('private');
  req.mockClear();const rows=vi.spyOn(db,'rows').mockResolvedValue([{next_attempt_at:new Date(Date.now()+60000).toISOString()}]);
  await prodioCron({...env,PRODIO_API_TOKEN:''},db);expect(rows).not.toHaveBeenCalled();await prodioCron(env,db);expect(req).not.toHaveBeenCalled();
 });
 it('autoriza administrador antes de revelar configuração; nenhuma chave vai ao navegador',async()=>{
  const db=new Database(env),req=vi.spyOn(db,'request');
  expect((await handle(new Request('https://local/api/prodio/status',{method:'POST'}),env,db)).status).toBe(401);expect(req).not.toHaveBeenCalled();
  const request=()=>new Request('https://local/api/prodio/status',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({tenantId:prodioTenant})});
  req.mockResolvedValue([{tenant_id:prodioTenant,role:'membro',active:true}]);expect((await handle(request(),env,db)).status).toBe(403);
  req.mockResolvedValue([{tenant_id:prodioTenant,role:'admin',active:true}]);const response=await handle(request(),env,db);expect(response.status).toBe(200);expect(await response.text()).not.toContain(env.PRODIO_API_TOKEN);
 });
});
