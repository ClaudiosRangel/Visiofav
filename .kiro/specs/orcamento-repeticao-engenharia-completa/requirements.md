# Requirements Document

## Introduction

Ao "Puxar Cálculo" da Biblioteca (7.951 cálculos migrados do Calcgraf) e criar
um orçamento, o item nasce com a **foto** correta (valor/C.PROD batem 100% com o
Calcgraf), mas os **campos estruturados de engenharia** (papel, gramatura,
suporte, máquina, acabamentos, preço das cores) vêm incompletos — a migração em
lote gravou só a foto (`resultado_calculo`), não a engenharia estruturada. Com
isso, ao editar o item no wizard, os passos abrem com campos vazios e o recálculo
falha ("Dados inválidos").

O padrão de mercado (Sage, Certinia, Printavo, CERM) e o próprio Calcgraf são
unânimes: **reaproveitar um cálculo = cópia COMPLETA e EDITÁVEL de toda a
engenharia**, e **repetição é um tipo de 1ª classe** com rastro da origem
(Calcgraf: `CodCalculoPadrao`/`[TipoOp]`). Ver
`docs/estudo-reaproveitamento-calculo-repeticao.md`.

Esta feature torna o "puxar cálculo" um **orçamento de repetição com engenharia
completa**, por duas vias combinadas:
- **Sob demanda:** ao usar um cálculo migrado incompleto, o sistema **completa a
  engenharia a partir da própria foto rica** (de-para para os cadastros do
  Vizor). O que não casar com segurança fica **"A COMPLETAR"** (visível, nunca
  inventado).
- **Lote prioritário:** um script antecipa esse enriquecimento nos **366
  produtos que mais repetem em 2026** (56 com 5+ orçamentos; 310 com 2–4).

Inclui marcar **NOVO | REPETIÇÃO**, exibir o badge, e uma **conferência foto ×
recálculo** (anti-vergonha) que nunca altera a foto.

Dados de 2026 (base restaurada): 2.292 cálculos distintos, 1.388 produtos; a
repetição se agrupa por **produto/descrição** (cliente quase sempre ausente no
cálculo).

Fora de escopo: motor de cálculo (não se reescreve), PCP (intocado), e as demais
features do roadmap de orçamento gráfico.

## Glossary

- **Calculo_Biblioteca**: entidade `CalculoGrafico` (foto + campos de engenharia),
  `origem` ∈ {`MIGRADO_CALCGRAF`, `VIZOR`}.
- **Foto_Rica**: `CalculoGrafico.resultadoCalculo` (JSON, `versaoFoto:2`) — o
  pré-cálculo inteiro do Calcgraf (planos, suportes, tintas, mat.acabamento,
  impressão, acabamentos, custos, CEV, margens). **Imutável** nesta feature.
- **Engenharia_Estruturada**: os campos tipados do `CalculoGrafico`/
  `ItemOrcamentoGrafico` usados pelo motor e pelo wizard: `papelId`, `suporteId`,
  `gramatura`, `cores` (com preço/rendimento), `maquinaId`, `acabamentosRicos`,
  `aproveitamentoManual`, montagem/formatos.
- **Engenharia_Incompleta**: `Calculo_Biblioteca` cujo conjunto mínimo de
  Engenharia_Estruturada para recalcular está ausente (ex.: `papelId`/
  `gramatura` nulos, cores com preço 0).
- **Enriquecimento**: preencher a Engenharia_Estruturada a partir da Foto_Rica +
  de-para para os cadastros do Vizor (papel/suporte/cores/acabamentos/máquina).
- **De_Para**: resolução de um nome da Foto_Rica para o id de um cadastro do
  Vizor (`PrecoMateriaPrima`, `SuporteGrafico`, `AcabamentoGrafico`,
  `CentroProducao`).
- **A_Completar**: marcação de um campo de engenharia que o Enriquecimento não
  conseguiu resolver com segurança (fica pendente de preenchimento pelo operador;
  nunca recebe valor inventado).
- **Tipo_Orcamento**: classificação do orçamento ∈ {`NOVO`, `REPETICAO`}.
- **Orcamento_Repeticao**: `Orcamento_Grafico` com `Tipo_Orcamento = REPETICAO`,
  criado ao puxar um Calculo_Biblioteca; mantém o vínculo de origem
  (`ItemOrcamentoGrafico.calculoGraficoOrigemId`).
