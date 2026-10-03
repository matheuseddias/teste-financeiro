import { useEffect,useState } from 'react';
import { money,type ProdioKind } from '@eddias/core';
import { useAuth } from '../../app/auth';
import { useStore } from '../../domain/store';
import { message } from '../../data/client';
import { Notice } from '../../ui';
const names={pedidos:'Pedidos e GMV',compras:'Ordens de compra',notas:'Notas de entrada'};
const stamp=(v:string|null)=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'Ainda não realizada';
export function Prodio(){
 const {session,member}=useAuth();const {data,repo,mutate,refresh,busy}=useStore();
 const [configured,setConfigured]=useState<boolean>();const [error,setError]=useState('');const [notice,setNotice]=useState('');const [loading,setLoading]=useState(false);
 const [kind,setKind]=useState<ProdioKind>('pedidos');const [month,setMonth]=useState('');const [page,setPage]=useState(0);
 async function api(action:string,extra:Record<string,unknown>={}){
  const r=await fetch('/api/prodio/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({tenantId:member.tenant_id,...extra})});
  const b=await r.json();if(!r.ok)throw new Error(b.error||'Não foi possível consultar o Prodio.');return b;
 }
 useEffect(()=>{let alive=true;api('status').then(r=>{if(alive)setConfigured(r.configured);}).catch(e=>{if(alive)setError(message(e));});return()=>{alive=false;};},[session.access_token]);
 async function act(action:'probe'|'sync',resource:ProdioKind){setLoading(true);setError('');setNotice('');try{
  const r=await api(action,{kind:resource});setNotice(action==='probe'?'Empresa, escopos e leitura conferidos. Você pode sincronizar e ativar esta fonte.':`${r.received} documentos processados. ${r.cycleComplete?'Ciclo concluído.':'Histórico ainda em processamento.'}`);
 }catch(e){setError(message(e));}finally{await refresh().catch(()=>{});setLoading(false);}}
 const rows=(data?.prodioDocuments||[]).filter(d=>d.kind===kind&&(!month||d.business_date?.startsWith(month))).sort((a,b)=>(b.business_date||'').localeCompare(a.business_date||''));
 return <><div className="page-heading"><div><p className="eyebrow">INTEGRAÇÕES</p><h1>Prodio</h1><p>Pedidos, compras e notas da Eddias para planejar o caixa.</p></div><button className="secondary" disabled={busy||loading} onClick={()=>void refresh().catch(e=>setError(message(e)))}>Atualizar tela</button></div>
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  {configured===undefined?<p>Verificando configuração…</p>:!configured?<Notice>Integração preparada, aguardando a configuração do acesso da empresa Eddias. Após ativar a conexão, o sistema poderá consultar pedidos, compras e notas automaticamente.</Notice>:<Notice>Conexão configurada. A primeira leitura confere a empresa Eddias, as permissões e o formato dos dados. A sincronização não altera pedidos, estoque ou pagamentos no Prodio.</Notice>}
  <Notice>Pedidos, compras e notas dependem da etapa E2 da API Prodio. Se a rota ainda não estiver publicada, a fonte mostrará essa pendência. GMV por canal depende da informação de origem; “BaseLinker” identifica a plataforma, não o marketplace.</Notice>
  {(Object.keys(names) as ProdioKind[]).map(k=>{const source=data?.prodioSources.find(s=>s.kind===k);return <section className="card" key={k}><h2>{names[k]}</h2>
   <p>{source?.company_name||'Empresa a conferir'} · {source?.enabled?'Leitura automática ativa':'Leitura automática pausada'}</p>
   <p>Última leitura: {stamp(source?.last_success_at||null)} · Último ciclo completo: {stamp(source?.last_full_sync_at||null)}</p>
   {source?.last_error&&<Notice error>{source.last_error}{source.enabled?' Nova tentativa após o intervalo indicado pelo servidor.':' Teste novamente após resolver a pendência.'}</Notice>}
   <div className="actions"><button className="secondary" disabled={!configured||busy||loading} onClick={()=>void act('probe',k)}>Testar {names[k].toLowerCase()}</button><button disabled={!configured||busy||loading||!source?.validated_at} onClick={()=>void act('sync',k)}>Ler próximo lote de {names[k].toLowerCase()}</button>
   {source&&<button className="secondary" disabled={busy||loading||(!source.enabled&&!source.validated_at)} onClick={async()=>{setError('');try{await mutate(()=>repo.rpc('fin_prodio_enable',{p_id:source.id,p_enabled:!source.enabled,p_version:source.version}));}catch(e){setError(message(e));}}}>{source.enabled?'Pausar':'Ativar'} leitura de {names[k].toLowerCase()}</button>}</div>
  </section>;})}
  <section className="card"><div className="form-grid"><label>Documentos do Prodio<select aria-label="Documentos do Prodio" value={kind} onChange={e=>{setKind(e.target.value as ProdioKind);setPage(0);}}>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Mês dos documentos<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(0);}}/></label></div>
   <p>{rows.length} documentos. Compras e notas são referências de conferência; as contas a pagar revisadas na Kamino alimentam os lançamentos previstos.</p>
   <div className="table-scroll"><table className="data-table"><thead><tr><th>Data</th><th>Documento</th><th>Valor</th><th>Situação</th><th>Canal / vínculo</th></tr></thead><tbody>{rows.slice(page*100,page*100+100).map(d=><tr key={d.id}><td>{d.business_date||'Sem data confirmada'}</td><td>{d.description}{d.expected_date&&<small className="block">Entrega prevista: {d.expected_date}</small>}</td><td>{money(d.amount_cents)}</td><td>{d.status||'Sem De-Para'}</td><td>{kind==='pedidos'?(d.channel_name||d.channel_key||'Canal não informado'):kind==='compras'?(data?.prodioDocuments.some(n=>n.kind==='notas'&&n.purchase_ids.includes(d.source_id))?'Há NF-e vinculada; conferir títulos na Kamino':'Sem NF-e vinculada nos dados carregados'):(data?.kaminoDocuments.some(n=>n.kind==='notas'&&n.invoice_key===d.invoice_key)?'Mesma NF-e encontrada na Kamino':'Documento de consulta')}{kind==='compras'&&<small className="block">Condição: {d.payment_terms.join(' / ')||'Não informada'} dias</small>}</td></tr>)}</tbody></table></div>
   <div className="actions"><button className="secondary" disabled={!page} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1}</span><button className="secondary" disabled={(page+1)*100>=rows.length} onClick={()=>setPage(page+1)}>Próxima</button></div>
  </section><Notice>A análise de GMV × repasses e a criação de cenários a partir do histórico ficam em <strong>Projeções de caixa</strong>.</Notice>
 </>;
}
