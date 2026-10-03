# Continuidade F2–F6

## Decisões confirmadas em 01/10/2026

- F1 publicada no Supabase atual e em financeiro.eddias.com.br; sem preview remoto.
- Usuário autorizou criar e publicar uma integração de leitura no Prodio para vendas, compras e NF-e, restrita ao grupo Eddias. Não alterar pedidos, estoque ou pagamentos.
- Prodio organiza produção e compras por produtos, sem exigir divisão das vendas por CNPJ.
- Histórico inicial a partir de 01/09/2026, considerando o calendário de Brasília.
- Vendas e origem/canal vêm da Base ou do banco do Prodio. Repasses efetivos são identificados nos extratos durante a conciliação.
- Sem empresa identificada de forma confiável, GMV e conversão em caixa ficam no consolidado do grupo, por canal. Não distribuir GMV arbitrariamente entre empresas.
- Saldos, movimentos e pagamentos pertencem à empresa da conta bancária correspondente. A relação conta/empresa deve ser cadastrada, não inferida do nome de uma aba.
- Categorias, custos fixos, impostos e premissas das planilhas podem iniciar como rascunhos editáveis, sujeitos à revisão. Não são movimentos bancários confirmados.
- Aprendizagem da conciliação gera sugestões de regras; administrador aprova antes de execução automática.

## Sequência e critérios de pronto

| Fase | Entrega | Critério de pronto |
| --- | --- | --- |
| F1 | Fundação, empresas, contas, acesso e auditoria | Publicada; validações remotas técnicas aprovadas. Login real do administrador ainda não exercitado por esta sessão. |
| F2 | Categorias, lançamentos previstos, compromissos e recorrências | CRUD com permissões, valores em centavos, versões, auditoria e datas; rascunho não vira realizado. |
| F3 | Importação e conciliação | XLSX com mapeamento, prévia e perfil; OFX SGML/XML; deduplicação; vínculos parciais e múltiplos; transferências próprias; saldo reconciliável sem duplicar previsão e realizado. |
| F4 | Integrações de leitura | Prodio: vendas, canais e compras/NF-e. Kamino: contas a pagar e NF-e. Primeira consulta real validada; paginação, cursor, identificação da fonte e estado de sincronização. |
| F5 | Projeções e cenários | GMV projetado por canal, conversão em dinheiro, prazo de repasse, obrigações conhecidas, compras estimadas e custos; comparação projetado × realizado e hipóteses editáveis. |
| F6 | Aprendizagem, automação e validação integrada | Sugestões baseadas em confirmações; aprovação administrativa e rastreabilidade; rotinas idempotentes; fluxo completo validado e limitações registradas. |

## Publicação confirmada em 02/10/2026

