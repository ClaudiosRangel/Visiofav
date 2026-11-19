# Requirements Document

## Introduction

Esta feature reorganiza o Orçamento Gráfico do Vizor para seguir o fluxo do sistema legado, de modo que o usuário migre sem confusão. O fluxo passa a ter dois momentos separados:

1. **Orçamento** (comercial): cliente, itens, Fechamento e Comissões.
2. **Cálculo Padrão** (engenharia): biblioteca de cálculos reutilizáveis, sem cliente obrigatório.

Regra central: o item do orçamento É um cálculo próprio, criado por CÓPIA do Cálculo Padrão escolhido. Cada escolha gera um número de cálculo novo (ex.: ao usar o 15678, nasce o 15680). Editar o item nunca altera o Cálculo Padrão de origem.

Fontes de referência: wireframes aprovados em `docs/orcamento-grafico-wireframe-paridade-fluxo-legado.md`, `docs/orcamento-grafico-wireframe-hierarquia.md` e o steering `orcamento-grafico-visao-front-calcgraf.md` (hierarquia Orçamento → Item → Plano).

### Decisões já aprovadas
- O editor do cálculo reutiliza as telas Item/Plano por meio de um adaptador sobre `CalculoGrafico`.
- Editar um cálculo migrado ou ancorado gera um cálculo NOVO por cópia; o original permanece intacto.
- Ordem de entrega: Fase 1 (Telas 1–4, orçamento); Fase 2 (menu Cálculo Padrão e editor, Telas 5–7); Fase 3 (Listagem de Cálculos e PDF de Pré-Cálculo).
- O produto do cálculo 12992 é `CG-PROD-7` "Impressos (aberto/fechado)".
- As 5 linhas de produto vêm do cadastro `LinhaProduto`.
- O orçamento abre em branco e só é criado no banco ao salvar.
- Série e data são gravadas no cabeçalho. A origem da série continua indefinida: mantém-se o comportamento atual, com campo editável.
- O plano espelho "Base" é enriquecido somente para exibição.

### Restrições transversais
- Não alterar `calcularOrcamentoGrafico` nem `ancorarCustoCalcgraf`.
- O custo do cálculo 12992 permanece R$ 5.192,05 e o valor R$ 15.084,04 ao chamar, editar e salvar.
- O guard `hierarquia/motor-guard.ts` deve continuar passando.
- Textos visíveis ao usuário nunca citam o sistema legado nem seus fornecedores.
- Cores usam tokens adaptativos do Mantine.
- A sessão é lida somente via `authStorage`.
- Toda query filtra `empresaId` de forma explícita.
- Alterações em `schema.prisma` e `migrate-prod.ts` vão no mesmo commit e são idempotentes.
- A tela é dirigida pelo cadastro do Produto Gráfico, sem nome de produto no código.

## Glossary

- **Vizor**: ERP (backend Fastify/Prisma e frontend Next.js/Mantine) onde esta feature é implementada.
- **Sistema_Legado**: sistema de cálculo e orçamento gráfico usado antes da migração. Só aparece em documentos técnicos, nunca em textos visíveis.
- **Orcamento_Grafico**: documento comercial (`OrcamentoGrafico`) com cliente, itens, Fechamento e Comissões.
- **Tela_Orcamento**: tela de manutenção do Orcamento_Grafico (Telas 1 e 4 do wireframe).
- **Item_Orcamento**: item do orçamento (`ItemOrcamentoGrafico`), vinculado a um Calculo_Grafico próprio criado por cópia.
- **Calculo_Grafico**: entidade `CalculoGrafico` com número próprio por empresa. Pode ser Calculo_Padrao ou cópia pertencente a um Item_Orcamento.
- **Calculo_Padrao**: Calculo_Grafico reutilizável da biblioteca de engenharia, sem cliente obrigatório.
- **Calculo_Origem**: Calculo_Padrao a partir do qual um Item_Orcamento foi copiado.
- **Dialogo_Linha_Produto**: diálogo "Novo Item — Linha de Produto" (Tela 2).
- **Seletor_Calculo_Padrao**: tela de busca de Calculo_Padrao aberta dentro do orçamento (Tela 3).
- **Menu_Calculo_Padrao**: item de menu "Cálculo Padrão" (biblioteca renomeada, Tela 7).
- **Editor_Calculo**: editor do cálculo no layout Item/Plano (Telas 5 e 6), reutilizando Item e Plano por adaptador sobre Calculo_Grafico.
- **Linha_Produto**: registro do cadastro `LinhaProduto` (hoje 5 linhas).
- **Produto_Grafico**: cadastro `ProdutoGrafico`, que dirige campos visíveis e padrões da tela.
- **Tipo_Plano**: cadastro `TipoPlanoGrafico`.
- **Foto**: resultado congelado do cálculo (`resultadoCalculo`) com valores finais, margens, CM e CEV.
- **Decomposicao_STC**: decomposição do custo por componente (Material Direto, Custo de Transformação, Serviço Externo), obtida de `custosCalcgraf` e aplicada por `aplicarDecomposicaoStc`.
- **Plano_Base**: plano espelho "Base" exibido no item puxado, preenchido somente para exibição.
- **Fechamento**: grid por tiragem com Margem, C.Marg., Valor Unitário e Valor Total, totalizando todos os itens.
- **Painel_Dados_Item**: painel de resumo do item selecionado na Tela_Orcamento.
- **Motor_Calculo**: `calcularOrcamentoGrafico` e `ancorarCustoCalcgraf`, que não podem ser alterados.
- **Motor_Guard**: verificação `hierarquia/motor-guard.ts` que protege o Motor_Calculo.
- **Servico_Copia**: serviço do backend que cria um Calculo_Grafico novo por cópia de um Calculo_Padrao.
- **Backfill_Orcamento_3**: script de correção do orçamento nº 3 de produção, executado só com autorização explícita.
- **Listagem_Calculos**: consulta/relatório de cálculos (Fase 3).
- **PreCalculo_PDF**: PDF da memória de cálculo (Fase 3).

## Requirements

### Requirement 1: Orçamento em branco com criação somente no Salvar (Fase 1)

**User Story:** Como orçamentista, quero abrir um orçamento em branco que só é gravado ao salvar, para não criar registros vazios no banco.

#### Acceptance Criteria

