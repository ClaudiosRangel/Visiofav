# Plano de Implementação — Planos fiéis ao Calcgraf

Backend only (não há mudança de schema). Os commits ficam com o usuário. Validar
com `get_diagnostics`. Testes com vitest (`--reporter=dot`; iniciar via
`control_pwsh_process`, aguardar, ler saída, parar o processo).

- [x] 1. Mapeador puro `FotoPlano → PlanoMapeado`
  - Criar `src/modules/orcamento-grafico/calculo-grafico/foto-planos.service.ts`
    com `mapearFotoPlanos(planos: FotoPlano[] | undefined): PlanoMapeado[]`.
  - Parsing resiliente de `formatoAberto`/`formatoCorte` ("284 x 488" →
    largura/altura) e `coresFV` ("2x0"/"6x0"/"4/0" → numCores). Nulos permanecem
    nulos; entrada inválida não lança.
  - Função PURA (sem Prisma, sem I/O), reutilizando o tipo `FotoPlano` de
    `foto-rica.types.ts`.
  - _Requisitos: 1.2, 1.3, 7.1, 7.2, 7.3_

- [x] 1.1 Testes do mapeador (vitest + fast-check)
  - `foto-planos.service.test.ts`: golden com o cálculo 11121 (2 planos: Cartão
    181g 284×488 e Cartão 230g 284×488); propriedades P1 (conservação do nº de
    planos), P2 (não-inventar nulos), P5 (parsing de formato/cores).
  - _Requisitos: 1.1, 1.3, 7.1, 7.2, 7.3_

- [x] 2. Materializar planos ao puxar cálculo
  - Em `copiarCalculoParaItem` (orcamento-grafico.routes.ts): derivar
    `planosDaFoto = mapearFotoPlanos(calc.resultadoCalculo?.planos)` e retorná-lo
    junto de `{ dadosItem, fotoResultado }`.
  - Nas DUAS rotas de puxar (`POST /:id/itens/de-calculo` e `POST /de-calculo`):
    após criar o item, criar os `PlanoCalculoGrafico` reutilizando o padrão de
    `dadosPersistenciaPlano` já usado pela rota "reaproveitar".
  - Regra D1: `>= 2` planos → cria todos; `<= 1` → cria 1 "Plano 1" com a
    engenharia do item.
  - `empresaId` explícito do orçamento/cálculo real; `custoSuporte/Impressao/
    Acabamento = 0` (detalhamento, não recalcula total).
  - _Requisitos: 1.1, 1.4, 2.1, 2.2, 6.1_

- [x] 3. Garantir não-regressão do custo do item
  - Confirmar que a criação dos planos NÃO altera `custoProducao`/`valorTotal` do
    item (continuam a ancoragem) nem o total consolidado do orçamento.
  - Não chamar reconsolidação por soma de planos no fluxo de puxar.
  - _Requisitos: 3.1, 3.2, 3.3_

- [x] 4. GET do orçamento devolve `itens[].planos`
  - JÁ ATENDIDO: a rota `GET /:id` principal já inclui `itens[].planos`
    (ordenado por sequência, filtrado por empresa) — infra da Fase 2 reaproveitada.
  - No `GET /:id` do orçamento, incluir por item a lista de `PlanoCalculoGrafico`
    (ordenada por `sequencia`), com filtro `empresaId` explícito.
  - Formato compatível com o `planosIniciais` que o `PlanosDoItem.tsx` já consome.
  - _Requisitos: 4.1, 4.2, 4.3, 6.2_

- [x] 5. Script de backfill idempotente (apenas RASCUNHO)
  - `scripts/backfill-planos-itens-orcamento.ts`: para cada item de orçamento
    RASCUNHO com `calculoGraficoOrigemId` e 0 planos, ler a foto do cálculo-origem,
    mapear `foto.planos[]` e criar os planos (mesma regra D1).
  - Idempotente (ignora item que já tem planos); flags `--empresa`, `--dry-run`.
  - Nunca toca orçamento não-RASCUNHO.
  - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1_

- [x] 6. Verificação e validação
  - `get_diagnostics` limpo nos arquivos tocados.
  - Rodar o backfill com `--dry-run` (sem gravar) e conferir o relatório.
  - Validar na tela: puxar o 11121 → seção "Planos do Cálculo" mostra 2 planos;
    cartucho simples → 1 plano; custo do item inalterado.
  - _Requisitos: 3.1, 4.2, 8.1, 8.2, 8.3_
