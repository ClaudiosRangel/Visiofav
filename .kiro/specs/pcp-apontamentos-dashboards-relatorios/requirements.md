# Requirements Document

## Glossary

- **Apontamento**: registro de evento de chão de fábrica (`ApontamentoEtapa`) —
  produção, perda, parada ou retomada numa etapa de OP.
- **Centro de produção**: máquina/setor/linha (`CentroProducao`). "Ativo" =
  `status = true`; "disponível para programação" = `disponivelProgramacao = true`.
- **Base de contagem**: unidade de medida derivada do tipo de processo do centro
  (COLAGEM → UNIDADE/peças; demais → TIRAGEM/folhas), spec
  `base-contagem-por-tipo-processo`.
- **Meta**: alvo de produção por centro (quantidade/dia e opcionalmente R$/dia).
- **Valorização**: conversão da produção apontada em R$ via `custoHora` do centro
  × tempo produtivo, ou valor unitário × quantidade.
- **Período**: intervalo de datas da consulta (default: últimos 30 dias).

## Introduction

O menu **Apontamentos** (PCP) hoje é uma casca: lista `ApontamentoProducao`
(tabela quase sempre vazia — o chão de fábrica grava em `ApontamentoEtapa`) e o
botão "Novo Apontamento" apenas redireciona para a Programação. Não há
dashboards, totalizadores por centro, histórico por período, nem relatórios
imprimíveis.

Esta feature reformula TOTALMENTE o menu Apontamentos, transformando-o num
módulo de BI operacional sobre a fonte real de apontamentos
(`ApontamentoEtapa`), espelhando as planilhas que a Carton Wega mantém hoje à
mão: produção diária por centro/operador, média mensal de produtividade por
operador e por máquina, folhas cortadas por mês, e o Relatório de Produção
Diária (máquina / operador / produção do dia / observações). Inclui **metas de
produção por centro** e **valorização em R$** (modo escolhido pelo usuário:
dashboards com meta e valores, não apenas quantidade), e **consultas por
período com impressão em PDF**.

Regra transversal (vinda da parte 1 desta demanda, já implementada no backend):
toda listagem/agregação de centros de produção exibe SOMENTE centros **ATIVOS**
(`status = true`) e **disponíveis para programação** (`disponivelProgramacao =
true`). Centros fora de programação não entram em dashboards, totalizadores nem
relatórios de apontamento.

Fonte de verdade dos apontamentos: `ApontamentoEtapa` (campos `tipo`
PRODUCAO/PERDA/PARADA/RETOMADA, `quantidadeProduzida`, `quantidadePerda`,
`quantidadeRetrabalho`, `motivoPerda`, `motivoParada`, `tempoParadaMinutos`,
`observacao`, `funcionarioId`, `dataHora`), relacionada a
`etapaOrdemProducao → ordemProducao` (empresaId, OP) e `centroProducao`
(tipo de processo, custoHora). Isolamento multi-tenant por `empresaId` EXPLÍCITO
da OP real (nunca só `prismaScoped` — bypass SUPER_ADMIN).

Base de contagem segue a spec `base-contagem-por-tipo-processo`: COLAGEM →
UNIDADE (peças); demais tipos → TIRAGEM (folhas). As quantidades agregadas usam
a base do tipo de processo do centro ao rotular a unidade.

## Requirements

### Requirement 1: Cadastro de metas de produção por centro

**User Story:** Como gestor de PCP, quero cadastrar metas de produção por centro
(e opcionalmente por período), para que os dashboards comparem o realizado com a
meta, como nas planilhas de "META COLADEIRAS".

#### Acceptance Criteria

1. WHEN o gestor acessa o cadastro de metas THEN o sistema SHALL permitir
   definir, por centro de produção ativo e disponível, uma meta de produção
   diária na base de contagem do centro (folhas para TIRAGEM, peças para
   UNIDADE) e, opcionalmente, uma meta em R$/dia.
2. WHEN uma meta é salva THEN o sistema SHALL persistir `empresaId`,
   `centroProducaoId`, `metaQuantidadeDia`, `metaValorDia` (opcional),
   `vigenciaInicio` e `vigenciaFim` (opcional, null = vigente indefinidamente).
