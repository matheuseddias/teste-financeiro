# Eddias Financeiro

Reconstrução para substituir a manutenção de planilhas: planejar caixa a partir do GMV, estimar quanto efetivamente chega às contas e comparar projetado com realizado conciliado.

O sistema inclui cadastros e acesso, projeções e cenários, lançamentos previstos, importação de extratos, conciliação, regras de classificação aprovadas e integração de leitura Kamino. A versão 0.7 prepara a API Prodio e a análise histórica GMV × repasses; a leitura real do Prodio depende do token e da publicação das rotas E2. Estado e evidências em [docs/continuidade.md](docs/continuidade.md), ativação em [docs/prodio.md](docs/prodio.md) e publicação em [docs/publicacao.md](docs/publicacao.md).

## Estrutura

- `apps/web`: React + TypeScript, interface e gateway Pages.
- `apps/worker`: API privada, configuração e backup agendado.
- `packages/core`: regras independentes e tipos.
- `supabase/migrations`: SQL versionado; prefixo `fin_`.
- `supabase/migracoes`: aplicador, backup cifrado e ensaio, adaptados do Prodio.
- `.github/workflows/publicar.yml`: publicação automática em produção; cópia de referência em `docs/publicar.yml.txt`.

## Desenvolvimento

Node 24, pnpm 11.19.0, Docker local para os testes PostgreSQL e Chromium para o teste de interface.

```bash
pnpm install --frozen-lockfile
pnpm check && pnpm test:browser && pnpm worker:dry-run
pnpm dev
```

O teste de navegador usa dados sintéticos e uma API simulada; não precisa de chaves. Chromium em `/usr/bin/chromium`, ou defina `CHROMIUM_PATH`. `pnpm db:test` inicia e remove um PostgreSQL 17 sem rede, verifica RLS e restaura um backup local. Precisa de Docker, Node, Bash e GPG. Arquivos de validação ficam em `.data/validation`, ignorados pelo Git.

`pnpm dev` abre o frontend; sem `/api/config` ele informa que o ambiente precisa de configuração. Os testes locais usam PostgreSQL descartável e dados sintéticos. Por decisão do usuário, há apenas um Supabase remoto; não publicar previews ligados a esse banco.

Neste ambiente gerenciado, os diretórios padrão de pnpm não são graváveis. Execute `bash scripts/cloud-check.sh` para instalar dependências e verificar o projeto com caches em `/workspace`. Preserve o proxy e os certificados configurados pela plataforma.

## Banco e publicação

Não editar migração aplicada. `BANCO_URL` deve apontar para o Session pooler, porta 5432. Primeiro simular, gerar backup cifrado e ensaiar; depois aplicar. O pipeline descrito em `docs/publicacao.md` faz essa sequência antes de publicar Worker e Pages. A publishable key é pública; a service role e a conexão do banco ficam somente no backend/CI.

O projeto Supabase de produção continua sendo `dheunohtkgvgqzwsauqt`. O usuário optou por ambiente único, sem preview publicado. Usuários do Supabase Auth são preservados, e administradores ativos do protótipo são aproveitados na migração. O novo esquema não apaga tabelas antigas.
