# Requisitos — Relatório de Ocorrências e Ajustes (Cadastro de Produtos/SKU WMS)

## Introdução

Este documento consolida as 8 ocorrências levantadas pelo QA humano no
**"3 - Relatório de Validação de Cadastro de Produtos WMS — Ocorrências e
Ajustes" (01/10/2026)**, concentradas no cadastro de Produto/SKU e nas regras
de recebimento. Cada requisito foi confrontado com as práticas de mercado
(GS1, SAP EWM/S4, Oracle PIM, Walmart Supplier) para garantir que a solução
siga o padrão correto do setor, não apenas o pedido literal.

### Benchmark de mercado (resumo que fundamenta as decisões)

- **Hierarquia de embalagem GS1 (Each/Inner/Case/Pallet):** cada nível tem GTIN
  próprio E dimensões/peso **medidos por nível**, nunca derivados por
  multiplicação da unidade. (GS1 US, Walmart Supplier, SAP HU volume.)
- **GTIN atribuído uma única vez:** um código de barras não pode se repetir
  entre itens; configurações de embalagem diferentes exigem GTINs distintos.
  SAP impede criação de material com EAN duplicado; SAP B1 tem trava padrão.
- **Herança de atributos pai→filho (Oracle PIM):** controle de lote/validade é
  do item físico e vale para todos os níveis de embalagem que o contêm;
  editável só no nível pai.
- **Shelf life (SAP):** "Total Shelf Life" e "Minimum Remaining Shelf Life" no
  recebimento são conceitos distintos porém ligados — o percentual é derivado
  de `dias mínimos ÷ shelf life total`.

### Decisões firmadas (confirmadas pelo usuário)

- **A (medidas):** campos de medida independentes por nível logístico (padrão
  GS1) + preenchimento automático OPCIONAL da cubagem da unidade por divisão
  (`cubagem caixa ÷ multiplicador`), sobrescrevível pela medida real.
- **B (EAN-13 fonte única):** o EAN-13 oficial é `Produto.cEAN`; o SKU do nível
  unidade reflete em modo somente leitura.
- **C (unicidade):** **bloquear** o salvamento de código de barras duplicado,
  escopo **por empresa**, cobrindo EAN-13, EAN-14/DUN e display.
- **D (entrega):** spec rastreável; implementação começa pela ocorrência 6
  (bug crítico).

### Convenções técnicas (herdadas do steering do projeto)

- Alteração de `schema.prisma` SEMPRE acompanha `migrate-prod.ts` idempotente
  no mesmo commit (steering database-migrations).
- Toda query filtra `empresaId` explicitamente (steering ATENCAO-pontos-verificar).
- Nunca commitar direto na `main`; branch nova.

---

## Requisito 1 — Bloqueio de código de barras duplicado (Ocorrência 6, CRÍTICO)

**História:** Como gestor de cadastro, quero que o sistema impeça salvar um SKU
com um código de barras (EAN-13, EAN-14/DUN ou display) já usado por outro
produto da mesma empresa, para evitar entrada/separação/inventário no item
errado.

#### Critérios de Aceitação
1. QUANDO o usuário tentar criar ou editar um SKU com `codigoBarra`,
   `codigoBarraDun` ou `codigoBarraDisplay` que já exista em QUALQUER SKU de
   QUALQUER produto da MESMA empresa, ENTÃO o sistema DEVE recusar a operação
   com HTTP 409 e mensagem informando o código conflitante e o produto que já o
   utiliza.
2. A verificação de unicidade DEVE considerar colisão cruzada entre os três
   campos (ex.: um EAN-13 novo não pode colidir com um `codigoBarraDun` já
   gravado em outro SKU).
3. A verificação DEVE ser isolada por `empresaId` (um EAN pode coexistir em
   empresas distintas do mesmo banco multi-tenant).
4. AO EDITAR um SKU, a verificação DEVE ignorar o próprio registro (não
   acusar conflito consigo mesmo).
5. O frontend DEVE exibir a mensagem de erro de forma clara ao usuário, sem
   fechar o formulário, preservando os dados digitados.
6. Códigos de barra vazios/nulos NÃO disparam verificação de unicidade.

---

## Requisito 2 — Medidas independentes por nível logístico (Ocorrência 1)

**História:** Como analista de WMS, quero cadastrar as dimensões/peso da
unidade solta (EAN-13) separadamente das da caixa fechada (EAN-14/DUN), para o
sistema calcular corretamente picking fracionado, ocupação de prateleira e
cubagem de transporte.

#### Critérios de Aceitação
1. O SKU DEVE suportar um conjunto de medidas da **unidade** (largura, altura,
   comprimento, volume, peso) distinto do conjunto de medidas da **caixa/fardo**.
2. As medidas da unidade alimentam cálculo de picking fracionado e escolha da
   caixa de envio; as da caixa alimentam recebimento, ocupação em prateleira
   alta e cubagem de transporte.
3. A persistência DEVE ser retrocompatível: SKUs existentes continuam válidos
   sem preenchimento dos novos campos (todos nullable).
4. O formulário de SKU DEVE separar visualmente "Medidas da Unidade" e
   "Medidas da Caixa".

---

## Requisito 3 — Cubagem automática proporcional da unidade (Ocorrência 2)