1. WHEN o usuário aciona "Novo Orçamento", THE Tela_Orcamento SHALL exibir um orçamento em branco com Série preenchida conforme a origem de série atual, Nº com o texto "auto" (não editável), Data igual à data corrente do dia no fuso America/Sao_Paulo, Cliente Principal vazio e a grade de itens com 0 linhas.
2. WHILE o orçamento em branco não foi salvo, THE Vizor SHALL manter 0 registros de `OrcamentoGrafico` e 0 registros de `ItemOrcamentoGrafico` criados para ele no banco.
3. WHEN o usuário aciona "Salvar" em um orçamento em branco, THE Vizor SHALL criar um `OrcamentoGrafico` com a Série e a Data informadas no cabeçalho e com Nº igual ao maior Nº existente para a mesma empresa e Série mais 1 (ou 1 se não houver orçamento para essa empresa e Série), e a Tela_Orcamento SHALL exibir o Nº atribuído no lugar de "auto".
4. IF o usuário sai da Tela_Orcamento (navegação para outra tela, fechamento ou recarga da página) sem salvar, THEN THE Tela_Orcamento SHALL descartar o orçamento em branco e THE Vizor SHALL manter 0 registros de `OrcamentoGrafico` e `ItemOrcamentoGrafico` criados para ele.
5. THE Tela_Orcamento SHALL exibir o campo Série como editável, aceitando de 1 a 10 caracteres, e SHALL preservar o comportamento atual de definição do valor inicial da série.
6. WHEN o usuário aciona "Incluir item" em orçamento ainda não salvo, THE Vizor SHALL criar o `OrcamentoGrafico` com os dados do cabeçalho, conforme o critério 3.
7. WHEN o `OrcamentoGrafico` é criado a partir de "Incluir item", THE Tela_Orcamento SHALL abrir o Dialogo_Linha_Produto vinculado a esse orçamento em até 2 segundos.
8. THE Vizor SHALL gravar o `empresaId` da sessão autenticada em todo `OrcamentoGrafico` criado, ignorando qualquer `empresaId` enviado pela Tela_Orcamento.
9. IF a criação do `OrcamentoGrafico` falha em "Salvar" ou em "Incluir item", THEN THE Tela_Orcamento SHALL exibir uma mensagem de erro indicando que o orçamento não foi criado, manter os dados do cabeçalho preenchidos pelo usuário, não abrir o Dialogo_Linha_Produto, e THE Vizor SHALL manter 0 registros parciais de `OrcamentoGrafico` e `ItemOrcamentoGrafico` para essa tentativa.
10. IF duas criações de `OrcamentoGrafico` para a mesma empresa e Série ocorrem simultaneamente, THEN THE Vizor SHALL atribuir um Nº distinto a cada orçamento, sem repetir Nº dentro da mesma empresa e Série.

### Requirement 2: Busca de empresa e modal "Observações da Empresa" (Fase 1)

**User Story:** Como orçamentista, quero localizar o cliente por código ou nome e ver as observações cadastradas, para atender o cliente com o contexto correto.

#### Acceptance Criteria

1. THE Tela_Orcamento SHALL exibir o campo Cliente Principal com os campos Código e Nome e o botão "Pesquisar", sendo o Código limitado a 20 caracteres e o Nome limitado a 200 caracteres.
2. WHEN o usuário aciona "Pesquisar" informando de 1 a 200 caracteres em Código ou Nome, THE Tela_Orcamento SHALL listar em até 2 segundos, no máximo 50 clientes da empresa da sessão cujo código ou nome contenha o texto informado, sem diferenciar maiúsculas de minúsculas e acentos, ordenados por nome.
3. IF a pesquisa não encontrar nenhum cliente da empresa da sessão, THEN THE Tela_Orcamento SHALL exibir uma mensagem indicando que nenhum cliente foi encontrado e manter o Cliente Principal anterior inalterado.
4. IF o usuário aciona "Pesquisar" com Código e Nome vazios, THEN THE Tela_Orcamento SHALL exibir uma mensagem indicando que é necessário informar código ou nome e não executar a pesquisa.
5. IF a pesquisa falhar por erro de comunicação ou do servidor, THEN THE Tela_Orcamento SHALL exibir uma mensagem de erro indicando a falha na pesquisa, manter o Cliente Principal anterior inalterado e permitir uma nova tentativa.
6. WHEN o usuário seleciona um cliente cuja observação cadastrada contém pelo menos 1 caractere não branco, THE Tela_Orcamento SHALL preencher o Cliente Principal com o código e o nome do cliente e abrir o modal "Observações da Empresa" exibindo o texto completo da observação, com rolagem quando exceder a área visível, e o botão "OK".
7. WHEN o usuário seleciona um cliente cuja observação está vazia ou contém apenas espaços, THE Tela_Orcamento SHALL preencher o Cliente Principal com o código e o nome do cliente sem abrir o modal.
8. WHEN o usuário aciona "OK" no modal "Observações da Empresa", THE Tela_Orcamento SHALL fechar o modal e manter o cliente selecionado no Cliente Principal.
9. WHILE o modal "Observações da Empresa" está aberto, THE Tela_Orcamento SHALL impedir a interação com os demais campos da tela.
10. THE Tela_Orcamento SHALL exibir o texto do modal "Observações da Empresa" sem citar o sistema legado, nem por nome nem por referência.

### Requirement 3: Diálogo "Novo Item — Linha de Produto" (Fase 1)

**User Story:** Como orçamentista, quero escolher a linha de produto ao incluir um item, para chegar ao cálculo padrão correto.

#### Acceptance Criteria

1. WHEN o usuário aciona "Incluir item" na Tela_Orcamento, THE Tela_Orcamento SHALL abrir o Dialogo_Linha_Produto como diálogo modal com o título "Novo Item — Selecione a Linha de Produto", sem nenhuma linha pré-selecionada, e SHALL exibir os botões "Confirmar" e "Cancelar".
2. WHEN o Dialogo_Linha_Produto é aberto, THE Dialogo_Linha_Produto SHALL listar como opções de seleção única, em ordem alfabética crescente pelo nome, todas as Linhas_Produto da empresa do usuário cujo cadastro `LinhaProduto` está com status ativo, e SHALL omitir as Linhas_Produto inativas e as de outras empresas.
3. THE Dialogo_Linha_Produto SHALL exibir o nome de cada opção exatamente como está gravado no cadastro `LinhaProduto`, de modo que a inclusão, a alteração ou a inativação de uma linha no cadastro apareça na abertura seguinte do diálogo sem alteração de código.
4. WHEN o usuário seleciona uma linha e aciona "Confirmar", THE Vizor SHALL fechar o Dialogo_Linha_Produto e abrir o Seletor_Calculo_Padrao com o filtro Linha preenchido com a linha escolhida.
5. WHEN o usuário aciona "Cancelar" no Dialogo_Linha_Produto, THE Vizor SHALL fechar o Dialogo_Linha_Produto e abrir o Seletor_Calculo_Padrao com o filtro Linha vazio (sem filtro de Linha).
6. WHILE nenhuma linha está selecionada, THE Dialogo_Linha_Produto SHALL manter o botão "Confirmar" desabilitado.
7. IF o cadastro `LinhaProduto` não retorna nenhuma linha ativa para a empresa, THEN THE Dialogo_Linha_Produto SHALL exibir uma mensagem indicando que não há linhas de produto ativas, SHALL manter "Confirmar" desabilitado e SHALL manter "Cancelar" habilitado.
8. IF a consulta ao cadastro `LinhaProduto` falha ou não responde em até 10 segundos, THEN THE Dialogo_Linha_Produto SHALL exibir uma mensagem de erro indicando que as linhas não puderam ser carregadas, SHALL manter "Confirmar" desabilitado e SHALL manter "Cancelar" habilitado, sem criar nenhum item no orçamento.

### Requirement 4: Seletor Cálculo Padrão com filtros e colunas (Fase 1)

**User Story:** Como orçamentista, quero buscar o cálculo padrão por vários critérios, para reaproveitar um cálculo existente.

#### Acceptance Criteria

