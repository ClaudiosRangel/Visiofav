# Requirements Document

## Introduction

Esta spec completa a **paridade total do fluxo gráfico do Calcgraf/GPrint** no Vizor
(ERP gráfico multi-tenant da Carton Wega), de modo que o Vizor **gere** cálculo
gráfico, orçamento, Ordem de Produção (OP) e relatório fiéis ao Calcgraf — batendo
número a número (desvio ≤ 0,5%) — **sem depender da importação do PDF de OP**. A
importação de PDF permanece como caminho legado/alternativo; esta spec **adiciona** a
geração nativa, não remove a importação.

O trabalho se apoia na spec já concluída `orcamento-grafico-multi-item-gcad`
(cabeçalho + N itens, consolidação, catálogo de facas/modelos GCad, restrições de
acabamento, seletor de máquina, matriz/tinta/materiais no Material Direto, itens
diversos/fornecidos/campos livres, relatório por item e consolidado) e no módulo PCP
existente (`OrdemProducao` e filhas `ItemOrdemProducao`, `EtapaOrdemProducao`,
`PlanoOrdemProducao`, `ProgramacaoEntrega`). O motor puro
`orcamento-grafico-calculo.service.ts` calcula UM item e **não é reescrito** — todas
as extensões são aditivas (envelope).

A spec cobre cinco frentes, derivadas dos documentos reais do cálculo 15.086 /
orçamento 5.316 / OP 3.149 (Cartucho CIMED Super Fresh, cliente ICEFRESH código 903,
vendedor IGOR ARNEIRO, tiragem 100.000):

- **Frente A — Campos faltantes do Cálculo Gráfico**: campos da tela CARTUCHO que o
  Vizor ainda não persiste (sigla acabado, tributação, processo de impressão,
  cobertura de tinta, modelos, fabricante, microondulado, formato suporte, fornecido,
  geometria completa, acondicionamento, observações e ARTE). A maioria é de paridade
  (exibição e repasse à OP); alguns afetam o cálculo (formato suporte, formato de
  corte, montagem → folhas/consumo).
- **Frente B — Planos por Cálculo**: um Cálculo pode ter N Planos, cada um com
  suporte, formato, pré-impressão, impressão e acabamentos próprios; o custo do item é
  a soma dos planos; o relatório lista um bloco por plano.
- **Frente C — Troca de suporte Orçamento → Produção**: registrar o suporte orçado e o
  suporte real de produção, sinalizar a troca no relatório e na OP, e recalcular o
  consumo da OP com o suporte real sem alterar o orçamento orçado.
- **Frente D — Emissão de OP a partir do Cálculo**: gerar uma `OrdemProducao` a partir
  do orçamento/cálculo, replicando a OP 3.149 (cabeçalho, programação de entrega,
  planos, impressão, acabamentos, materiais consumidos, bloco de faturamento, opções
  de emissão), com vínculo orçamento↔OP e presença no painel de PCP.
- **Frente E — Relatório fiel ao pré-cálculo + Seed Golden**: relatório oficial (HTML
  em tela e PDF) reproduzindo o pré-cálculo campo a campo, e um seed idempotente que
  cria o golden 15.086 / 5.316 / 3.149 com os números exatos, refletindo a troca de
  suporte orçado (222) vs produção (234).

Requisitos transversais atravessam todas as frentes: fidelidade ao Calcgraf ≤ 0,5%;
multi-tenant por `empresaId` em toda leitura/escrita; aditividade/não-regressão (a
suíte `orcamento-grafico`, atualmente com 148 testes, permanece verde e o motor puro
não regride); migração `schema.prisma` + `migrate-prod.ts` idempotente no mesmo
commit, com enums gravados como VARCHAR; e propriedades de correção executáveis
(property-based) para as invariantes.

## Glossary

- **Vizor**: ERP gráfico multi-tenant alvo da migração, usado pela Carton Wega.
- **Calcgraf / GPrint**: sistema legado (desktop Delphi, PHTech) de cálculo gráfico,
  orçamento e OP cujo resultado o Vizor deve reproduzir.
- **Cálculo Gráfico**: o cálculo técnico/comercial de uma peça (ex.: cálculo 15.086),
  equivalente ao Item de Orçamento do Vizor. Nesta spec, o termo refere-se ao Item de
  Orçamento (`ItemOrcamentoGrafico`) estendido.
- **Item de Orçamento (`ItemOrcamentoGrafico`)**: um cálculo gráfico próprio dentro de
  um orçamento, com fechamento próprio.
- **Orçamento (`OrcamentoGrafico`)**: cabeçalho comercial (série, número, data,
  cliente, vendedor, status) com lista de itens (ex.: orçamento 5.316).
