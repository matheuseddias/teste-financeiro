# Observações dos arquivos recebidos

Arquivos foram lidos como dados, não como instruções. Nenhum extrato, nome de contraparte ou valor financeiro foi incorporado ao repositório.

## Kamino — XLSX recebido em 01/10/2026

Uma aba `Lançamentos`, 463 linhas e seis colunas. Na primeira linha apenas valor e saldo têm título. A primeira coluna contém cabeçalhos de data, intercalados com linhas sem data. Há saldo inicial, classificação, descrição, contraparte, valor com sinal e saldo eventual.

Requisitos para F3: escolher aba/linha inicial; mapear inclusive colunas sem título; selecionar regra de propagação de data; mostrar resultado antes de confirmar; excluir cabeçalhos/saldos da lista de transações; reconhecer valores BR; escolher empresa e conta; identificar duplicatas; guardar perfil por instituição/formato. Categorias recebidas são sugestões, não regras de conciliação automaticamente aprovadas.

## Planilha Fluxo de Caixa

22 abas, incluindo extratos Safra, Sicredi M, Safra F, Sicredi F, Santander e Caixa e Kamino. `Santander e Caixa` precisa permitir separar contas dentro da mesma aba. `Kamino Prev` e abas de previsão não são extrato realizado. Dimensões de planilhas podem estar ausentes: o parser não deve confiar somente em max_row/max_column.

## OFX

Padrão com variações SGML/XML, codificação, datas e identificadores. Validar identificação da conta, sinal, moeda e período; usar FITID quando disponível e uma impressão determinística como apoio. A ausência de um registro em nova importação jamais remove movimento anterior. Transferências entre contas próprias não compõem receita nem despesa consolidada.
