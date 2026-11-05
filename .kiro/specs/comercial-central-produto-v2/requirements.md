# Requirements — Central do Produto v2 ("certidão de nascimento")

## Introdução

A Central do Produto v1 (spec `comercial-central-produto-acabado`, já no ar)
entregou a **busca e consolidação de leitura**: ao pesquisar por código de
acabado ou nome, o usuário vê identificação, arte, ficha técnica, histórico de
OPs e cálculos de um produto, e pode editar descrição/arte/vínculos de código
acabado.

A v2 (Pilar 2 do plano §20 do documento-mestre `PROJETO-MODULO-COMERCIAL.md`)
transforma essa consulta num **Item Master** — o registro único e versionado
que todos os setores (Comercial, Pré-Impressão, PCP, Fiscal) consultam como a
"certidão de nascimento" do produto. A v2 **estende, não descarta** a v1.

Princípios inegociáveis:
- **Base = o `Produto` de Compras/Fiscal** (o mesmo da NF-e). Nada de produto
  gráfico paralelo. A ficha gráfica é uma extensão 1:1 do `Produto`.
- **Multi-tenant por `empresaId` EXPLÍCITO** em toda query (sem depender do
  `prismaScoped`, que faz bypass de SUPER_ADMIN).
- **Não tocar o motor de cálculo** nem quebrar a v1 (não-regressão).
- **Matriz/faca**: o número real da faca já existe no Vizor como tag `[Matriz]`
  nas observações das OPs (ver `docs/matriz-faca-fonte-de-dados.md`); a base
  Calcgraf não tem esse dado. A v2 **consome a tag**, não importa do Calcgraf.

## Glossário

- **Item Master**: a visão consolidada e versionável de um `Produto` gráfico.
- **Revisão de arte**: um conjunto de até 4 imagens + metadados, com um estado
  (RASCUNHO/EM_APROVACAO/APROVADA/REPROVADA/OBSOLETA). A OP sempre usa a arte da
  revisão APROVADA vigente.
- **Conjunto de dimensões**: um registro de medidas com um papel (PRODUTO_FINAL,
  PLANIFICADO, FOLHA) — um produto pode ter vários.
- **Movimentação**: existência de pedido, OP, nota fiscal ou histórico que
  impeça a exclusão física (só permite inativar).

## Requisitos

### Requisito 1 — Ficha gráfica estendida do Produto (1:1)

**História:** Como comercial/pré-impressão, quero uma ficha gráfica rica ligada
ao `Produto`, para centralizar os dados de engenharia sem criar produto paralelo.

#### Critérios
1. QUANDO um `Produto` é aberto na Central ENTÃO o sistema DEVE exibir/permitir
   editar uma ficha gráfica 1:1 (`FichaGraficaProduto`, `@@unique([empresaId,
   produtoId])`), com: cartão/suporte, gramatura, nº de cores, descrição de
   cores, acabamentos, matriz (texto), observações técnicas.
2. A ficha DEVE coexistir com o `AtributoGrafico` existente (a v1 exibe
   `AtributoGrafico`; a v2 adiciona a ficha estendida sem removê-lo) — não-regressão.
3. QUANDO não houver ficha ENTÃO a Central DEVE exibir "sem ficha" e permitir
   criar sob demanda (idempotente).
4. A escrita DEVE validar `empresaId` na entidade real (cross-empresa ⇒ 404).

### Requisito 2 — Arte versionada (até 4 imagens por revisão, uma aprovada)

**História:** Como pré-impressão, quero versionar a arte do produto com rodadas
de aprovação, para que a OP sempre use a arte correta (aprovada vigente).

#### Critérios
1. O sistema DEVE permitir criar **revisões de arte** por produto, cada uma com
   **até 4 imagens** (dataURL/base64 em TEXT, nunca em `select` de listagem).
2. Cada revisão tem estado `RASCUNHO → EM_APROVACAO → APROVADA | REPROVADA` e
   pode ser marcada `OBSOLETA` quando uma nova é aprovada.
3. QUANDO uma revisão é APROVADA ENTÃO qualquer revisão APROVADA anterior DEVE
   virar OBSOLETA (só uma aprovada vigente por produto).
4. O sistema DEVE identificar claramente **qual é a arte aprovada vigente** e
   expor as imagens dela no detalhe.
5. Aprovar/reprovar DEVE registrar quem e quando (auditável) e aceitar um
   comentário.
6. A listagem de revisões NÃO DEVE trafegar as imagens (só contagem/estado);
   as imagens vêm só no detalhe de uma revisão.

### Requisito 3 — Faca / Matriz do produto

**História:** Como comercial/PCP, quero ver e registrar a faca de corte do
produto (número real + imagem), para rastrear a matriz usada.

