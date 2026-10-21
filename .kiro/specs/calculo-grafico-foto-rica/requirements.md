# Requirements — Cálculo Gráfico: Foto Rica + Conferência (paridade total Calcgraf)

## Introdução

A migração do acervo (spec `biblioteca-calculos-graficos`) trouxe para o Vizor o
cabeçalho + agregados dos 7.951 cálculos do Calcgraf (número, descrição, tiragem,
cores, custo de produção, valor total). **Porém o detalhamento do pré-cálculo**
— planos, suportes com peso/custo, tintas, materiais de acabamento, etapas de
impressão/acabamento com tempos e custos, e a decomposição (MD / Custo de
Transformação / Serviço Externo / CEV / margens por tiragem) — **não foi
migrado**. Hoje a tela de detalhe mostra um resumo; o PDF do Calcgraf mostra
tudo.

O objetivo de negócio é CRÍTICO e explícito do usuário (Carton Wega): *"preciso
reproduzir qualquer orçamento do Calcgraf no Vizor; vou gerar um orçamento na
frente do cliente e precisa bater tudo com o Calcgraf — não posso passar
vergonha."*

Esta spec entrega isso em duas camadas:
- **Camada 1 — Foto rica (garantida):** trazer TODO o detalhamento do
  pré-cálculo de cada cálculo do Calcgraf para o Vizor, e exibir uma tela
  idêntica ao pré-cálculo (valores = os do Calcgraf, batem 100% por definição).
- **Camada 2 — Conferência ao recriar (anti-vergonha):** ao gerar um orçamento
  novo a partir de um cálculo, mostrar lado a lado o valor da FOTO (Calcgraf) e
  o valor RECALCULADO pelo motor do Vizor, com o desvio %, antes de enviar ao
  cliente.

O que NÃO muda: o motor de cálculo (`calcularOrcamentoGrafico`), o PCP, a
estrutura existente da biblioteca. A foto rica é ADITIVA (um JSON a mais na
coluna `resultado_calculo` que hoje está nula nos migrados).

## Glossário

- **Foto rica**: JSON estruturado, gravado em `calculo_grafico.resultado_calculo`,
  contendo todas as seções do pré-cálculo do Calcgraf de um cálculo.
- **Pré-cálculo**: o relatório do Calcgraf (ex.: o PDF do cálculo 11121) com
  planos, suportes, tintas, mat.acabamento, impressão, acabamentos e a
  decomposição de custo/margem.
- **Conferência**: comparação visível foto (Calcgraf) × recalculado (Vizor) com
  o desvio percentual, exibida antes de o operador enviar o orçamento.

## Requisitos

### Requisito 1 — Extração completa do pré-cálculo do Calcgraf

**História:** Como responsável pela migração, quero extrair do Calcgraf TODOS os
dados que compõem o pré-cálculo de cada cálculo, para que nada falte no Vizor.

#### Critérios de aceitação
1. QUANDO o exportador rodar, ENTÃO para cada cálculo (maior `Codigo` por
   `NumCalculo`, não cancelado) ele DEVE extrair:
   - cabeçalho (número, cliente, linha, produto/descrição, sigla, tiragem,
     tributação, alíquotas);
   - planos (`CalculoPlanos`): nome, suporte (nome resolvido), gramatura,
     formato aberto/corte, aproveitamento, ocorrências, tiragem, micro/capa;
   - suportes com peso e subtotal (do pré-cálculo: formato, folhas, quantidade
     kg, preço unit, subtotal);
   - tintas (`CalculoTintas`): nome/Pantone, cobertura %, plano;
   - materiais de acabamento (`CalculoMatAcabamento` + `Itc.Descritivo`);
   - matriz de impressão (quantidade + preço, quando houver);
   - impressão (`CalculoAtvImpressao` + máquina): cores, formato, horas,
     prod/hora, custo;
   - acabamentos (`CalculoAtividades` tipo A/M + `Atividades`/`CentrosProducao`):
     nome, centro, horas (acerto + operação), prod/hora, custo;
   - decomposição (`CalculoResAgrupamento`): MD, Custo de Transformação, Serviço
     Externo, Custo de Produção;
   - créditos/impostos e CEV (`CalculoTaxas`): ICMS, PIS/Cofins, comissões,
     juros, crédito IPI;
   - margens por tiragem (`CalculoTiragens` + `CalculoMargens`): margem %,
     CM %, valor unitário, valor total nas faixas (ex.: 10%, selecionada, 30%).
2. A extração DEVE preservar acentos (`sqlcmd -u` UTF-16 → UTF-8).
3. A extração DEVE resolver os NOMES (suporte, máquina, atividade, material,
   tinta) — não só os códigos.