- **Plano de Cálculo (`PlanoCalculoGrafico`)**: nível abaixo do item introduzido por
  esta spec; cada plano tem suporte, formato, pré-impressão, impressão e acabamentos
  próprios. O custo do item é a soma dos planos. Não confundir com
  `PlanoOrdemProducao` do PCP.
- **Ordem de Produção (`OrdemProducao`)**: entidade do PCP que materializa a produção
  de um pedido (ex.: OP 3.149). Nesta spec, pode ser **gerada nativamente** a partir
  do cálculo, além do caminho legado de importação por PDF.
- **Suporte**: substrato/papel-cartão/bobina do item ou do plano (ex.: Stora Enzo
  Bobina 222).
- **Suporte Orçado**: o suporte definido no orçamento/plano no momento do cálculo
  comercial (`suporteId`).
- **Suporte de Produção**: o suporte efetivamente usado na produção (`suporteProducaoId`),
  inicialmente igual ao orçado, podendo ser trocado pelo que há em estoque.
- **Troca de Suporte**: situação em que o Suporte de Produção difere do Suporte
  Orçado, exigindo sinalização no relatório e na OP e recálculo de consumo na OP.
- **Formato Suporte (Form. Sup.)**: formato da folha/suporte de origem (ex.: 720×1000).
- **Formato de Corte**: formato da folha de corte (ex.: 720×1000, 745×1000).
- **Montagem (Mont.)**: imposição de peças por folha (ex.: 7×3), número de linhas por
  colunas.
- **Acondicionamento**: lista de atividades de embalagem final (ex.: Caixa Padrão,
  Embalar) e o conteúdo por volume (ex.: 900 peças por volume).
- **Programação de Entrega (`ProgramacaoEntrega`)**: entregas parciais programadas
  (ex.: "4931 - 50.000 para 21/10/26, 4932 - 50.000 para 21/10/26"), com excedente.
- **Pré-cálculo (memória de cálculo)**: relatório detalhado do Calcgraf com cabeçalho,
  blocos por plano, suporte, matriz, tinta, materiais, impressão, acabamento, custo de
  produção, prazos, comissões, CEV, condições de pagamento e margens.
- **MD (Material Direto)**: Suporte + Matriz de Impressão + Tinta + Material de
  Acabamento.
- **CT (Custo de Transformação)**: custos de máquina (Impressão + Acabamentos), tempo
  fixo (acerto) + tempo variável (produção) × custo-hora.
- **Servex (Serviços Externos)**: custos de serviços terceirizados.
- **Custo de Produção (C.Prod)**: MD + CT + Servex.
- **CEV (Custos de Venda)**: percentuais incidentes sobre o preço (ICMS, Juros,
  PIS/COFINS, Comissões, IPI).
- **Margem**: markup percentual aplicado para formar o preço de venda.
- **C.Marg (Contribuição Marginal)**: percentual e valor da contribuição marginal.
- **Primeiro Mil / Mil Seguinte**: os dois pontos de precificação por tiragem do
  Calcgraf (preço do primeiro milheiro e do milheiro seguinte).
- **Seed Golden**: script/fase idempotente que cria o cálculo 15.086 / orçamento 5.316
  / OP 3.149 na empresa Carton Wega com os números exatos dos documentos de
  referência, para visualização e validação.
- **Golden case**: cálculo real do Calcgraf (entrada → saída) usado como teste
  congelado de fidelidade.
- **Campo de Paridade**: campo persistido e exibido no relatório/OP apenas para
  reproduzir o Calcgraf, sem afetar o cálculo de custo.
- **Campo de Cálculo**: campo que participa do cálculo de folhas, consumo ou custo.
- **Não-regressão (aditividade)**: garantia de que as mudanças não alteram o resultado
  de orçamentos já suportados pelo motor puro e mantêm a suíte `orcamento-grafico`
  aprovada.
- **Multi-tenant**: isolamento de dados por `empresaId` da entidade de negócio em toda
  leitura e escrita.

## Requirements

### Frente A — Campos Faltantes do Cálculo Gráfico

### Requirement 1: Campos Informativos de Paridade do Cálculo Gráfico

**User Story:** Como orçamentista da Carton Wega, quero que o cálculo gráfico persista
os campos informativos da tela CARTUCHO do Calcgraf, para que o relatório e a OP
reproduzam fielmente os dados do pré-cálculo sem alterar o custo.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL persistir os seguintes Campos de Paridade do item, cada um opcional e sem efeito sobre o cálculo de custo: Sigla Acabado (texto de 0 a 60 caracteres), Tributação (texto de 0 a 60 caracteres), Processo de Impressão (texto de 0 a 60 caracteres), Cobertura de Tinta (texto de 0 a 60 caracteres), Fabricante (texto de 0 a 120 caracteres), Microondulado (indicador booleano), e um indicador booleano Fornecido.
2. THE Item_Orcamento SHALL persistir a quantidade de Modelos vinculados ao item como inteiro maior ou igual a 0, com valor padrão 0.
3. WHEN o orçamentista salva um Item de Orçamento, THE Item_Orcamento SHALL persistir os Campos de Paridade informados e disponibilizá-los para exibição no relatório e para repasse à OP.
4. WHERE um Campo de Paridade está ausente ou vazio em um item, THE Item_Orcamento SHALL persistir o item sem o campo e exibir o campo como vazio no relatório, sem gerar erro.
5. WHEN um Item de Orçamento com Campos de Paridade preenchidos é recalculado, THE Motor_Calculo SHALL produzir MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento idênticos (até a segunda casa decimal) aos produzidos pelo mesmo item sem os Campos de Paridade.
6. THE Item_Orcamento SHALL filtrar tanto a leitura quanto a escrita dos Campos de Paridade pelo `empresaId` da entidade de negócio.