1. THE Seletor_Calculo_Padrao SHALL oferecer os filtros Cliente (campo código com até 20 caracteres e campo nome com até 200 caracteres), "Sem cliente definido" (caixa de marcação), Linha (até 120 caracteres), Produto (até 200 caracteres), Descrição (até 200 caracteres), Sigla Acabado (até 60 caracteres), Nº cálculo (somente dígitos, de 1 a 9 dígitos, valor maior que zero) e "Cálculo cancelado" (caixa de marcação), todos iniciando vazios ou desmarcados.
2. WHEN o Seletor_Calculo_Padrao é aberto, THE Seletor_Calculo_Padrao SHALL exibir a grade com as colunas Cliente, Linha, Produto, Descrição, Formato Final, Cód. Cálculo Acabado (sigla), Tiragem e Nº Cálculo, sem nenhuma linha, com "Quantidade de cálculos: 0" e com "Usar" desabilitado.
3. WHEN o usuário aciona "Buscar", THE Seletor_Calculo_Padrao SHALL listar, ordenados por Nº Cálculo decrescente e limitados a 500 linhas, somente os cálculos da empresa da sessão que atendam simultaneamente (E lógico) a todos os filtros preenchidos, em que os filtros de texto casam por trecho contido, sem diferenciar maiúsculas de minúsculas, e o filtro Nº cálculo casa por valor exato.
4. IF a busca encontra mais de 500 cálculos, THEN THE Seletor_Calculo_Padrao SHALL exibir somente as 500 primeiras linhas e uma mensagem informando que o resultado foi limitado e que os filtros devem ser refinados.
5. WHILE "Sem cliente definido" está marcado, THE Seletor_Calculo_Padrao SHALL listar somente cálculos sem cliente, desabilitar os campos código e nome de Cliente e ignorar o conteúdo desses campos na busca.
6. WHILE "Cálculo cancelado" está desmarcado, THE Seletor_Calculo_Padrao SHALL omitir da busca os cálculos cancelados.
7. WHILE "Cálculo cancelado" está marcado, THE Seletor_Calculo_Padrao SHALL listar somente os cálculos cancelados que atendam aos demais filtros.
8. WHEN uma busca é concluída, THE Seletor_Calculo_Padrao SHALL exibir "Quantidade de cálculos: N", em que N é o número de linhas exibidas na grade.
9. WHEN um cálculo possui mais de uma sigla de acabado distinta, THE Seletor_Calculo_Padrao SHALL exibir "(vários)" na coluna de sigla desse cálculo.
10. IF a busca não retorna cálculos, THEN THE Seletor_Calculo_Padrao SHALL esvaziar a grade, exibir a mensagem "Nenhum cálculo encontrado", exibir "Quantidade de cálculos: 0" e manter "Usar" desabilitado.
11. IF a busca falha por erro de comunicação ou do servidor, THEN THE Seletor_Calculo_Padrao SHALL exibir uma mensagem de erro indicando que a busca não pôde ser concluída, manter os filtros preenchidos pelo usuário e manter a grade e a contagem do resultado anterior.
12. WHILE nenhuma linha da grade está selecionada, THE Seletor_Calculo_Padrao SHALL manter "Usar" desabilitado.
13. WHEN o usuário aciona "Sair", THE Seletor_Calculo_Padrao SHALL fechar sem criar cálculo nem item e sem alterar nenhum dado existente.

### Requirement 5: "Usar" cria cálculo novo por cópia e lança o item (Fase 1)

**User Story:** Como orçamentista, quero que "Usar" crie um cálculo próprio para o item, para editar o item sem mexer no cálculo padrão.

#### Acceptance Criteria

1. WHEN o usuário aciona "Usar" com um Calculo_Padrao selecionado, THE Servico_Copia SHALL criar um Calculo_Grafico novo com número sequencial próprio da empresa, diferente do número do Calculo_Origem, e SHALL copiar do Calculo_Origem os campos de engenharia (medidas, aproveitamento, papel, cores, formato de corte, acabamentos) e o custo de produção, com valores idênticos aos do Calculo_Origem.
2. WHEN o Servico_Copia cria o cálculo novo, THE Servico_Copia SHALL criar o Item_Orcamento vinculado a esse cálculo novo, gravando `calculoGraficoOrigemId` com o id do Calculo_Origem, e SHALL retornar ao usuário o id e o número do cálculo novo e o id do Item_Orcamento.
3. WHEN o usuário usa o mesmo Calculo_Padrao duas vezes, THE Servico_Copia SHALL gerar dois cálculos novos com números distintos entre si e distintos do número do Calculo_Origem, e dois Itens_Orcamento distintos, ambos com `calculoGraficoOrigemId` igual ao id do Calculo_Origem.
4. THE Servico_Copia SHALL executar a criação do cálculo novo e do item em uma única transação, de modo que, ao término da operação, existam os dois registros (sucesso) ou nenhum deles (falha).
5. IF a transação falha, THEN THE Servico_Copia SHALL reverter o cálculo e o item, retornar erro indicando que a operação não foi concluída, e manter a contagem de Calculos_Graficos e de Itens_Orcamento da empresa igual à anterior à tentativa, sem deixar cálculo órfão.
6. WHEN o usuário edita ou salva o Item_Orcamento, THE Vizor SHALL manter inalterados todos os campos do Calculo_Origem, incluindo o número, a engenharia, o custo de produção e o resultado de cálculo, e SHALL aplicar a alteração somente ao cálculo novo e ao item.
7. IF o Calculo_Origem pertence a outra empresa, THEN THE Servico_Copia SHALL rejeitar a operação com HTTP 403, sem criar cálculo nem item e sem revelar dados do Calculo_Origem na resposta.
8. IF o Calculo_Origem não existe, THEN THE Servico_Copia SHALL retornar HTTP 404, sem criar cálculo nem item.
9. THE Servico_Copia SHALL filtrar por `empresaId` explícito, o da entidade de negócio real e não apenas o escopo automático do cliente de banco, em toda query de leitura e escrita.

### Requirement 6: Resolução de produto, tipo de plano e dados da Foto ao puxar (Fase 1)

**User Story:** Como orçamentista, quero que o item puxado já venha com produto, margem e estrutura corretos, para conferir o valor sem retrabalho.

#### Acceptance Criteria

1. WHEN o Servico_Copia cria o item, THE Servico_Copia SHALL resolver o Produto_Grafico e o Tipo_Plano a partir do produto e do formato do Calculo_Origem, por correspondência com o cadastro, e gravar `produtoGraficoId` e `tipoPlanoId` no item. A resolução é única quando exatamente 1 registro ativo do cadastro corresponde.
2. WHEN o Calculo_Origem tem o produto "Impressos (aberto/fechado)", THE Servico_Copia SHALL resolver o Produto_Grafico `CG-PROD-7`, por correspondência no cadastro e sem nome de produto no código.
3. IF o Produto_Grafico ou o Tipo_Plano não pode ser resolvido de forma única (0 ou 2 ou mais correspondências), THEN THE Servico_Copia SHALL criar o item com o identificador não resolvido (`produtoGraficoId` ou `tipoPlanoId`) vazio, preservar os demais dados do item e retornar na resposta um aviso de resolução pendente que indique qual identificador ficou vazio.
4. WHEN o Servico_Copia cria o item, THE Servico_Copia SHALL copiar da Foto os valores de `margemSelecionada`, margem, CM e CEV, sem arredondamento nem alteração de valor.
5. IF a Foto não contém algum dos valores de `margemSelecionada`, margem, CM ou CEV, THEN THE Servico_Copia SHALL criar o item com o campo ausente vazio e retornar um aviso que indique quais campos estavam ausentes.
6. WHEN o Servico_Copia cria o item e a Foto contém os custos por componente do Calculo_Origem, THE Servico_Copia SHALL aplicar a Decomposicao_STC, separando Material Direto, Custo de Transformação e Serviço Externo, de modo que a soma dos três valores seja igual ao custo de produção da Foto com diferença máxima de R$ 0,01.
7. IF a Foto não contém os custos por componente do Calculo_Origem, THEN THE Servico_Copia SHALL criar o item sem a Decomposicao_STC, manter o custo total da Foto no item e retornar um aviso de decomposição indisponível.
8. WHEN o Servico_Copia cria o item, THE Servico_Copia SHALL gravar Modelos igual a 1.
9. WHEN o Servico_Copia cria o item e o Calculo_Origem tem mais de uma sigla distinta, THE Servico_Copia SHALL gravar a sigla "(vários)".
10. WHEN o Servico_Copia cria o item e o Calculo_Origem tem exatamente uma sigla, THE Servico_Copia SHALL gravar essa sigla no item.
11. WHEN o Servico_Copia cria o item, THE Servico_Copia SHALL gravar no item a série e a data do cabeçalho do orçamento ao qual o item pertence.
12. THE Servico_Copia SHALL gravar o custo e o valor do item com valores idênticos aos da Foto, sem invocar o Motor_Calculo durante a criação do item.
13. IF a gravação do item falha, THEN THE Servico_Copia SHALL não persistir nenhum dado parcial do item, manter o orçamento inalterado e retornar um erro que indique a falha na criação do item.

