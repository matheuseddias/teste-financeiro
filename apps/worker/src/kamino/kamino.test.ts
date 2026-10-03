import { describe,it,expect,vi } from 'vitest';
import { KaminoClient,kaminoTenant } from './client';
import { paymentPage,invoiceList,cents } from './map';
import { requestWindow,syncKamino } from './sync';
import { Database } from '../backup';
import { handle } from '../index';
import type { Env } from '../config';
const env:Env={ENVIRONMENT:'production',SUPABASE_URL:'https://dheunohtkgvgqzwsauqt.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'service-test',KAMINO_API_BASE:'https://sandbox.kamino.tech',KAMINO_APP:'app-private',KAMINO_CN:'cn-private',KAMINO_IDUSR:'id-private',KAMINO_USR:'usr-private',KAMINO_HASH:'hash-private'};
const raw={ID:1,Descricao:'Fornecedor teste',DataVencimento:'2026-09-10T00:00:00',DataCompetencia:'2026-09-01T00:00:00',Situacao:1,SimbMoeda:'R$',ValorVencimento:1234.56,ValorPagamento:null,IDNotaFiscalEntrada:10};
const page={PaginaAtual:1,TamanhoPagina:100,TotalLinhas:1,TotalPaginas:1,Dados:[raw]};
describe('Kamino somente leitura',()=>{
 it('nega redirecionamento e destinos que poderiam receber credenciais indevidamente',async()=>{
  for(const url of ['http://sandbox.kamino.tech','https://kamino.tech.evil.test','https://sandbox.kamino.tech@evil.test','https://sandbox.kamino.tech/api','https://sandbox.kamino.tech:444/'])expect(()=>new KaminoClient({...env,KAMINO_API_BASE:url},'principal')).toThrow();
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:302,headers:{Location:'https://evil.test'}}));
  await expect(new KaminoClient(env,'principal',fetcher).get('pagamentos',{})).rejects.toThrow('HTTP 302');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'manual'});
 });
 it('preserva centavos e recusa moeda, situação, paginação e nota sem chave reconhecíveis',()=>{
  expect(cents('1234.5650')).toBe(123457);expect(cents(12.45)).toBe(1245);
  expect(paymentPage(page,1,100).documents[0]).toMatchObject({amount_cents:123456,invoice_source_id:'10'});
  for(const change of [{SimbMoeda:'USD'},{Situacao:9},{ValorVencimento:-1},{DataVencimento:'2026-02-31'}])expect(()=>paymentPage({...page,Dados:[{...raw,...change}]},1,100)).toThrow();
  expect(()=>paymentPage({...page,PaginaAtual:2},1,100)).toThrow();
  expect(()=>paymentPage({...page,TotalLinhas:200,TotalPaginas:2},1,100)).toThrow();
  expect(()=>invoiceList({})).toThrow();expect(()=>invoiceList([{ID:1}])).toThrow();
 });
 it('só avança cursor após gravar o lote e não remove documentos ausentes',async()=>{
  const db=new Database(env);const request=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{page:1}}).mockResolvedValue(null);
  const api=new KaminoClient(env,'principal');vi.spyOn(api,'get').mockResolvedValue(page);
  await syncKamino(env,db,kaminoTenant,'principal','pagamentos',false,api);
  expect(request.mock.calls[1][1]).toMatchObject({p_cursor:{page:1},p_done:true,p_documents:[{source_id:'1',amount_cents:123456}]});
  request.mockReset().mockResolvedValueOnce({lease_id:'next',cursor:{page:1}}).mockResolvedValue(null);
  vi.spyOn(api,'get').mockResolvedValue({PaginaAtual:1,TamanhoPagina:100,TotalLinhas:0,TotalPaginas:0,Dados:[]});
  await syncKamino(env,db,kaminoTenant,'principal','pagamentos',false,api);
  expect(request.mock.calls[1][1]).toMatchObject({p_documents:[],p_done:true});
 });
 it('429 pausa sem repetir e preserva cursor; erros da fonte não vazam o corpo',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('private financial detail',{status:429,headers:{'RateLimit-Reset':'120'}}));
  const db=new Database(env);const request=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{page:4}}).mockResolvedValue(null);
  await expect(syncKamino(env,db,kaminoTenant,'principal','pagamentos',false,new KaminoClient(env,'principal',fetcher))).rejects.toThrow('Limite');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(request.mock.calls[1][1]).toMatchObject({p_cursor:{page:4},p_retry_seconds:122});expect(JSON.stringify(request.mock.calls)).not.toContain('private financial detail');
 });
 it('não usa credenciais externas antes de validar administrador e grupo',async()=>{
  const db=new Database(env);const req=vi.spyOn(db,'request');
  expect((await handle(new Request('https://local/api/kamino/status',{method:'POST'}),env,db)).status).toBe(401);expect(req).not.toHaveBeenCalled();
  req.mockResolvedValue([{tenant_id:kaminoTenant,role:'membro',active:true}]);
  const request=()=>new Request('https://local/api/kamino/status',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({tenantId:kaminoTenant})});
  expect((await handle(request(),env,db)).status).toBe(403);
  req.mockResolvedValue([{tenant_id:kaminoTenant,role:'admin',active:true}]);const r=await handle(request(),env,db);const text=await r.text();expect(r.status).toBe(200);expect(text).toContain('configured');for(const value of ['app-private','cn-private','hash-private'])expect(text).not.toContain(value);
 });
 it('janelas usam calendário de Brasília e janela cheia encolhe sem lacuna',async()=>{
  expect(requestWindow('notas',{},true,new Date('2026-10-03T01:00:00Z')).from).toBe('2026-10-02T00:00:00');
  const db=new Database(env);const request=vi.spyOn(db,'request').mockResolvedValueOnce({lease_id:'lease',cursor:{from:'2026-09-01T00:00:00',span:86400}}).mockResolvedValue(null);
  const api=new KaminoClient(env,'principal');vi.spyOn(api,'get').mockResolvedValue(Array.from({length:100},(_,i)=>({ID:i+1,ChaveAcessoNF:'1'.repeat(44),DataHoraEmissao:'2026-09-01T10:00:00',ValorTotal:12.34})));
  expect((await syncKamino(env,db,kaminoTenant,'principal','notas',false,api)).shrinking).toBe(true);expect(request.mock.calls[1][1]).toMatchObject({p_cursor:{from:'2026-09-01T00:00:00',span:43200},p_documents:[],p_done:false});
 });
});