### Requirement 2: Geometria e Formatos que Afetam o Cálculo

**User Story:** Como orçamentista, quero informar a geometria e os formatos do item
(comprimento, largura, altura, abas, fibra, montagem, formato de corte, formato
suporte, ajuste de corte micro), para que o número de folhas e o consumo de suporte
reflitam a imposição real.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir informar os campos de geometria do item: Comprimento, Largura e Altura em milímetros (cada um maior que 0), Aba Cola e Aba Fechamento em milímetros (cada uma maior ou igual a 0), e um indicador booleano Fibra.
2. THE Item_Orcamento SHALL permitir informar a Montagem como número de linhas e número de colunas (cada um inteiro maior ou igual a 1), o Formato Suporte como largura e altura em milímetros (cada uma maior que 0), e o Formato de Corte como largura e altura em milímetros (cada uma maior que 0).
3. THE Item_Orcamento SHALL permitir informar o Ajuste Corte Micro em milímetros como valor maior ou igual a 0, com valor padrão 0.
4. WHERE a Montagem está informada em um item, THE Motor_Calculo SHALL usar o aproveitamento (peças por folha) igual ao produto do número de linhas pelo número de colunas da Montagem no cálculo do número de folhas e do consumo de suporte, usando EXATAMENTE os valores dos campos de linhas e colunas da Montagem informada do item (sem admitir quaisquer outros valores que apenas satisfaçam o mesmo produto).
5. WHEN o Formato Suporte, o Formato de Corte ou a Montagem de um item é alterado, THE Item_Orcamento SHALL recalcular o fechamento daquele item, mantendo inalterados os fechamentos dos demais itens do orçamento.
6. IF qualquer dimensão de geometria, Formato Suporte ou Formato de Corte é informada com valor menor ou igual a 0, ou qualquer componente da Montagem é menor que 1, THEN THE Item_Orcamento SHALL rejeitar a entrada, preservar o valor anterior do item e retornar uma mensagem indicando o campo com valor inválido.
7. WHERE um Item de Orçamento não possui Montagem, Formato Suporte e Formato de Corte informados, THE Motor_Calculo SHALL usar o cálculo de encaixe legado, produzindo resultado igual (até a segunda casa decimal) ao do motor puro congelado.

### Requirement 3: Acondicionamento e Observações do Cálculo

**User Story:** Como orçamentista, quero registrar as atividades de acondicionamento,
o conteúdo por volume e as observações do cálculo, para que a OP e o relatório
reproduzam as instruções de embalagem e as áreas de OP do Calcgraf.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL permitir cadastrar uma lista de 0 a 20 atividades de Acondicionamento, cada uma com descrição textual de 1 a 100 caracteres (ex.: Caixa Padrão, Embalar).
2. THE Item_Orcamento SHALL permitir informar o Conteúdo por Volume como inteiro maior ou igual a 1 (ex.: 900).
3. THE Item_Orcamento SHALL permitir registrar dois campos de texto independentes: Observação (0 a 1000 caracteres) e Observação de Áreas de OP (0 a 1000 caracteres), e um campo ARTE (0 a 60 caracteres, ex.: NOVA).
4. WHEN o orçamentista salva as atividades de Acondicionamento, o Conteúdo por Volume e as observações de um item, THE Item_Orcamento SHALL persistir esses dados e disponibilizá-los para exibição no relatório e para repasse à OP.
5. WHERE as atividades de Acondicionamento, o Conteúdo por Volume e as observações estão informados, THE Motor_Calculo SHALL produzir MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento idênticos (até a segunda casa decimal) aos produzidos pelo mesmo item sem esses campos, tratando-os como Campos de Paridade.
6. IF uma atividade de Acondicionamento é informada com descrição vazia, ou o Conteúdo por Volume é informado com valor menor que 1, THEN THE Item_Orcamento SHALL rejeitar a entrada, preservar os dados já informados do item e retornar uma mensagem indicando o campo inválido.

### Frente B — Planos por Cálculo

### Requirement 4: Cadastro de Planos por Cálculo

