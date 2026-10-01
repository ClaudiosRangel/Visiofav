# Requirements Document

## Introduction

Esta feature implementa no Vizor o **Mapa de Localização de Custos (MLC)** pela
metodologia **RKW**, replicando o que a Carton Wega hoje recebe via consultoria
paga externa do Calcgraf/WebGraf. O sistema apropria o custo fixo mensal da
empresa (salários+encargos, depreciação, despesas) nos centros de custo, rateia
os centros auxiliares e administrativos sobre os produtivos, e calcula o
**Custo/Hora** de cada centro produtivo. O custo-hora resultante alimenta o
módulo de Orçamento Gráfico já existente (via `CentroProducao.custoHora`).

Referências de domínio: `docs/calcgraf-gprint-levantamento.md` (§2–§13,
RI-1..RI-6). Escopo = Bloco 3 do plano de ação (`docs/calcgraf-plano-de-acao.md`).
Fora de escopo: camada gerencial (Bloco 4) e paridade do orçamento (Bloco 1).

## Glossary

- **Mapa de Custos**: uma "foto" do custeio de uma competência (mês/ano). Versionado e imutável após fechar.
- **Centro de Custo**: setor da empresa. Natureza: Produtivo (vende horas), Auxiliar (apoio, rateado) ou Administração (rateado).
- **Custo Fixo**: salários+encargos + depreciação + despesas de um centro.
- **Chave de Rateio**: critério reutilizável que distribui um valor entre centros por pesos (manuais ou automáticos por headcount/ativo).
- **Custo/Hora**: custo fixo final do centro produtivo ÷ horas produtivas. Variações: Apurado, A Praticar (com ajuste %), Praticado.
- **RKW**: metodologia de custeio pleno (apropria todos os custos aos produtos).
- **A.C. (Ajuda de Custo)**: valor pago ao funcionário fora dos encargos sociais.

## Requirements

### Requisito 1: Gestão de Mapas de Custo por competência

**User Story:** Como controller/gestor da gráfica, quero criar e versionar mapas
de custo por competência, para manter o histórico e comparar meses diferentes.

#### Critérios de Aceitação
1. QUANDO o usuário cria um mapa THE sistema SHALL exigir uma competência única por empresa (formato AAAA-MM) e criar o mapa com status RASCUNHO.
2. WHERE já existe mapa para a mesma competência e empresa THE sistema SHALL rejeitar a criação com mensagem clara.
3. QUANDO o usuário solicita duplicar de outra competência THE sistema SHALL copiar todos os cadastros (centros, bens, funcionários, despesas, chaves) para o novo mapa em RASCUNHO.
4. QUANDO o usuário fecha um mapa THE sistema SHALL mudar o status para FECHADO e registrar a data de fechamento.
5. WHILE o mapa está FECHADO THE sistema SHALL rejeitar qualquer escrita em seus cadastros com HTTP 409.
6. THE sistema SHALL filtrar todos os mapas e cadastros por empresaId, retornando 404 para ids de outra empresa.

### Requisito 2: Cadastro de Centros de Custo

**User Story:** Como controller, quero classificar os setores em centros de custo
produtivos, auxiliares e administrativos, para estruturar o rateio.

#### Critérios de Aceitação
1. QUANDO o usuário cadastra um centro THE sistema SHALL exigir código único no mapa, descrição e natureza (PRODUTIVO, AUXILIAR ou ADMINISTRACAO).
2. WHERE a natureza é PRODUTIVO THE sistema SHALL calcular horasProdutivas = unidadesProdutivas × horasProdutivasBase (do mapa) + horasExtras.
3. THE sistema SHALL permitir vincular opcionalmente um CentroProducao operacional ao centro de custo produtivo (para posterior aplicação do custo-hora).
4. QUANDO o usuário define uso no orçamento THE sistema SHALL registrar o flag usoOrcamento.

### Requisito 3: Cadastro de Bens a Depreciar e cálculo de depreciação

**User Story:** Como controller, quero cadastrar o ativo imobilizado por centro,
para que a depreciação mensal entre no custo fixo.

#### Critérios de Aceitação
1. QUANDO o usuário cadastra um bem THE sistema SHALL exigir centro, grupo, descrição, valor, estado (OTIMO/BOM/REGULAR), anos de vida útil e percentual residual.
2. QUANDO o mapa é calculado THE sistema SHALL calcular a depreciação mensal do bem = (valor − valor × residual%/100) ÷ (anos × 12), modulada pelo fator de estado.
3. THE sistema SHALL somar a depreciação de todos os bens de um centro na coluna Depreciações (B) do resultado do centro.
4. THE sistema SHALL consolidar o total de ativo imobilizado e a depreciação mensal total no mapa.

### Requisito 4: Cadastro de Funcionários e encargos

**User Story:** Como controller, quero lançar os funcionários por centro com
salário e ajuda de custo, para compor a mão de obra do custo fixo.

#### Critérios de Aceitação
1. QUANDO o usuário cadastra um funcionário THE sistema SHALL exigir nome, salário e (para não-rateados) o centro de custo.
2. QUANDO o mapa é calculado THE sistema SHALL compor o custo de mão de obra do funcionário = salário × (1 + percEncargos/100) + ajudaCusto.
3. WHERE o funcionário é marcado como rateado THE sistema SHALL distribuir seu custo entre centros conforme uma Chave de Rateio do tipo FUNCIONARIO.
4. THE sistema SHALL somar o custo de mão de obra dos funcionários de cada centro na coluna Salários+Encargos (A) do resultado.
5. THE sistema SHALL consolidar o total de funcionários no mapa.

