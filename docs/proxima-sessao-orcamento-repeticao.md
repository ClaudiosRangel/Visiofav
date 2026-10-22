# Próxima sessão — Orçamento de Repetição + Engenharia Completa

Handoff da sessão 22/10/2026. Spec:
`.kiro/specs/orcamento-repeticao-engenharia-completa/`. Estudo de mercado:
`docs/estudo-reaproveitamento-calculo-repeticao.md`. Contexto-mestre no steering
`migracao-calcgraf-carton-wega.md` (bloco "🟡 ORÇAMENTO DE REPETIÇÃO").

## Em 1 parágrafo

Puxar um cálculo da biblioteca = orçamento de REPETIÇÃO que traz TUDO preenchido
e editável (padrão de mercado + Calcgraf). Os 7.951 migrados só tinham a FOTO; a
engenharia estruturada (papel/gramatura/cores/acabamentos/máquina) vinha nula.
Agora, ao puxar, o backend ENRIQUECE a engenharia a partir da foto (de-para para
os cadastros do Vizor), resolve o CLIENTE por CNPJ, marca tipo=REPETICAO, e o que
não casa fica "A COMPLETAR" (nunca inventa). A FOTO é imutável. Conferência
foto×recálculo avisa se diverge (anti-vergonha).

## O QUE JÁ ESTÁ FEITO (backend + produção + frontend; NADA commitado)

### Schema (schema.prisma + migrate-prod.ts — aditivo idempotente)
- `OrcamentoGrafico.tipo` (VARCHAR(12), default 'NOVO') — NOVO | REPETICAO.
- `CalculoGrafico.engenhariaCompleta` (Boolean default false),
  `engenhariaPendentes` (Json?), `clienteDoc` (VarChar20?), `clienteCodigo` (Int?).
- As 5 colunas JÁ foram APLICADAS em PRODUÇÃO (via pg direto, idempotente).
- `prisma generate` rodou OK (client tem os campos).

### Backend
- `src/modules/orcamento-grafico/calculo-grafico/enriquecimento-engenharia.service.ts`
  (NOVO): `enriquecerEngenharia(empresaId, calc)` + helpers `normalizarNome`,
  `normalizarDoc`. De-para por nome normalizado (papel/suporte/gramatura/cores/
  acabamentos/máquina) + cliente por CNPJ. 0 ou 2+ candidatos → PENDENTE. Foto
  imutável. empresaId explícito.
- `calculo-grafico.service.ts`: `garantirEngenhariaCompleta(empresaId, id)` —
  roda o de-para, grava a engenharia DE VOLTA no cálculo (melhora progressiva),
  grava `engenhariaPendentes`, marca `engenhariaCompleta` quando sem pendência
  ESSENCIAL (papel/gramatura/cores). Idempotente. Retorna {calculo, clienteId,
  pendentes}.
- `orcamento-grafico.routes.ts`:
  - `POST /de-calculo` agora chama `garantirEngenhariaCompleta` ANTES de copiar,
    grava `tipo='REPETICAO'` + `clienteId` resolvido. `orcamentoGraficoSelect`
    ganhou `tipo`. O select do GET /:id (itens) ganhou `calculoGraficoOrigemId`.
  - `GET /:id/itens/:itemId/conferencia` (NOVO — Task 6): foto (origem) ×
    recálculo (Vizor) + desvio %; ≤0,5% = confere; não grava nada.
- `calculo-grafico/calculo-grafico.routes.ts`: `POST /enriquecer-lote` (NOVO —
  Task 7, ADMIN): roda o de-para nos MIGRADO_CALCGRAF incompletos (ordenados por
  numeroCalcgraf desc), `{ limite }` default 400; relatório resolvidos×pendentes.
- `foto-rica.types.ts`: `cabecalho.clienteDoc`/`clienteCodigo`.

### Scripts / Produção
- `scripts/exportar-calculos-acervo-rico.mjs`: inclui `n.CNPJCPF`→clienteDoc e
  `h.CodNome`→clienteCodigo (raiz + cabeçalho). RE-EXPORTADO (7.951, 32 com doc).
- `scripts/gravar-foto-rica.mjs` (NOVO, versionado): grava foto + cliente_doc +
  cliente_codigo via pg, idempotente, COM RETRY (ECONNRESET do pooler Neon). JÁ
  EXECUTADO em PRODUÇÃO: 7.951 atualizados, 32 com doc, todos casando com cliente
  do Vizor por CNPJ (verificado: Belgo/Vapza/Gerdau/Fortaleza/Hidratei ✓).

### Frontend
- Badge "Repetição" na LISTA (`orcamento-grafico/page.tsx`) e no DETALHE
  (`[id]/page.tsx`) quando `tipo=REPETICAO`.
- Conferência foto×recálculo no `novo/StepRevisao.tsx` (Task 8.3): painel
  Calcgraf × Vizor + desvio; verde ≤0,5%, laranja senão; busca
  `/conferencia` quando o item vem de cálculo. O `ItemWizardModal` passa o
  contexto (`_conferenciaOrcamentoId`/`_conferenciaItemId`) via `itemParaForm`
  (só quando `item.calculoGraficoOrigemId` existe). `WizardFormData` ganhou esses
  campos `_conferencia*` + `_engenhariaPendentes`.