**User Story:** Como orçamentista, quero cadastrar e editar múltiplos planos dentro de
um cálculo (ex.: "Cartão" e "Cartão (M)"), cada um com suporte, formato,
pré-impressão, impressão e acabamentos próprios, para reproduzir o editor de planos do
Calcgraf.

#### Acceptance Criteria

1. THE Item_Orcamento SHALL conter uma lista de 0 a 50 Planos de Cálculo, cada um com Nome (texto de 1 a 60 caracteres), Suporte, Formato (largura e altura em milímetros, cada uma maior que 0), parâmetros de Pré-impressão, parâmetros de Impressão (número de cores de 0 a 12 e máquina de impressão) e uma lista própria de acabamentos.
2. THE Plano_Calculo SHALL fornecer operações de criação, leitura, atualização e exclusão de Planos vinculados a um Item de Orçamento, filtradas pelo `empresaId` do item.
3. WHEN o orçamentista adiciona um Plano de Cálculo a um item, THE Item_Orcamento SHALL vincular o plano ao item e atribuir ao plano um identificador de sequência inteiro único dentro do item, igual ao maior identificador de sequência existente no item mais 1.
4. WHEN o orçamentista remove um Plano de Cálculo de um item, THE Item_Orcamento SHALL excluir o plano e recalcular o custo do item como a soma dos planos restantes, preservando os identificadores de sequência dos planos restantes como estão (sem renumerar, admitindo lacunas na sequência).
5. IF um Plano de Cálculo é salvo com Nome vazio, com qualquer dimensão de Formato menor ou igual a 0, ou com número de cores fora do intervalo de 0 a 12, THEN THE Plano_Calculo SHALL rejeitar a operação, preservar o estado anterior do plano e retornar uma mensagem indicando o campo inválido.

### Requirement 5: Cálculo por Plano e Consolidação no Item

**User Story:** Como orçamentista, quero que cada plano calcule seu próprio suporte,
impressão e acabamento e que o item consolide os planos, para que o custo do cálculo
seja a soma coerente dos planos.

#### Acceptance Criteria

1. WHEN o cálculo de um Plano de Cálculo é disparado, THE Plano_Calculo SHALL calcular o custo de Suporte, o custo de Impressão e o custo de Acabamento usando exclusivamente os parâmetros do próprio plano.
2. WHEN o cálculo de um Item de Orçamento que possui ao menos um Plano de Cálculo conclui, THE Item_Orcamento SHALL calcular MD, CT e Servex do item como a soma dos respectivos custos de todos os seus Planos de Cálculo.
3. WHEN um parâmetro de um Plano de Cálculo é alterado, THE Item_Orcamento SHALL recalcular apenas o plano alterado e reconsolidar o custo do item, mantendo inalterados os custos dos demais planos.
4. FOR ALL itens com um ou mais Planos de Cálculo, a diferença absoluta entre a soma dos custos de Suporte, Impressão e Acabamento dos planos e o MD mais CT do item SHALL ser menor ou igual a 0,01.
5. WHERE um Item de Orçamento não possui nenhum Plano de Cálculo, THE Motor_Calculo SHALL calcular o item pelo caminho de item único legado, produzindo resultado igual (até a segunda casa decimal) ao do motor puro congelado.
6. WHEN o orçamentista solicita o relatório de um item que possui Planos de Cálculo, THE Orcamento_Grafico SHALL apresentar um bloco por plano, com o custo de Suporte, Impressão e Acabamento de cada plano.

### Frente C — Troca de Suporte Orçamento → Produção

### Requirement 6: Registro do Suporte Orçado e do Suporte de Produção

**User Story:** Como responsável pela produção, quero registrar o suporte orçado e o
suporte real de produção em cada plano/item, para poder trocar o suporte na produção
pelo que há em estoque sem alterar o orçamento orçado.

#### Acceptance Criteria

1. THE Plano_Calculo SHALL armazenar, em cada plano (ou no item quando não houver planos), um Suporte Orçado identificado por `suporteId` e um Suporte de Produção identificado por `suporteProducaoId`, ambos filtrados por `empresaId`.
2. WHEN um Plano de Cálculo ou Item de Orçamento é criado, THE Plano_Calculo SHALL inicializar o Suporte de Produção igual ao Suporte Orçado.
3. WHEN o responsável pela produção altera o Suporte de Produção de um plano ou item para um suporte disponível em estoque que atende o pedido, THE Plano_Calculo SHALL persistir o novo Suporte de Produção e preservar inalterado o Suporte Orçado.
4. IF o responsável pela produção tenta definir o Suporte de Produção como um suporte inexistente ou de outra empresa, THEN THE Plano_Calculo SHALL rejeitar a alteração, preservar o Suporte de Produção anterior e retornar uma única mensagem genérica de "suporte inválido" para ambos os casos (inexistente ou de outra empresa), sem distinguir entre eles.
5. THE Plano_Calculo SHALL filtrar toda leitura e escrita do Suporte Orçado e do Suporte de Produção pelo `empresaId` da entidade de negócio.