- **Conferencia**: comparação, ao recalcular, entre o valor recalculado pelo
  motor (Vizor) e o da Foto_Rica (Calcgraf), por componente e total, com desvio %.
- **Lote_Prioritario**: os 366 produtos que mais repetem em 2026 (56 com ≥5; 310
  com 2–4 orçamentos).
- **Empresa_Id**: tenant (`empresaId`), isolamento multi-empresa.
- **Sistema**: o Vizor (backend `VisioFab.Wms.Back` + frontend
  `VisioFab.Wms.Front`).

## Requirements

### Requirement 1: Enriquecimento sob demanda ao usar um cálculo incompleto

**User Story:** Como operador, quero que ao puxar um cálculo migrado o orçamento
já venha com a engenharia preenchida, para editar/recalcular sem redigitar.

#### Acceptance Criteria

1. WHEN o operador usa um Calculo_Biblioteca com `origem = MIGRADO_CALCGRAF` e Engenharia_Incompleta para criar um Orcamento_Repeticao, THE Sistema SHALL executar o Enriquecimento a partir da Foto_Rica antes de popular o Item_Orcamento.
2. WHEN o Sistema executa o Enriquecimento, THE Sistema SHALL resolver, via De_Para, `papelId`/`suporteId`, `gramatura`, preço/rendimento de cada cor, `acabamentosRicos` e `maquinaId` a partir dos nomes/dados presentes na Foto_Rica.
3. WHERE um campo não puder ser resolvido com segurança pelo De_Para, THE Sistema SHALL marcar esse campo como A_Completar e NÃO atribuir valor inventado.
4. WHEN o Enriquecimento resolve um campo com segurança, THE Sistema SHALL gravar o valor resolvido na Engenharia_Estruturada.
5. THE Sistema SHALL preservar a Foto_Rica (`resultadoCalculo`) inalterada durante todo o Enriquecimento.

### Requirement 2: Melhora progressiva (gravar engenharia de volta no cálculo)

**User Story:** Como operador, quero que um cálculo que já completei venha pronto
na próxima vez, para não refazer o mesmo ajuste.

#### Acceptance Criteria

1. WHEN o Enriquecimento de um Calculo_Biblioteca resolve campos com segurança, THE Sistema SHALL persistir esses campos resolvidos de volta no próprio Calculo_Biblioteca de origem.
2. THE Sistema SHALL gravar no Calculo_Biblioteca os campos resolvidos sem alterar sua Foto_Rica nem seus totais (`custoProducao`/`valorTotal`).
3. WHEN um Calculo_Biblioteca já tem a Engenharia_Estruturada completa, THE Sistema SHALL usá-la diretamente sem reexecutar o De_Para.
4. THE Sistema SHALL filtrar e gravar por `Empresa_Id` explícito em toda operação de Enriquecimento.

### Requirement 3: Lote prioritário dos cálculos que mais repetem

**User Story:** Como administrador, quero enriquecer antecipadamente os cálculos
mais usados, para que o operador quase nunca veja campos pendentes.

#### Acceptance Criteria

1. THE Sistema SHALL oferecer um procedimento de Enriquecimento em lote sobre o Lote_Prioritario.
2. WHEN o procedimento em lote roda, THE Sistema SHALL aplicar o MESMO Enriquecimento usado sob demanda (mesma regra de De_Para e de A_Completar).
3. WHEN o procedimento em lote conclui, THE Sistema SHALL produzir um relatório com a contagem de campos resolvidos e de campos A_Completar por cálculo.
4. THE Sistema SHALL ser idempotente: reexecutar o lote não altera cálculos já completos nem duplica dados.
5. THE Sistema SHALL NÃO alterar nenhum dado do PCP durante o procedimento em lote.

### Requirement 4: Tipo de orçamento (NOVO | REPETIÇÃO) com rastro da origem

**User Story:** Como operador, quero ver que um orçamento é de repetição e de
qual cálculo veio, para tratá-lo como reaproveitamento.

#### Acceptance Criteria

1. WHEN o operador cria um orçamento puxando um Calculo_Biblioteca, THE Sistema SHALL registrar `Tipo_Orcamento = REPETICAO` no orçamento.
2. WHEN o operador cria um orçamento em branco, THE Sistema SHALL registrar `Tipo_Orcamento = NOVO`.
3. WHEN o Sistema cria um Orcamento_Repeticao, THE Sistema SHALL gravar o vínculo de origem no item (`calculoGraficoOrigemId` = id do cálculo).
4. WHERE um orçamento é REPETICAO, THE Sistema SHALL exibir um indicador "Repetição" na tela do orçamento e no relatório/proposta.

