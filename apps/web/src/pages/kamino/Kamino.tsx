import { useEffect, useState } from 'react';
import { money, type KaminoKind, type KaminoSlot } from '@eddias/core';
import { useAuth } from '../../app/auth';
import { useStore } from '../../domain/store';
import { message } from '../../data/client';
import { Notice } from '../../ui';
import { Review } from './Review';
type Ready = Record<KaminoSlot,{configured:boolean;missing:string[]}>;
const kinds={pagamentos:'Contas a pagar',notas:'Notas de entrada'};
const stamp=(s:string|null)=>s?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(s)):'Ainda não realizada';
export function Kamino() {
 const { session,member }=useAuth();const { data,repo,mutate,refresh,busy }=useStore();
 const [ready,setReady]=useState<Ready>();const [error,setError]=useState('');const [status,setStatus]=useState('');const [loading,setLoading]=useState(false);
 const [slot,setSlot]=useState<KaminoSlot>('principal');const [kind,setKind]=useState<KaminoKind>('pagamentos');const [reviewOnly,setReviewOnly]=useState(false);
 const [unit,setUnit]=useState('');
 const [selected,setSelected]=useState<Set<string>>(new Set());const [page,setPage]=useState(0);
 async function api(action:string,extra:Record<string,unknown>={}) {
  const r=await fetch('/api/kamino/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({tenantId:member.tenant_id,...extra})});
  const b=await r.json();if(!r.ok)throw new Error(b.error||'Não foi possível consultar a Kamino.');return b;
 }
 useEffect(()=>{let alive=true;api('status').then(r=>{if(alive)setReady(r);}).catch(e=>{if(alive)setError(message(e));});return()=>{alive=false;};},[session.access_token]);
 async function act(action:'probe'|'sync',s:KaminoSlot,k:KaminoKind) {
  setError('');setStatus('');setLoading(true);
  try {const r=await api(action,{slot:s,kind:k});setStatus(action==='probe'?'Leitura validada. Você já pode sincronizar esta fonte.':r.shrinking?'Janela cheia: será consultado um período menor, sem avançar o histórico.':`${r.received} documentos processados. ${r.cycleComplete?'Ciclo de leitura concluído.':'Histórico ainda em processamento.'}`);}
  catch(e){setError(message(e));}finally{await refresh().catch(()=>{});setLoading(false);}
 }
 const rows=(data?.kaminoDocuments||[]).filter(d=>d.slot===slot&&d.kind===kind&&(!unit||d.unit_id===unit)&&(!reviewOnly||d.reviewed_fingerprint!==d.fingerprint)).sort((a,b)=>(b.due_date||b.issue_date||'').localeCompare(a.due_date||a.issue_date||''));
 const chosen=(data?.kaminoDocuments||[]).filter(d=>selected.has(d.id));
 function reset(){setSelected(new Set());setPage(0);}
 return <><div className="page-heading"><div><p className="eyebrow">INTEGRAÇÕES</p><h1>Kamino</h1><p>Contas a pagar e notas de entrada no seu financeiro.</p></div><button className="secondary" disabled={busy||loading} onClick={()=>void refresh()}>Atualizar tela</button></div>
  <Notice>Leitura desde 01/09/2026. A importação não altera nada na Kamino. Confira empresa, categoria e possíveis lançamentos já cadastrados antes de incluir títulos nas previsões. Notas são documentos de apoio e não geram uma segunda saída.</Notice>
  {error&&<Notice error>{error}</Notice>}{status&&<Notice>{status}</Notice>}
  {(['principal','home'] as const).filter(s=>s==='principal'||ready?.home.configured).map(s=><section className="card" key={s}><h2>{s==='principal'?'Conexão principal':'Conexão Home'}</h2>
   {!ready?<p>Verificando configuração…</p>:!ready[s].configured?<Notice>Configuração pendente no servidor: {ready[s].missing.join(', ')}. As credenciais não são enviadas ao navegador.</Notice>:<>
   {(Object.keys(kinds) as KaminoKind[]).map(k=>{const source=data?.kaminoSources.find(x=>x.slot===s&&x.kind===k);return <div className="card" key={k}><h3>{kinds[k]}</h3><p>Última leitura: {stamp(source?.last_success_at||null)} · Último ciclo completo: {stamp(source?.last_full_sync_at||null)}</p>
    <p>{source?.enabled?'Leitura automática ativa':'Leitura automática pausada'} · Uma consulta por rodada; o histórico avança em páginas ou períodos menores.</p>
    {source?.last_error&&<Notice error>{source.last_error}</Notice>}
    <div className="actions"><button className="secondary" disabled={loading||busy} onClick={()=>void act('probe',s,k)}>Testar {kinds[k].toLowerCase()}</button><button disabled={loading||busy||!source?.validated_at} onClick={()=>void act('sync',s,k)}>Ler próximo lote de {kinds[k].toLowerCase()}</button>
    {source&&<button className="secondary" disabled={loading||busy||(!source.enabled&&!source.validated_at)} onClick={async()=>{setError('');try{await mutate(()=>repo.rpc('fin_kamino_enable',{p_id:source.id,p_enabled:!source.enabled,p_version:source.version}));}catch(e){setError(message(e));}}}>{source.enabled?'Pausar':'Ativar'} leitura automática de {kinds[k].toLowerCase()}</button>}</div></div>;})}</>}
  </section>)}
  <section className="card"><div className="form-grid"><label>Conexão<select aria-label="Conexão" value={slot} onChange={e=>{setSlot(e.target.value as KaminoSlot);setUnit('');reset();}}><option value="principal">Principal</option><option value="home">Home</option></select></label><label>Documentos<select aria-label="Documentos" value={kind} onChange={e=>{setKind(e.target.value as KaminoKind);setUnit('');reset();}}><option value="pagamentos">Contas a pagar</option><option value="notas">Notas de entrada</option></select></label><label>Unidade Kamino<select aria-label="Unidade Kamino" value={unit} onChange={e=>{setUnit(e.target.value);reset();}}><option value="">Todas as unidades</option>{[...new Map((data?.kaminoDocuments||[]).filter(d=>d.slot===slot&&d.kind===kind&&d.unit_id).map(d=>[d.unit_id!,d.unit_name||d.unit_id!])).entries()].map(([id,name])=><option key={id} value={id}>{name} · {id}</option>)}</select></label></div>
   <label className="checkbox"><input type="checkbox" checked={reviewOnly} onChange={e=>{setReviewOnly(e.target.checked);reset();}}/>Somente não revisados ou alterados na origem</label><p>{rows.length} documentos. Pago na Kamino não significa conciliado no extrato. Títulos com pagamento informado precisam de conferência bancária.</p>
   {kind==='pagamentos'&&<button className="secondary" onClick={()=>setSelected(new Set(rows.slice(page*100,page*100+100).filter(d=>['1','3'].includes(d.status)&&!d.paid_cents&&d.amount_cents>0).map(d=>d.id)))}>Selecionar títulos abertos desta página</button>}
   <div className="table-scroll"><table className="data-table"><thead><tr><th>Revisar</th><th>{kind==='pagamentos'?'Vencimento':'Emissão'}</th><th>Descrição / fornecedor</th><th>Valor</th><th>Situação</th><th>Previsão / nota</th></tr></thead><tbody>{rows.slice(page*100,page*100+100).map(d=><tr key={d.id}><td>{kind==='pagamentos'&&['1','3'].includes(d.status)&&!d.paid_cents&&d.amount_cents>0&&<input type="checkbox" aria-label={'Selecionar título '+d.source_id} checked={selected.has(d.id)} onChange={e=>{const n=new Set(selected);if(e.target.checked)n.add(d.id);else n.delete(d.id);setSelected(n);}}/>}</td><td>{d.due_date||d.issue_date}</td><td>{d.description}<small className="block">{d.supplier} · Unidade {d.unit_name||d.unit_id||'não informada'}</small></td><td>{money(d.amount_cents)}</td><td>{kind==='pagamentos'?({'1':'Pendente','2':'Paga na Kamino','3':'Aguardando aprovação'}[d.status]||d.status):d.status}{!!d.paid_cents&&<small className="block">Pagamento informado: {money(d.paid_cents)}</small>}</td><td>{kind==='notas'?'Documento de consulta':d.commitment_id?(d.reviewed_fingerprint===d.fingerprint?'Vinculado à previsão':'Alterado na origem; revisar'):'Ainda não incluído'}{d.invoice_source_id&&<small className="block">Nota Kamino #{d.invoice_source_id}</small>}{kind==='notas'&&<small className="block">{d.invoice_key}</small>}</td></tr>)}</tbody></table></div>
   <div className="actions"><button className="secondary" disabled={!page} onClick={()=>{setPage(page-1);setSelected(new Set());}}>Anterior</button><span>Página {page+1}</span><button className="secondary" disabled={(page+1)*100>=rows.length} onClick={()=>{setPage(page+1);setSelected(new Set());}}>Próxima</button></div>
  </section>{!!chosen.length&&<Review key={chosen.map(d=>d.id+':'+d.version).join(',')} documents={chosen} done={()=>setSelected(new Set())}/>}</>;
}
