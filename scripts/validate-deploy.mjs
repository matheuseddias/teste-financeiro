// Executado antes de qualquer escrita remota. Nunca imprime valores de segredos.
const fail = message => { console.error(message); process.exit(1); };
const required = ['DEPLOY_ENVIRONMENT','BANCO_URL','BACKUP_SENHA','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'];
for (const key of required) if (!process.env[key]?.trim()) fail('Configuração ausente: ' + key);
const mode = process.env.DEPLOY_ENVIRONMENT;
if (mode !== 'production') fail('Somente produção está habilitada.');
if (process.env.GITHUB_REF_NAME !== 'main') fail('Somente a branch main pode publicar.');
let supa, db;
try { supa = new URL(process.env.SUPABASE_URL); db = new URL(process.env.BANCO_URL); } catch { fail('URLs inválidas.'); }
const prod = 'dheunohtkgvgqzwsauqt';
const ref = supa.hostname.split('.')[0];
if (supa.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(supa.hostname) || supa.username || supa.password || supa.pathname !== '/' || supa.search || supa.hash) fail('URL Supabase inválida.');
if (ref !== prod) fail('Use o projeto atual do Financeiro.');
if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.port === '6543' || db.searchParams.has('host') || db.searchParams.has('hostaddr') || db.searchParams.has('port')) fail('Use a URL do Session pooler (5432), sem sobrescrita de host/porta.');
if (!(db.hostname === 'db.' + ref + '.supabase.co' || (db.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(db.username) === 'postgres.' + ref))) fail('BANCO_URL não corresponde ao projeto Supabase selecionado.');
if (db.searchParams.has('sslmode') && db.searchParams.get('sslmode') !== 'verify-full') fail('A conexão remota exige sslmode=verify-full.');
if (process.env.BACKUP_SENHA.length < 20) fail('BACKUP_SENHA precisa de pelo menos 20 caracteres.');
if (!process.env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) fail('Use a chave publishable do projeto selecionado.');
console.log('Configuração de publicação validada para ' + mode + '.');
