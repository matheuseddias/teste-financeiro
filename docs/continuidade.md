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

## Evidências atualizadas do Prodio

Referência remota consultada em 01/10/2026: commit `eb9f245`. A cópia local anterior (`a8148ac`) não representava mais o código atual.

- `apps/worker/src/conectores/baselinkerEntrega.ts` lê `order_source`, `order_source_id` e `order_source_info`, normalizando `origem` e `origemNome`.
- `apps/worker/src/jobs/syncPedidos.ts` envia esses campos para persistência.
- `supabase/migrations/20260928001200_canais_e_mix.sql` adiciona `orders.origem` / `orders.origem_nome` e atualiza a gravação dos pedidos.
- Isso comprova capacidade no código; ainda não comprova aplicação da migração nem cobertura do histórico no banco real. Pedidos sem origem devem permanecer identificados como tal.
- O total do pedido normalizado inclui produtos e frete. Não confundir esse total com o valor líquido que chega ao banco.
- Existe conector Kamino de NF-e no código atual. A disponibilidade e as permissões da conexão real ainda precisam ser verificadas.

## Integração Kamino

Documentação autenticada consultada; senha da documentação não é credencial de API. Não guardar senhas, cookies, chaves ou respostas financeiras neste documento ou no Git.

API exige URL específica da empresa e cabeçalhos App, CN, IDUsr, Usr e Hash. Configuração orientada para o environment `financeiro-producao`: `KAMINO_API_BASE`, `KAMINO_APP`, `KAMINO_CN`, `KAMINO_IDUSR`, `KAMINO_USR`, `KAMINO_HASH`. Se houver conexão separada da Home, usar prefixo `KAMINO_HOME_`. Esta orientação ainda precisa ser implementada no deploy da F4; não representa chaves já disponíveis.

Consultas documentadas: `/api/financeiro/pagamento/lista/paginada`, `/api/notafiscal/entrada/lista`, `/api/financeiro/unidadenegocio/lista`, `/api/financeiro/contabanco/lista` e `/api/financeiro/movimentoFinanceiro/lista`.

Limite documentado de 20 requisições/minuto por cliente (CN), compartilhado com outras integrações. Validar uma consulta antes de iniciar lotes; parar no primeiro erro e respeitar os cabeçalhos de limite. Exportação de movimentação financeira não foi comprovada como equivalente ao extrato da conta digital. XLSX/OFX continuam necessários.

## Critérios financeiros e pendências operacionais

- Conversão histórica precisa considerar o prazo entre a venda e o repasse; dividir simplesmente os depósitos pelo GMV do mesmo mês distorce a previsão.
- Repasses relativos a vendas anteriores ao início do histórico ou sem período identificável precisam de indicação de cobertura incompleta, sem associação inventada.
- Transferências próprias, empréstimos e aportes não compõem conversão de GMV em receita líquida de caixa. Taxas já retidas no repasse não podem ser subtraídas novamente da projeção líquida.
- Uma obrigação representada por compra, NF-e e conta a pagar deve ser vinculada entre fontes, sem triplicar saídas previstas.
- Saldo/data de referência são necessários para projeção de saldo absoluto; sem eles, mostrar movimentação e a pendência do saldo inicial.
- Credenciais e permissões reais da Kamino ainda não foram validadas. Acesso de leitura real ao Prodio e cobertura do histórico também permanecem pendentes.
- Não foi recebido OFX real; testes com exemplos sintéticos não substituem validação do arquivo do banco utilizado.
- Migrações já publicadas são imutáveis. Cada fase acrescenta migrações, executa testes, backup cifrado e ensaio antes da publicação.