**História:** Como operador de cadastro, quero que o sistema derive a cubagem
da unidade a partir da cubagem da caixa dividida pelo multiplicador, para não
precisar medir item a item em embalagens irregulares/cilíndricas.

#### Critérios de Aceitação
1. QUANDO o usuário informar as dimensões da caixa master e o multiplicador
   (unidades por caixa), ENTÃO o sistema DEVE oferecer o cálculo automático
   `volume da unidade = volume da caixa ÷ multiplicador`.
2. O preenchimento automático DEVE ser OPCIONAL e sobrescrevível pela medida
   real da unidade (padrão GS1 de medir por nível tem prioridade quando
   disponível).
3. O multiplicador usado DEVE ser `qtdEmbalagem` quando > 0; se for 0/ausente,
   o cálculo não é oferecido.

---

## Requisito 4 — Herança de lote e shelf life (EAN-13 → EAN-14) (Ocorrência 3)

**História:** Como conferente, quero que ao ler o EAN-14 (caixa) no recebimento
as regras de controle de lote e shelf life cadastradas para o item sejam
aplicadas, porque a caixa é composta pelas unidades físicas.

#### Critérios de Aceitação
1. As regras de lote (`exigeLote`) e shelf life (`shelfLifeMinimo`,
   `shelfLifeTotalDias`, `percentualVidaUtilMinimoRecebimento`,
   `diasQuarentenaVencimento`) DEVEM continuar vinculadas ao Produto (nível
   pai), valendo para todos os SKUs/níveis sem duplicação.
2. QUANDO o recebimento/conferência receber um código EAN-14/DUN, ENTÃO o
   sistema DEVE resolver o produto correspondente e aplicar as mesmas
   validações de lote/validade da unidade.
3. A tela de SKU DEVE deixar claro (visualmente) que lote/validade são herdados
   do produto, exibindo a referência ao EAN-13/código do produto em destaque
   (vermelho), como pedido no relatório.

---

## Requisito 5 — EAN-13 somente leitura no SKO, vindo do Produto (Ocorrência 4)

**História:** Como gestor de cadastro, quero que o EAN-13 do SKU da unidade seja
preenchido automaticamente a partir do cadastro principal do produto, sem
edição manual, para evitar divergência de digitação.

#### Critérios de Aceitação
1. A fonte da verdade do EAN-13 é `Produto.cEAN`.
2. No formulário de SKU do nível unidade, o campo EAN-13 DEVE ser exibido em
   modo somente leitura, refletindo `Produto.cEAN`.
3. O rótulo/identificação do produto (código/nome) vinculado ao EAN-13 DEVE ser
   exibido em destaque (vermelho), conforme o relatório.
4. QUANDO o `Produto.cEAN` estiver vazio, ENTÃO a tela DEVE orientar o usuário a
   preencher o EAN no cadastro principal do produto.

---

## Requisito 6 — Peso tara do palete no cálculo de capacidade (Ocorrência 5)

**História:** Como responsável pela estrutura de armazenagem, quero que o peso
da tara do palete (25–60 kg conforme o tipo) entre no cálculo da capacidade de
suporte da porta-paletes, para não estourar o limite da estrutura.

#### Critérios de Aceitação
1. O cálculo de peso total de um palete DEVE somar a **tara do palete** ao peso
   da carga (peso bruto × unidades no palete).
2. A tara DEVE ser derivada do `tipoPalete` do SKU (tabela de taras por tipo),
   com possibilidade de valor manual.
3. Onde o sistema avaliar capacidade de porta-paletes, o peso considerado DEVE
   incluir a tara.

---

## Requisito 7 — Código interno sequencial em ordem (Ocorrência 7)

**História:** Como gestor de cadastro, quero que o código interno gerado
automaticamente saia em ordem sequencial correta, para manter a organização do
cadastro.

#### Critérios de Aceitação
1. O código automático de Produto DEVE ser gerado em ordem sequencial sem
   saltos indevidos nem repetição (reforço/validação do fix anterior do
   relatório 2).
2. SE for identificado caso novo de desordenação, ENTÃO a causa DEVE ser
   diagnosticada antes de qualquer alteração (o fix anterior consome o contador
   em transação e pula códigos ocupados).

---

## Requisito 8 — Dependência Shelf-Life (dias) × RLM (%) (Ocorrência 8)

**História:** Como analista de cadastro, quero que ao preencher o Shelf-Life
Mínimo (dias) o campo RLM Recebimento (%) seja inibido, e ao preencher o RLM (%)
o Shelf-Life Mínimo (dias) seja calculado automaticamente, para evitar
configuração conflitante.

#### Critérios de Aceitação
1. QUANDO o usuário preencher `Shelf-Life Mínimo (Dias)`, ENTÃO o campo
   `RLM Recebimento (%)` DEVE ficar inibido para edição.
2. QUANDO o usuário preencher `RLM Recebimento (%)`, ENTÃO o sistema DEVE
   calcular e preencher automaticamente o `Shelf-Life Mínimo (Dias)` usando
   `dias = round(shelfLifeTotalDias × RLM% ÷ 100)`.
3. O cálculo do item 2 depende de `shelfLifeTotalDias` estar preenchido; se não
   estiver, a tela DEVE orientar o usuário a informar o shelf life total antes.
4. A relação segue o padrão SAP (percentual derivado de dias ÷ total).