### Requisito 5: Cadastro de Despesas com chave de rateio

**User Story:** Como controller, quero lançar as despesas mensais com o critério
de rateio de cada uma, para distribuí-las corretamente entre os centros.

#### Critérios de Aceitação
1. QUANDO o usuário cadastra uma despesa THE sistema SHALL exigir descrição, valor e uma Chave de Rateio.
2. QUANDO o mapa é calculado THE sistema SHALL ratear o valor da despesa entre os centros conforme a chave, somando na coluna Despesas (C) do resultado de cada centro.
3. THE sistema SHALL consolidar o custo fixo total do mapa = soma de (A + B + C) de todos os centros.

### Requisito 6: Motor de Chaves de Rateio

**User Story:** Como controller, quero definir chaves de rateio reutilizáveis
com pesos manuais ou automáticos, para não repetir a distribuição em cada item.

#### Critérios de Aceitação
1. THE sistema SHALL suportar os tipos de chave: MANUAL (pesos fixos por destino), HEADCOUNT (peso = nº de funcionários do centro), ATIVO (peso = valor dos bens do centro), CENTRO (destino único a 100%) e FUNCIONARIO (rateio de um funcionário específico).
2. QUANDO uma chave distribui um valor THE sistema SHALL calcular o percentual de cada destino = peso do destino ÷ soma dos pesos, de modo que a soma dos percentuais seja 100%.
3. IF uma chave não tem destinos OU a soma dos pesos é zero THEN THE sistema SHALL rejeitar o cálculo apontando a chave problemática, sem dividir por zero.

### Requisito 7: Cálculo do Custo/Hora (rateio em 2 níveis)

**User Story:** Como controller, quero que o sistema rateie auxiliares e
administração sobre os produtivos e calcule o custo-hora, para eu formar preço.

#### Critérios de Aceitação
1. QUANDO o usuário solicita calcular o mapa THE sistema SHALL computar por centro o Custo Fixo (D) = Salários+Encargos (A) + Depreciações (B) + Despesas (C).
2. QUANDO calcula o rateio de 2º nível THE sistema SHALL distribuir o custo fixo de cada centro AUXILIAR na coluna Rateio Auxiliar (E) dos produtivos, e de cada centro ADMINISTRACAO na coluna Rateio Administração (F) dos produtivos, conforme suas chaves.
3. THE sistema SHALL calcular por centro produtivo o Custo Fixo Final (G) = D + E + F.
4. WHERE horasProdutivas > 0 THE sistema SHALL calcular Custo/Hora Apurado = G ÷ horasProdutivas.
5. THE sistema SHALL calcular Custo/Hora A Praticar = Custo/Hora Apurado × (1 + ajustePraticarPerc/100).
6. IF horasProdutivas = 0 para um centro produtivo THEN THE sistema SHALL marcar o custo-hora como não calculado (N/A), sem dividir por zero.
7. QUANDO o cálculo termina THE sistema SHALL consolidar no mapa: custo fixo total, taxa administrativa (soma dos centros ADMINISTRACAO ÷ custo fixo total).
8. QUANDO o usuário recalcula o mesmo mapa THE sistema SHALL produzir resultados idênticos, sem acumular valores de execuções anteriores.

### Requisito 8: Integração com o Orçamento Gráfico

**User Story:** Como controller, quero aplicar os custos-hora calculados nas
máquinas do orçamento, para que o preço use os custos atualizados.

#### Critérios de Aceitação
1. QUANDO o usuário solicita aplicar ao orçamento THE sistema SHALL gravar o Custo/Hora A Praticar de cada centro produtivo no campo custoHora do CentroProducao vinculado.
2. WHERE um centro produtivo não tem CentroProducao vinculado THE sistema SHALL pular esse centro e reportar quais foram aplicados e quais foram pulados.
3. THE sistema SHALL permitir a ação de aplicar ao orçamento mesmo com o mapa FECHADO.

### Requisito 9: Relatórios do Mapa de Custos

**User Story:** Como controller, quero ver os relatórios do mapa (custos/hora,
composição, distribuição), para analisar e apresentar os resultados.

#### Critérios de Aceitação
1. THE sistema SHALL fornecer o relatório Composição do Custo Hora, exibindo por centro as colunas A, B, C, D, E, F, G, horas e custo/hora.
2. THE sistema SHALL fornecer o relatório Distribuição do Custo Fixo, exibindo o valor e o percentual de cada centro sobre o total.
3. THE sistema SHALL fornecer o relatório Mapa Custos/Hora (Resultado Apurado) com Custo/Hora Apurado, A Praticar e o ajuste percentual por centro produtivo.

### Requisito 10: Interface de usuário (módulo PCP → Custos)

**User Story:** Como controller, quero uma tela para operar o mapa de custos,
para cadastrar os dados, calcular e aplicar sem depender de consultoria externa.

#### Critérios de Aceitação
1. THE sistema SHALL exibir uma lista de mapas por competência com indicação visual de status (Rascunho/Fechado).
2. THE sistema SHALL fornecer um editor com abas para Centros, Bens, Funcionários, Despesas, Chaves de Rateio, Parâmetros e Resultado.
3. QUANDO o usuário aciona Calcular na aba Resultado THE sistema SHALL exibir a tabela de composição do custo hora atualizada.
4. THE sistema SHALL disponibilizar as ações Calcular, Fechar e Aplicar ao Orçamento na interface.