### Requirement 7: Sinalização da Troca de Suporte no Relatório e na OP

**User Story:** Como vendedor e como PCP, quero ver uma sinalização clara quando o
suporte de produção difere do orçado, para saber que houve troca sem precisar
comparar manualmente.

#### Acceptance Criteria

1. WHILE o Suporte de Produção de um plano ou item é igual ao Suporte Orçado, THE Orcamento_Grafico SHALL apresentar o relatório e a OP sem qualquer indicação de troca de suporte.
2. WHEN o Suporte de Produção de um plano ou item difere do Suporte Orçado, THE Orcamento_Grafico SHALL apresentar no relatório uma indicação visível de troca contendo o nome do Suporte Orçado e o nome do Suporte de Produção no formato "Suporte alterado na produção: {orçado} → {real}".
3. WHEN o Suporte de Produção de um plano ou item difere do Suporte Orçado, THE Ordem_Producao SHALL apresentar na OP a sua PRÓPRIA indicação visível de troca, contendo o nome do Suporte Orçado e o nome do Suporte de Produção no formato "Suporte alterado na produção: {orçado} → {real}", independentemente de o relatório também exibir a indicação (a presença no relatório NÃO substitui a exibição na OP).
4. WHERE existe histórico de troca de suporte disponível, THE Plano_Calculo SHALL registrar, para cada troca, o Suporte Orçado anterior, o novo Suporte de Produção, o identificador do usuário que realizou a troca e a data e hora da troca.
5. FOR ALL planos ou itens cujo Suporte de Produção é igual ao Suporte Orçado, o relatório e a OP SHALL omitir a indicação de troca de suporte.

### Requirement 8: Consumo da OP com Suporte Real sem Alterar o Orçamento Orçado

**User Story:** Como PCP, quero que a OP calcule o consumo de material com o suporte
real de produção, enquanto o orçamento continua fechado com o suporte orçado, para não
distorcer o resultado comercial já fechado.

#### Acceptance Criteria

1. WHEN uma OP é gerada ou recalculada a partir de um cálculo cujo Suporte de Produção difere do Suporte Orçado, THE Ordem_Producao SHALL calcular o consumo de material usando o Suporte de Produção.
2. WHEN o Suporte de Produção de um cálculo é alterado após o fechamento do orçamento, THE Orcamento_Grafico SHALL preservar inalterados os valores de MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento do orçamento orçado.
3. WHERE o Suporte de Produção difere do Suporte Orçado, THE Ordem_Producao SHALL calcular o número de folhas e o peso em quilogramas do material consumido a partir das dimensões, da gramatura e do preço do Suporte de Produção.
4. FOR ALL cálculos cujo Suporte de Produção é igual ao Suporte Orçado, o consumo de material da OP SHALL ser igual (até a segunda casa decimal) ao consumo de material calculado com o Suporte Orçado.
5. THE Ordem_Producao SHALL filtrar toda leitura e escrita de consumo com suporte real pelo `empresaId` da entidade de negócio.

### Frente D — Emissão de OP a partir do Cálculo

### Requirement 9: Geração de OP a partir do Cálculo com Cabeçalho Completo

**User Story:** Como PCP/vendedor, quero gerar uma Ordem de Produção diretamente do
orçamento/cálculo, com todos os dados de cabeçalho da OP do Calcgraf, para deixar de
depender da importação do PDF.

#### Acceptance Criteria

1. WHEN o usuário solicita a emissão de OP a partir de um Item de Orçamento, THE Ordem_Producao SHALL criar uma `OrdemProducao` com `origemImportacao` igual a NATIVA_CALCULO e com número sequencial único dentro da empresa.
2. THE Ordem_Producao SHALL preencher o cabeçalho da OP gerada com: cliente, vendedor, pedido interno, código do cliente, ficha técnica, data e hora de emissão, indicador de via (primeira via ou reemissão) com o identificador do usuário e a data e hora da ação, número da OP sequencial e revisão.
3. WHEN a OP gerada é a primeira emissão, THE Ordem_Producao SHALL registrar o indicador de via como primeira via e a revisão como o valor inicial.
4. WHEN uma OP já emitida é reemitida, THE Ordem_Producao SHALL registrar o indicador de via como reemissão, incrementar a revisão e registrar o identificador do usuário e a data e hora da reemissão, preservando o número da OP.
5. THE Ordem_Producao SHALL manter o vínculo entre o orçamento/cálculo de origem e a OP gerada, de modo que o item do orçamento exiba o status da OP vinculada (ex.: "OP: 3149").
6. WHEN a OP é gerada a partir de um cálculo, THE Ordem_Producao SHALL ficar disponível no painel de Programação do PCP da empresa.
7. THE Ordem_Producao SHALL preservar a importação de PDF de OP como caminho alternativo, sem que a emissão nativa remova ou desabilite a importação.
8. THE Ordem_Producao SHALL filtrar toda leitura e escrita da OP gerada pelo `empresaId` da entidade de negócio de origem (o orçamento/cálculo).