4. O resultado DEVE casar com o PDF do cálculo 11121 (caso de prova) seção por
   seção, valor por valor.

### Requisito 2 — Foto rica gravada e idempotente

**História:** Como sistema, quero gravar a foto rica em cada cálculo da
biblioteca sem duplicar nem perder o que já existe.

#### Critérios de aceitação
1. QUANDO o importador processar um cálculo, ENTÃO DEVE gravar o JSON da foto
   rica em `calculo_grafico.resultado_calculo` do cálculo correspondente (match
   por `empresaId` + `numeroCalcgraf`).
2. A operação DEVE ser idempotente — rodar de novo atualiza a foto sem criar
   cálculos novos nem alterar `numero`/`numeroCalcgraf`.
3. A foto rica NÃO DEVE recalcular — grava os valores DA ORIGEM (Calcgraf).
4. O custo de produção e o valor total exibidos DEVEM ser os do pré-cálculo
   (ex.: C.PROD 64.491,72 e Valor Total 100.580,00 do 11121), com tolerância 0
   em relação ao Calcgraf (são os mesmos números).
5. QUANDO um cálculo não tiver determinada seção (ex.: sem mat.acabamento),
   ENTÃO a seção vem vazia, sem erro.

### Requisito 3 — Tela de detalhe idêntica ao pré-cálculo

**História:** Como operador, quero abrir um cálculo no Vizor e ver o pré-cálculo
completo, igual ao que eu via no Calcgraf.

#### Critérios de aceitação
1. QUANDO abrir um cálculo com foto rica, ENTÃO a tela DEVE exibir as seções:
   cabeçalho comercial, planos, suportes (com peso/subtotal), matriz, tintas,
   mat.acabamento, impressão, acabamentos, custo de produção decomposto
   (MD/CT/SE), CEV e margens por tiragem.
2. O layout DEVE ser legível e espelhar a ordem/rotulagem do pré-cálculo do
   Calcgraf.
3. QUANDO o cálculo for migrado (`origem=MIGRADO_CALCGRAF`), ENTÃO DEVE exibir o
   selo "Foto do Calcgraf — valores originais".
4. DEVE ser possível imprimir/gerar PDF dessa visão (paridade com o pré-cálculo
   impresso do Calcgraf).
5. QUANDO a foto rica ainda não existir (cálculo antigo não reprocessado),
   ENTÃO a tela DEVE exibir o resumo atual, sem quebrar.

### Requisito 4 — Conferência ao gerar orçamento (anti-vergonha)

**História:** Como operador gerando um orçamento na frente do cliente, quero ver
se o valor recalculado pelo Vizor bate com o do Calcgraf ANTES de enviar.

#### Critérios de aceitação
1. QUANDO o operador usar um cálculo num orçamento (reaproveitar), ENTÃO o item
   criado DEVE preservar a foto (valor Calcgraf) E, quando recalculável, exibir
   o valor recalculado do Vizor lado a lado.
2. A tela DEVE mostrar o desvio percentual entre foto e recalculado por
   componente (MD, CT, Custo de Produção, Valor Total) e no total.
3. QUANDO o desvio total for ≤ 0,5%, ENTÃO DEVE sinalizar "confere" (verde).
4. QUANDO o desvio for > 0,5% OU o recálculo não for possível (cadastro
   ausente), ENTÃO DEVE sinalizar claramente (amarelo/vermelho) com o motivo,
   para o operador decidir usar a foto (valor Calcgraf) em vez do recalculado.
5. O operador DEVE poder escolher qual valor vai para a proposta: a foto
   (Calcgraf) ou o recalculado (Vizor).

### Requisito 5 — Caso de prova 11121 e validação do acervo

**História:** Como usuário, quero provar que um cálculo real bate 100% antes de
confiar nos 7.951.

#### Critérios de aceitação
1. O cálculo 11121 (ESAB) DEVE ser reproduzido no Vizor com a foto rica e
   conferido seção por seção contra o PDF fornecido (planos, suportes, tintas,
   acabamentos, C.PROD, margens).
2. SÓ APÓS o 11121 bater, a foto rica DEVE ser aplicada aos 7.951 (idempotente,
   em produção, sem tocar PCP).
3. A aplicação em massa DEVE reportar quantos cálculos receberam foto rica e
   quantos ficaram sem (e por quê), sem abortar.

### Requisito 6 — Isolamento e segurança (inalterado)

#### Critérios de aceitação
1. Toda operação DEVE filtrar `empresaId` explícito (multi-tenant).
2. A migração roda na tabela isolada `calculo_grafico` — NÃO toca OP,
   Programação, importação de PDF nem qualquer tabela do PCP.
3. A connection string de produção vem de env, nunca commitada.
