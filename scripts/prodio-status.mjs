// Diagnóstico somente de leitura; imprime estado e contagens, nunca documentos ou valores.
const origin='https://dheunohtkgvgqzwsauqt.supabase.co';
const tenant='edd1a500-0000-4000-8000-000000000001';
async function main(){
 if(process.env.SUPABASE_URL!==origin||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Configuração do diagnóstico indisponível.');
 const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY};
 async function read(path,method='GET'){
  let r;try{r=await fetch(origin+'/rest/v1/'+path,{method,headers:{...headers,Prefer:'count=exact'},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Banco indisponível.');}
  if(!r.ok)throw new Error('Diagnóstico interrompido: HTTP '+r.status+'.');return r;
 }
 const response=await read('fin_prodio_sources?tenant_id=eq.'+tenant+'&select=kind,enabled,validated_at,last_success_at,last_full_sync_at,last_error,cursor&order=kind');
 const sources=await response.json();if(!Array.isArray(sources))throw new Error('Estado de fontes não reconhecido.');
 for(const source of sources){
  if(!['pedidos','compras','notas'].includes(source.kind))throw new Error('Fonte não reconhecida.');
  const count=await read('fin_prodio_documents?tenant_id=eq.'+tenant+'&kind=eq.'+source.kind+'&select=id','HEAD');
  const total=Number(count.headers.get('Content-Range')?.split('/')[1]);if(!Number.isSafeInteger(total)||total<0)throw new Error('Contagem não reconhecida.');
  console.log(JSON.stringify({kind:source.kind,enabled:source.enabled,validated:!!source.validated_at,last_success_at:source.last_success_at,last_full_sync_at:source.last_full_sync_at,has_error:!!source.last_error,error:source.last_error,documents:total,has_next_cursor:!!source.cursor?.next}));
 }
 if(!sources.length)console.log('Nenhuma fonte inicializada.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Falha no diagnóstico.');process.exitCode=1;});
