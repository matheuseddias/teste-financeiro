import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const JSZip = createRequire(new URL('../apps/web/package.json', import.meta.url))('jszip');
const { Workbook } = createRequire(new URL('../apps/web/package.json', import.meta.url))('exceljs');
const server = spawn('node', ['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts','--host','127.0.0.1','--port','5178'], { stdio:'pipe' });
let browser;
try {
 for (let i=0;i<40;i++) { try { if((await fetch('http://127.0.0.1:5178')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage(); page.setDefaultTimeout(10000); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const tenant='edd1a500-0000-4000-8000-000000000001', account='55555555-5555-4555-8555-555555555555', company='44444444-4444-4444-8444-000000000001';
 const user={id:'11111111-1111-4111-8111-111111111111',email:'admin@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-01'};
 const transactions=[],allocations=[],profiles=[],rules=[];
 const commitment={id:'88888888-8888-4888-8888-888888888888',tenant_id:tenant,company_id:company,name:'Fornecedor previsto',due_date:'2026-10-10',amount_cents:60000,direction:'saida',category:'fornecedores',version:1,deleted_at:null};
 let writes=0;
 await page.route('**/api/config',r=>r.fulfill({json:{environment:'preview',supabaseUrl:'https://testfixture.supabase.co',supabasePublishableKey:'sb_publishable_test'}}));
 await page.route('https://testfixture.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,b=req.postDataJSON();let data;
  if(path==='/auth/v1/token')data={access_token:'test-session',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user};
  else if(path==='/auth/v1/user')data=user;
  else if(path.endsWith('/fin_my_workspaces'))data=[{tenant_id:tenant,user_id:user.id,role:'admin',active:true,permissions:{},workspace_name:'Grupo teste'}];
  else if(path.endsWith('/fin_members')||path.endsWith('/fin_plans'))data=[];
  else if(path.endsWith('/fin_companies'))data=[{id:company,tenant_id:tenant,name:'Empresa teste',document:null,version:1,deleted_at:null}];
  else if(path.endsWith('/fin_bank_accounts'))data=[{id:account,tenant_id:tenant,company_id:company,name:'Conta teste',bank_name:'Banco teste',bank_code:'001',branch:'',account_number:'0001',kind:'corrente',currency:'BRL',reference_date:null,reference_balance_cents:null,version:1,deleted_at:null}];
  else if(path.endsWith('/fin_commitments'))data=[commitment];
  else if(path.endsWith('/fin_rules'))data=rules;
  else if(path.endsWith('/fin_transactions'))data=transactions;
  else if(path.endsWith('/fin_allocations'))data=allocations;
  else if(path.endsWith('/fin_import_profiles'))data=profiles;
  else if(path.endsWith('/fin_import_transactions')){
   const existing=new Set(transactions.map(t=>t.source_key));const fresh=b.p_rows.filter(r=>!existing.has(r.source_key));
   data={total:b.p_rows.length,new:fresh.length,duplicates:b.p_rows.length-fresh.length,possible_duplicates:0,dry_run:b.p_dry_run};
   if(!b.p_dry_run){writes++;transactions.push(...fresh.map(r=>({...r,id:crypto.randomUUID(),tenant_id:tenant,account_id:account,classification:'pendente',category:null,channel:null,version:1,deleted_at:null})));}
  }
  else if(path.endsWith('/fin_approve_rule')){rules.push({id:b.p_id,tenant_id:tenant,account_id:account,description_key:'repasse aprendido',direction:1,classification:'repasse',category:null,channel:'Canal teste',example_ids:b.p_examples,active:true,version:1,deleted_at:null});data=null;}
  else if(path.endsWith('/fin_apply_rules')){const selected=transactions.filter(t=>b.p_ids.includes(t.id)&&t.classification==='pendente');data={affected:selected.length};if(!b.p_dry_run)selected.forEach(t=>Object.assign(t,{classification:'repasse',channel:'Canal teste',rule_id:rules[0].id,version:t.version+1}));}
  else if(path.endsWith('/fin_save_import_profile')){profiles.push({id:b.p_id,account_id:account,tenant_id:tenant,name:b.p_name,config:b.p_config,version:1,deleted_at:null});data=null;}
  else if(path.endsWith('/fin_reconcile')){allocations.push({id:b.p_id,tenant_id:tenant,transaction_id:b.p_transaction_id,commitment_id:b.p_commitment_id,amount_cents:b.p_amount_cents,deleted_at:null});const t=transactions.find(t=>t.id===b.p_transaction_id);t.version++;t.classification='operacional';t.category='fornecedores';data=null;}
  else throw new Error('Requisição inesperada: '+path);
  await route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:5178');await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('button',{name:'Extratos e conciliação',exact:true}).click();
 const csv=Buffer.from('Data;Descrição;Valor\n10/10/2026;Pagamento fornecedor;-400,00\n11/10/2026;Repasse teste;1.000,00');
 async function csvPreview(){await page.getByRole('button',{name:'Importar extrato',exact:true}).click();await page.getByLabel('Conta do extrato',{exact:true}).selectOption(account);await page.getByLabel('Arquivo XLSX, CSV ou OFX',{exact:true}).setInputFiles({name:'extrato.csv',mimeType:'text/csv',buffer:csv});await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();await page.getByRole('button',{name:'Verificar importação',exact:true}).click();}
 await csvPreview();expect(writes).toBe(0);await expect(page.getByText(/2 novos · 0 já existentes/)).toBeVisible();
 await page.getByRole('checkbox',{name:/Conferi a conta/}).check();await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();
 await expect(page.getByRole('button',{name:'Conciliar',exact:true})).toHaveCount(2);expect(writes).toBe(1);
 await csvPreview();await expect(page.getByText(/0 novos · 2 já existentes/)).toBeVisible();await page.getByRole('button',{name:'Fechar importação',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:'Pagamento fornecedor'});await row.getByRole('button',{name:'Conciliar',exact:true}).click();
 await page.getByLabel('Previsão a vincular',{exact:true}).selectOption(commitment.id);await expect(page.getByLabel('Valor a conciliar (R$)',{exact:true})).toHaveValue('400,00');
 await page.getByRole('button',{name:'Confirmar conciliação',exact:true}).click();await expect(page.getByText(/Disponível para vincular: R\$\s*0,00/)).toBeVisible();expect(allocations[0].amount_cents).toBe(40000);
 await page.getByRole('button',{name:'Fechar',exact:true}).click();
 await page.getByRole('button',{name:'Importar extrato',exact:true}).click();await page.getByLabel('Conta do extrato',{exact:true}).selectOption(account);
 const workbook=new Workbook();const sheet=workbook.addWorksheet('Lançamentos');sheet.addRow(['Data','Descrição','Valor']);sheet.addRow([new Date('2026-10-12T00:00:00Z'),'Fornecedor XLSX',-123.45]);
 await page.getByLabel('Arquivo XLSX, CSV ou OFX',{exact:true}).setInputFiles({name:'extrato.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
 await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();await expect(page.getByRole('cell',{name:'Fornecedor XLSX',exact:true})).toBeVisible();
 const zip=await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.xml'))){
  const xml=await zip.files[name].async('string');
  if(!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))continue;
  zip.file(name,xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'<$1x:$2'));
 }
 await page.getByLabel('Arquivo XLSX, CSV ou OFX',{exact:true}).setInputFiles({name:'exportador.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await zip.generateAsync({type:'nodebuffer'})});
 await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();await expect(page.getByRole('cell',{name:'Fornecedor XLSX',exact:true})).toBeVisible();
 await page.getByLabel('Nome do perfil',{exact:true}).fill('Formato teste');await page.getByRole('button',{name:'Salvar perfil',exact:true}).click();await expect(page.getByText('Perfil salvo para esta conta.',{exact:true})).toBeVisible();expect(profiles).toHaveLength(1);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 for(let i=1;i<=4;i++)transactions.push({...transactions[1],id:crypto.randomUUID(),description:'Repasse aprendido',source_key:'learn-'+i,posted_date:'2026-10-0'+i,classification:i<4?'repasse':'pendente',channel:i<4?'Canal teste':null});
 await page.reload();await page.getByRole('button',{name:'Abrir menu',exact:true}).click();await page.getByRole('button',{name:'Extratos e conciliação',exact:true}).click();
 await page.getByRole('button',{name:'Regras e sugestões',exact:true}).click();
 await expect(page.getByRole('button',{name:'Aprovar regra',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:/Revisei os exemplos/}).check();await page.getByRole('button',{name:'Aprovar regra',exact:true}).click();
 await expect(page.getByText('Nenhum padrão consistente disponível.',{exact:false})).toBeVisible();expect(rules).toHaveLength(1);
 await page.getByRole('button',{name:'Simular aplicação',exact:true}).click();await expect(page.getByText(/Simulação: 1 classificações/)).toBeVisible();
 expect(transactions.at(-1).classification).toBe('pendente');
 await page.getByRole('button',{name:'Confirmar classificações',exact:true}).click();await expect(page.getByText('1 movimentos classificados.',{exact:true})).toBeVisible();expect(transactions.at(-1).rule_id).toBe(rules[0].id);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);console.log('Extratos no navegador: CSV, XLSX real, prévia sem escrita, confirmação, deduplicação, alocação parcial, perfil, regras aprovadas e mobile aprovados (API simulada).');
} finally {await browser?.close();server.kill();}
