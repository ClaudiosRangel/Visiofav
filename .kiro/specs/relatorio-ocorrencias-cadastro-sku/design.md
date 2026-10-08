# Design — Relatório de Ocorrências e Ajustes (Cadastro de Produtos/SKU WMS)

## Visão geral

Correções no cadastro de Produto/SKU e no recebimento, agrupadas por camada.
Ordem de implementação por risco/valor: **Ocorrência 6 (crítica) → 4/5 (EAN
read-only + herança) → 1/2 (medidas) → 8 (shelf-life × RLM) → 6-tara → 7
(verificação)**.

Arquivos-base confirmados por leitura:
- Backend: `src/modules/sku/sku.routes.ts`, `src/modules/produto/produto.routes.ts`,
  `src/modules/nota-entrada/resolver-codigo-produto-item.service.ts`,
  `src/modules/endereco/validador-capacidade.service.ts`,
  `prisma/schema.prisma` (models `Sku`, `Produto`), `prisma/migrate-prod.ts`.
- Frontend: `configurador/produtos/SkuPanel.tsx`,
  `configurador/produtos/ProdutoModal.tsx`, `data/hooks/useSku.ts`.

Decisão de arquitetura central (fundamentada no benchmark): seguir o modelo
GS1/SAP/Oracle — atributos de controle (lote/validade/EAN) no **Produto (pai)**,
dimensões **medidas por nível** no SKU, GTIN **único por empresa**.

---

## Ocorrência 6 — Bloqueio de código de barras duplicado (CRÍTICO)

### Backend
Novo helper puro `verificarCodigoBarraDuplicado` em
`src/modules/sku/sku-codigo-barra.service.ts`:

```ts
// Dado empresaId, os códigos candidatos (ean13/dun/display) e um skuId a
// ignorar (edição), retorna o primeiro conflito encontrado ou null.
export interface ConflitoCodigoBarra {
  codigo: string
  campoConflitante: 'codigoBarra' | 'codigoBarraDun' | 'codigoBarraDisplay'
  skuIdConflitante: string
  produtoId: string
  produtoCodigo: string
  produtoNome: string
}
```

Regras:
- Coleta os códigos não-vazios do payload (ean13/dun/display), normaliza
  (`trim`), dedup.
- Busca SKUs da MESMA empresa (via `Sku.empresaId`, com fallback por
  `produto.empresaId` para SKUs legados com `empresaId` null) cujo
  `codigoBarra` OU `codigoBarraDun` OU `codigoBarraDisplay` ∈ candidatos.
- Ignora o próprio `skuId` em edição.
- Retorna o 1º conflito (campo + produto) para a mensagem.

Integração nas rotas `POST /skus` e `PUT /skus/:id`: antes do create/update,
chamar o helper; se houver conflito → `reply.status(409).send({ message })`
com texto: `"O código <X> já está em uso pelo produto <codigo> - <nome>."`.

**Isolamento multi-tenant:** o filtro usa `empresaId` do usuário; como
`Sku.empresaId` é nullable (legado), a query cobre
`OR: [{ empresaId }, { empresaId: null, produto: { empresaId } }]`.

### Frontend (`SkuPanel.tsx`)
O `handleSave` já captura `err?.response?.data?.message` e exibe em
`notifications`. Garantir que o modal NÃO feche em erro (hoje fecha sempre após
`mutateAsync`; mover `setModalOpen(false)` para dentro do try, só no sucesso).

### Testes
`sku-codigo-barra.service.test.ts` (vitest): colisão direta, colisão cruzada
(ean13 novo x dun existente), isolamento por empresa, ignora próprio id,
vazio/nulo não acusa.

---

## Ocorrências 4 e 5 — EAN-13 read-only + herança no recebimento (EAN-14)

### Backend — fechar a lacuna do resolver
`resolver-codigo-produto-item.service.ts` hoje busca EAN em `Produto.cEAN` e
`Sku.codigoBarra`, **mas não em `Sku.codigoBarraDun`**. Isso faz a leitura do
EAN-14 da caixa não resolver o produto — e, por consequência, as regras de
lote/shelf life (que dependem do `produtoId` resolvido) não são aplicadas.

Correção: incluir `codigoBarraDun` (e `codigoBarraDisplay`) na busca de SKU por
EAN, mantendo a prioridade atual (De-Para → cEANTrib → cEAN) e adicionando o
match por DUN como mais um caminho de resolução. Assim, a herança do Req 4 passa
a funcionar de fato: EAN-14 → produto → regras do produto.

### Frontend
- `Produto.cEAN` é a fonte da verdade do EAN-13 (Req 5).
- No `SkuPanel`, o campo "Código de Barras (EAN-13)" do SKU de nível unidade
  passa a ser **somente leitura**, pré-preenchido com o `cEAN` do produto
  (recebido via prop a partir do `ProdutoModal`/detalhe do produto).
- Exibir o código/nome do produto vinculado em destaque (vermelho) perto do
  campo EAN-13 (Req 4.3/5.3).
- Quando `Produto.cEAN` vazio: alerta orientando preencher no cadastro
  principal (Req 5.4).