### Requirement 7: Orçamento com o item lançado, painel e Fechamento (Fase 1)

**User Story:** Como orçamentista, quero ver o item lançado, seus dados e o Fechamento, para validar o valor antes de enviar a proposta.

#### Acceptance Criteria

1. WHEN o item é lançado, THE Tela_Orcamento SHALL exibir na grade, em até 2 segundos, uma linha com item (número sequencial a partir de 1), Cálculo (número do cálculo novo), Linha, Tipo, Tiragens (formato com separador de milhar, ex.: 6.000), Descrição e Status.
2. WHEN a grade de itens passa de vazia para ter itens, THE Tela_Orcamento SHALL selecionar automaticamente o item de menor número e destacá-lo visualmente como selecionado.
3. WHEN um item é selecionado, THE Painel_Dados_Item SHALL exibir formato, suporte, cores, acabamentos e itens diversos do item, organizados conforme a hierarquia do steering: para plano único (Cartucho e Lâmina Simples), Formato, Suporte, Cores, Acabamento e Itens Diversos; para multi-plano, Especificações Gerais, Tipos de Plano (suporte, cores, formato e acabamentos de cada plano), Acabamentos e Itens Diversos.
4. WHEN um item é selecionado, THE Tela_Orcamento SHALL preencher o Fechamento, em até 2 segundos, com uma linha por tiragem do item contendo Tiragem, Margem (percentual com 2 casas decimais), C.Marg. (percentual com 2 casas decimais), Valor Unitário (5 casas decimais) e Valor Total (moeda R$ com 2 casas decimais).
5. WHEN o item do cálculo 12992 é lançado, THE Tela_Orcamento SHALL exibir no Fechamento Margem 47,62%, C.Marg. 55,01%, Valor Unitário 3,77101 e Valor Total R$ 15.084,04.
6. THE Fechamento SHALL totalizar todos os itens do orçamento por tiragem, somando o Valor Total de cada item da mesma tiragem, e SHALL manter os valores de cada item inalterados.
7. THE Tela_Orcamento SHALL exibir as abas "Fechamento" e "Comissões" no nível do orçamento, fora do editor do item, visíveis independentemente de haver item selecionado.
8. WHEN o usuário aciona duplo clique em um item da grade, THE Tela_Orcamento SHALL abrir o Editor_Calculo desse item.
9. THE Tela_Orcamento SHALL oferecer as ações "Incluir item", "Copiar" e "Excluir" sobre os itens, SHALL manter "Copiar" e "Excluir" desabilitadas enquanto nenhum item estiver selecionado e SHALL manter "Incluir item" habilitada.
10. WHEN o usuário aciona "Copiar" sobre um item, THE Vizor SHALL criar um Calculo_Grafico novo por cópia do cálculo do item e um novo item vinculado a ele, preservando o custo ancorado do cálculo de origem, e SHALL exibir o novo item na grade com número sequencial seguinte ao maior existente.
11. IF a criação do Calculo_Grafico ou do novo item falhar durante "Copiar", THEN THE Vizor SHALL desfazer qualquer registro parcial criado, SHALL manter a grade de itens inalterada e SHALL exibir mensagem de erro indicando que a cópia não foi realizada.
12. WHEN o usuário aciona "Excluir" sobre um item, THE Tela_Orcamento SHALL solicitar confirmação e, após a confirmação, SHALL remover o item da grade, recalcular o Fechamento sem o item e selecionar automaticamente o item de menor número restante, ou limpar o Painel_Dados_Item e o Fechamento se a grade ficar vazia.

### Requirement 8: Plano "Base" preenchido para exibição (Fase 1)

**User Story:** Como orçamentista, quero ver o plano Base com suporte, formato, cores e acabamentos, para entender a composição do item puxado.

#### Acceptance Criteria

1. WHEN o Servico_Copia cria o item a partir de um cálculo copiado, THE Servico_Copia SHALL preencher o Plano_Base, na mesma operação de criação do item, com: suporte (nome e gramatura), formato de corte (largura x altura em mm), cores (nome e cobertura de cada cor), cobertura de tinta, atividades de acabamento (nome de cada atividade) e custo do plano (valor em R$ com 2 casas decimais), lidos da Foto e da engenharia do cálculo copiado.
2. THE Plano_Base SHALL ser somente leitura e usado apenas para exibição, sem permitir edição de nenhum de seus campos e sem alterar o valor do item.
3. THE Vizor SHALL calcular o valor do item com a mesma base de custo ancorada no cálculo de origem usada antes da criação do Plano_Base, de modo que a diferença entre o valor do item com e sem Plano_Base seja R$ 0,00, sem recálculo por `somaPlanos`.
4. WHEN o usuário abre o Plano_Base na Tela 6, THE Editor_Calculo SHALL exibir todos os campos listados no critério 1 que existam na origem com o valor copiado, e nenhum desses campos vazio.
5. IF um campo do plano está ausente, nulo ou vazio na origem, THEN THE Plano_Base SHALL deixar esse campo vazio, sem valor padrão, sem zero e sem valor inferido, e THE Servico_Copia SHALL concluir a criação do item sem erro.
6. IF o preenchimento do Plano_Base falha durante a criação do item, THEN THE Servico_Copia SHALL criar o item sem Plano_Base, manter inalterado o valor ancorado do item e exibir uma mensagem de erro indicando que o Plano_Base não foi preenchido.

### Requirement 9: Preservação do motor e dos valores ancorados

**User Story:** Como gestor, quero que o custo migrado continue idêntico ao do sistema anterior, para confiar nos valores após a reorganização.

#### Acceptance Criteria

