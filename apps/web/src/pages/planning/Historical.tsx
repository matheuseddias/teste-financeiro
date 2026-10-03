import { useEffect,useState } from 'react';
import { conversionWindow,dayAfter,money,monthAfter,project,resizePlan,scenarioFromHistory,type PlanInput } from '@eddias/core';
import { useStore } from '../../domain/store';
import { message } from '../../data/client';
import { Notice } from '../../ui';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function Historical({saved}:{saved:(id:string)=>void}){
 const {data,repo,mutate,busy}=useStore();const current=today();
 const [month,setMonth]=useState(monthAfter(current.slice(0,7)+'-01',-1).slice(0,7));const [lag,setLag]=useState(0);const [channel,setChannel]=useState('');
 const [start,setStart]=useState(monthAfter(current.slice(0,7)+'-01',1).slice(0,7));const [template,setTemplate]=useState('');const [checked,setChecked]=useState(false);const [error,setError]=useState('');
 const source=data?.prodioSources.find(s=>s.kind==='pedidos');
 useEffect(()=>setChecked(false),[month,lag,channel,start,template,source?.last_success_at,data?.transactions]);
 const channels=[...new Set((data?.prodioDocuments||[]).filter(d=>d.kind==='pedidos').map(d=>d.channel_name||d.channel_key).filter((s):s is string=>!!s))].sort();
 let analysis:ReturnType<typeof conversionWindow>|undefined;let config:PlanInput|undefined;let invalid='';
 try{
  analysis=conversionWindow(data?.prodioDocuments||[],data?.transactions||[],month,lag,channel);
  if(source?.last_full_sync_at&&analysis.cashEnd<=current){
   config=scenarioFromHistory(analysis,start+'-01',lag,channel);const base=data?.plans.find(p=>p.id===template);
   if(base){const costs=resizePlan({...base.config,start_month:config.start_month},config.months);config={...config,costs:costs.costs,supplier_bps:costs.supplier_bps,tax_bps:costs.tax_bps,opening_cents:null,notes:(config.notes+' Custos copiados de '+base.name+'.').slice(0,4000)};}
   project(config,data?.commitments);
  }
 }catch(e){invalid=message(e);}
 return <details className="card"><summary><strong>Histórico · GMV × dinheiro recebido</strong><span className="muted">Comparar vendas com repasses e criar um cenário editável</span></summary>
  <Notice>Comparação por janela de repasse: o GMV dos pedidos confirmados de um mês é comparado aos repasses bancários numa janela deslocada pelo prazo informado. É uma estimativa para revisão, sem atribuição individual entre pedido e depósito. Transferências, empréstimos e aportes ficam fora.</Notice>
  {!source?.last_full_sync_at&&<Notice>Conecte o Prodio e conclua o primeiro ciclo de pedidos antes de criar premissas a partir do histórico. Dados parciais podem ser consultados, mas não devem orientar a projeção.</Notice>}
  <div className="form-grid"><label>Mês das vendas<input aria-label="Mês das vendas" type="month" min="2026-09" value={month} onChange={e=>setMonth(e.target.value)}/></label><label>Prazo de repasse (dias)<input aria-label="Prazo histórico de repasse" type="number" min="0" max="180" value={lag} onChange={e=>setLag(Number(e.target.value))}/></label><label>Canal das vendas<select aria-label="Canal das vendas" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Consolidado do grupo</option>{channels.map(c=><option key={c} value={c}>{c}</option>)}</select></label></div>
  {analysis&&<><p>Repasses considerados: {analysis.cashBegin} a {dayAfter(analysis.cashEnd,-1)}. GMV inclui pedidos com De-Para demanda, carteira ou enviado; cancelados e ignorados ficam fora.</p>
   <div className="stats"><div className="card stat"><span>GMV de pedidos válidos</span><strong>{money(analysis.gmv)}</strong><small>{analysis.orders} pedidos</small></div><div className="card stat"><span>Repasses classificados</span><strong>{money(analysis.receipts)}</strong><small>Dinheiro identificado no extrato</small></div><div className="card stat"><span>Conversão estimada da janela</span><strong>{analysis.rateBps===null?'Indisponível':(analysis.rateBps/100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'}</strong><small>Precisa de cobertura e prazo conferidos</small></div></div>
   {!!analysis.missingChannel&&<Notice>{analysis.missingChannel} pedidos válidos não têm canal informado. Permanecem no consolidado. A plataforma de integração não é usada como canal de venda.</Notice>}
   {!!analysis.unknownOrders&&<Notice error>{analysis.unknownOrders} pedidos do período sem De-Para confiável não entraram no GMV. Revise na origem antes de usar a taxa.</Notice>}
   {!!analysis.unclassifiedCash&&<Notice error>{analysis.unclassifiedCash} movimentos da janela ainda não classificados. Confira os extratos.</Notice>}
   {!!analysis.undatedOrders&&<Notice>{analysis.undatedOrders} pedidos sem data confirmada exigem revisão para avaliar a cobertura do período.</Notice>}
   {analysis.rateBps!==null&&analysis.rateBps>10000&&<Notice error>Repasses superam o GMV considerado. Confira prazo, cobertura e vendas de outras competências. Essa taxa não será limitada artificialmente a 100%.</Notice>}
   {analysis.cashEnd>current&&<Notice>A janela de repasses ainda não terminou; o resultado é parcial.</Notice>}
  </>}
  {invalid&&<Notice error>{invalid}</Notice>}{error&&<Notice error>{error}</Notice>}
  <div className="form-grid"><label>Início do novo cenário<input aria-label="Início do cenário histórico" type="month" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Custos de referência<select aria-label="Custos de referência" value={template} onChange={e=>setTemplate(e.target.value)}><option value="">Preencher custos após criar</option>{data?.plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
  <p>O novo cenário repete o GMV do mês-base por seis meses e usa a taxa e o prazo desta análise. São hipóteses editáveis. O saldo inicial precisa ser informado; lançamentos previstos já cadastrados continuam compondo o fluxo.</p>
  <label className="checkbox"><input type="checkbox" checked={checked} disabled={!config} onChange={e=>setChecked(e.target.checked)}/>Conferi a cobertura das vendas e dos extratos, o canal e o prazo; aceito usar esta estimativa como premissa.</label>
  <button disabled={busy||!checked||!config} onClick={async()=>{if(!config)return;setError('');try{const id=crypto.randomUUID();await mutate(()=>repo.rpc('fin_save_plan',{p_id:id,p_name:'Histórico '+month+' · '+(channel||'consolidado').slice(0,70),p_config:config,p_version:0}));setChecked(false);saved(id);}catch(e){setError(message(e));}}}>Criar cenário com esta análise</button>
 </details>;
}
