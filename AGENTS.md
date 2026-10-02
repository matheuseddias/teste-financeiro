# Eddias Financeiro

- Falar e escrever a interface, documentação e commits em português.
- Use o checkout existente. Não criar worktrees sem solicitação.
- A reconstrução segue o Prodio; Suprimentos é só referência histórica.
- Entregar uma fase por vez. F1: fundação, empresas e contas. Não implementar integrações/conciliador/projeções sem avançar o escopo com o usuário.
- A produção reutiliza o Supabase dheunohtkgvgqzwsauqt e financeiro.eddias.com.br. O usuário optou por ambiente único: não exigir projeto Supabase de testes nem publicar preview; não inferir autorização para apagar tabelas antigas.
- Nunca editar SQL já aplicado. Simular, fazer backup cifrado e ensaiar antes de migrar. Lista vazia nunca implica exclusão.
- Código modular, até 400 linhas por arquivo de código. Dinheiro em centavos inteiros.
- Não registrar segredos, extratos ou dados pessoais no Git, logs ou screenshots públicas.
- RLS e permissões no banco são obrigatórias; interface não é controle de segurança.
- O template de Actions fica em docs/publicar.yml.txt. O usuário questionou a necessidade de instalação manual: não presumir falta de permissão workflow a partir do texto de referência; distinguir leitura Git de permissão de publicar workflows.
- Verificação: pnpm check && pnpm test:browser && pnpm worker:dry-run. No ambiente gerenciado use scripts/cloud-check.sh para os diretórios graváveis.
- Reportar ENTREGUE / PENDENTE / BLOQUEADA, ações necessárias e comando de commit/push ao terminar uma fase. Nunca afirmar publicação ou validação remota baseada só em testes locais.