1. THE Vizor SHALL manter `calcularOrcamentoGrafico` e `ancorarCustoCalcgraf` sem alteração de código, de modo que o diff dos arquivos que os definem contenha 0 linhas alteradas nessas duas funções ao final da feature.
2. WHEN a suíte de testes do Motor_Guard é executada após as mudanças desta feature, THE Motor_Guard SHALL terminar com 0 testes falhando e sem reduzir a quantidade de testes executados em relação à execução anterior às mudanças.
3. WHEN o cálculo 12992 é puxado, editado ou salvo em um item, THE Vizor SHALL apresentar custo de produção R$ 5.192,05 e valor R$ 15.084,04, com diferença de 0,00 em relação a esses valores nos três momentos (puxar, editar, salvar).
4. WHEN o Item_Orcamento tem `calculoGraficoOrigemId`, THE Vizor SHALL aplicar a ancoragem de custo nas operações de calcular e salvar do item, e o custo de produção resultante SHALL ser igual ao custo de produção do cálculo de origem, com diferença de 0,00.
5. IF o Item_Orcamento não tem `calculoGraficoOrigemId`, ou o cálculo de origem não existe mais, THEN THE Vizor SHALL calcular o custo pelo motor sem ancoragem, sem exibir erro e sem alterar o `calculoGraficoOrigemId` do item.
6. FOR ALL cálculos migrados, THE Servico_Copia SHALL criar o item com custo de produção igual ao custo de produção da Foto, com diferença de 0,00 (propriedade de invariância).
7. IF a cópia de um cálculo migrado produzir custo de produção diferente do da Foto, THEN THE Servico_Copia SHALL cancelar a criação do item, não gravar nenhum item parcial e retornar erro indicando a divergência de custo.

### Requirement 10: Menu "Cálculo Padrão" — biblioteca (Fase 2)

**User Story:** Como engenheiro de cálculo, quero um menu Cálculo Padrão fora do orçamento, para manter a biblioteca de cálculos reutilizáveis.

#### Acceptance Criteria

1. THE Vizor SHALL exibir o item de menu "Cálculo Padrão" em Vendas → Orçamento e SHALL NOT exibir o item "Biblioteca de Cálculos" em nenhum menu.
2. WHEN o usuário abre o Menu_Calculo_Padrao, THE Menu_Calculo_Padrao SHALL exibir os mesmos filtros e as mesmas colunas do Seletor_Calculo_Padrao, com os mesmos nomes, na mesma ordem e com o mesmo comportamento de filtragem.
3. WHEN o usuário abre o Menu_Calculo_Padrao sem informar cliente, THE Menu_Calculo_Padrao SHALL listar os cálculos da empresa do usuário, paginados em no máximo 50 registros por página, sem exigir cliente.
4. THE Menu_Calculo_Padrao SHALL oferecer as ações "Incluir", "Editar", "Copiar" e "Cancelar" para cálculos não cancelados, e SHALL oferecer somente as ações "Reativar" e "Copiar" para cálculos cancelados.
5. WHEN o usuário aciona "Incluir", THE Menu_Calculo_Padrao SHALL abrir o Editor_Calculo para um Calculo_Padrao novo, com número sequencial próprio, único dentro da empresa e distinto do número de qualquer outro cálculo existente.
6. WHEN o usuário aciona "Copiar" sobre um cálculo, THE Menu_Calculo_Padrao SHALL criar um novo Calculo_Padrao com número sequencial próprio, contendo os mesmos dados de engenharia do original e o status inicial de um cálculo incluído, e SHALL manter o cálculo original sem nenhuma alteração.
7. WHEN o usuário confirma "Cancelar" sobre um cálculo não cancelado, THE Menu_Calculo_Padrao SHALL registrar o status atual como status anterior, marcar o cálculo como cancelado e manter o registro no banco de dados.
8. WHEN o usuário aciona "Reativar" sobre um cálculo cancelado, THE Menu_Calculo_Padrao SHALL restaurar o status registrado antes do cancelamento e limpar a marcação de cancelado.
9. WHILE o filtro "Cálculo cancelado" do Seletor_Calculo_Padrao está desmarcado, THE Seletor_Calculo_Padrao SHALL omitir dos resultados todo Calculo_Padrao cancelado; WHILE o filtro está marcado, THE Seletor_Calculo_Padrao SHALL incluir os cálculos cancelados nos resultados.
10. THE Menu_Calculo_Padrao SHALL filtrar por `empresaId` explícito, obtido da sessão do usuário, em toda consulta e alteração, e SHALL NOT retornar nem alterar cálculos de outra empresa.
11. IF o cálculo informado em "Editar", "Copiar", "Cancelar" ou "Reativar" não pertence à empresa do usuário ou não existe, THEN THE Menu_Calculo_Padrao SHALL recusar a ação, exibir mensagem de erro indicando que o cálculo não foi encontrado e não alterar nenhum registro.
12. IF a gravação de "Incluir", "Copiar", "Cancelar" ou "Reativar" falhar, THEN THE Menu_Calculo_Padrao SHALL exibir mensagem de erro indicando a falha da ação, manter inalterados os dados e o status dos cálculos envolvidos e não consumir número sequencial de cálculo que não foi gravado.

### Requirement 11: Editar cálculo migrado ou ancorado gera cálculo novo (Fase 2)

**User Story:** Como engenheiro de cálculo, quero que a edição de um cálculo migrado gere uma cópia, para nunca perder o valor original do sistema anterior.

#### Acceptance Criteria

1. WHEN o usuário aciona "Editar" sobre um Calculo_Grafico com origem migrada (origem = MIGRADO_CALCGRAF) ou com custo ancorado (custo de produção e preço de venda reais do sistema anterior gravados no cálculo), THE Menu_Calculo_Padrao SHALL criar um Calculo_Grafico novo por cópia, com os mesmos valores de todos os campos de engenharia do original, status de rascunho e origem = VIZOR, e abrir o Editor_Calculo sobre a cópia em até 3 segundos.
2. THE Menu_Calculo_Padrao SHALL manter o Calculo_Grafico original com todos os campos, o número e a Foto idênticos aos valores anteriores à ação "Editar", inclusive após a cópia ser editada, salva ou descartada.
3. WHEN a cópia é criada, THE Menu_Calculo_Padrao SHALL exibir ao usuário uma mensagem contendo o número do cálculo novo, que é único dentro da empresa e diferente do número do original.
4. WHEN o usuário aciona "Editar" sobre um Calculo_Grafico com origem = VIZOR e sem custo ancorado, THE Menu_Calculo_Padrao SHALL abrir o Editor_Calculo sobre o próprio cálculo, sem criar cópia e sem alterar a numeração.
5. WHEN a cópia é criada, THE Vizor SHALL registrar o cálculo original como origem da cópia, e o registro SHALL permanecer após o usuário salvar a cópia.
6. IF a criação da cópia falhar, THEN THE Menu_Calculo_Padrao SHALL não abrir o Editor_Calculo, exibir uma mensagem de erro indicando que a cópia não foi criada, manter o original inalterado e não deixar nenhum cálculo parcial gravado.

### Requirement 12: Editor do cálculo com layout Item/Plano (Fase 2)

**User Story:** Como engenheiro de cálculo, quero editar o cálculo no mesmo layout de Item/Plano usado no orçamento, para ter uma única experiência.

#### Acceptance Criteria