### Requirement 10: Programação de Entrega, Planos e Materiais na OP Gerada

**User Story:** Como PCP, quero que a OP gerada traga a programação de entrega, os
planos (com material, formato, tempos de impressão e acabamentos) e os materiais
consumidos com códigos e quantidades, para replicar a OP 3.149 do Calcgraf.

#### Acceptance Criteria

1. WHEN a OP é gerada a partir de um cálculo com entregas programadas, THE Ordem_Producao SHALL criar uma `ProgramacaoEntrega` por entrega, cada uma com número de pedido, quantidade e data de entrega, e SHALL registrar o excedente quando informado.
2. WHEN a OP é gerada a partir de um cálculo com Planos de Cálculo, THE Ordem_Producao SHALL criar um plano de produção por Plano de Cálculo, cada um com material/suporte, formato, quantidade em quilogramas, taxa de reposição (TR), quantidade, formato de corte, aprovação e dados de impressão (máquina, cores, chapa) e acabamento.
3. WHEN a OP é gerada, THE Ordem_Producao SHALL registrar, para a impressão, o tempo Fixo e o tempo Variável de cada plano.
4. WHEN a OP é gerada, THE Ordem_Producao SHALL registrar, para cada acabamento, o tempo Fixo, o tempo Variável e o detalhe do acabamento (ex.: Fundo Automático, Matriz, Refilar, Verniz UV).
5. WHEN a OP é gerada, THE Ordem_Producao SHALL criar um item de material consumido por material do cálculo, cada um com código do material, unidade (quilograma, peça ou unidade) e quantidade, incluindo tintas com código e percentual, colas, vernizes e materiais de acondicionamento.
6. THE Ordem_Producao SHALL preencher o bloco de Faturamento da OP gerada com razão social, código do cliente, número do pedido interno, ficha técnica, quantidade do pedido por acabado e identificadores de quem emitiu e de quem reemitiu, quando aplicável.
7. IF o cálculo de origem não possui itens de material, planos ou programação de entrega, THEN THE Ordem_Producao SHALL gerar a OP normalmente com as seções correspondentes vazias e registrar um aviso APENAS INFORMATIVO listando quais seções ficaram sem dados, sem bloquear nem exigir confirmação do PCP.

### Requirement 11: Opções da Emissão de OP

**User Story:** Como usuário da tela de Emissão de OP, quero as opções do Calcgraf
(não gerar pedido, OP reserva, imprimir traçado, série automática, gerar em arquivo,
enviar por e-mail, emissão em lote), para controlar como a OP é emitida.

#### Acceptance Criteria

1. THE Ordem_Producao SHALL oferecer, na emissão de OP, as opções booleanas: Não Gerar Pedido, OP Reserva, Imprimir Traçado, Série de Pedido e OP Automática, e Gerar em Arquivo, cada uma com valor padrão definido.
2. WHERE a opção Não Gerar Pedido está marcada, THE Ordem_Producao SHALL gerar a OP sem criar o pedido de venda associado.
3. WHERE a opção OP Reserva está marcada, THE Ordem_Producao SHALL marcar a OP gerada como reserva.
4. WHERE a opção Série de Pedido e OP Automática está marcada, THE Ordem_Producao SHALL atribuir a série e o número do pedido e da OP automaticamente, sem exigir entrada manual.
5. WHERE a opção Gerar em Arquivo está marcada, THE Ordem_Producao SHALL produzir o arquivo da OP para download.
6. WHEN o usuário solicita o envio da OP por e-mail, THE Ordem_Producao SHALL enviar a OP para os destinatários informados e registrar o resultado do envio.
7. WHEN o usuário seleciona múltiplos cálculos para emissão em lote, THE Ordem_Producao SHALL gerar uma OP por cálculo selecionado, aplicando a cada OP as opções de emissão escolhidas, e SHALL retornar o resultado individual de cada emissão.
8. IF a emissão em lote de um ou mais cálculos falha, THEN THE Ordem_Producao SHALL concluir as emissões bem-sucedidas, não gerar as OPs que falharam e retornar, para cada cálculo com falha, uma indicação do motivo.

### Frente E — Relatório Fiel ao Pré-cálculo e Seed Golden

### Requirement 12: Relatório Oficial Fiel ao Pré-cálculo (HTML e PDF)

**User Story:** Como orçamentista, quero que o relatório oficial do Vizor (em tela e em
PDF) reproduza o pré-cálculo do Calcgraf campo a campo, para apresentar ao cliente e
validar a paridade sem recorrer ao Calcgraf.

