# Classificação aprendida — versão 0.5

Em **Extratos e conciliação → Regras e sugestões**, o administrador vê padrões com pelo menos três classificações manuais consistentes em duas datas diferentes. A assinatura é a conta, o sinal e a descrição completa, com caixa/espaços normalizados. Não há correspondência aproximada nem inferência de canal por um modelo de linguagem.

O administrador confere os exemplos, marca sua aprovação e ativa a regra. Novos movimentos importados com aquela assinatura recebem classificação, categoria e canal automaticamente. A identificação da regra fica no movimento e na auditoria. Para pendentes já importados, a tela oferece simulação e confirmação explícita, até 2000 por lote. Não sobrescreve movimentos já classificados.

Corrigir manualmente um movimento para uma classificação diferente da regra pausa a regra. O administrador pode revisar e reativar. Movimentos classificados automaticamente não são usados para reforçar a própria regra. Confirmações manuais conflitantes impedem novas sugestões/aprovações para a mesma assinatura. Transferências próprias, aportes e empréstimos não geram regras automáticas nesta etapa.

Descrições genéricas podem reunir origens distintas: a revisão é obrigatória antes da aprovação. A regra não altera data, valor, conta, saldo nem vínculo com uma obrigação. **Automatizar classificação não equivale a liquidar uma conta a pagar**; conciliações com lançamentos previstos permanecem explícitas. Aprender valores/prazos de conversão do GMV e conciliar automaticamente documentos entre Kamino/Prodio dependem das integrações e de validação futura.

Banco e interface aplicam permissões separadamente. Aprovação, pausa e aplicação em lote são administrativas; classificação manual depende da permissão de edição de extratos. RLS isola grupos; aprovação verifica novamente exemplos e conflitos no servidor. Backup inclui regras e sua proveniência.

Validação: testes de consistência, conflito, isolamento de conta/grupo/sinal, ausência de reforço automático; PostgreSQL real testa aprovação, simulação, aplicação idempotente, disparo em importação, correção/pausa, permissões e restauração. Navegador com API simulada testa confirmação administrativa e aplicação em pendentes. Não representa validação do login real do administrador.
