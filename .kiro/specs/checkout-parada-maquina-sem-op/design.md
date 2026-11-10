# Design — Parada de Máquina sem OP (Checkout)

## Visão geral

A parada de manutenção de uma máquina **sem OP rodando** é, conceitualmente, um
evento de *downtime do recurso* (padrão MES: Sepasoft/Vorne/MachineMetrics
modelam downtime por equipamento, não por ordem). O modelo atual do Vizor só
modela parada como `ApontamentoEtapa` tipo `PARADA`, cujo `etapaOrdemProducaoId`
é **obrigatório** — por isso o operador é forçado a entrar numa OP.

A solução é um **novo model dedicado `ParadaCentro`** (parada por Centro de
Produção, sem FK para etapa/OP). Isso evita tornar `ApontamentoEtapa.
etapaOrdemProducaoId` nullable (que quebraria a cascade, os índices e a lógica de
Pareto/valorização existentes) e deixa o downtime do recurso como cidadão de
primeira classe, agregável nos relatórios junto das paradas por etapa.

Repositórios (separados):
- **Backend** `VisioFab.Wms.Back`: schema + migrate-prod + serviço/rotas do
  Checkout (terminal) + leitura no PCP + inclusão no Pareto do relatório mensal.
- **Frontend do Checkout** `VisioFab.Wms.Back/VisioFab.Checkout` (app Next dentro
  do repo do backend, sem git próprio): botão/indicador de parada no painel.

## Modelo de dados

### Novo model `ParadaCentro` (tabela `parada_centro`)

```prisma
/// Parada (downtime) de um Centro de Produção SEM vínculo com OP/etapa.
/// Registrada pelo Checkout quando a máquina para (ex.: manutenção) sem
/// nenhuma OP rodando. Isolamento por empresaId (multi-tenant).
/// Spec: checkout-parada-maquina-sem-op.
model ParadaCentro {
  id                String         @id @default(uuid())
  empresaId         String         @map("empresa_id")
  centroProducaoId  String         @map("centro_producao_id")
  centroProducao    CentroProducao @relation(fields: [centroProducaoId], references: [id])
  // Motivo (mesmo enum textual de ApontamentoEtapa.motivoParada).
  motivoParada      String         @map("motivo_parada") @db.VarChar(50)
  // Código de parada customizável (opcional) — reusa CodigoParada do PCP.
  codigoParadaId    String?        @map("codigo_parada_id")
  observacao        String?        @db.Text
  // Quem registrou (funcionário/operador do terminal), opcional.
  funcionarioId     String?        @map("funcionario_id")
  inicio            DateTime       @default(now())
  fim               DateTime?
  duracaoMinutos    Int?           @map("duracao_minutos")
  criadoEm          DateTime       @default(now()) @map("criado_em")

  @@index([empresaId, centroProducaoId])
  @@index([empresaId, inicio])
  @@map("parada_centro")
}
```

- `CentroProducao` ganha a relação inversa `paradasCentro ParadaCentro[]`
  (aditivo, não muda colunas).
- `codigoParadaId` é só um campo (sem FK dura, igual já é em
  `ApontamentoEtapa.codigoParadaId`) — mantém o padrão existente e evita
  acoplamento de cascade.
- **Parada_Aberta** = `ParadaCentro` com `fim IS NULL`. Invariante de negócio:
  no máximo uma por `(empresaId, centroProducaoId)` — garantida na aplicação
  (checagem antes de criar), não por constraint parcial (evita migração mais
  arriscada; a checagem na transação é suficiente para o volume do terminal).

### `migrate-prod.ts` (idempotente)

`CREATE TABLE IF NOT EXISTS parada_centro (...)` + os dois
`CREATE INDEX IF NOT EXISTS`. Sem FK dura obrigatória além de
`centro_producao_id` (adicionada via `ADD CONSTRAINT` em try/catch, padrão do
arquivo). Testar rodando 2× local — idempotente. Schema + migrate no MESMO
commit.

## Backend — serviço e rotas

### Serviço (checkout.service.ts)

Classe de erro reutilizada: `CheckoutError` (padrão do arquivo). Novas funções
PURAS onde possível; as de IO filtram `empresaId` + `centroProducaoId`
explícitos.

- `registrarParadaCentro(checkoutUser, { motivoParada, codigoParadaId?,
  observacao?, funcionarioId? })`:
  1. valida o corpo (zod);
  2. checa se já há Parada_Aberta para `(empresaId, centroProducaoId)` → 400;
  3. cria `ParadaCentro` com `inicio = now`, `fim = null`.
  Retorna a parada criada. NÃO toca OP/etapa.
