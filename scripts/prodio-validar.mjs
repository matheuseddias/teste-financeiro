// Diagnóstico GET: imprime somente validações de identidade/escopos e disponibilidade, nunca token ou documentos.
async function main(){
 const token=process.env.PRODIO_API_TOKEN;
 if(!token||!/^prodio_live_[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Token ausente ou formato inválido.');
 const get=path=>fetch('https://api.prodio.com.br/v1'+path,{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 let r;try{r=await get('/eu');}catch{throw new Error('Prodio indisponível na consulta de identidade.');}
 console.log(JSON.stringify({route:'/eu',status:r.status}));if(!r.ok)throw new Error('Identidade não validada; nenhuma lista consultada.');
 const me=await r.json();const company=typeof me?.empresa?.nome==='string'&&me.empresa.nome.normalize('NFKC').trim().toLowerCase()==='eddias';
 const uuid=typeof me?.empresa?.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(me.empresa.id);
 const scopes=Array.isArray(me?.token?.escopos)?me.token.escopos:[];const missing=['pedidos:ler','compras:ler','notas:ler','custos:ler'].filter(s=>!scopes.includes(s));
 console.log(JSON.stringify({company_is_eddias:company,company_id_is_uuid:uuid,missing_scopes:missing}));if(!company||!uuid||missing.length)throw new Error('Empresa, identificador ou permissões precisam de conferência.');
 let unavailable=false;
 for(const path of ['/pedidos','/compras/ordens','/notas']){
  try{r=await get(path+'?limite=1');}catch{throw new Error('Prodio indisponível na consulta de rota.');}
  console.log(JSON.stringify({route:path,status:r.status}));if(r.body)await r.body.cancel();
  if(r.status===429||r.status>=500)throw new Error('Leitura interrompida para respeitar indisponibilidade/limite.');
  if(!r.ok)unavailable=true;
 }
 if(unavailable)throw new Error('Uma ou mais rotas necessárias ainda não estão disponíveis para este acesso.');
 console.log('Prodio: identidade, escopos e três rotas disponíveis. Conteúdo financeiro não registrado.');
}
main().catch(e=>{console.error(e instanceof Error&&/^(Prodio|Token|Identidade|Empresa|Leitura|Uma)/.test(e.message)?e.message:'Diagnóstico interrompido; resposta não reconhecida.');process.exitCode=1;});
