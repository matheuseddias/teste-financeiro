# Prodio — integração de leitura e histórico de conversão

Implementação Financeiro 0.7 baseada no contrato fornecido pelo usuário, `contrato-v1.md`, versão **1.0-rascunho de 03/10/2026**. A API ainda precisa ser validada com o token real. O contrato antecipa entregas: pedidos, ordens de compra e notas dependem da **E2**; o token sozinho não garante que essas rotas estejam publicadas.

## Ativar quando o token estiver disponível

1. No Prodio, empresa **Eddias**, criar um token exclusivo para o Financeiro com `pedidos:ler`, `compras:ler`, `notas:ler` e `custos:ler`. Não precisa de escrita.
2. No GitHub, repositório `matheuseddias/teste-financeiro` → Settings → Environments → `financeiro-producao` → Environment secrets, adicionar **`PRODIO_API_TOKEN`**. Não enviar o valor pelo chat nem incluí-lo em variáveis `VITE_*`.
3. Em Actions → **Publicar Financeiro** → Run workflow, selecionar `main`. Na primeira ativação, deixar `retomar_prodio` desmarcado. Se já houve tentativa com falha, marcar essa opção para testar e reativar as fontes existentes. Deixar `retomar_kamino=nenhuma` para preservar a configuração atual da Kamino.
4. O workflow envia o segredo ao Worker e testa `/eu`, empresa, escopos e um lote de cada fonte. Somente depois habilita a leitura automática. Sem token, esse passo informa a pendência e termina sem consultar o Prodio.
5. No Financeiro → **Prodio**, conferir empresa, última leitura, erros e último ciclo completo de cada fonte. Também é possível testar, ler o próximo lote, pausar e ativar cada fonte pela tela, respeitando o intervalo de um minuto.
6. Se retornar rota ausente, aguardar a E2 da API e repetir a validação. Se faltar `custos:ler`, valores ocultos não são interpretados como zero. Após trocar um token expirado, publicar novamente com `retomar_prodio` marcado.

Não é necessário editar arquivos manualmente no GitHub. O código e a publicação já incluem essa configuração. Nenhuma alteração no backend Prodio foi feita nesta entrega.

## Dados e sincronização

- Origem fixa `https://api.prodio.com.br/v1`; apenas GET `/eu`, `/pedidos`, `/compras/ordens` e `/notas`; redirecionamentos bloqueados.
- O primeiro `/eu` exige nome Eddias; o UUID retornado fica vinculado à conexão. Rodadas seguintes conferem o UUID, inclusive entre fontes. Não usar ID de seed nem distribuir GMV por CNPJ arbitrariamente.
- Token privado no servidor. Rotas Financeiro exigem administrador autenticado; tabelas têm RLS administrativa, auditoria e controle de versão. Somente funções restritas ao servidor podem gravar o espelho dos documentos.
- Um lote de até 200 documentos por minuto, alternando fontes. Lease e intervalo são compartilhados; cursor opaco é preservado e confirmado na mesma transação dos documentos. Lista vazia nunca exclui. Atualização antiga não desfaz dados mais recentes; repetição idêntica não altera versão.
- Pedidos iniciam por atualização desde **01/09/2026 00h em Brasília**. Compras e notas fazem carga inicial completa para não perder compras abertas antigas ou vínculos. A comparação financeira começa em setembro.
- Após cada ciclo, o filtro incremental usa o maior `atualizado_em` observado menos 60 segundos, com deduplicação. Isso cobre a estabilização de 30 segundos indicada no contrato. Backfills precisam atualizar `atualizado_em` conforme o contrato.
- 429 respeita `Retry-After`; 5xx/rede têm repetição com espera crescente. Após cinco falhas temporárias consecutivas, a fonte pausa para revisão. Erros de contrato, empresa ou autorização pausam imediatamente. Cursor e documentos anteriores permanecem.
- Guardamos apenas dados financeiros e identificadores necessários, sem XML, compradores ou resposta bruta. Valores passam de reais para centavos, com arredondamento a cada total de documento.
- O backup lógico passa a incluir as duas tabelas Prodio. Migração nova: `20261003000200_prodio.sql`; anteriores permanecem inalteradas.

## Canal, compras e notas

O rascunho não contém o canal de venda. O adaptador aceita as extensões opcionais `origem` e `origem_nome` caso a API as publique; isso **não foi confirmado**. Sem elas, o pedido aparece como “Canal não informado” e participa do consolidado. `plataforma=baselinker` não é convertido em marketplace.

Ordens de compra e notas são referências para conferência. O painel mostra vínculos OC/NF e a mesma chave de NF-e encontrada na Kamino. Não transforma automaticamente uma OC ou NF em outra saída: os títulos revisados da Kamino alimentam as previsões. O contrato informa dias da condição de pagamento, mas não define a data-base para calcular vencimentos; esta entrega não inventa essa data. Compra sem título pode ser incluída como lançamento previsto pelo usuário, conferindo duplicidade.

## Histórico → cenário

Em **Projeções de caixa → Histórico · GMV × dinheiro recebido**:

1. Selecionar o mês das vendas, o canal ou consolidado e o prazo de repasse.
2. Conferir o GMV de pedidos confirmados com De-Para demanda/carteira/enviado; cancelados e ignorados ficam fora. A data de confirmação usa o fuso informado pelo Prodio.
3. Conferir os depósitos positivos classificados como **repasse** no extrato, numa janela do mesmo tamanho deslocada pelo prazo informado. Transferências próprias, empréstimos e aportes não compõem essa conta. Por canal, os nomes devem corresponder aos utilizados na classificação bancária (ignorando caixa/espaços).
4. Conferir cobertura e classificações. Primeiro ciclo incompleto, janela ainda aberta, GMV zero, De-Para ausente, pedidos sem data ou movimentos pendentes impedem criar premissa. Taxa acima de 100% aparece sem ser artificialmente reduzida e exige revisão.
5. Marcar a conferência e criar um **novo cenário editável**. O GMV do mês-base se repete por seis meses como hipótese; taxa e prazo vêm da análise. Custos podem ser copiados de outro cenário. Saldo inicial permanece sem preenchimento até confirmação. Cenários anteriores não são alterados.

Essa taxa é uma **estimativa por janela**, não uma conciliação individual de pedidos e depósitos nem uma taxa definitiva de uma coorte. Pode conter repasses de vendas de outras competências; conferir prazo e cobertura antes de usá-la. A futura atribuição por período de venda e canal pode melhorar essa premissa, mas não está entregue. Custos de referência e GMV futuro também precisam ser ajustados ao planejamento.

## Validação

Os testes usam dados sintéticos para autenticação, empresa/escopos, centavos/fuso, paginação opaca, limites, atualização, RLS, backoff e cenários. O teste no workerd exercita a sincronização com respostas externas simuladas, incluindo RPC HTTP 204. O navegador confere token ausente, cobertura incompleta, taxa, confirmação, cenário e mobile. Não substituem a primeira consulta real ao Prodio nem login real do administrador.