#### Acceptance Criteria

1. THE Orcamento_Grafico SHALL produzir o relatório oficial em dois formatos — HTML em tela e PDF — com o mesmo conteúdo em ambos.
2. THE Orcamento_Grafico SHALL apresentar no cabeçalho do relatório: empresa, cliente e nome, contato, telefone, formato final, produto, descrição, código do acabado, quantidade e excedente, programação de entrega e número da OP vinculada.
3. THE Orcamento_Grafico SHALL apresentar, por Plano de Cálculo, os campos Ocorrências, Cores, Formato, Repetição, TR, Corte, Formato, Aprovação, Tiragem, Impressão (máquina), Produção por Hora, Quebra percentual e Apara percentual.
4. THE Orcamento_Grafico SHALL apresentar as seções Suporte (formato, folhas, quantidade, unidade, fixo, variável, unitário e subtotal), Matriz de Impressão, Tinta (escala ou pantone com fixo, variável, unitário e subtotal) e Material de Acabamento.
5. THE Orcamento_Grafico SHALL apresentar as seções Impressão (fixo e variável em horas) e Acabamento, com cada centro de acabamento exibindo fixo, variável, unitário e subtotal.
6. THE Orcamento_Grafico SHALL apresentar a seção Custo de Produção com Material Direto, Custo de Transformação, Serviços Externos, Custo de Produção, Créditos de ICMS, IPI e PIS/COFINS, Taxas de Produção, Custo Financeiro percentual e Total.
7. THE Orcamento_Grafico SHALL apresentar a seção Prazos (produção, armazenagem, pagamento, financiamento e total em dias) e a seção Comissões, com os vendedores e os respectivos percentuais.
8. THE Orcamento_Grafico SHALL apresentar a seção Custos de Venda (CEV) com ICMS, Juros, PIS/COFINS, Comissões, Total CEV percentual e Imposto IPI, e a seção Condições de Pagamento.
9. THE Orcamento_Grafico SHALL apresentar os três pontos de Margem, cada um com Margem percentual, Margem em valor, Contribuição Marginal percentual, Contribuição Marginal em valor, Valor Unitário e Valor Total, para o Primeiro Mil e para o Mil Seguinte.
10. THE Orcamento_Grafico SHALL apresentar no relatório os identificadores de quem incluiu e de quem alterou o cálculo.
11. THE Orcamento_Grafico SHALL filtrar toda geração de relatório pelo `empresaId` da entidade de negócio.

### Requirement 13: Seed Golden 15.086 / 5.316 / 3.149

**User Story:** Como responsável pela migração, quero um seed idempotente que crie o
cálculo 15.086, o orçamento 5.316 e a OP 3.149 com os números exatos dos documentos de
referência, para visualizar em tela e validar o relatório e a OP.

#### Acceptance Criteria

1. WHEN o seed golden é executado para a empresa Carton Wega, THE Seed_Golden SHALL criar o cálculo 15.086, o orçamento 5.316 e a OP 3.149 com os valores exatos dos documentos de referência (cliente ICEFRESH código 903, vendedor IGOR ARNEIRO, tiragem 100.000).
2. THE Seed_Golden SHALL ser idempotente, de modo que executar o seed mais de uma vez não crie registros duplicados nem altere valores já ajustados manualmente.
3. WHEN o seed golden é executado com a opção de simulação (dry-run), THE Seed_Golden SHALL relatar as operações que seriam realizadas sem gravar nenhum registro.
4. THE Seed_Golden SHALL refletir a troca de suporte orçamento→produção, criando o cálculo com o Suporte Orçado Stora Enzo Bobina 222 (formato suporte 720×1000) e o Suporte de Produção Stora Enzo Bobina 234 (formato de corte 745×1000), com a sinalização de troca de suporte habilitada.
5. THE Seed_Golden SHALL criar os dados do golden exclusivamente na empresa Carton Wega identificada por `empresaId`, sem gravar em outras empresas.
6. IF o seed golden é executado e a empresa Carton Wega não existe, THEN THE Seed_Golden SHALL abortar a execução sem criar registros e retornar uma mensagem indicando a ausência da empresa.

### Requisitos Transversais

### Requirement 14: Fidelidade ao Calcgraf (Golden 15.086)

**User Story:** Como responsável pela migração, quero que o cálculo, o relatório e a OP
gerados pelo Vizor batam com o Calcgraf dentro de 0,5%, para substituir o Calcgraf sem
divergência de valores.

#### Acceptance Criteria

