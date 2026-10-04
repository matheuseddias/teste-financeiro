import type { ProdioKind, ProdioRecord } from '../../../../packages/core/src/prodio';
import { cents, obj } from '../kamino/map';
export const invalid=(field:string)=>new Error('Prodio: formato não reconhecido em '+field+'. Nenhum lote foi confirmado.');
function str(v:unknown,field:string,max=120):string {if(typeof v!=='string'||!v.trim()||v.length>max)throw invalid(field);return v.trim();}
function optional(v:unknown,field:string,max=120){return v==null?null:str(v,field,max);}
// O contrato aceita UUID PostgreSQL, inclusive identificadores legados sem versão/variante RFC.
function id(v:unknown,field:string){if(typeof v!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw invalid(field);return v.toLowerCase();}
function ids(v:unknown,field:string){if(!Array.isArray(v)||v.length>200)throw invalid(field);return [...new Set(v.map(x=>id(x,field)))];}
export function instant(v:unknown,field:string):string{
 if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw invalid(field);date(v.slice(0,10),field);return v;
}
function date(v:unknown,field:string):string|null{
 if(v==null)return null;if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw invalid(field);return v;
}
function day(v:unknown,field:string,timezone:string):string|null{
 if(v==null)return null;return new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant(v,field)));
}
function amount(v:unknown,field:string):number {if(v===null)throw new Error('Prodio: valores não disponíveis. Confira o escopo custos:ler.');try{return cents(v);}catch{throw invalid(field);}}
export function profile(v:unknown){
 if(!obj(v)||!obj(v.empresa)||!obj(v.token))throw invalid('eu');
 const companyId=id(v.empresa.id,'empresa.id'),name=str(v.empresa.nome,'empresa.nome'),timezone=str(v.empresa.fuso,'empresa.fuso');
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone}).format(new Date());}catch{throw invalid('empresa.fuso');}
 if(!Array.isArray(v.token.escopos)||v.token.escopos.some(s=>typeof s!=='string'))throw invalid('token.escopos');
 return {companyId,name,timezone,scopes:v.token.escopos as string[]};
}
export function record(kind:ProdioKind,v:unknown,timezone:string):ProdioRecord{
 if(!obj(v))throw invalid('documento');
 const base:ProdioRecord={source_id:id(v.id,'id'),source_updated_at:instant(v.atualizado_em,'atualizado_em'),business_date:null,amount_cents:0,status:optional(v.status,'status'),description:'',channel_key:null,channel_name:null,invoice_key:null,supplier_id:null,purchase_ids:[],payment_terms:[],expected_date:null};
 if(kind==='pedidos'){
  if(v.significado!==null&&!['ignorar','demanda','carteira','enviado','cancelado'].includes(String(v.significado)))throw invalid('significado');
  return {...base,business_date:day(v.confirmado_em,'confirmado_em',timezone),amount_cents:amount(v.total,'total'),status:v.significado as string|null,description:'Pedido '+str(v.externo_id,'externo_id',80),
   // Extensão aditiva ainda ausente no rascunho v1: nunca confundir plataforma com canal.
   channel_key:optional(v.origem,'origem'),channel_name:optional(v.origem_nome,'origem_nome')};
 }
 if(kind==='compras'){
  if(!Number.isSafeInteger(v.numero)||Number(v.numero)<1||!['aberta','parcial','recebida','cancelada'].includes(String(v.status)))throw invalid('ordem de compra');
  if(!Array.isArray(v.condicao_pagamento)||v.condicao_pagamento.length>60||v.condicao_pagamento.some(n=>!Number.isSafeInteger(n)||n<0||n>3650))throw invalid('condicao_pagamento');
  return {...base,business_date:day(v.criada_em,'criada_em',timezone),amount_cents:amount(v.total,'total'),description:'OC '+v.numero,supplier_id:id(v.fornecedor_id,'fornecedor_id'),payment_terms:v.condicao_pagamento,expected_date:date(v.entrega_prevista,'entrega_prevista')};
 }
 if(!['aguardando_xml','pendente','conferida','recebida','ignorada'].includes(String(v.status))||typeof v.chave!=='string'||!/^\d{44}$/.test(v.chave))throw invalid('nota');
 return {...base,business_date:date(v.emissao,'emissao'),amount_cents:amount(v.valor_total,'valor_total'),description:'NF-e '+(Number.isSafeInteger(v.numero)?v.numero:'sem número'),supplier_id:v.fornecedor_id==null?null:id(v.fornecedor_id,'fornecedor_id'),invoice_key:v.chave,purchase_ids:ids(v.ordens_compra,'ordens_compra')};
}
export async function page(kind:ProdioKind,v:unknown,timezone:string,previous:string|null){
 if(!obj(v)||!Array.isArray(v.dados)||v.dados.length>200||(v.proximo_cursor!==null&&(typeof v.proximo_cursor!=='string'||!v.proximo_cursor||v.proximo_cursor.length>4096)))throw invalid('paginação');
 const next=v.proximo_cursor as string|null;if(next&&(next===previous||!v.dados.length))throw invalid('cursor sem avanço');
 const docs=v.dados.map(d=>record(kind,d,timezone));if(new Set(docs.map(d=>d.source_id)).size!==docs.length)throw invalid('identificador repetido');
 const documents=await Promise.all(docs.map(async d=>({...d,fingerprint:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(d))))].map(x=>x.toString(16).padStart(2,'0')).join('')})));
 return {documents,next,maxUpdated:docs.reduce((max,d)=>Math.max(max,Date.parse(d.source_updated_at)),0)};
}