Nota: o SKU continua podendo ter `codigoBarraDun`/`display` editáveis (são
códigos próprios do nível caixa/display). Apenas o EAN-13 da unidade é espelho.

---

## Ocorrências 1 e 2 — Medidas por nível + cubagem derivada

### Schema (`Sku`) + `migrate-prod.ts`
Adicionar campos de medida da **unidade** (os atuais passam a representar a
caixa/embalagem do SKU; os novos, a unidade contida), todos nullable:

```prisma
larguraUnidade     Decimal? @map("largura_unidade") @db.Decimal(10, 3)
alturaUnidade      Decimal? @map("altura_unidade") @db.Decimal(10, 3)
comprimentoUnidade Decimal? @map("comprimento_unidade") @db.Decimal(10, 3)
volumeUnidade      Decimal? @map("volume_unidade") @db.Decimal(10, 6)
pesoLiquidoUnidade Decimal? @map("peso_liquido_unidade") @db.Decimal(10, 3)
```

`migrate-prod.ts`: 5× `ADD COLUMN IF NOT EXISTS` (idempotente, rodar 2x local).
Retrocompat: campos nullable; nenhuma leitura existente quebra.

### Backend (`sku.routes.ts`)
Zod de create/update ganha os 5 campos novos (`.nullable().optional()`),
seguindo o padrão de nullable já usado para permitir limpar valor.

### Frontend (`SkuPanel.tsx`)
- Separar visualmente "Medidas da Caixa/Embalagem" (campos atuais) e "Medidas da
  Unidade" (campos novos).
- Botão "Derivar cubagem da unidade": calcula
  `volumeUnidade = volume (caixa) ÷ qtdEmbalagem` quando `qtdEmbalagem > 0`;
  resultado editável/sobrescrevível (Req 3). Exibir como sugestão (placeholder
  "Auto: X"), igual ao padrão já existente de volume/pesoPalete.

---

## Ocorrência 8 — Shelf-Life (dias) × RLM (%)

Apenas frontend (`ProdutoModal.tsx`), campos já existem:
- `shelfLifeMinimo` (dias), `percentualVidaUtilMinimoRecebimento` (RLM %),
  `shelfLifeTotalDias` (total).
- Regra:
  - Se `shelfLifeMinimo` preenchido → desabilitar input de RLM%.
  - Ao preencher RLM% → calcular `shelfLifeMinimo = round(shelfLifeTotalDias ×
    RLM ÷ 100)` e preencher (desabilitando a edição direta de dias enquanto RLM%
    estiver no comando) — mas o usuário pode limpar um para liberar o outro.
  - RLM% exige `shelfLifeTotalDias`; se ausente, exibir aviso orientando
    preencher o total primeiro (Req 8.3).
- Padrão SAP (percentual derivado de dias ÷ total).

Lógica pura extraída para `src/utils/shelfLifeRlm.ts` (front) com testes, para
não enterrar a conversão no componente.

---

## Ocorrência 6 (tara) — Peso tara do palete na capacidade

### Backend (`validador-capacidade.service.ts`)
O cálculo de peso atual soma `quantidade × pesoBruto`. A tara do palete deve
entrar quando a ocupação é por palete. Abordagem mínima e segura:
- Tabela de taras por `tipoPalete` (constante compartilhada
  `src/modules/sku/tara-palete.ts`): PBR≈25, CHEP≈30, ... (valores default
  parametrizáveis; o SKU pode ter `pesoPalete` manual que já inclui tara).
- Ao calcular o peso de uma unidade de palete completa, somar a tara do tipo.
- Como a mudança toca um motor usado por put-away/sugestão, será **aditiva e
  guardada atrás de verificação** (se não houver `tipoPalete`/tara, comportamento
  atual preservado). Detalhar/validar com teste antes de plugar no put-away.

Observação: o `Sku` já tem `pesoPalete` (peso do palete montado) e `tipoPalete`.
A tara entra como piso quando `pesoPalete` não foi informado manualmente.

---

## Ocorrência 7 — Código interno em ordem (verificação)

O fix do relatório 2 (consumir contador em transação + pular ocupados) está em
`produto/codigo-sequencial.service.ts` + `POST /produtos`. Esta spec faz
**diagnóstico**: reproduzir o cenário do print do relatório 3 (se obtido) antes
de qualquer alteração. Se for o mesmo bug já corrigido, documentar e fechar; se
for caso novo (ex.: ordenação de exibição por `nome` em vez de `codigo`),
tratar pontualmente. Não alterar o gerador sem reproduzir.

---

## Multi-tenant e migrações (checklist do projeto)
- Toda query nova filtra `empresaId` explicitamente.
- `schema.prisma` + `migrate-prod.ts` no mesmo commit; idempotente; testado 2x
  local.
- Branch nova; nunca commit direto na `main`.

## Estratégia de testes
- Backend: vitest para `sku-codigo-barra.service` e resolver EAN-14; validador
  de capacidade com tara.
- Frontend: unit da lógica pura `shelfLifeRlm.ts`.
- QA E2E: estender a suíte Python (`test_23_sku_e_produto_config.py`) para o
  bloqueio de EAN duplicado.
