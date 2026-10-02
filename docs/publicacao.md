# Publicação da F1

## Destino e corte

Produção reutiliza o Supabase `https://dheunohtkgvgqzwsauqt.supabase.co` e o Pages `eddias-financeiro`, já associado a `financeiro.eddias.com.br`. Não precisa alterar o CNAME. O Worker novo chama-se `eddias-financeiro-v2`; o antigo pode permanecer até validar a troca. Nunca alterar recursos do Prodio ou Suprimentos.

A produção recebe somente `main`. O usuário optou por ambiente único; não criar outro projeto Supabase. `f1-fundacao` é uma branch de trabalho, sem publicação de preview. Os testes usam dados sintéticos e PostgreSQL local descartável.

## Ações de configuração

1. No GitHub do repositório, use somente o environment `financeiro-producao`. Nele, cadastre os nomes abaixo. Não cole segredos no chat ou em arquivos versionados.
2. Para produção, use o projeto Supabase atual. `BANCO_URL` vem de **Connect → Session pooler**: URI PostgreSQL, porta 5432, com senha do banco codificada na URL. A chave publishable não concede permissão de criar tabelas. O cliente usa TLS com verificação do certificado.
3. A chave `SUPABASE_SERVICE_ROLE_KEY` vem de **Project Settings → API keys → Legacy API Keys → service_role**. Ela permite ao Worker gerar snapshots; nunca deve ir ao frontend. Não é o personal access token da conta Supabase.
4. A configuração de publicação está preparada em `docs/publicar.yml.txt`, para instalação em `.github/workflows/publicar.yml`. O texto de referência dizia que seu token não possuía escopo workflow; essa restrição não foi comprovada na conexão atual. Só será necessário copiar manualmente se o acesso disponível impedir a instalação automática.

| Tipo no GitHub Environment | Nome | Uso |
| --- | --- | --- |
| Secret | `BANCO_URL` | Migrar e exportar backup do projeto correspondente |
| Secret | `BACKUP_SENHA` | Senha longa, exclusiva, mínimo 20 caracteres; guardar em gerenciador de senhas |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Backup no Worker |
| Secret | `CLOUDFLARE_API_TOKEN` | Publicar Workers, Pages e configurar bindings/segredos na conta atual |
| Variable | `SUPABASE_URL` | URL do projeto do ambiente |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | Chave pública do mesmo projeto |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | `ea141e4ed31edb24f33c2066b0e770de` |

Os segredos de rede deste ambiente Codex são usados pelo proxy nas chamadas autorizadas. Não copiar placeholders para GitHub ou Worker. A configuração do GitHub é independente da configuração do ambiente Codex. O token Cloudflare precisa de permissões de Workers Scripts e Pages na conta correta.

## Sequência automática

Testes e build → validar destino → simular pendentes → backup de `public` e `financeiro_admin`, cifrado AES256 → conferir decifragem → guardar artefato cifrado por 30 dias → ensaiar migrações sobre estrutura real em banco local vazio → aplicar pendentes em transações → publicar Worker → configurar suas chaves → publicar Pages.

O backup externo inclui todo o schema `public` desse projeto, inclusive o protótipo. Não inclui `auth` e schemas internos gerenciados do Supabase. Guardar a senha fora do GitHub é necessário para recuperar artefatos no futuro. Snapshots do Worker mantêm 20 versões no mesmo banco e não substituem esse backup externo.

Falhou qualquer etapa: não executar as seguintes. Se a publicação falhar depois das migrações, elas já podem estar aplicadas. Elas são aditivas; o protótipo continua funcionando. Corrigir e repetir o pipeline preserva o registro de hashes e aplica apenas pendentes.

## SQL e primeiro administrador

O caminho recomendado é o aplicador, que registra os hashes. Para revisão, `supabase/consolidado.sql` contém os mesmos arquivos em uma transação. Ele termina com `commit;`; a versão truncada não deve ser executada. É um arquivo gerado, nunca editar diretamente.

No banco atual, a migração copia administradores ativos de `eddias_financeiro_members` para o novo grupo, sem mudar o Auth. Em projeto novo, depois de criar o usuário no Supabase Authentication, execute no SQL Editor (troque apenas o e-mail):

```sql
insert into public.fin_memberships (tenant_id, user_id, role)
select 'edd1a500-0000-4000-8000-000000000001', id, 'admin'
from auth.users where lower(email) = lower('SEU_EMAIL_AQUI')
on conflict (tenant_id, user_id) do nothing;
```

Verifique que exatamente o usuário esperado existe; uma lista vazia não cria nem remove cadastros. Os demais acessos são configurados pela interface da F1. Os testes automatizados usam empresas/contas sintéticas apenas localmente. Após publicar, validar login e backup no site; cadastros de produção devem corresponder à operação real.

## Volta à versão anterior

Antes do corte, registre o deployment atual em Cloudflare Pages. Se houver falha funcional, use o rollback desse deployment no painel Pages. Não apague o schema novo nem restaure o dump por cima do banco ativo. A restauração deve ocorrer primeiro em projeto isolado, com revisão das diferenças; o backup não autoriza sobrescrever dados atuais.

## Publicar mudanças do código

Depois dos testes e da configuração:

```bash
pnpm check && pnpm test:browser && pnpm worker:dry-run && git add . && git commit -m "Cria fundação do novo financeiro com empresas e contas bancárias" && git push -u origin f1-fundacao
```

Aguarde a conclusão do workflow e mais 1–2 minutos para propagação do Pages; atualize o navegador. A branch `f1-fundacao` não publica. O merge em `main` faz o corte de produção. Sem instalar o workflow, o push sozinho não publica.
