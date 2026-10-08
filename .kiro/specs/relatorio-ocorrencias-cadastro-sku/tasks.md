# Plano de Implementação — Relatório de Ocorrências e Ajustes (Cadastro SKU)

Ordem por risco/valor. Backend em `VisioFab.Wms.Back`, frontend em
`VisioFab.Wms.Front` (repos separados).

- [x] 1. **Ocorrência 6 (CRÍTICO) — bloqueio de EAN duplicado no backend**
  - [x] 1.1 Criar `src/modules/sku/sku-codigo-barra.service.ts` com
    `verificarCodigoBarraDuplicado(db, empresaId, { ean13, dun, display }, skuIdIgnorar?)`
    retornando o 1º conflito (campo + produto) ou null. Isolar por empresa
    (`OR: [{ empresaId }, { empresaId: null, produto: { empresaId } }]`).
  - [x] 1.2 Plugar em `POST /skus` e `PUT /skus/:id` → 409 com mensagem clara.
  - [x] 1.3 Testes `sku-codigo-barra.service.test.ts` (colisão direta, cruzada,
    isolamento, ignora próprio id, vazio não acusa). **7/7 passando.**
  - _Requisitos: 1_

- [x] 2. **Ocorrência 6 — frontend não fecha modal em erro**
  - [x] 2.1 Verificado: `handleSave` já faz `setModalOpen(false)` DENTRO do try
    após o await; em erro 409 cai no catch e o modal permanece aberto com os
    dados preservados. Nenhuma alteração necessária.
  - _Requisitos: 1.5_

- [x] 3. **Ocorrência 4 — resolver EAN-14/DUN no recebimento (herança)**
  - [x] 3.1 Em `resolver-codigo-produto-item.service.ts`, busca de SKU por EAN
    passou a cobrir `codigoBarra` + `codigoBarraDun` + `codigoBarraDisplay`
    (OR), mapeando todos os códigos do SKU para o produto. Prioridade preservada
    (De-Para → cEANTrib → cEAN; menor sequência). get_diagnostics limpo.
  - [ ] 3.2 Teste cobrindo leitura de EAN-14 → produto resolvido (pendente).
  - _Requisitos: 4.2_

- [x] 4. **Ocorrência 5 — EAN-13 read-only vindo do produto (frontend)**
  - [x] 4.1 `SkuPanel` busca o produto por `produtoId` (query própria, sem
    propagar prop por 3 call-sites); campo EAN-13 do SKU em modo read-only
    espelhando `cEAN`. `handleSave` grava `codigoBarra = cEAN`; `handleGerarEan14`
    usa o cEAN.
  - [x] 4.2 Código/nome do produto em destaque vermelho na description do campo.
  - [x] 4.3 Aviso laranja quando `cEAN` vazio (orientar preencher no produto).
  - _Requisitos: 5_

- [x] 5. **Ocorrências 1 e 2 — medidas da unidade + cubagem derivada**
  - [x] 5.1 Schema `Sku`: 5 campos `*Unidade` (nullable) + `migrate-prod.ts`
    (ADD COLUMN IF NOT EXISTS ×5, mesmo padrão idempotente das colunas de SKU
    acima). `prisma generate` OK. **NÃO testado 2x local: Postgres local
    (localhost:5432) não está no ar nesta máquina — validar antes do deploy.**
  - [x] 5.2 Zod de create/update de SKU com os campos novos.
  - [x] 5.3 Hook `useSku.ts` + interface `Sku` com os campos novos.
  - [x] 5.4 `SkuPanel`: seções "Medidas da Caixa (EAN-14)" × "Medidas da Unidade
    (EAN-13)" + botão "Derivar cubagem da unidade" (`volume ÷ qtdEmbalagem`,
    sobrescrevível; medida real tem prioridade).
  - _Requisitos: 2, 3_

- [x] 6. **Ocorrência 8 — Shelf-Life (dias) × RLM (%)**
  - [x] 6.1 `src/utils/shelfLifeRlm.ts` (front) — conversão pura dias↔% +
    `estadoCamposShelfLife`. Teste `shelfLifeRlm.test.ts` escrito; validado via
    Node (vitest do front não inicia worker nesta máquina — infra, não o teste).
  - [x] 6.2 `ProdutoModal`: RLM% inibido quando dias preenchido; preencher dias
    ao informar RLM% (`round(total × RLM ÷ 100)`); aviso se faltar total.
  - _Requisitos: 8_

- [x] 7. **Ocorrência 6-tara — peso tara do palete na capacidade**
  - [x] 7.1 `src/modules/sku/tara-palete.ts` (taras default por `tipoPalete`:
    PBR 25, CHEP 30, PER 35, FER 40, DESCARTAVEL 10; padrão 25).
  - [x] 7.2 `validador-capacidade.service.ts`: `calcularTaraPaletes` soma a tara
    por palete montado (ceil) ao peso incoming; aditivo (0 sem paletização) e
    sem dupla contagem quando há `pesoPalete` manual. Teste `tara-palete.test.ts`
    6/6 passando.
  - _Requisitos: 6_

- [~] 8. **Ocorrência 7 — verificação do código sequencial**
  - [~] 8.1 Diagnóstico: a GERAÇÃO está correta e robusta
    (`codigo-sequencial.service.ts` — UPDATE atômico, pula ocupados; fix do
    relatório 2 presente). O "fora de ordem" do relatório 3 vem com um PRINT que
    NÃO está no texto do PDF. Hipótese forte: é ORDENAÇÃO DE EXIBIÇÃO —
    `GET /produtos` ordena por `nome asc`, não por `codigo`, então códigos
    sequenciais aparecem fora de ordem na lista ordenada por nome. **Não alterar
    o gerador sem reproduzir** (regra do steering PCP). PENDENTE: obter o print
    do relatório para confirmar se é exibição (ajustar ordenação/filtro) ou
    caso novo de geração.
  - _Requisitos: 7_

- [ ] 9. **QA E2E + build + rastreamento**
  - [ ] 9.1 Estender `test_23_sku_e_produto_config.py` com o bloqueio de EAN
    duplicado.
  - [ ] 9.2 `npm run build` back + front; `get_diagnostics` nos arquivos tocados.
  - [ ] 9.3 Atualizar steering `relatorio-validacao-cadastral.md` (ou criar bloco
    do relatório 3) com o status de cada ocorrência.
  - _Requisitos: todos_