- `encerrarParadaCentro(checkoutUser)`:
  1. busca a Parada_Aberta do `(empresaId, centroProducaoId)`; se não houver →
     400 ("Não há parada de máquina em aberto");
  2. `fim = now`, `duracaoMinutos = max(0, round((fim - inicio)/60000))`;
  3. update. Retorna a parada encerrada.
- `paradaAbertaDoCentro(checkoutUser)`: retorna a Parada_Aberta atual (ou null),
  para o indicador do painel. Usada também dentro de `dadosDaSessaoCheckout`
  ou numa rota dedicada `GET /checkout/parada-maquina`.

Função PURA testável (sem Prisma):
- `calcularDuracaoParada(inicio: Date, fim: Date): number` → minutos inteiros,
  nunca negativo (`fim < inicio ⇒ 0`). Testada com fast-check.

### Rotas do terminal (checkout.routes.ts, preHandler `checkoutAuth`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/checkout/parada-maquina` | Registra parada (Req 1). Body: motivoParada, codigoParadaId?, observacao?. |
| PATCH | `/checkout/parada-maquina/encerrar` | Encerra a parada aberta do terminal (Req 2). |
| GET | `/checkout/parada-maquina` | Retorna a parada aberta atual (ou null) (Req 3). |

Schemas zod locais na rota (mesmo padrão do `pausarEtapaBodySchema`).

### Leitura no ERP/PCP (contador-pcp? ou novo arquivo)

- `GET /api/pcp/centros/:id/paradas` — lista `ParadaCentro` do centro por
  período (query `dataInicio`/`dataFim` opcionais), isolado por `empresaId`
  explícito (centro de outra empresa → 404). Arquivo novo
  `parada-centro-pcp.routes.ts` (ou anexado a um routes de PCP existente),
  `authenticate` + `moduloGuard('PCP')`.

### Pareto do relatório mensal (relatorio-producao.service.ts)

`paretoParadas(empresaId, ano, mes)` hoje agrega `ApontamentoEtapa` tipo PARADA
por `codigoParadaId` (fallback `motivoParada`). Estender para **também** somar as
`ParadaCentro` encerradas do período (mesmo critério de agrupamento), no mesmo
intervalo BRT. A soma é aditiva — as duas fontes contribuem para o mesmo balde
de código/motivo. Não há dupla contagem (são registros distintos). Teste golden
atualizado + não-regressão (sem ParadaCentro ⇒ saída idêntica à atual).

## Frontend do Checkout (VisioFab.Checkout)

No painel (`src/app/painel/page.tsx`) e/ou no cabeçalho da máquina:
- Carregar `GET /checkout/parada-maquina` ao abrir o painel.
- Se **sem** parada aberta: botão "Registrar parada da máquina" → abre um modal/
  tela simples (motivo via select, código de parada opcional via select de
  `GET /checkout/codigos-parada` já existente, observação) → `POST
  /checkout/parada-maquina` → recarrega.
- Se **com** parada aberta: faixa/badge de destaque no topo ("Máquina em parada:
  MANUTENÇÃO desde HH:MM") + botão "Encerrar parada" → `PATCH .../encerrar`.
- Disponível **independente de haver etapas/RCs na fila** (Req 3.3).

## Correctness Properties

1. **Duração nunca negativa**: `calcularDuracaoParada(i, f)` ≥ 0 para quaisquer
   datas; `f < i ⇒ 0`. (fast-check)
2. **No máximo uma parada aberta por centro**: após `registrarParadaCentro`, uma
   segunda chamada para o mesmo `(empresa, centro)` sem encerrar falha; após
   `encerrar`, uma nova pode ser criada. (teste de serviço com mock)
3. **Isolamento multi-tenant**: registrar/encerrar/listar nunca afeta ou revela
   parada de outro `(empresaId)`; o filtro é sempre explícito. (teste de serviço)
4. **Não-regressão do Pareto**: sem nenhuma `ParadaCentro` no período, o Pareto
   é idêntico ao atual (só `ApontamentoEtapa`). (golden)

## Decisões

- **D1 — Model novo vs FK nullable em ApontamentoEtapa**: escolhido model novo
  (`ParadaCentro`). FK nullable quebraria a cascade por etapa, os índices e a
  semântica de "apontamento de etapa"; além de exigir migração de dados e revisar
  todas as queries que assumem `etapaOrdemProducaoId` presente.
- **D2 — Uma parada aberta por centro**: garantida na aplicação (checagem antes
  de criar), não por índice único parcial, para uma migração mais simples e
  idempotente. O volume (um terminal por máquina) torna a condição de corrida
  irrelevante na prática; ainda assim a checagem roda dentro da criação.
- **D3 — Pareto soma as duas fontes**: o downtime de manutenção sem OP precisa
  aparecer no mesmo relatório; agregamos por código/motivo somando os minutos de
  ambas as fontes, sem alterar a contribuição já existente das paradas por etapa.