1. WHEN o cálculo 15.086 é calculado com o mesmo conjunto de entradas do golden case, THE Orcamento_Grafico SHALL reproduzir cada componente do pré-cálculo (Suporte, Matriz de Impressão, Tinta, Material de Acabamento, Impressão e Acabamento) com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf.
2. WHEN o cálculo 15.086 é calculado com o mesmo conjunto de entradas do golden case, THE Orcamento_Grafico SHALL reproduzir cada total do pré-cálculo (MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e CEV) com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf.
3. WHEN o cálculo 15.086 é calculado, THE Orcamento_Grafico SHALL reproduzir cada um dos três pontos de Margem (Margem percentual, Margem em valor, Contribuição Marginal percentual e em valor, Valor Unitário e Valor Total) para o Primeiro Mil e para o Mil Seguinte com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf.
4. WHEN a OP 3.149 é gerada a partir do cálculo 15.086, THE Ordem_Producao SHALL reproduzir o consumo de cada material (em quilograma, peça ou unidade) com desvio menor ou igual a 0,5% em relação ao valor congelado do Calcgraf.
5. WHEN a Suite_Testes executa o golden case 15.086, THE Suite_Testes SHALL aprovar o caso apenas quando todos os desvios de componentes, totais, pontos de margem e consumos de material forem menores ou iguais a 0,5%.
6. IF algum componente, total, ponto de margem ou consumo de material do golden case 15.086 excede o desvio de 0,5%, THEN THE Suite_Testes SHALL reprovar o caso e indicar qual valor divergiu e o desvio apurado.

### Requirement 15: Multi-tenant, Não-Regressão e Migração

**User Story:** Como responsável técnico, quero que as mudanças respeitem o isolamento
multi-tenant, não regridam o que já funciona e mantenham o banco de produção
sincronizado, para que a entrega seja segura.

#### Acceptance Criteria

1. THE Orcamento_Grafico SHALL filtrar toda leitura e escrita de orçamentos, itens, planos, suportes, relatórios e OPs pelo `empresaId` da entidade de negócio.
2. WHEN a suíte de testes `orcamento-grafico` é executada após as alterações, THE Suite_Testes SHALL manter aprovados todos os 148 testes previamente aprovados, sem nenhum teste novo em falha.
3. WHERE os campos introduzidos por esta spec estão ausentes ou nulos em um item ou plano, THE Motor_Calculo SHALL produzir MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento iguais (até a segunda casa decimal) aos produzidos pelo motor puro congelado.
4. WHEN `prisma/schema.prisma` é alterado por esta spec, THE Migracao SHALL incluir, no mesmo commit, a alteração equivalente idempotente em `prisma/migrate-prod.ts`, gravando os campos de enumeração como VARCHAR.
5. WHEN `prisma/migrate-prod.ts` é executado duas vezes seguidas contra o mesmo banco, THE Migracao SHALL concluir sem erro e sem duplicar tabelas, colunas, índices ou chaves estrangeiras.
6. WHEN o usuário abre um orçamento, item ou OP pré-existente sem os campos introduzidos por esta spec, THE Orcamento_Grafico SHALL carregá-lo sem erro aplicando valores padrão para os campos ausentes, sem alterar os valores de cálculo já persistidos.

### Requirement 16: Propriedades de Correção (Property-Based Testing)

**User Story:** Como responsável pela qualidade, quero propriedades de correção
executáveis sobre o cálculo por planos, a troca de suporte e o consumo da OP, para que
as invariantes sejam verificadas por geração de casos.

#### Acceptance Criteria

1. FOR ALL itens com um ou mais Planos de Cálculo, THE Suite_Testes SHALL verificar que a soma dos custos de Suporte, Impressão e Acabamento dos planos é igual, com tolerância de 0,01, ao MD mais CT do item (invariante de soma de planos).
2. FOR ALL cálculos em que o Suporte de Produção é alterado após o fechamento, THE Suite_Testes SHALL verificar que os valores de MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento do orçamento orçado permanecem inalterados (invariante de preservação do orçamento orçado).
3. FOR ALL cálculos cujo Suporte de Produção difere do Suporte Orçado, THE Suite_Testes SHALL verificar que o consumo de material da OP é recalculado a partir do Suporte de Produção (invariante de consumo com suporte real).
4. FOR ALL cálculos cujo Suporte de Produção é igual ao Suporte Orçado, THE Suite_Testes SHALL verificar que o consumo de material da OP é igual (até a segunda casa decimal) ao consumo calculado com o Suporte Orçado (invariante de identidade quando não há troca).
5. FOR ALL itens em que os Campos de Paridade são preenchidos ou removidos, THE Suite_Testes SHALL verificar que MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e fechamento permanecem iguais (até a segunda casa decimal) aos do mesmo item sem os Campos de Paridade (invariante de não interferência dos campos informativos).
6. WHEN uma geração de OP a partir de um cálculo é aplicada duas vezes com as mesmas opções de emissão sobre o mesmo cálculo, THE Suite_Testes SHALL verificar que a segunda aplicação não cria uma OP duplicada nem altera a OP já gerada (invariante de idempotência da emissão).
