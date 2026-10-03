# Kamino — integração de leitura

## Configuração e uso

As seis credenciais foram confirmadas pelo usuário e o diagnóstico real `37090289661` passou para contas a pagar e lista de notas de entrada. Os valores permanecem no GitHub environment `financeiro-producao` e nos secrets do Worker. Não são enviados ao navegador, gravados nas tabelas nem incluídos em logs. O diagnóstico de notas do dia retornou lista vazia; posteriormente a carga histórica validou o mapeamento e persistiu 11 notas reais no primeiro lote.

Conexão principal: `KAMINO_API_BASE`, `KAMINO_APP`, `KAMINO_CN`, `KAMINO_IDUSR`, `KAMINO_USR`, `KAMINO_HASH`. Conexão Home, se necessária, usa o mesmo sufixo com prefixo `KAMINO_HOME_`. Só são aceitos hosts HTTPS em `*.kamino.tech`, sem porta, caminho, credenciais ou redirecionamento. A conexão está restrita ao grupo Financeiro autorizado, não a qualquer tenant que possua um administrador.

1. Abra **Kamino**. A tela informa configuração, última leitura, último ciclo completo e eventual erro de cada fonte.
2. A primeira publicação testa fontes novas, lê um lote e habilita sua leitura automática. Publicações comuns não reativam fontes existentes ou pausadas. A tela também permite testar, ler o próximo lote, ativar e pausar. Para recuperar uma inicialização interrompida pelo Actions, a execução manual de **Publicar Financeiro** oferece `retomar_kamino`: a conexão escolhida é testada novamente, recebe um lote e é reativada explicitamente.
3. Consulte **Contas a pagar**, filtre pela unidade Kamino e selecione os títulos abertos da empresa que será revisada. Títulos pagos e com pagamento parcial informado permanecem visíveis para conferência; não viram nova previsão por esse botão.
4. Escolha a empresa titular e a categoria. **Simular inclusão nas previsões** não grava. Confira o total, possíveis duplicatas e atualizações de previsões já vinculadas. Confirme após a revisão.
5. Havendo previsão manual do mesmo valor/vencimento, selecione um título por vez e vincule o lançamento existente. A revisão bloqueia uma cópia adicional enquanto a possível duplicidade não for resolvida. Empresa não identificada no lançamento manual também participa dessa verificação.
6. Os títulos confirmados aparecem em **Lançamentos previstos**, participam dos cenários e podem ser conciliados com os extratos. As notas ficam como consulta documental; não geram nova saída. O identificador de NF-e informado pelo título é preservado para relacionar as fontes.

## Sincronização e integridade

- Somente GETs de pagamentos e notas. Não cria, altera, cancela, paga, manifesta ciência ou baixa qualquer documento na Kamino.
- Histórico desde **01/09/2026**. Pagamentos filtrados por vencimento, incluindo obrigações futuras; dívidas anteriores a essa data exigem revisão separada. Notas filtradas por emissão. Horários da interface em Brasília.
- Pagamentos: páginas de 100, validação do envelope e da página retornada. Cursor só avança após persistência. Releitura começa novamente na primeira página ao completar o ciclo, capturando alterações sem confiar em um campo de atualização que não foi validado.
- Notas: janelas de até um dia. Lista com 100 ou mais itens reduz a janela e não avança o histórico; se um minuto continuar cheio, pausa com indicação de cobertura incompleta. Limites não documentados menores que 100 ainda precisam ser avaliados no uso real. A releitura completa desde setembro captura notas que chegaram depois da emissão.
- Cron a cada dois minutos processa uma fonte, alternando pela última tentativa. Intervalo mínimo global de um minuto e lease no banco evitam chamadas simultâneas desta aplicação. Outros sistemas que usam o mesmo CN compartilham o limite de 20/min. Um 429 respeita `RateLimit-Reset`; qualquer erro pausa a fonte, preserva o cursor e exige novo teste antes de retomar.
- Identidade: grupo + conexão + tipo + ID da Kamino. Repetição do mesmo conteúdo não duplica nem aumenta a versão do documento. Resposta vazia não arquiva nem remove registros. Cancelamentos/deleções por ausência não são inferidos.
- Somente os campos necessários à consulta financeira são armazenados. PIX, boleto, dados de login, XML e resposta bruta não são persistidos por esta etapa.

## Efeito nas projeções

A leitura automática atualiza a cópia da fonte; **a inclusão ou alteração da previsão exige revisão explícita**. Empresa não é inferida pelo fornecedor ou pelo nome da unidade. Alteração posterior na fonte marca o título para nova conferência. Diferenças de valor, vencimento ou titular em uma previsão já conciliada bloqueiam sua atualização até a revisão dos vínculos.

Uma situação “paga” na Kamino não gera transação bancária e não desfaz conciliações. Títulos que ficaram pagos após inclusão na previsão devem ser conferidos no extrato, para o previsto ser substituído pelo realizado sem inventar caixa. Baixas parciais da fonte não são convertidas automaticamente em parcelas previstas nesta etapa.

Não há correspondência automática por valor entre nota, compra e título, nem alteração automática das premissas de GMV/conversão. A integração Prodio permanece fora desta entrega.

## Validação e publicação

Testes cobrem acesso administrativo antes de leitura privilegiada, não exposição de credenciais, bloqueio de redirecionamento, BRL/centavos, paginação, janela cheia, 429 sem repetição, preservação de cursor, isolamento, simulação, duplicatas, vínculos conciliados, backup e restauração. Navegador usa dados e API simulados para estado, teste de conexão, revisão, confirmação e mobile. Isso não comprova login real do administrador.

Migração nova `20261003000100_kamino.sql`, backup com fontes/documentos, publicação somente após testes/backup cifrado/ensaio. A confirmação de produção exige Actions, inicialização real e health, não apenas build local. Dados financeiros não devem ser inseridos na documentação nem nos logs de diagnóstico.

O workflow manual **Conferir sincronização Kamino** consulta somente estado, cursor e contagens no Supabase; não solicita outra leitura da Kamino nem imprime documentos. Use-o para comprovar o avanço do cron e identificar uma fonte pausada. `last_full_sync_at` ausente significa que a cobertura do primeiro ciclo ainda não foi comprovada.

Publicação confirmada: commit `f79b491`, Actions [37092984999](https://github.com/matheuseddias/teste-financeiro/actions/runs/37092984999) aprovado, health 0.6.0/production. Diagnóstico [37092564170](https://github.com/matheuseddias/teste-financeiro/actions/runs/37092564170), às 00h15 de Brasília em 03/10/2026: 100 títulos e 11 notas persistidos, ambas as fontes ativas/validadas, sem erro, primeiro ciclo completo ainda pendente. Migração aplicada é imutável. Os testes de regressão incluem confirmação HTTP 204 de RPC sem repetição indevida.

Avanço automático confirmado pelo diagnóstico [37093564529](https://github.com/matheuseddias/teste-financeiro/actions/runs/37093564529), às 00h33 de Brasília: 300 títulos/página 4 e 15 notas/04 de setembro, fontes ativas, sem erro. As leituras das 00h31/00h32 ocorreram no cron do Worker após o fim da inicialização. Regressão em workerd confirma a chamada à Kamino e a resposta 204 do banco; a chamada global de fetch usa wrapper para preservar o contexto exigido pelo runtime.