1. THE Editor_Calculo SHALL reutilizar os componentes de Item e Plano do orçamento por meio de um adaptador sobre `CalculoGrafico`, sem criar uma segunda tela de Item nem de Plano.
2. WHEN o usuário abre o Editor_Calculo, THE Editor_Calculo SHALL exibir o cabeçalho com número do cálculo (somente leitura), Linha (somente leitura, vinda do Produto_Grafico), Tiragem (editável, inteiro de 1 a 999.999.999) e Sigla (editável, até 60 caracteres).
3. WHERE o Produto_Grafico é de plano único, THE Editor_Calculo SHALL exibir os campos do plano (Cores, Processo de Impressão, Cobertura de Tinta, Suporte e Acabamento) na própria tela do item, sem grid de planos.
4. WHERE o Produto_Grafico é multi-plano, THE Editor_Calculo SHALL exibir o grid de planos com as colunas Nome, Suporte, Cores, Formato e Acabamento, e os botões "Incluir", "Copiar", "Excluir" e "Reordenar". "Incluir" e "Copiar" SHALL ser desabilitados quando o item já tem 20 planos. "Copiar" SHALL criar um novo plano com os mesmos valores do plano selecionado. "Excluir" SHALL pedir confirmação e remover somente o plano selecionado. "Reordenar" SHALL manter a nova ordem após salvar e reabrir o cálculo.
5. WHEN o usuário aciona um plano do grid, THE Editor_Calculo SHALL abrir a tela do plano (TelaPlano) preenchida com os valores atuais do plano. WHEN o usuário confirma a TelaPlano, THE Editor_Calculo SHALL voltar ao grid com a linha do plano atualizada.
6. THE Editor_Calculo SHALL exibir a lista marcável de atividades de acabamento e os botões "Itens Diversos", "Itens Fornecidos", "Campos Livres" e "Observação". WHEN o usuário aciona um desses botões, THE Editor_Calculo SHALL abrir a edição correspondente sem sair do Editor_Calculo.
7. THE Editor_Calculo SHALL determinar os campos visíveis e os valores padrão exclusivamente pelo cadastro do Produto_Grafico, sem comparar nome de produto no código. `modoFormato` define quais campos de formato aparecem (TRES_DIMENSOES, DUAS_DIMENSOES, ABERTO_FECHADO, SANFONA_ABAS ou PAGINA). `exibeRestricoes` e `exibeInformacoesComplementares` definem se a lista de Restrições e o campo Informações Complementares aparecem. O formato padrão (`formatoPadraoLargura` e `formatoPadraoAltura`) e `DefaultProdutoPlano` definem os valores iniciais de formato, cores, processo, cobertura e atividades pré-marcadas.
8. WHEN o Editor_Calculo é aberto a partir de um Item_Orcamento, THE Editor_Calculo SHALL gravar as alterações somente no cálculo desse item, sem alterar o cálculo de origem na biblioteca nem os outros itens do orçamento.
9. WHEN o usuário salva o Editor_Calculo, THE Vizor SHALL manter o custo ancorado do cálculo conforme o Requirement 9, e o custo de produção exibido após salvar SHALL ser igual (em 2 casas decimais) ao exibido antes de salvar.
10. IF o usuário tenta salvar com campo obrigatório vazio ou fora do intervalo permitido (por exemplo Tiragem fora de 1 a 999.999.999), THEN THE Editor_Calculo SHALL bloquear o salvamento, indicar cada campo inválido com mensagem de erro e manter os dados digitados.
11. IF o salvamento falhar por erro do servidor ou de rede, THEN THE Editor_Calculo SHALL exibir mensagem de erro indicando que nada foi gravado, manter os dados digitados na tela e não gravar o cálculo parcialmente.

### Requirement 13: Backfill do orçamento nº 3 de produção

**User Story:** Como responsável pelo sistema, quero corrigir o orçamento nº 3 de produção para o novo modelo, para que ele reflita o fluxo de cópia.

#### Acceptance Criteria

1. THE Backfill_Orcamento_3 SHALL ser um script armazenado no controle de versão do repositório e idempotente, de modo que executá-lo N vezes produza o mesmo estado final que executá-lo uma vez.
2. THE Backfill_Orcamento_3 SHALL executar em modo de simulação (dry-run) por padrão, sem gravar nenhum dado, e SHALL exibir ao final um relatório com o número de registros que seriam alterados e, para cada campo alterado, o valor atual e o valor novo.
3. WHEN o usuário executa o Backfill_Orcamento_3 com o parâmetro explícito de autorização de gravação, THE Backfill_Orcamento_3 SHALL gravar as alterações no banco de produção em uma única transação e exibir ao final um relatório com o número de registros efetivamente alterados.
4. IF o parâmetro explícito de autorização de gravação não foi informado, THEN THE Backfill_Orcamento_3 SHALL recusar qualquer gravação, manter o banco inalterado, e encerrar com status de saída 0 após exibir o relatório de simulação.
5. WHEN o Backfill_Orcamento_3 executa com autorização de gravação, THE Backfill_Orcamento_3 SHALL, para o orçamento nº 3 e seus itens, resolver `produtoGraficoId` e `tipoPlanoId`, copiar margem, CM e CEV da Foto, aplicar a Decomposicao_STC e preencher o Plano_Base do item, conforme o Requirement 6 e o Requirement 8.
6. WHEN o Backfill_Orcamento_3 executa com autorização de gravação uma segunda vez seguida, THE Backfill_Orcamento_3 SHALL alterar 0 registros e preservar todos os campos do orçamento nº 3, de seus itens e de seus planos com os mesmos valores da primeira execução.
7. THE Backfill_Orcamento_3 SHALL manter, após a execução, o custo do item do cálculo 12992 igual a R$ 5.192,05 e o valor igual a R$ 15.084,04, sem diferença de centavos.
8. THE Backfill_Orcamento_3 SHALL filtrar por `empresaId` explícito, informado como parâmetro de execução, em toda query de leitura e de gravação.
9. THE Backfill_Orcamento_3 SHALL receber a connection string do banco exclusivamente por variável de ambiente, sem gravá-la em arquivo versionado e sem exibi-la na saída ou em logs.
10. IF o `empresaId` ou a variável de ambiente da connection string não for informado, THEN THE Backfill_Orcamento_3 SHALL encerrar com status de saída diferente de 0 e mensagem indicando o parâmetro ausente, sem abrir conexão de escrita nem alterar dados.
11. IF, em execução com autorização de gravação, a resolução de `produtoGraficoId` ou `tipoPlanoId` falhar para qualquer item, ou o custo ou valor do item do cálculo 12992 divergir de R$ 5.192,05 ou R$ 15.084,04 após a aplicação, THEN THE Backfill_Orcamento_3 SHALL reverter a transação inteira, encerrar com status de saída diferente de 0 e informar no relatório o item e o motivo da falha, deixando o banco no estado anterior à execução.

### Requirement 14: Listagem de Cálculos (Fase 3)

**User Story:** Como gestor, quero uma listagem de cálculos para consulta e relatório, para analisar o acervo.

#### Acceptance Criteria

1. THE Vizor SHALL exibir o item de menu "Listagem de Cálculos" no menu Vendas → Orçamento, visível para todo usuário com acesso ao módulo Orçamento Gráfico.
2. THE Listagem_Calculos SHALL oferecer exatamente os mesmos critérios de filtro do Seletor_Calculo_Padrao, com a mesma rotulagem e o mesmo comportamento de combinação (todos os filtros preenchidos aplicados em conjunto, como E lógico).
3. THE Listagem_Calculos SHALL listar somente cálculos cujo empresaId seja o da empresa da sessão, mesmo quando o usuário for SUPER_ADMIN, e SHALL excluir cálculos de qualquer outra empresa dos resultados e dos totais de paginação.
4. WHEN o usuário aciona "Buscar", THE Listagem_Calculos SHALL exibir, em até 3 segundos para acervos de até 10.000 cálculos, somente os cálculos que atendem a todos os filtros preenchidos, paginados em 20 registros por página, com indicação do total de registros encontrados e navegação entre páginas.
5. WHEN o usuário aciona uma linha da Listagem_Calculos, THE Vizor SHALL abrir o cálculo correspondente em modo de consulta (somente leitura, sem controles de edição, gravação ou recálculo habilitados).
6. IF a busca não encontrar nenhum cálculo que atenda aos filtros, THEN THE Listagem_Calculos SHALL exibir uma mensagem indicando que nenhum cálculo foi encontrado, sem linhas na grade, e SHALL manter os filtros preenchidos.
7. IF a busca falhar por erro do servidor ou de rede, THEN THE Listagem_Calculos SHALL exibir uma mensagem de erro indicando a falha na consulta, preservar os filtros preenchidos e a página anterior exibida, e permitir que o usuário acione "Buscar" novamente.
8. IF o usuário acionar uma linha cujo cálculo não exista mais ou pertença a outra empresa, THEN THE Vizor SHALL exibir uma mensagem indicando que o cálculo não foi encontrado e SHALL manter o usuário na Listagem_Calculos com os filtros e a página preservados.