3. IF já existe meta vigente para o centro no período informado THEN o sistema
   SHALL atualizar a meta vigente em vez de criar sobreposição conflitante.
4. WHEN o gestor lista metas THEN o sistema SHALL retornar apenas metas de
   centros da sua empresa (isolamento por `empresaId`).
5. WHEN um centro não tem meta cadastrada THEN os dashboards SHALL exibir o
   realizado sem linha de meta (sem erro), tratando meta ausente como "sem meta".

### Requirement 2: Valorização em R$ da produção apontada

**User Story:** Como gestor, quero ver a produção apontada convertida em R$, para
replicar os gráficos "PRODUÇÃO DIÁRIA ... P/DIA - R$" com totais e metas em reais.

#### Acceptance Criteria

1. WHEN o sistema valoriza a produção de um centro THEN o sistema SHALL calcular
   o valor em R$ por uma regra determinística e documentada, usando o
   `custoHora` do centro multiplicado pelo tempo produtivo apontado no período,
   OU, quando configurado, um valor unitário por quantidade produzida.
2. WHEN o centro não tem `custoHora` nem valor unitário definido THEN o sistema
   SHALL exibir a quantidade sem valor em R$ (valor = null/0, nunca erro).
3. WHEN a produção é valorizada THEN o cálculo SHALL ser uma função pura e
   testável (sem acesso a banco), para permitir testes golden/property-based.
4. The valuation rule SHALL be identical across dashboard e relatório (fonte
   única), para que tela e PDF nunca divirjam.

### Requirement 3: Dashboard de apontamentos por centro e período

**User Story:** Como gestor, quero um dashboard com totalizadores por centro
produtivo (ativo e disponível) num período, para enxergar produção, perdas,
paradas e produtividade sem abrir planilha.

#### Acceptance Criteria

1. WHEN o gestor abre o dashboard com um intervalo de datas THEN o sistema SHALL
   agregar os `ApontamentoEtapa` do período, da empresa, apenas de centros ativos
   e disponíveis, retornando por centro: quantidade produzida, quantidade de
   perda, quantidade de retrabalho, tempo de parada (min) e valor em R$ (Req 2).
2. WHEN há meta cadastrada para o centro (Req 1) THEN o dashboard SHALL incluir a
   meta (quantidade e R$) e o percentual atingido (realizado/meta).
3. WHEN o período não informado THEN o sistema SHALL assumir os últimos 30 dias.
4. WHEN o gestor filtra por centro, operador ou tipo de processo THEN a
   agregação SHALL respeitar o filtro.
5. The dashboard SHALL agrupar a produção diária por data (série temporal) por
   centro, para alimentar gráficos de barras por dia como nas planilhas.

### Requirement 4: Produtividade por operador e por máquina

**User Story:** Como gestor, quero a média de produtividade por operador e por
máquina ao longo dos meses, replicando as planilhas "MÉDIA MENSAL DE
PRODUTIVIDADE P/ OPERADOR" e "P/ MÁQUINA".

#### Acceptance Criteria

1. WHEN o gestor consulta produtividade por operador num intervalo THEN o sistema
   SHALL agregar quantidade produzida por `funcionarioId` e por mês civil, da
   empresa, centros ativos/disponíveis.
2. WHEN o gestor consulta produtividade por máquina THEN o sistema SHALL agregar
   quantidade produzida por `centroProducaoId` e por mês civil.
3. WHEN um apontamento não tem `funcionarioId` THEN o sistema SHALL agrupá-lo sob
   um rótulo "Sem operador" (não descartar).
4. The month boundary SHALL use o fuso America/Sao_Paulo (-3h), consistente com o
   restante do PCP (ex.: reset diário do contador).

### Requirement 5: Histórico completo de apontamentos por período

**User Story:** Como gestor, quero listar todos os apontamentos realizados num
período, com detalhe (data/hora, centro, operador, OP, tipo, quantidade, motivo,
observação), para auditoria e conferência.

