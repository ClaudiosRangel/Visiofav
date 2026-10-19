# Requirements Document

## Glossary

- **Processo (tipo de processo)**: classificação do centro (`TipoProcesso`:
  Cortadeira, Impressão, Acabamento, Acoplagem, Corte Vinco, Colagem). O resumo
  e as metas gerenciais agregam por processo.
- **Centro**: máquina/linha (`CentroProducao`), ex.: CD5, CD7, KBA (impressão);
  BOBST-S, BOBST-E (corte/vinco). As tabelas diárias detalham por centro.
- **Base de contagem**: UNIDADE para COLAGEM (peças); TIRAGEM (folhas) para os
  demais, conforme spec `base-contagem-por-tipo-processo`.
- **Valorização**: produção em R$ = `custoHora do centro × horas produtivas`.
  Horas derivadas de `produção ÷ velocidade` do centro, com fallback no tempo
  apontado. Somente CUSTO (não há preço de venda nesta feature).
- **Meta por processo**: alvo diário de produção por tipo de processo
  (quantidade/dia e opcionalmente R$/dia), com vigência.
- **Código de parada**: motivo de parada customizável por empresa (ex.: "1 =
  Troca de chapa/Setup"), usado no Pareto de ocorrências.
- **Menu Gerencial**: agrupador de relatórios gerenciais do PCP (Mapa de Custos
  RKW, Análise Gerencial RKW e o novo Relatório Mensal de Produção).

## Introduction

A Carton Wega mantém hoje, em planilhas/PowerPoint, um relatório gerencial
mensal de produção com: quantidade de OPs emitidas (comparativo anual), resumo
por processo (Cortadeiras/Guilhotina/Coladeiras/Acoplagem/Corte-Vinco/Impressão),
produção diária consolidada (pico/média), produção por máquina/semana/operador,
metas por processo com gráfico de linha, dados diários por centro
(CD5/CD7/KBA; BOBST-S/BOBST-E), Pareto de códigos de parada, trabalhos em
máquina nos dias de meta e um plano de ação.

Esta feature traz esse relatório para dentro do Vizor, num **menu Gerencial
próprio** que também passa a abrigar os itens já existentes "Mapa de Custos
(RKW)" e "Análise Gerencial (RKW)". A fonte dos dados de produção é
`ApontamentoEtapa` (já consolidada pelo módulo de Apontamentos BI). A
valorização em R$ usa somente o **custo** (`custoHora × horas`).

Pré-requisito: os centros precisam de `custoHora` e `velocidade` preenchidos.
Como estão parcialmente vazios na Carton Wega, esta feature inclui popular esses
campos a partir dos exports do Calcgraf (`cartoon/export/*.json`), em modo
dry-run para conferência antes de aplicar.

Isolamento multi-tenant por `empresaId` EXPLÍCITO em todas as agregações.

## Requirements

### Requirement 1: Popular custo-hora e velocidade dos centros

**User Story:** Como gestor, quero que os centros tenham custo-hora e velocidade
preenchidos, para que a produção seja valorizada em R$ corretamente.

#### Acceptance Criteria

1. WHEN o script de população roda em modo dry-run THEN o sistema SHALL exibir o
   de-para proposto (centro Vizor → centro Calcgraf, custoHora e velocidade) sem
   gravar nada, para conferência.
2. WHEN o script roda em modo apply THEN o sistema SHALL preencher `custoHora` e
   `velocidade` SOMENTE nos centros cujos campos estão nulos ou zerados (nunca
   sobrescrever valor já ajustado manualmente > 0).
3. The de-para SHALL casar por nome normalizado (sem acento, case-insensitive) e,
   quando ambíguo, deixar o centro de fora do apply e listá-lo para vínculo
   manual (não adivinhar).
4. The fonte dos valores SHALL ser `cartoon/export/CentroCustoHora.json`
   (custoHora) e `CentrosProducaoxTiragensProdHora.json` + `CentrosProducao.json`
   (velocidade, maior faixa de tiragem como representativa).

### Requirement 2: Menu Gerencial agrupando os relatórios

**User Story:** Como usuário do PCP, quero um menu "Gerencial" que reúna os
relatórios gerenciais, para encontrá-los num lugar só.

#### Acceptance Criteria

1. WHEN o usuário abre o PCP THEN o sistema SHALL exibir um grupo/menu
   "Gerencial" contendo: Mapa de Custos (RKW), Análise Gerencial (RKW) e
   Relatório Mensal de Produção (novo).
2. The itens existentes (Mapa de Custos RKW, Análise Gerencial RKW) SHALL
   continuar funcionando, apenas reposicionados sob o menu Gerencial.

### Requirement 3: Meta de produção por processo

**User Story:** Como gestor, quero cadastrar metas por tipo de processo (ex.:
Meta Impressão 100.000/dia), para comparar com a produção agregada do processo.

#### Acceptance Criteria

1. WHEN o gestor cadastra uma meta de processo THEN o sistema SHALL persistir
   `empresaId`, `tipoProcessoId`, `metaQuantidadeDia`, `metaValorDia` (opcional),
   `vigenciaInicio`, `vigenciaFim` (opcional).
2. WHEN o relatório agrega a produção de um processo THEN o sistema SHALL
   comparar o realizado (soma dos centros do processo) com a meta do processo e
   calcular o percentual atingido.
3. The meta por processo SHALL coexistir com a meta por centro já existente
   (`MetaProducaoCentro`) sem conflito.

### Requirement 4: Cadastro de códigos de parada customizável

**User Story:** Como gestor, quero cadastrar códigos de parada próprios da
empresa (ex.: "1 = Troca de chapa/Setup"), para o Pareto refletir minha
operação.

#### Acceptance Criteria

1. WHEN o gestor cadastra um código de parada THEN o sistema SHALL persistir
   `empresaId`, `codigo` (numérico/texto curto), `descricao` e `status`.
2. WHEN um apontamento de parada é registrado THEN o sistema SHALL permitir
   associar um código de parada cadastrado (além do enum legado `motivoParada`,
   mantido por compatibilidade).
3. WHEN o Pareto de paradas é gerado THEN o sistema SHALL agrupar por código de
   parada cadastrado, ordenando por ocorrências decrescentes.
4. The códigos SHALL ser isolados por `empresaId`.

### Requirement 5: Relatório Mensal de Produção — visões

**User Story:** Como gestor, quero um relatório mensal com as visões das minhas
planilhas, para acompanhar a produção sem planilha manual.

#### Acceptance Criteria

1. WHEN o gestor seleciona mês/ano THEN o sistema SHALL exibir o **resumo por
   processo** (produção total do mês por Cortadeira, Impressão, Acabamento/
   Guilhotina, Acoplagem, Corte-Vinco, Coladeira) na base de contagem de cada
   processo.
2. WHEN o gestor abre a visão **produção diária consolidada** THEN o sistema
   SHALL exibir a série diária do mês com pico, 2º/3º maiores dias, média diária
   e menor dia.
3. WHEN o gestor abre **produção por máquina/operador** THEN o sistema SHALL
   exibir a média mensal por centro e por operador (comparando meses, como nas
   planilhas) com o percentual de variação mês a mês.
4. WHEN o gestor abre **metas por processo** THEN o sistema SHALL exibir, por
   processo, a série diária de produção com linha de meta e linha de média
   diária mensal.
5. WHEN o gestor abre **dados diários por centro** de um processo THEN o sistema
   SHALL exibir uma tabela data × centro (ex.: CD5/CD7/KBA para Impressão;
   BOBST-S/BOBST-E para Corte-Vinco) com total diário, meta e média.
6. WHEN o gestor abre **OPs emitidas** THEN o sistema SHALL exibir a quantidade
   de OPs criadas por mês, com comparativo entre anos.
7. WHEN o gestor abre **Pareto de paradas** THEN o sistema SHALL exibir os
   códigos de parada mais frequentes do mês (Req 4).
8. WHEN existir produção num dia que atingiu/aproximou a meta THEN o sistema
   SHALL listar os **trabalhos (OPs/clientes) que estavam em máquina** naquele
   dia/centro, derivados das OPs apontadas.

### Requirement 6: Valorização em R$ por custo

**User Story:** Como gestor, quero a produção valorizada em R$ pelo custo, para
ver o total em reais como nas planilhas.

#### Acceptance Criteria

1. WHEN a produção de um centro é valorizada THEN o sistema SHALL calcular
   `custoHora × horas`, com horas = `produção ÷ velocidade` quando a velocidade
   existe, senão o tempo apontado.
2. WHEN o centro não tem custoHora nem velocidade THEN o valor R$ SHALL ser 0
   (sem erro), exibindo apenas a quantidade.
3. The valorização SHALL ser função pura e testável.

### Requirement 7: Impressão em PDF

**User Story:** Como gestor, quero imprimir o relatório mensal em PDF, para
distribuir e arquivar.

#### Acceptance Criteria

1. WHEN o gestor solicita a impressão THEN o sistema SHALL gerar um PDF (pdfkit)
   do relatório mensal com as visões selecionadas.
2. The PDF SHALL usar a MESMA agregação da tela (fonte única).

### Requirement 8: Isolamento multi-tenant

**User Story:** Como responsável pela plataforma, quero que cada empresa veja só
seus dados.

#### Acceptance Criteria

1. WHEN qualquer endpoint agrega/lista dados THEN o filtro `empresaId` SHALL ser
   aplicado explicitamente (nunca só `prismaScoped`).
2. The endpoints SHALL exigir autenticação e guard de módulo PCP.
