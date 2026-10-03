import { MAX_CENTS } from './index';
import { blankPlan, monthAfter, type PlanInput } from './planning';
import type { BankTransaction } from './statements';
export type ProdioKind = 'pedidos' | 'compras' | 'notas';
export interface ProdioSource {
 id:string;tenant_id:string;kind:ProdioKind;enabled:boolean;company_external_id:string|null;company_name:string|null;timezone:string|null;
 validated_at:string|null;cursor:Record<string,unknown>;last_attempt_at:string|null;last_success_at:string|null;last_full_sync_at:string|null;
 last_error:string|null;next_attempt_at:string|null;failure_count:number;version:number;deleted_at:string|null;
}
export interface ProdioRecord {
 source_id:string;source_updated_at:string;business_date:string|null;amount_cents:number;status:string|null;description:string;
 channel_key:string|null;channel_name:string|null;invoice_key:string|null;supplier_id:string|null;purchase_ids:string[];
 payment_terms:number[];expected_date:string|null;
}
export interface ProdioDocument extends ProdioRecord {
 id:string;tenant_id:string;kind:ProdioKind;fingerprint:string;version:number;deleted_at:string|null;
}
export const channelKey=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
function safe(n:number){if(!Number.isSafeInteger(n)||Math.abs(n)>MAX_CENTS)throw new Error('Valores históricos excedem o limite.');return n;}
export function dayAfter(day:string,days:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
// Aproximação explícita por janela: não atribui cada repasse a pedidos individuais.
export function conversionWindow(documents:ProdioDocument[],transactions:BankTransaction[],month:string,lagDays:number,channel=''){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!Number.isSafeInteger(lagDays)||lagDays<0||lagDays>180)throw new Error('Mês ou prazo inválido.');
 const begin=month+'-01',end=monthAfter(begin,1),cashBegin=dayAfter(begin,lagDays),cashEnd=dayAfter(end,lagDays);
 const match=(s:string|null)=>!channel||!!s&&channelKey(s)===channelKey(channel);
 const orders=documents.filter(d=>d.kind==='pedidos'&&!d.deleted_at&&d.business_date&&d.business_date>=begin&&d.business_date<end&&match(d.channel_name||d.channel_key));
 const valid=orders.filter(d=>['demanda','carteira','enviado'].includes(d.status||''));
 const gmv=valid.reduce((n,d)=>safe(n+d.amount_cents),0);
 const cash=transactions.filter(t=>!t.deleted_at&&t.posted_date>=cashBegin&&t.posted_date<cashEnd);
 const receipts=cash.filter(t=>t.amount_cents>0&&t.classification==='repasse'&&match(t.channel)).reduce((n,t)=>safe(n+t.amount_cents),0);
 const unknown=orders.filter(d=>!['ignorar','demanda','carteira','enviado','cancelado'].includes(d.status||''));
 const rateBps=gmv>0?Number((BigInt(receipts)*10000n+BigInt(Math.floor(gmv/2)))/BigInt(gmv)):null;
 return {month,cashBegin,cashEnd,gmv,receipts,rateBps,orders:valid.length,unknownOrders:unknown.length,
  cancelled:orders.filter(d=>d.status==='cancelado').length,missingChannel:valid.filter(d=>!d.channel_name&&!d.channel_key).length,
  unclassifiedCash:cash.filter(t=>t.classification==='pendente').length,
  undatedOrders:documents.filter(d=>d.kind==='pedidos'&&!d.deleted_at&&!d.business_date).length};
}
export function scenarioFromHistory(analysis:ReturnType<typeof conversionWindow>,start:string,lagDays:number,channel:string,months=6):PlanInput{
 if(!analysis.gmv||analysis.rateBps===null||analysis.rateBps<0||analysis.rateBps>10000||analysis.unknownOrders||analysis.unclassifiedCash||analysis.undatedOrders)throw new Error('Revise cobertura, pedidos e classificações antes de usar a conversão.');
 const p=blankPlan(start);p.months=months;
 p.channels=[{id:crypto.randomUUID(),name:channel||'GMV consolidado',net_bps:analysis.rateBps,lag_days:lagDays,gmv_cents:Array.from({length:months},()=>analysis.gmv)}];
 p.notes=`Premissa revisável: GMV de pedidos válidos de ${analysis.month}; repasses classificados entre ${analysis.cashBegin} e ${dayAfter(analysis.cashEnd,-1)}. Aproximação por janela de ${lagDays} dias, sem vínculo individual pedido/repasse. GMV mensal repetido como hipótese; custos e saldo inicial precisam ser preenchidos.`;
 return p;
}
