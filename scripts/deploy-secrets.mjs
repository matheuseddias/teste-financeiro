// Saída destinada EXCLUSIVAMENTE ao pipe de wrangler secret bulk, nunca ao log.
const names=['SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'];
if(process.env.PRODIO_API_TOKEN?.trim())names.push('PRODIO_API_TOKEN');
for(const prefix of ['KAMINO_','KAMINO_HOME_']){
 const group=['API_BASE','APP','CN','IDUSR','USR','HASH'].map(k=>prefix+k);
 const present=group.filter(k=>process.env[k]?.trim());
 if(present.length&&present.length!==group.length)throw new Error('Configuração incompleta de '+prefix+' no GitHub.');
 if(present.length)names.push(...group);
}
const payload=Object.fromEntries(names.map(k=>[k,process.env[k]]));
if(process.argv.includes('--check'))console.log('Conjuntos de credenciais conferidos, sem exibir valores.');
else process.stdout.write(JSON.stringify(payload));