#### Critérios
1. O detalhe DEVE exibir o **número da matriz real** do produto, derivado da tag
   `[Matriz]` das OPs do produto (a mais recente), conforme
   `docs/matriz-faca-fonte-de-dados.md` — SEM importar do Calcgraf (não há dado lá).
2. A ficha gráfica DEVE permitir registrar/editar manualmente um número de
   matriz (sobrepõe o derivado quando preenchido) e **uma imagem da faca**
   (dataURL/base64 em TEXT).
3. A ficha gráfica DEVE permitir vincular opcionalmente um `ModeloFaca` existente
   (campo nullable; não obrigatório — o cadastro `ModeloFaca` hoje está vazio).
4. Nenhum vínculo/edição de faca DEVE tocar o motor de cálculo.

### Requisito 4 — Conjuntos de dimensões (vários por produto)

**História:** Como pré-impressão, quero registrar vários conjuntos de medidas
(produto final, planificado, folha), para a ficha refletir a realidade do item.

#### Critérios
1. O sistema DEVE permitir cadastrar N **conjuntos de dimensões** por produto,
   cada um com `tipo` (PRODUTO_FINAL | PLANIFICADO | FOLHA), largura/altura/
   profundidade (mm, opcionais) e observação.
2. O detalhe DEVE listar os conjuntos e permitir incluir/editar/remover.
3. A remoção de um conjunto NÃO DEVE afetar OPs/cálculos (dado cadastral).

### Requisito 5 — Totalizadores de venda por cliente/período (lidos da NF-e)

**História:** Como comercial, quero ver quanto aquele produto já vendeu (por
cliente e período), para decisões comerciais.

#### Critérios
1. O detalhe DEVE exibir totalizadores de venda do produto: quantidade e valor
   agregados, com recorte por período (ex.: 12 meses) e por cliente (top N).
2. A fonte DEVE ser os itens de documento fiscal de SAÍDA já emitidos
   (`ItemDocumentoFiscal`/documento fiscal), filtrados por `empresaId` EXPLÍCITO
   e pelo produto.
3. QUANDO não houver notas ENTÃO o sistema DEVE exibir "sem vendas registradas"
   (nunca erro).
4. A agregação DEVE ter custo controlado (sem N+1; agregação no banco quando
   possível).

### Requisito 6 — Inativar vs excluir (proteção por movimentação)

**História:** Como administrador, quero excluir um produto só quando ele não tem
movimentação, e apenas inativar nos demais casos, para não corromper histórico.

#### Critérios
1. O sistema DEVE permitir **inativar/reativar** um produto (`Produto.status`).
2. O sistema SÓ DEVE permitir **excluir fisicamente** um produto quando ele NÃO
   tiver nenhuma movimentação: sem pedido (venda/compra), sem OP, sem nota
   fiscal, sem item de orçamento, sem saldo/estoque.
3. QUANDO houver movimentação E o usuário pedir exclusão ENTÃO o sistema DEVE
   recusar (409) explicando o motivo e sugerir inativar.
4. Exclusão/inativação exigem permissão (`podeEditarCadastros` + ADMIN bypass).

### Requisito 7 — Carga inicial / localização

**História:** Como usuário, quero que os produtos já cadastrados apareçam na
Central e sejam fáceis de localizar.

#### Critérios
1. A busca da v1 (código acabado OU nome) DEVE continuar funcionando (não-regressão).
2. A Central DEVE permitir **listar/paginar todos os produtos** da empresa com
   filtros (status ativo/inativo, com/sem ficha, texto) — para a "carga inicial"
   ser consultável sem depender de um termo de busca.
3. Nenhuma migração de dado é necessária (os produtos já existem); a v2 só os
   expõe.

### Requisito 8 — Preparo fiscal/SPED (arquitetura, sem gerar SPED)

**História:** Como fiscal, quero que a ficha aponte para a estrutura ativa do
produto, deixando o caminho pronto para o SPED Bloco K, sem implementá-lo agora.

#### Critérios
1. A ficha DEVE expor (leitura) o vínculo do produto com a `EstruturaProduto`
   ATIVA quando existir (consumo por OP já vive em `ItemOrdemProducao`).
2. NÃO DEVE gerar arquivo SPED nesta spec (só deixar a amarração visível/pronta).

### Requisito 9 — Não-regressão, multi-tenant e verificação

#### Critérios
1. A v1 (busca/detalhe/edição básica) DEVE continuar funcionando sem alteração
   de comportamento observável.
2. TODA query nova DEVE filtrar `empresaId` EXPLÍCITO.
3. Mudanças de schema DEVEM vir com `migrate-prod.ts` idempotente no MESMO commit.
4. Funções de regra (versionamento de arte, proteção de exclusão, derivação da
   matriz) DEVEM ser PURAS e cobertas por testes (incl. property-based).
5. `get_diagnostics` limpo nos arquivos tocados; `prisma generate` OK.
