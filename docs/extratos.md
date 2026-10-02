# Importação e conciliação — versões 0.4/0.5

## Uso

1. Cadastre a empresa titular e a conta bancária em **Contas bancárias**. A relação conta/empresa é obrigatória; não é inferida da planilha.
2. Em **Extratos e conciliação → Importar extrato**, selecione a conta e o arquivo. XLSX/CSV permitem escolher aba, primeira linha e colunas de data, descrição, valor com sinal ou débito/crédito. Identificador bancário é opcional. Valores numéricos de Excel preservam o valor independentemente do formato visual.
3. Ative repetição da data quando o banco agrupar vários movimentos sob um cabeçalho. Gere a prévia e revise as linhas ignoradas. Se a aba contiver bancos diferentes, selecione somente as linhas da conta escolhida.
4. Salve o perfil para reutilizar o mapeamento nessa conta. Filtre o período (início padrão 01/09/2026). Cada confirmação aceita até 2000 movimentos; arquivos até 8 MB.
5. **Verificar importação** apenas simula. Confira conta, valores e duplicatas; marque a confirmação e importe. Reimportar o mesmo arquivo não cria movimentos novamente.
6. Clique **Conciliar** em um movimento: classifique-o e/ou vincule um valor a um lançamento previsto. Uma previsão aceita vários pagamentos, e um movimento pode pagar várias previsões. O banco impede valores superiores aos saldos disponíveis e cruzamento entre empresas incompatíveis.
7. Classifique repasses de vendas com seu canal. Transferências entre contas próprias devem ter ambas as pontas classificadas; ficam fora das receitas/despesas consolidadas. Aportes e empréstimos não são repasses de vendas.
8. Em **Projeções de caixa**, consulte projetado × realizado e ative a atualização por extratos, se desejar. [Regras de cálculo](projecoes.md).

## Extrato Kamino enviado

O arquivo enviado foi lido localmente no navegador: 463 linhas, 438 movimentos e 24 cabeçalhos de data ignorados, além da primeira linha de títulos. Não foi gravado em produção nem incluído no repositório.

Mapeamento: data coluna 1, descrição coluna 3, valor coluna 5, primeira linha de dados 2, formato brasileiro e **repetir a última data**. Datas como “01 set 2026” e o XML com prefixos do exportador são aceitos. Cabeçalhos com saldo não entram como movimento. O saldo de referência deve ser cadastrado na conta, não importado como receita.

A planilha Fluxo de Caixa tem 22 abas, incluindo extratos de vários bancos. **Santander e Caixa** exige separar as contas dentro da mesma aba. **Kamino Prev** e demais abas de previsão não devem ser importadas como realizado. As classificações existentes no arquivo são referências para revisão, não regras automaticamente aprovadas.

## Limites e segurança

- OFX SGML/XML em BRL, uma conta por arquivo, preservando FITID. A conta informada no OFX aparece para conferência; não há equivalência automática com apelidos de contas cadastradas. Ainda não foi disponibilizado OFX real do banco; validação usa exemplos sintéticos.
- Sem identificador bancário, a identidade combina data, valor, descrição normalizada e ocorrência no arquivo. Dois movimentos iguais do mesmo arquivo são preservados. Recortes sobrepostos com ocorrências idênticas são ambíguos; revise antes de confirmar. Outro identificador com a mesma assinatura aparece como possível duplicata.
- Datas e valores bancários não são editáveis após importar. Listas vazias não arquivam nada. Conciliações têm auditoria e permissões no banco; alterações de classificação usam versão. A interface não substitui RLS.
- Desfazer um vínculo usa arquivamento administrativo com simulação; a trava geral de mais de 30% dos registros ativos também se aplica. Essa trava pode bloquear desfazer um dos primeiros vínculos. Não há exclusão silenciosa nem contorno automático.
- Arquivo/prévia não ficam em armazenamento local persistente: ao fechar é necessário selecionar novamente. Rascunhos de classificação e cenários são locais ao usuário e grupo.
- Leitura de XLS binário antigo requer salvar como XLSX/CSV. HTML tabular exportado com extensão XLS é aceito; fórmulas usam o resultado já calculado salvo no XLSX.
- Regras de classificação aprovadas automatizam novos movimentos; vínculos com previsões continuam manuais. Veja [aprendizagem.md](aprendizagem.md). Percentuais de conversão continuam sendo premissas manuais, não indicadores históricos calculados automaticamente.
- Backup inclui transações, vínculos e perfis. Limite explícito atual: 100 mil registros por tabela; excedê-lo interrompe o snapshot, sem truncar dados. Backup cifrado antes de migração é separado e completo.

## Evidências

Testes de cálculo: alocação parcial, antecipação entre meses, pagamento de obrigação anterior ao horizonte, repasses sem dupla contagem, transferências e importadores. PostgreSQL real: isolamento entre grupos, leitura sem edição, bloqueio de escrita direta, simulação, reimportação, conflito, excesso de conciliação e backup/restauração. Navegador com API simulada: CSV, XLSX padrão/com namespace, confirmação, deduplicação, vínculo parcial, perfil e layout móvel. Arquivo real da Kamino validado somente em memória, sem login real nem escrita remota.