#### Acceptance Criteria

1. WHEN o gestor consulta o histórico com um intervalo THEN o sistema SHALL
   retornar os `ApontamentoEtapa` do período, da empresa, ordenados por data/hora
   decrescente, com paginação.
2. WHEN o gestor filtra por centro, operador, tipo (PRODUCAO/PERDA/PARADA/
   RETOMADA) ou OP THEN a listagem SHALL respeitar os filtros combinados.
3. WHEN um apontamento tem observação THEN a listagem SHALL incluir o texto da
   observação.
4. The listagem SHALL incluir apenas apontamentos de centros ativos e disponíveis
   da empresa (isolamento por `empresaId` da OP real).

### Requirement 6: Relatório de Produção Diária imprimível (PDF)

**User Story:** Como gestor, quero gerar o Relatório de Produção Diária em PDF
(máquina / operador / produção do dia / observações), para imprimir e arquivar,
como a planilha "RELATÓRIO DE PRODUÇÃO DIÁRIA".

#### Acceptance Criteria

1. WHEN o gestor solicita o relatório para um período THEN o sistema SHALL gerar
   um PDF (pdfkit) com cabeçalho (empresa, período), e linhas por
   centro/operador contendo a produção do dia e a observação do apontamento.
2. WHEN o período abrange vários dias THEN o PDF SHALL agrupar por data, uma
   seção por dia, replicando o layout da planilha de referência.
3. WHEN um centro teve parada (quantidade 0 com motivo) THEN o relatório SHALL
   exibir a observação/motivo (ex.: "Máquina em manutenção", "Sem serviço").
4. The relatório SHALL conter apenas centros ativos e disponíveis da empresa.
5. The dados do relatório SHALL vir da MESMA agregação do dashboard (fonte única)
   para que PDF e tela nunca divirjam.

### Requirement 7: Consultas por período com impressão (dashboards e produtividade)

**User Story:** Como gestor, quero poder imprimir também os dashboards e as
tabelas de produtividade por período em PDF, não só o relatório diário.

#### Acceptance Criteria

1. WHEN o gestor está num dashboard/consulta com período definido THEN o sistema
   SHALL oferecer exportação em PDF daquela visão (totalizadores por centro,
   produtividade por operador/máquina).
2. The PDF exportado SHALL refletir exatamente os dados e filtros aplicados na
   tela no momento da exportação.

### Requirement 8: Reformulação do menu/tela Apontamentos (frontend)

**User Story:** Como usuário do PCP, quero que o menu Apontamentos abra o novo
módulo de dashboards/relatórios, não a tela antiga vazia que redireciona para a
Programação.

#### Acceptance Criteria

1. WHEN o usuário clica em "Apontamentos" no menu PCP THEN o sistema SHALL abrir
   a nova tela com abas: Dashboard, Produtividade, Histórico, Relatórios e Metas.
2. WHEN a nova tela carrega THEN ela SHALL consumir os endpoints de agregação
   (não mais `GET /apontamentos-producao`), exibindo dados reais de
   `ApontamentoEtapa`.
3. The nova tela SHALL permitir selecionar o período e os filtros (centro,
   operador, tipo) e acionar as impressões em PDF.
4. The seletor de centros nas telas SHALL listar apenas centros ativos e
   disponíveis.

### Requirement 9: Isolamento multi-tenant e segurança

**User Story:** Como responsável pela plataforma, quero garantir que um gestor só
veja apontamentos e metas da própria empresa.

#### Acceptance Criteria

1. WHEN qualquer endpoint desta feature agrega ou lista dados THEN o filtro por
   `empresaId` SHALL ser aplicado EXPLICITAMENTE (via `empresaId` do
   `ApontamentoEtapa` e/ou da OP real), nunca dependendo apenas de
   `request.prismaScoped`.
2. WHEN um SUPER_ADMIN está logado THEN os endpoints SHALL continuar filtrando
   pela empresa selecionada na sessão (sem vazamento cross-empresa).
3. The endpoints SHALL exigir autenticação e o guard de módulo PCP.
