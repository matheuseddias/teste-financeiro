import { chromium,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
const server=spawn('node',['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts','--host','127.0.0.1','--port','5181'],{stdio:'pipe'});let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:5181')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const tenant='edd1a500-0000-4000-8000-000000000001';const user={id:crypto.randomUUID(),email:'prodio@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-01'};
 const plans=[];let configured=false;const actions=[];
 const sources=[{id:crypto.randomUUID(),tenant_id:tenant,kind:'pedidos',company_name:'Eddias',enabled:true,validated_at:'2026-10-01T12:00:00Z',last_success_at:'2026-10-01T12:00:00Z',last_full_sync_at:null,version:1,deleted_at:null}];
 const documents=[{id:crypto.randomUUID(),tenant_id:tenant,source_id:crypto.randomUUID(),kind:'pedidos',business_date:'2026-09-10',amount_cents:100000,status:'enviado',description:'Pedido teste',channel_name:null,channel_key:null,purchase_ids:[],payment_terms:[],deleted_at:null}];
 const transactions=[{id:crypto.randomUUID(),tenant_id:tenant,account_id:'account',posted_date:'2026-09-15',amount_cents:80000,classification:'repasse',channel:null,description:'Repasse teste',version:1,deleted_at:null}];
 await page.route('**/api/config',r=>r.fulfill({json:{environment:'preview',supabaseUrl:'https://testfixture.supabase.co',supabasePublishableKey:'sb_publishable_test'}}));
 await page.route('**/api/prodio/**',r=>{actions.push(r.request().postDataJSON());return r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/status')?{configured}:{ok:true,received:1,cycleComplete:true}});});
 await page.route('https://testfixture.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,b=req.postDataJSON();let data;
  if(path==='/auth/v1/token')data={access_token:'test-session',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user};
  else if(path==='/auth/v1/user')data=user;
  else if(path.endsWith('/fin_my_workspaces'))data=[{tenant_id:tenant,user_id:user.id,role:'admin',active:true,permissions:{},workspace_name:'Grupo teste'}];
  else if(path.endsWith('/fin_prodio_sources'))data=sources;
  else if(path.endsWith('/fin_prodio_documents'))data=documents;
  else if(path.endsWith('/fin_transactions'))data=transactions;
  else if(path.endsWith('/fin_plans'))data=plans;
  else if(path.endsWith('/fin_save_plan')){data={id:b.p_id,tenant_id:tenant,name:b.p_name,config:b.p_config,version:1,deleted_at:null};plans.push(data);}
  else if(['/fin_members','/fin_companies','/fin_bank_accounts','/fin_commitments','/fin_kamino_sources','/fin_kamino_documents','/fin_allocations','/fin_import_profiles','/fin_rules'].some(t=>path.endsWith(t)))data=[];
  else throw new Error('Requisição inesperada: '+path);
  await route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:5181');await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('button',{name:'Prodio',exact:true}).click();await expect(page.getByText(/Integração preparada, aguardando/)).toBeVisible();await expect(page.getByRole('button',{name:'Testar pedidos e gmv',exact:true})).toBeDisabled();
 configured=true;await page.getByRole('button',{name:'Projeções de caixa',exact:true}).click();await page.getByRole('button',{name:'Prodio',exact:true}).click();
 await page.getByRole('button',{name:'Testar pedidos e gmv',exact:true}).click();await expect(page.getByText(/Empresa, escopos e leitura conferidos/)).toBeVisible();expect(actions.at(-1)).toMatchObject({tenantId:tenant,kind:'pedidos'});
 await expect(page.getByRole('cell',{name:'Canal não informado',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Projeções de caixa',exact:true}).click();await page.getByText('Histórico · GMV × dinheiro recebido',{exact:true}).click();
 await page.getByLabel('Mês das vendas',{exact:true}).fill('2026-09');await page.getByLabel('Início do cenário histórico',{exact:true}).fill('2026-11');
 await expect(page.getByRole('button',{name:'Criar cenário com esta análise',exact:true})).toBeDisabled();
 await expect(page.getByText('80%',{exact:true})).toBeVisible();
 sources[0].last_full_sync_at='2026-10-01T12:00:00Z';await page.reload();await page.getByRole('button',{name:'Projeções de caixa',exact:true}).click();await page.getByText('Histórico · GMV × dinheiro recebido',{exact:true}).click();await page.getByLabel('Mês das vendas',{exact:true}).fill('2026-09');await page.getByLabel('Início do cenário histórico',{exact:true}).fill('2026-11');
 await expect(page.getByRole('button',{name:'Criar cenário com esta análise',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:/Conferi a cobertura das vendas/}).check();await page.getByRole('button',{name:'Criar cenário com esta análise',exact:true}).click();
 await expect(page.getByText('Cenário salvo · Histórico 2026-09 · consolidado',{exact:true})).toBeVisible();expect(plans).toHaveLength(1);expect(plans[0].config.channels[0]).toMatchObject({net_bps:8000,gmv_cents:[100000,100000,100000,100000,100000,100000]});expect(plans[0].config.opening_cents).toBeNull();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);console.log('Prodio no navegador: token ausente, teste de conexão, canal ausente, histórico parcial bloqueado, taxa 80%, revisão explícita, cenário e mobile aprovados (API simulada).');
}finally{await browser?.close();server.kill();}
