import { useState } from 'react';
import { money, type KaminoDocument, type CostCategory } from '@eddias/core';
import { useStore } from '../../domain/store';
import { message } from '../../data/client';
import { Notice } from '../../ui';
import { categories } from '../planning/fields';
export function Review({documents,done}:{documents:KaminoDocument[];done:()=>void}) {
 const {data,repo,mutate,busy}=useStore();const [company,setCompany]=useState(documents[0].company_id||'');const [category,setCategory]=useState<CostCategory>(documents[0].category||'fornecedores');
 const [existing,setExisting]=useState('');const [preview,setPreview]=useState<{total:number;linked:number;possible_duplicates:number}|null>(null);const [error,setError]=useState('');const [confirmed,setConfirmed]=useState(false);const [checking,setChecking]=useState(false);
 const possible=(data?.commitments||[]).filter(c=>documents.length===1&&(c.company_id===company||c.company_id===null)&&c.direction==='saida'&&c.amount_cents===documents[0].amount_cents&&c.due_date===documents[0].due_date);
 const args={p_items:documents.map(d=>({id:d.id,version:d.version})),p_company_id:company,p_category:category,p_existing_id:existing||null};
 function invalidate(){setPreview(null);setConfirmed(false);}
 return <section className="card editor"><h2>Conferir títulos para a projeção</h2><p>{documents.length} títulos · {money(documents.reduce((s,d)=>s+d.amount_cents,0))}. A confirmação cria ou atualiza lançamentos previstos; o realizado continua vindo do banco.</p>
 <form data-dirty="true" onSubmit={e=>e.preventDefault()}><fieldset disabled={busy||checking}><div className="form-grid"><label>Empresa titular<select aria-label="Empresa titular" value={company} onChange={e=>{setCompany(e.target.value);setExisting('');invalidate();}}><option value="">Selecione</option>{data?.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Categoria dos títulos<select aria-label="Categoria dos títulos" value={category} onChange={e=>{setCategory(e.target.value as CostCategory);invalidate();}}>{Object.entries(categories).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 {documents.length===1&&!documents[0].commitment_id&&<label>Lançamento existente<select aria-label="Lançamento existente" value={existing} onChange={e=>{setExisting(e.target.value);invalidate();}}><option value="">Criar após conferir duplicatas</option>{possible.map(c=><option key={c.id} value={c.id}>{c.name} · {money(c.amount_cents)}</option>)}</select></label>}</div>
 {!!documents.filter(d=>d.commitment_id).length&&<Notice>Títulos já vinculados atualizarão sua previsão com valor e vencimento atuais da Kamino. Diferenças em previsões conciliadas bloqueiam a operação para revisão.</Notice>}
 {error&&<Notice error>{error}</Notice>}<button type="button" disabled={!company||busy||checking} onClick={async()=>{setChecking(true);setError('');try{setPreview(await repo.rpc('fin_kamino_review',{...args,p_dry_run:true}));setConfirmed(false);}catch(e){setError(message(e));}finally{setChecking(false);}}}>Simular inclusão nas previsões</button>
 {preview&&<><p>{preview.total} títulos · {preview.linked} previsões existentes serão atualizadas · {preview.possible_duplicates} possíveis duplicatas.</p>{preview.possible_duplicates>0?<Notice error>Selecione um título por vez e vincule o lançamento existente antes de confirmar.</Notice>:<><label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Conferi a empresa, a categoria, os valores e os lançamentos existentes.</label><button disabled={!confirmed||busy} onClick={async()=>{setError('');try{await mutate(()=>repo.rpc('fin_kamino_review',{...args,p_dry_run:false}));done();}catch(e){setError(message(e));}}}>Confirmar títulos nas previsões</button></>}</>}
 <button type="button" className="secondary" onClick={done}>Cancelar revisão</button></fieldset></form></section>;
}