### Requirement 15: Emissão de Pré-Cálculo em PDF (Fase 3)

**User Story:** Como orçamentista, quero emitir o Pré-Cálculo em PDF, para consultar a memória de cálculo e compartilhá-la.

#### Acceptance Criteria

1. THE Vizor SHALL exibir o item de menu "Emissão de Pré-Cálculo" em Vendas → Orçamento.
2. WHEN o usuário aciona "Emitir" sobre um cálculo da empresa da sessão que possui Foto ou Decomposicao_STC, THE PreCalculo_PDF SHALL gerar um arquivo PDF contendo as seções Material Direto, Custo de Transformação, Custo de Produção e Margens, montadas a partir da Foto e da Decomposicao_STC, e disponibilizá-lo ao usuário para visualização e download em até 10 segundos.
3. THE PreCalculo_PDF SHALL exibir, para cada valor monetário de Material Direto, Custo de Transformação, Custo de Produção, Margens, Valor Unitário e Valor Total, o mesmo valor exibido na tela do cálculo, com 2 casas decimais e sem diferença de centavos.
4. THE PreCalculo_PDF SHALL omitir qualquer menção ao sistema legado e a seus fornecedores em todo o conteúdo do documento, incluindo textos, cabeçalhos, rodapés, nomes de seções e propriedades do arquivo (título, autor e assunto).
5. IF o cálculo informado pertence a outra empresa que não a da sessão, THEN THE PreCalculo_PDF SHALL recusar a geração, exibir mensagem de erro indicando que o cálculo não foi encontrado e não gerar nem retornar nenhum conteúdo do cálculo.
6. IF o cálculo não possui Foto nem Decomposicao_STC, THEN THE PreCalculo_PDF SHALL exibir a mensagem "Cálculo sem memória de cálculo disponível" e não gerar arquivo PDF.
7. IF ocorrer falha na geração do PDF, THEN THE PreCalculo_PDF SHALL exibir mensagem de erro indicando que a emissão falhou e que o usuário pode tentar novamente, mantendo inalterados os dados do cálculo.

### Requirement 16: Textos visíveis, tema e sessão

**User Story:** Como usuário final, quero uma interface consistente e neutra, para usar o Vizor sem referências a outros sistemas.

#### Acceptance Criteria

1. THE Vizor SHALL exibir os textos visíveis das telas, diálogos, mensagens de erro, rótulos, títulos de aba, dicas de campo e PDFs desta feature sem as palavras "Calcgraf", "G-Print" ou "PHTech", em qualquer combinação de maiúsculas e minúsculas e com ou sem hífen ou espaço (por exemplo "calcgraf", "G Print", "GPrint").
2. THE Vizor SHALL usar tokens de cor adaptativos do Mantine (por exemplo `--mantine-color-body`, `--mantine-color-default`, `--mantine-color-text` e as variantes `*-light`) para fundos, bordas e textos de todas as telas e diálogos desta feature. THE Vizor SHALL NOT usar cores fixas de fundo (hexadecimal, `rgb()` ou tons claros fixos como `-0`) nessas telas e diálogos.
3. WHILE o tema ativo for claro ou escuro, THE Vizor SHALL exibir todo texto e todo botão desta feature com contraste mínimo de 4,5:1 em relação ao fundo.
4. THE Vizor SHALL obter token e empresa da sessão exclusivamente por `authStorage`. THE Vizor SHALL NOT ler nem gravar token ou empresa diretamente em `localStorage`, `sessionStorage` ou cookie nas telas desta feature.
5. WHEN a empresa da sessão muda, THE Vizor SHALL recarregar as listas e os detalhes exibidos nas telas desta feature em até 2 segundos, usando o token da nova empresa.
6. WHEN a empresa da sessão muda, THE Vizor SHALL exibir somente dados da empresa ativa, sem manter na tela nem em cache nenhum registro da empresa anterior.
7. IF a requisição de recarga após a troca de empresa falhar, THEN THE Vizor SHALL limpar os dados da empresa anterior da tela e exibir uma mensagem de erro com a opção de tentar novamente.
8. WHILE duas abas do navegador estiverem abertas com empresas diferentes, THE Vizor SHALL manter em cada aba a empresa e os dados da sessão dessa aba, sem alterar a outra aba.

### Requirement 17: Isolamento por empresa

**User Story:** Como administrador, quero garantir que nenhum dado vaze entre empresas, para manter a segurança multi-tenant.

#### Acceptance Criteria

1. THE Vizor SHALL aplicar, em 100% das queries Prisma desta feature (Calculo_Grafico, Item_Orcamento, Plano_Base e suas filhas), um filtro explícito por `empresaId` da sessão do usuário (diretamente ou via relação com o registro pai), sem depender somente de `prismaScoped`, inclusive quando o usuário tem perfil SUPER_ADMIN.
2. WHEN o usuário de uma empresa consulta, altera ou exclui por id um cálculo, orçamento, item ou plano pertencente a outra empresa, THE Vizor SHALL retornar HTTP 404, não retornar nenhum campo do registro, não alterar nenhum dado e manter o registro intacto na empresa de origem.
3. WHEN o Servico_Copia cria Calculo_Grafico, Item_Orcamento ou Plano_Base a partir de um cálculo real, THE Servico_Copia SHALL gravar em cada registro criado o `empresaId` do cálculo real de origem, e não o `empresaId` do usuário logado.
4. IF o cálculo de origem informado à cópia pertencer a empresa diferente da sessão do usuário, THEN THE Servico_Copia SHALL rejeitar a operação com HTTP 403, indicando que o cálculo não pertence à empresa do usuário, e SHALL NOT criar nenhum registro, mantendo o estado anterior inalterado.
5. WHEN o Seletor_Calculo_Padrao executa uma busca, THE Seletor_Calculo_Padrao SHALL retornar somente cálculos cujo `empresaId` é igual ao da sessão, e SHALL retornar lista vazia, sem erro, quando a empresa da sessão não tem cálculos.
6. WHEN a empresa A e a empresa B possuem registros com o mesmo número ou código, THE Vizor SHALL retornar, em qualquer consulta ou busca desta feature feita por usuário da empresa A, apenas o registro da empresa A.

### Requirement 18: Schema e migração de produção

**User Story:** Como responsável pelo deploy, quero que o schema e a migração de produção andem juntos, para não dessincronizar o banco.

#### Acceptance Criteria