### Requirement 5: Edição parte da engenharia existente (precedência)

**User Story:** Como operador, quero que ao editar um item de repetição todos os
campos já venham preenchidos, para alterar só o que eu quiser.

#### Acceptance Criteria

1. WHEN o operador abre a edição de um Item_Orcamento de um Orcamento_Repeticao, THE Sistema SHALL popular todos os passos do wizard com a Engenharia_Estruturada do item.
2. WHILE o operador não altera um campo, THE Sistema SHALL preservar o valor copiado/completado (não substituir por padrão do sistema).
3. WHERE houver campos A_Completar no item, THE Sistema SHALL sinalizá-los no wizard de forma visível.
4. WHEN o operador recalcula um item com algum campo A_Completar ainda pendente, THE Sistema SHALL informar quais campos faltam preencher (mensagem por campo), sem valor genérico.

### Requirement 6: Conferência foto × recálculo (anti-vergonha)

**User Story:** Como operador, quero ver se o recálculo bate com o valor original
do Calcgraf antes de enviar ao cliente, para não passar vergonha.

#### Acceptance Criteria

1. WHEN o operador recalcula um Item_Orcamento vinculado a um Calculo_Biblioteca, THE Sistema SHALL apresentar a Conferencia entre o valor recalculado (Vizor) e o da Foto_Rica (Calcgraf), por componente e total, com o desvio percentual.
2. WHERE o desvio total for menor ou igual a 0,5%, THE Sistema SHALL indicar a Conferencia como "confere".
3. WHERE o desvio total for maior que 0,5% OU o recálculo não for possível, THE Sistema SHALL exibir um alerta com o motivo.
4. THE Sistema SHALL permitir ao operador escolher qual valor (foto ou recalculado) vai para a proposta.
5. THE Sistema SHALL NÃO alterar a Foto_Rica em nenhuma etapa da Conferencia.

### Requirement 7: Localizar o cliente do cálculo (de-para por CNPJ)

**User Story:** Como operador, quero que o orçamento de repetição já traga o
cliente do cálculo do Calcgraf, para não procurar o cliente manualmente.

Nota de investigação (confirmada): o Vizor NÃO guarda o código de cliente do
Calcgraf; o vínculo possível é por **CNPJ/CPF normalizado** (só dígitos — os
formatos divergem entre os sistemas). Amostra 2026: 8/8 clientes casaram por
CNPJ normalizado. O CNPJ precisa estar disponível na Foto_Rica (o exportador
passa a incluir `clienteDoc` e `clienteCodigo`).

#### Acceptance Criteria

1. WHERE o Calculo_Biblioteca possui documento de cliente (CNPJ/CPF) na Foto_Rica, THE Sistema SHALL localizar o `Cliente` do Vizor cujo documento, normalizado (apenas dígitos), seja igual ao documento do cálculo normalizado, dentro da mesma `Empresa_Id`.
2. WHEN o Sistema localiza o cliente por documento, THE Sistema SHALL preencher o cliente do Orcamento_Repeticao com esse cliente.
3. WHERE o cálculo não possui documento de cliente OU nenhum `Cliente` casa pelo documento normalizado, THE Sistema SHALL criar o orçamento sem cliente e marcar o cliente como A_Completar.
4. THE Sistema SHALL buscar o `Cliente` apenas dentro da `Empresa_Id` do orçamento.

### Requirement 8: Isolamento multi-tenant e integridade

**User Story:** Como responsável multi-empresa, quero que o enriquecimento e a
repetição respeitem o isolamento de dados, para não vazar entre empresas.

#### Acceptance Criteria

1. THE Sistema SHALL filtrar por `Empresa_Id` explícito toda leitura/escrita de Calculo_Biblioteca, de cadastros de De_Para e de Orcamento_Grafico/Item_Orcamento.
2. IF um cálculo pertence a outra Empresa_Id, THEN THE Sistema SHALL recusar o uso/enriquecimento (acesso negado) sem alterar dados.
3. THE Sistema SHALL resolver o De_Para apenas contra cadastros da mesma Empresa_Id do cálculo.
4. WHEN o Enriquecimento grava campos, THE Sistema SHALL gravar o `Empresa_Id` correto nas entidades afetadas.
