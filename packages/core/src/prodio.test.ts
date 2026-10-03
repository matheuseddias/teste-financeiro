import { describe,it,expect } from 'vitest';
import { conversionWindow,scenarioFromHistory,type ProdioDocument } from './prodio';
import type { BankTransaction } from './statements';
const order=(changes:Partial<ProdioDocument>={}):ProdioDocument=>({id:'1',tenant_id:'t',kind:'pedidos',source_id:'s',source_updated_at:'2026-10-01T12:00:00Z',business_date:'2026-09-10',amount_cents:100000,status:'enviado',description:'Pedido',channel_key:null,channel_name:null,invoice_key:null,supplier_id:null,purchase_ids:[],payment_terms:[],expected_date:null,fingerprint:'a',version:1,deleted_at:null,...changes});
const tx=(changes:Partial<BankTransaction>={}):BankTransaction=>({id:'tx',tenant_id:'t',account_id:'a',posted_date:'2026-10-10',amount_cents:80000,description:'Repasse',classification:'repasse',channel:null,category:'outros',version:1,deleted_at:null,...changes} as BankTransaction);
describe('GMV × repasses por janela',()=>{
 it('desloca mês, exclui transferências/aportes/empréstimos e cancelados sem inventar caixa',()=>{
  const a=conversionWindow([order(),order({status:'cancelado'}),order({status:'ignorar'})],[tx(),tx({classification:'transferencia'}),tx({classification:'emprestimo'}),tx({classification:'aporte'}),tx({posted_date:'2026-09-01'})],'2026-09',30);
  expect(a).toMatchObject({gmv:100000,receipts:80000,rateBps:8000,cashBegin:'2026-10-01',cashEnd:'2026-10-31',cancelled:1,missingChannel:1});
  const p=scenarioFromHistory(a,'2026-11-01',30,'');expect(p.channels[0]).toMatchObject({net_bps:8000,lag_days:30,gmv_cents:[100000,100000,100000,100000,100000,100000]});expect(p.opening_cents).toBeNull();
 });
 it('normaliza canal informado e mantém ausência apenas no consolidado',()=>{
  const docs=[order(),order({channel_name:'Mercado Livre'})];const cash=[tx({channel:' mercado  livre '}),tx({channel:null})];
  expect(conversionWindow(docs,cash,'2026-09',30,'Mercado Livre')).toMatchObject({gmv:100000,receipts:80000,missingChannel:0});
  expect(conversionWindow(docs,cash,'2026-09',30)).toMatchObject({gmv:200000,receipts:160000,missingChannel:1});
 });
 it('não transforma cobertura incompleta, De-Para ausente ou taxa acima de 100% em premissa',()=>{
  const over=conversionWindow([order({amount_cents:100})],[tx()],'2026-09',30);expect(over.rateBps).toBe(8000000);expect(()=>scenarioFromHistory(over,'2026-11-01',30,'')).toThrow();
  for(const a of [conversionWindow([order(),order({status:null})],[tx()],'2026-09',30),conversionWindow([order()],[tx(),tx({classification:'pendente'})],'2026-09',30),conversionWindow([],[tx()],'2026-09',30)])expect(()=>scenarioFromHistory(a,'2026-11-01',30,'')).toThrow();
 });
 it('arredonda centavos sem float e rejeita período/prazo impossível',()=>{
  expect(conversionWindow([order({amount_cents:3})],[tx({amount_cents:2})],'2026-09',30).rateBps).toBe(6667);
  expect(()=>conversionWindow([],[],'2026-13',0)).toThrow();expect(()=>conversionWindow([],[],'2026-09',-1)).toThrow();
 });
});