1. WHEN um commit altera `prisma/schema.prisma` com nova tabela, coluna ou índice desta feature, THE Vizor SHALL incluir no mesmo commit a alteração equivalente em `prisma/migrate-prod.ts`.
2. THE `migrate-prod.ts` SHALL usar apenas comandos idempotentes para as alterações desta feature: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`. Para `ADD CONSTRAINT`, SHALL usar um `try/catch` individual por constraint.
3. WHEN o `migrate-prod.ts` executa duas vezes seguidas contra o mesmo banco, THE `migrate-prod.ts` SHALL concluir a segunda execução com código de saída 0, sem lançar erro, sem criar tabela, coluna ou índice duplicado e sem alterar o número de linhas das tabelas existentes.
4. IF o `migrate-prod.ts` falha ao aplicar uma alteração desta feature, THEN THE `migrate-prod.ts` SHALL registrar no log de saída o nome da tabela ou coluna que falhou e SHALL terminar com código de saída diferente de 0, sem remover tabelas, colunas ou dados existentes.
5. WHEN o `migrate-prod.ts` adiciona uma coluna a uma tabela que já contém registros, THE `migrate-prod.ts` SHALL criar a coluna como `NULL` ou com valor `DEFAULT`, de modo que nenhum registro existente seja alterado ou rejeitado.
6. WHEN uma coluna nova é adicionada, THE `migrate-prod.ts` SHALL manter inalterados os valores de custo já gravados (`custoProducao`, `valorTotalConsolidado` e `resultadoCalculo`) em todos os registros existentes.
7. THE Vizor SHALL manter a restrição única `(empresaId, numero)` em `CalculoGrafico`, de modo que, ao inserir um segundo registro com o mesmo `empresaId` e `numero`, o banco rejeite a inserção por violação de unicidade. Registros de empresas diferentes podem repetir o mesmo `numero`.

### Requirement 19: Tela dirigida pelo cadastro do Produto Gráfico

**User Story:** Como administrador, quero configurar o comportamento dos itens pelo cadastro, para criar produtos novos sem alterar o código.

#### Acceptance Criteria

1. WHEN o usuário abre o editor de um item de orçamento cujo Produto_Grafico não possui plano fixo (conforme `DefaultProdutoPlano` e `TipoPlanoGrafico.fixo`), THE Vizor SHALL exibir o grid "Tipos de Plano" com os botões Incluir, Copiar, Excluir, Trocar/Reordenar e Desfazer, e SHALL ocultar na tela do item os campos de plano (Cores, Processo de Impressão, Cobertura de Tinta, Suporte e Acabamento).
2. WHEN o usuário abre o editor de um item de orçamento cujo Produto_Grafico possui plano fixo (conforme `DefaultProdutoPlano` e `TipoPlanoGrafico.fixo`), THE Vizor SHALL exibir os campos do plano único (Cores, Processo de Impressão, Cobertura de Tinta, Suporte e Acabamento) na própria tela do item, sem exibir o grid "Tipos de Plano".
3. WHEN o usuário abre o editor de um item, THE Vizor SHALL exibir os campos de formato correspondentes ao `modoFormato` do Produto_Grafico, sendo exatamente um dos conjuntos: TRES_DIMENSOES (Comp x Larg x Alt), DUAS_DIMENSOES (Formato Final), ABERTO_FECHADO (Formato Aberto e Formato Fechado), SANFONA_ABAS ou PAGINA.
4. WHEN o usuário abre o editor de um item cujo Produto_Grafico define `formatoPadraoLargura` e `formatoPadraoAltura`, THE Vizor SHALL preencher os campos de formato com esses valores e mantê-los editáveis.
5. WHEN o usuário abre o editor de um item, THE Vizor SHALL exibir a lista de Restrições se `exibeRestricoes` for verdadeiro no Produto_Grafico e ocultá-la se for falso.
6. WHEN o usuário abre o editor de um item, THE Vizor SHALL exibir o campo Informações Complementares se `exibeInformacoesComplementares` for verdadeiro no Produto_Grafico e ocultá-lo se for falso.
7. WHEN o usuário abre o editor de um item cujo Produto_Grafico tem `semImpressao` verdadeiro, THE Vizor SHALL ocultar os campos Cores, Processo de Impressão e Cobertura de Tinta.
8. WHEN o usuário altera o Produto_Grafico de um item já aberto no editor, THE Vizor SHALL reavaliar, em até 1 segundo e sem recarregar a página, a visibilidade e os valores padrão de todos os campos conforme o cadastro do novo produto.
9. IF a troca de Produto_Grafico ocultar um campo que o usuário já preencheu, THEN THE Vizor SHALL pedir confirmação antes de descartar o valor, e SHALL manter o produto anterior e o valor preenchido se o usuário cancelar.
10. IF o cadastro do Produto_Grafico do item não puder ser carregado (inexistente, inativo ou erro de comunicação), THEN THE Vizor SHALL exibir mensagem de erro indicando a falha ao carregar o cadastro, bloquear o salvamento do item e preservar os dados já digitados na tela.
11. THE Vizor SHALL manter o código-fonte desta feature sem comparações com nomes fixos de produto ou de linha de produto (por exemplo "Cartucho", "Lâmina Simples", "Impressos", "Venda de Cartão"), verificável por busca textual nos arquivos da feature que retorne 0 ocorrências.

### Requirement 20: Verificação e não regressão

**User Story:** Como mantenedor, quero testes que protejam o fluxo, para evitar regressões no valor dos cálculos.

#### Acceptance Criteria

1. THE Vizor SHALL incluir testes automatizados do Servico_Copia que verifiquem, em casos separados: (a) a cópia recebe um número maior que o maior número existente na empresa e nunca repete um número já usado; (b) a cópia fica vinculada ao Calculo_Origem pelo identificador dele; (c) IF qualquer etapa da cópia falhar, THEN o teste confirma que nenhum registro parcial permanece (zero registros novos na empresa) e que o Calculo_Origem não foi alterado.
2. WHEN o Servico_Copia concluir a cópia de qualquer Calculo_Padrao usado nos testes, THE Servico_Copia SHALL deixar o Calculo_Origem com todos os campos persistidos idênticos aos do estado anterior à cópia (incluindo a Foto e o custo de produção), com diferença zero em comparação campo a campo.
3. WHEN um cálculo migrado for copiado, THE Servico_Copia SHALL gerar um item cujo custo de produção seja igual ao custo de produção da Foto do Calculo_Origem, com diferença absoluta de R$ 0,00 (comparação em 2 casas decimais), para todos os cálculos migrados incluídos na verificação.
4. WHEN o cálculo 12992 for copiado, THE Vizor SHALL apresentar custo de produção R$ 5.192,05, valor R$ 15.084,04, Margem 47,62%, C.Marg. 55,01% e Valor Unitário 3,77101 (5 casas decimais), sem tolerância de divergência, e o teste de regressão SHALL verificar esses valores nos três momentos: logo após puxar o cálculo, ao editar o item e ao salvar o item.
5. IF um usuário solicitar a cópia de um cálculo pertencente a outra empresa, THEN THE Servico_Copia SHALL recusar a cópia com erro de acesso negado, SHALL NOT criar nenhum registro, e o teste automatizado SHALL confirmar o erro e a contagem zero de registros criados.
6. WHEN o item copiado de um Calculo_Origem com custo ancorado for recalculado ou salvo, THE Vizor SHALL manter o custo de produção ancorado igual ao do Calculo_Origem (diferença de R$ 0,00), e o teste automatizado SHALL cobrir os casos de item com origem (custo ancorado preservado) e de item sem origem (sem ancoragem).
7. WHEN a suíte de testes do módulo orçamento-gráfico e do Motor_Guard for executada, THE Vizor SHALL concluí-la com 0 testes falhando.
