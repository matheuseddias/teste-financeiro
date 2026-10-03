import { chromium,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
const server=spawn('node',['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts','--host','127.0.0.1','--port','5180'],{stdio:'pipe'});let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:5180')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const tenant='edd1a500-0000-4000-8000-000000000001',company='44444444-4444-4444-8444-000000000001';
 const user={id:'11111111-1111-4111-8111-111111111111',email:'admin@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-01'};
 const entries=[],actions=[];
 const base={id:'22222222-2222-4222-8222-222222222222',tenant_id:tenant,slot:'principal',kind:'pagamentos',source_id:'1',description:'Fornecedor da Kamino',due_date:'2026-11-10',issue_date:'2026-09-01',amount_cents:50000,paid_cents:null,status:'1',unit_id:'1',supplier:'Fornecedor teste',supplier_document:null,invoice_number:'100',invoice_key:null,invoice_source_id:'20',category_key:'compras',fingerprint:'a'.repeat(64),reviewed_fingerprint:null,commitment_id:null,company_id:null,category:null,version:1,deleted_at:null,updated_at:'2026-10-01'};
 const documents=[base,{...base,id:crypto.randomUUID(),source_id:'2',description:'Título já pago',status:'2',paid_cents:50000},{...base,id:crypto.randomUUID(),source_id:'20',description:'NF-e 100',kind:'notas',invoice_key:'1'.repeat(44),status:'Autorizada',due_date:null}];
 const sources=[{id:crypto.randomUUID(),tenant_id:tenant,slot:'principal',kind:'pagamentos',enabled:true,validated_at:'2026-10-01',last_success_at:'2026-10-01',last_full_sync_at:null,last_error:null,cursor:{page:2},version:1,deleted_at:null}];
 let writes=0;
 await page.route('**/api/config',r=>r.fulfill({json:{environment:'preview',supabaseUrl:'https://testfixture.supabase.co',supabasePublishableKey:'sb_publishable_test'}}));
 await page.route('**/api/kamino/**',r=>{const path=new URL(r.request().url()).pathname;actions.push(r.request().postDataJSON());return r.fulfill({json:path.endsWith('/status')?{principal:{configured:true,missing:[]},home:{configured:false,missing:['KAMINO_HOME_APP']}}:{ok:true,probe:true,received:0}});});
 await page.route('https://testfixture.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,b=req.postDataJSON();let data;
  if(path==='/auth/v1/token')data={access_token:'test-session',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user};
  else if(path==='/auth/v1/user')data=user;
  else if(path.endsWith('/fin_my_workspaces'))data=[{tenant_id:tenant,user_id:user.id,role:'admin',active:true,permissions:{},workspace_name:'Grupo teste'}];
  else if(path.endsWith('/fin_companies'))data=[{id:company,tenant_id:tenant,name:'Empresa teste',document:null,version:1,deleted_at:null}];
  else if(path.endsWith('/fin_commitments'))data=entries;
  else if(path.endsWith('/fin_kamino_sources'))data=sources;
  else if(path.endsWith('/fin_kamino_documents'))data=documents;
  else if(path.endsWith('/fin_kamino_review')){data={total:1,linked:0,possible_duplicates:0};if(!b.p_dry_run){writes++;entries.push({id:crypto.randomUUID(),tenant_id:tenant,company_id:b.p_company_id,name:base.description,due_date:base.due_date,amount_cents:base.amount_cents,direction:'saida',category:b.p_category,version:1,deleted_at:null});base.commitment_id=entries[0].id;base.reviewed_fingerprint=base.fingerprint;base.version++;}}
  else if(['/fin_prodio_sources','/fin_prodio_documents','/fin_members','/fin_bank_accounts','/fin_plans','/fin_transactions','/fin_allocations','/fin_import_profiles','/fin_rules'].some(t=>path.endsWith(t)))data=[];
  else throw new Error('Requisição inesperada: '+path);
  await route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:5180');await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('button',{name:'Kamino',exact:true}).click();await expect(page.getByRole('heading',{name:'Kamino',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Testar notas de entrada',exact:true}).click();await expect(page.getByText(/Leitura validada/)).toBeVisible();expect(actions.at(-1)).toMatchObject({tenantId:tenant,slot:'principal',kind:'notas'});
 await expect(page.getByRole('checkbox',{name:'Selecionar título 2',exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Selecionar título 1',exact:true}).check();await page.getByLabel('Empresa titular',{exact:true}).selectOption(company);
 await page.getByRole('button',{name:'Simular inclusão nas previsões',exact:true}).click();expect(writes).toBe(0);await expect(page.getByRole('button',{name:'Confirmar títulos nas previsões',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:/Conferi a empresa/}).check();await page.getByRole('button',{name:'Confirmar títulos nas previsões',exact:true}).click();await expect(page.getByText('Vinculado à previsão',{exact:false})).toBeVisible();expect(writes).toBe(1);
 await page.getByLabel('Documentos',{exact:true}).selectOption('notas');await expect(page.getByRole('cell',{name:'NF-e 100',exact:false})).toBeVisible();await expect(page.getByText('Documento de consulta',{exact:false})).toBeVisible();expect(entries).toHaveLength(1);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);console.log('Kamino no navegador: estado, teste de conexão, separação de títulos pagos/notas, revisão explícita, prévia, previsão sem duplicar nota e mobile aprovados (API simulada).');
}finally{await browser?.close();server.kill();}