| Versão | Commit | GitHub Actions | Entrega |
| --- | --- | --- | --- |
| 0.3 | `0e6c5ab` | [37072852604](https://github.com/matheuseddias/teste-financeiro/actions/runs/37072852604) | Projeções e lançamentos previstos |
| 0.4 | `0d74fe1` | [37075910059](https://github.com/matheuseddias/teste-financeiro/actions/runs/37075910059) | Extratos, conciliação e comparação com realizado |
| 0.5 | `1678938` | [37076898055](https://github.com/matheuseddias/teste-financeiro/actions/runs/37076898055) | Regras de classificação aprendidas e aprovadas |

As três execuções concluíram testes, backup cifrado externo, ensaio, migração e publicação. HTTPS remoto da 0.5: site e assets 200, health 0.5.0/production, regras anônimas 401 e backup sem sessão 401. Migrações 1–6 aplicadas e imutáveis. Login real do administrador não foi exercitado.

Validação local da 0.5: 29 testes Vitest, 17 da trava SQL, PostgreSQL real, backup/restauração/reaplicação, workerd e navegador com API simulada, inclusive bundle de produção. O XLSX real Kamino foi somente lido em memória; nenhuma movimentação dele foi gravada em produção.

O usuário confirmou as seis credenciais Kamino em `financeiro-producao`; a execução de diagnóstico `37090289661` comprovou acesso real às duas APIs. A consulta de notas do dia estava vazia. Após a etapa Kamino, o usuário pediu continuidade e confirmou **Eddias** como nome no Prodio. Integração Prodio ainda em preparação, sem alterações publicadas nesta etapa. Conversão histórica automática e conciliação automática com obrigações permanecem pendentes; as premissas de projeção seguem manuais.

## Kamino 0.6 publicada em 03/10/2026

Implementação `f3c2595`, correções `19ceff8`/`f79b491`, [Actions 37092984999](https://github.com/matheuseddias/teste-financeiro/actions/runs/37092984999) concluído com sucesso: testes, backup cifrado, ensaio, publicação e inicialização real. Migração 7 `20261003000100_kamino.sql` aplicada e imutável. A tentativa anterior publicou a aplicação, mas interrompeu a inicialização; o tratamento de HTTP 204 do Supabase foi corrigido e testado antes da retomada.

Às 00h15 de Brasília, o diagnóstico [37092564170](https://github.com/matheuseddias/teste-financeiro/actions/runs/37092564170) confirmou 100 títulos e 11 notas reais persistidos, fontes principal/pagamentos e principal/notas habilitadas/validadas, sem erro. Pagamentos seguiram para página 2 e notas para 02/09. Primeiro ciclo completo ainda pendente; não afirmar que todo o histórico foi carregado.

HTTPS: site/assets 200, health 0.6.0/production, Kamino sem sessão 401, fontes/documentos anônimos 401. Seis bindings Kamino e crons diário de backup + leitura a cada dois minutos confirmados por nomes/tipos. Login real do administrador ainda não exercitado.

Validação: 36 Vitest + 17 de trava SQL; PostgreSQL/RLS/revisão/duplicatas/conciliações preservadas/backup/restauração; workerd; três suítes de navegador com API simulada. O mapeamento de NF-e foi confirmado por notas reais na carga inicial, além dos testes sintéticos. Consulte [kamino.md](kamino.md).

A revisão de títulos abertos por empresa/categoria inclui ou atualiza as previsões; NF-e não gera uma segunda saída e status pago não inventa realizado bancário. Leitura automática não altera sozinha as previsões já revisadas. Prodio, conversão histórica GMV/caixa e vínculos financeiros automáticos continuam pendentes. O usuário confirmou depois o nome Eddias no Prodio e pediu continuidade durante a noite.

O diagnóstico [37093564529](https://github.com/matheuseddias/teste-financeiro/actions/runs/37093564529), às 00h33 de Brasília, confirmou **execuções automáticas reais após o deploy**, com avanço para 300 títulos/página 4 e 15 notas/04 de setembro; ambas as fontes ativas e sem erro. A chamada de fetch com contexto incorreto no Workers foi reproduzida no workerd, corrigida e coberta por regressão. Primeiro ciclo completo continua em processamento.

## Prodio e histórico 0.7 — publicados em 03/10/2026

O usuário forneceu o contrato público v1 antecipado e informou que entregará o token amanhã. A ideia anterior de ponte privada foi abandonada antes de alterar código Prodio. Referência Prodio segue limpa em `e7c5a47`; somente o Financeiro foi implementado.

Cliente somente GET, identidade da empresa fixada após `/eu`, quatro escopos de leitura, cursor opaco, carga incremental com sobreposição, limite/lease global, backoff e pausa. Tela Prodio permite consultar estado e documentos, testar e controlar leitura. OC/NF permanecem referências; títulos Kamino revisados alimentam previsões sem duplicar saída. Canal opcional ainda não confirmado no contrato; ausência permanece explícita.

Projeções agora incluem histórico GMV × repasses por janela deslocada pelo prazo informado. Após primeiro ciclo completo, janela encerrada e revisão explícita, cria cenário novo editável com taxa histórica estimada, GMV-base repetido e custos opcionais de referência. Não atribui cada depósito a pedidos nem modifica cenários existentes. Sem token e extratos conferidos, a análise real continua pendente.

Validação local: 48 testes Vitest + 17 de trava SQL; PostgreSQL real com RLS, versão, lease, idempotência, empresa fixada, atualização fora de ordem, backoff e lista vazia; backup/restauração/ensaio/reaplicação; workerd real com respostas externas simuladas. Quatro suítes de navegador passaram com API simulada, incluindo ausência de token, histórico parcial bloqueado, taxa de 80%, confirmação e criação de cenário. Os mocks das telas existentes foram atualizados para as duas novas tabelas. Nenhum dado de teste foi enviado à produção.

Ativação amanhã: secret `PRODIO_API_TOKEN` em GitHub `financeiro-producao`, token da empresa Eddias com pedidos:ler, compras:ler, notas:ler e custos:ler; executar Publicar Financeiro. A API deve disponibilizar as rotas E2. Detalhes em [prodio.md](prodio.md). Publicação confirmada: commit `41c0638`, [Actions 37095659839](https://github.com/matheuseddias/teste-financeiro/actions/runs/37095659839) concluído com sucesso. Backup cifrado guardado, ensaio e migração 8 aplicados; migrações 1–8 agora imutáveis. HTTPS remoto: health 0.7.0/production, site e assets 200, rotas sem sessão e tabelas Prodio anônimas 401. Três crons confirmados; token Prodio ausente no Worker e inicialização corretamente encerrada sem consulta externa. Seis bindings Kamino preservados. Login real e leitura Prodio real continuam pendentes.

## Evidências atualizadas do Prodio

Entrega 0.3: projeções e lançamentos previstos publicados no commit `0e6c5ab`, execução `37072852604` aprovada. Entrega 0.4: importação XLSX/CSV/OFX, perfis, prévia/deduplicação, conciliação parcial/múltipla e atualização do fluxo por realizado. Consulte [extratos.md](extratos.md) e [projecoes.md](projecoes.md) para limitações; a publicação de cada revisão deve ser confirmada no Actions e em `/api/health`. A parte Prodio da F4 segue pendente. A versão 0.5 entrega a primeira automação da F6: sugestões consistentes, aprovação e regras de classificação. Vínculos financeiros automáticos e validação integrada com fontes externas permanecem pendentes. Não interpretar as premissas manuais de conversão como aprendizado histórico.

Referência atualizada em 03/10/2026 por fast-forward preservando checkout limpo: commit `e7c5a47`. O usuário confirmou o nome **Eddias**; resolver sua identidade real com escopo restrito antes de consumir dados. Não inferir o ID de produção pelo seed.

- `apps/worker/src/conectores/baselinkerEntrega.ts` lê `order_source`, `order_source_id` e `order_source_info`, normalizando `origem` e `origemNome`.
- `apps/worker/src/jobs/syncPedidos.ts` envia esses campos para persistência.
- `supabase/migrations/20260928001200_canais_e_mix.sql` adiciona `orders.origem` / `orders.origem_nome` e atualiza a gravação dos pedidos.
- Isso comprova capacidade no código; ainda não comprova aplicação da migração nem cobertura do histórico no banco real. Pedidos sem origem devem permanecer identificados como tal.
- O total do pedido normalizado inclui produtos e frete. Não confundir esse total com o valor líquido que chega ao banco.
- Existe conector Kamino de NF-e no código atual. A disponibilidade e as permissões da conexão real ainda precisam ser verificadas.

## Integração Kamino

Documentação autenticada consultada; senha da documentação não é credencial de API. Não guardar senhas, cookies, chaves ou respostas financeiras neste documento ou no Git.

API exige URL específica da empresa e cabeçalhos App, CN, IDUsr, Usr e Hash. Configuração orientada para o environment `financeiro-producao`: `KAMINO_API_BASE`, `KAMINO_APP`, `KAMINO_CN`, `KAMINO_IDUSR`, `KAMINO_USR`, `KAMINO_HASH`. Se houver conexão separada da Home, usar prefixo `KAMINO_HOME_`. O deploy 0.6 envia os conjuntos completos aos secrets do Worker. Não copiar credenciais para o navegador ou para o ambiente local. O usuário confirmou o conjunto principal; Home é opcional.

Consultas documentadas: `/api/financeiro/pagamento/lista/paginada`, `/api/notafiscal/entrada/lista`, `/api/financeiro/unidadenegocio/lista`, `/api/financeiro/contabanco/lista` e `/api/financeiro/movimentoFinanceiro/lista`.

Limite documentado de 20 requisições/minuto por cliente (CN), compartilhado com outras integrações. Validar uma consulta antes de iniciar lotes; parar no primeiro erro e respeitar os cabeçalhos de limite. Exportação de movimentação financeira não foi comprovada como equivalente ao extrato da conta digital. XLSX/OFX continuam necessários.

## Critérios financeiros e pendências operacionais

- Conversão histórica precisa considerar o prazo entre a venda e o repasse; dividir simplesmente os depósitos pelo GMV do mesmo mês distorce a previsão.
- Repasses relativos a vendas anteriores ao início do histórico ou sem período identificável precisam de indicação de cobertura incompleta, sem associação inventada.
- Transferências próprias, empréstimos e aportes não compõem conversão de GMV em receita líquida de caixa. Taxas já retidas no repasse não podem ser subtraídas novamente da projeção líquida.
- Uma obrigação representada por compra, NF-e e conta a pagar deve ser vinculada entre fontes, sem triplicar saídas previstas.
- Saldo/data de referência são necessários para projeção de saldo absoluto; sem eles, mostrar movimentação e a pendência do saldo inicial.
- Credenciais Kamino e acesso às duas listas foram validados. Cobertura histórica depende da conclusão dos ciclos de sincronização. Acesso de leitura real ao Prodio permanece pendente.
- Não foi recebido OFX real; testes com exemplos sintéticos não substituem validação do arquivo do banco utilizado.
- Migrações já publicadas são imutáveis. Cada fase acrescenta migrações, executa testes, backup cifrado e ensaio antes da publicação.

Último diagnóstico Kamino antes desta publicação: [37095569974](https://github.com/matheuseddias/teste-financeiro/actions/runs/37095569974), 01h09 de Brasília, fontes ativas/validadas sem erro, 1.200 títulos/página 13 e 30 notas/janela de 13 de setembro. Cobertura inicial ainda em andamento.

Diagnóstico após deploy: [37095800821](https://github.com/matheuseddias/teste-financeiro/actions/runs/37095800821), 01h13 de Brasília, Kamino preservada ativa/validada e sem erro, com 1.300 títulos/página 14 e 32 notas/janela de 14 de setembro. A leitura de notas ocorreu depois da publicação. Primeiros ciclos ainda incompletos.