- `StepRevisao` já mostrava erro por campo (sessão anterior).

### Validação
- `get_diagnostics` LIMPO em TODOS os arquivos tocados (back + front).
- (tsc inteiro e `npx tsx`/`prisma generate` TRAVAM nesta máquina — usar
  get_diagnostics; prisma generate roda no deploy.)

## FEITO NESTA SESSÃO (23/10/2026) — property tests

- **Task 9 (property tests) — FEITO.** A lógica de match do de-para foi extraída
  para DUAS funções PURAS no `enriquecimento-engenharia.service.ts`
  (`matchUnicoPorNome` e `matchClientePorDoc`), e os usos inline (acabamentos e
  cliente) foram refatorados para reusá-las (comportamento idêntico).
  `enriquecimento-engenharia.service.test.ts` cobre com fast-check:
  - P2 "nunca inventa": match ambíguo (2+) ou ausente (0) / alvo vazio → undefined.
  - P4 cliente por CNPJ: invariante a máscara (só dígitos); doc vazio/sem match → undefined.
  - P3 idempotência: `normalizarNome` estável (maiúsc/sem acento/sem espaço duplo/bordas).
  - `normalizarDoc`: resultado só-dígitos; máscara não altera dígitos.
  - **14/14 testes passando** (`npx vitest run ... --reporter=dot`, 5,27s).
  - `get_diagnostics` LIMPO no serviço e no teste.
  - tasks.md marcado: 1–7, 8.1, 8.3, 9.2/9.3/9.4 = done.

## O QUE FALTA (fazer na próxima sessão)

1. **Task 8.2 (opcional/refinamento)** — chips "A Completar" por campo no wizard
   (ItemWizardModal/steps) lendo `engenhariaPendentes`. NÃO feito — o aviso por
   campo no recálculo + a conferência já cobrem o essencial. Fazer se o usuário
   quiser destaque por campo.
2. **Task 9 — propriedades que exigem Prisma mockado/integração** (9.1 foto
   imutável, 9.5 tipo+rastreabilidade, 9.6 conferência de desvio, 9.7 isolamento
   multi-tenant, 9.8 exemplos). O núcleo puro do de-para (P2/P3/P4) já está
   testado; as demais dependem de mockar o Prisma client (não há harness de mock
   no módulo ainda) ou rodar contra banco — opcionais.
3. **Task 7 — script `scripts/enriquecer-engenharia-lote.ts`**: hoje o lote existe
   como ENDPOINT admin `POST /api/calculo-grafico/enriquecer-lote` (precisa da API
   no ar). Se preferir rodar offline por `pg`, criar o script equivalente.
4. **Task 10 — checkpoint na tela**: precisa de DEPLOY (back no Render + front na
   Vercel). Validar puxando um cálculo COM cliente (ex.: nº Calcgraf 12992 Gerdau,
   13296 Vapza) → orçamento REPETICAO com cliente preenchido + conferência verde.
5. **Rodar `POST /api/calculo-grafico/enriquecer-lote`** em produção (precisa da
   API no ar) para os 366 produtos que mais repetem — ou deixar 100% sob demanda.
6. **COMMIT** (não feito — política do usuário). Back e front são repos separados;
   schema.prisma + migrate-prod.ts no MESMO commit. Lembrar: as 5 colunas já
   estão em produção, mas o migrate-prod.ts garante idempotência no próximo deploy.

## Como testar o fluxo (após deploy)

1. Orçamentos Gráficos → "Puxar Cálculo" → buscar cálculo COM cliente
   (nº Calcgraf 12992/13296/13917) → "Usar".
2. Orçamento nasce com badge "Repetição", cliente preenchido, item com engenharia.
3. Abrir "Editar Item" → Revisão: painel de Conferência (Calcgraf × Vizor).

## Armadilhas desta máquina (relembrar)
- `npx tsx`, `prisma generate`, `tsc` inteiro TRAVAM → usar get_diagnostics; pg
  direto em `.mjs` para produção.
- Pooler Neon derruba conexão em loop longo (ECONNRESET) → usar retry +
  reconexão (o `gravar-foto-rica.mjs` já tem).
- PowerShell: paths com `(interna)`/`[id]` quebram grep/comandos → usar aspas ou
  get_diagnostics/read_file direto.
- DATABASE_URL Neon (pooler) fica FORA do git; empresa Wega
  `75848e24-742e-461d-b913-1642c5b83ae9`.

## Arquivos-chave
- Spec: `.kiro/specs/orcamento-repeticao-engenharia-completa/{requirements,design,tasks}.md`
- `src/modules/orcamento-grafico/calculo-grafico/enriquecimento-engenharia.service.ts`
- `src/modules/orcamento-grafico/calculo-grafico/calculo-grafico.service.ts` (garantirEngenhariaCompleta)
- `src/modules/orcamento-grafico/orcamento-grafico.routes.ts` (/de-calculo, /conferencia)
- `src/modules/orcamento-grafico/calculo-grafico/calculo-grafico.routes.ts` (/enriquecer-lote)
- `scripts/gravar-foto-rica.mjs`, `scripts/exportar-calculos-acervo-rico.mjs`
- Front: `orcamento-grafico/page.tsx`, `[id]/page.tsx`, `[id]/ItemWizardModal.tsx`, `novo/StepRevisao.tsx`, `novo/page.tsx`
