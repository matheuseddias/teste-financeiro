# Projeções para a reunião

O usuário priorizou projeções em 01/10/2026. A entrega antecipa o núcleo de planejamento da F5 com lançamentos da F2, sem depender das integrações da F4. A versão 0.4 acrescenta importação e conciliação da F3. Integrações F4 continuam pendentes. A versão 0.5 acrescenta regras de classificação aprendidas; a conversão histórica de GMV em caixa ainda não é calculada automaticamente.

## Como usar

1. Abra **Projeções de caixa → Novo cenário**.
2. Defina o mês inicial, horizonte e saldo do grupo imediatamente antes do período. Sem saldo inicial, o sistema calcula entradas e saídas, mas não inventa saldo acumulado.
3. Adicione os canais: GMV de cada mês, percentual líquido que chega ao banco e prazo médio em dias corridos. O botão de repetição preenche os demais meses com o primeiro valor; depois cada mês pode ser ajustado.
4. Acrescente custos recorrentes e, se desejar, percentuais de fornecedores/impostos para períodos ainda sem obrigações detalhadas.
5. Em **Lançamentos previstos**, registre obrigações conhecidas e outras entradas com vencimento. Elas entram em todos os cenários. Não repita nos custos do cenário os mesmos valores dos lançamentos.
6. Salve. Duplique ou crie variações conservadora/crescimento; compare saldos mês a mês. CSV e impressão/PDF ficam na tabela de fluxo.

## Cálculo e limites

- GMV × percentual líquido = repasse estimado. O total é distribuído uniformemente nos dias do mês, com preservação exata dos centavos, e deslocado pelo prazo informado. Não é uma agenda de liquidação contratual do marketplace.
- O caixa de cada mês recebe os repasses cujas datas estimadas caem naquele mês. Repasses depois do horizonte são informados separadamente. Recebíveis anteriores ao início da projeção precisam de lançamento de entrada próprio.
- Fornecedores e impostos: o maior valor entre o detalhamento conhecido e a estimativa percentual do GMV, calculado por categoria/mês. Trata-se de cobertura agregada; a vinculação entre compras, notas e contas a pagar depende da integração/conciliador.
- Custos fixos e outras saídas são somados às obrigações do mês. Taxas já descontadas no percentual líquido não devem ser descontadas novamente.
- Saldo final = saldo inicial + entradas − saídas acumuladas. O menor saldo exibido considera o inicial e os fechamentos mensais, não o menor saldo intramês.
- Os percentuais permanecem premissas editáveis. A versão 0.7 acrescenta análise histórica por janela GMV × repasses, com criação de um novo cenário após revisão de cobertura e prazo; depende de vendas sincronizadas via API Prodio e de extratos classificados. Não é atribuição individual de depósitos a pedidos. Consulte [prodio.md](prodio.md). Extratos são importados por arquivo na tela Extratos e conciliação.
- Conservador: GMV −20%, percentual líquido −3 pontos percentuais, repasse +7 dias. Crescimento: GMV +10%. Variações são hipóteses editáveis, não recomendações.
- Cenários, lançamentos e alterações são persistidos no Supabase com RLS, permissão própria de planejamento, controle de versão e auditoria. Administrador administra as permissões. Rascunhos permanecem neste dispositivo até salvar.
- Backup diário e pré-deploy incluem as novas tabelas; retenção dos snapshots permanece em 20.

## Projetado × realizado

A tabela compara as premissas do cenário com os movimentos importados. A opção **Atualizar a projeção com os extratos classificados e conciliados** retira parcelas vinculadas das datas previstas e incorpora o realizado na data bancária. Pagamentos parciais preservam o restante. Repasses e despesas operacionais classificados, sem vínculo, abatem estimativas agregadas do mesmo mês; isso não é identificação da safra de vendas liquidada. Movimentos não classificados entram no realizado e podem se sobrepor às previsões até a conciliação.

Transferências próprias classificadas ficam fora das entradas e saídas consolidadas. Aportes e empréstimos entram no caixa, sem abater a projeção de repasses. Confira cobertura de todas as contas e contrapartidas; importação ausente não comprova movimento zero. Detalhes em [extratos.md](extratos.md).

## Validação

Testes de cálculo cobrem repasses entre meses, conservação de centavos, fevereiro/ano bissexto, virada do ano, saldo ausente, fornecedores sem duplicidade agregada, variações e limites numéricos. PostgreSQL real cobre RLS, autorização, concorrência, validação de JSON, auditoria, backup e restauração. Navegador testa salvar e reabrir cenário, variantes, comparação, CSV e layout móvel com dados sintéticos.

Status da publicação deve ser confirmado pela execução do GitHub Actions e checagem remota; testes locais não comprovam publicação nem login real.
