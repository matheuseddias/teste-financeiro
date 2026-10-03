// Diagnóstico somente de leitura. Nunca escreve corpo, valores ou credenciais nos logs.
const required = ['KAMINO_API_BASE','KAMINO_APP','KAMINO_CN','KAMINO_IDUSR','KAMINO_USR','KAMINO_HASH'];
async function main() {
  const missing = required.filter(k => !process.env[k]?.trim());
  if (missing.length) throw new Error('Credenciais ausentes: ' + missing.join(', '));
  const base = new URL(process.env.KAMINO_API_BASE);
  if (base.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.kamino\.tech$/i.test(base.hostname) || base.port || base.username || base.password || !['','/'].includes(base.pathname) || base.search || base.hash) throw new Error('URL da API fora do formato https://empresa.kamino.tech.');
  const headers = { Accept:'application/json',App:process.env.KAMINO_APP,CN:process.env.KAMINO_CN,IDUsr:process.env.KAMINO_IDUSR,Usr:process.env.KAMINO_USR,Hash:process.env.KAMINO_HASH };
  async function get(path,params) {
    const url=new URL(path,base);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    let response;try { response=await fetch(url,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(20000)}); } catch {throw new Error('Falha de conexão com a Kamino.');}
    if(!response.ok)throw new Error('Kamino retornou HTTP '+response.status+'. Diagnóstico interrompido.');
    let body;try{body=await response.json();}catch{throw new Error('Kamino não retornou JSON.');}
    return body;
  }
  function fields(row) { return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null?'null':Array.isArray(value)?'array':typeof value])); }
  const payments=await get('/api/financeiro/pagamento/lista/paginada',{_pagina:'1',_tamanhoPagina:'1',VencDe:'2026-09-01'});
  if(!payments || !Array.isArray(payments.Dados) || payments.PaginaAtual!==1)throw new Error('Formato da resposta de contas a pagar precisa de revisão.');
  console.log('Contas a pagar: acesso de leitura confirmado; envelope paginado reconhecido.');
  if(payments.Dados[0] && typeof payments.Dados[0]==='object')console.log('Campos/tipos, sem valores:',JSON.stringify(fields(payments.Dados[0])));
  await new Promise(resolve=>setTimeout(resolve,4000));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const invoices=await get('/api/notafiscal/entrada/lista',{DataHoraEmissaoDe:today+'T00:00:00',DataHoraEmissaoAte:today+'T23:59:59'});
  const list=Array.isArray(invoices)?invoices:invoices?.Dados;
  if(!Array.isArray(list))throw new Error('Formato da resposta de NF-e precisa de revisão.');
  console.log('NF-e de entrada: acesso de leitura confirmado; lista reconhecida.');
  if(list[0] && typeof list[0]==='object')console.log('Campos/tipos, sem valores:',JSON.stringify(fields(list[0])));
  else console.log('Sem nota na janela consultada; campos de uma nota real ainda não verificados.');
}
main().catch(error=>{console.error(error instanceof Error && !error.message.includes('https:') ? error.message : 'Diagnóstico interrompido. Revise a configuração da API.');process.exitCode=1;});
