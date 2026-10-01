# Mapa de Custos RKW — Design Técnico

## Overview

Réplica no Vizor do **Mapa de Localização de Custos (MLC)** do Calcgraf/WebGraf
(metodologia RKW), usado pela Carton Wega. Hoje esse cálculo é entregue por
**consultoria paga externa**; o Vizor passa a oferecê-lo como funcionalidade
viva (diferencial competitivo). Fonte de verdade do domínio:
`docs/calcgraf-gprint-levantamento.md` (§2–§13, RI-1..RI-6).

**Objetivo:** apropriar todo o custo fixo mensal da empresa (salários+encargos,
depreciação, despesas) nos centros de custo, ratear auxiliares e administração
sobre os produtivos, e calcular o **Custo/Hora** de cada centro produtivo. O
Custo/Hora "A Praticar" resultante **alimenta** o custo-hora usado pelo módulo
Orçamento Gráfico (integração via `CentroProducao.custoHora`, campo já existente).

Escopo desta feature (Bloco 3 do plano de ação): cadastros do mapa, motor de
rateio em 2 níveis, cálculo do custo/hora, relatórios e integração com o
Orçamento. NÃO inclui a camada gerencial (Contribuição Marginal / Ponto de
Equilíbrio / Pós-Cálculo = Bloco 4) nem a paridade do orçamento (Bloco 1).

## Architecture

Stack: Fastify + Prisma + PostgreSQL (Neon) no backend; Next.js 15 + Mantine 7 +
React Query no frontend. Multi-tenant por `empresaId` com filtro manual
explícito (steering `ATENCAO-pontos-verificar.md` — não confiar só no
prismaScoped). Migração idempotente em `migrate-prod.ts` no mesmo commit do
schema (steering `database-migrations.md`).

Fluxo de custeio (2 níveis de rateio):

```
Cadastros base do MAPA (versão/foto mensal):
  CentroCusto (Produtivo/Auxiliar/Administração)
  BemDepreciar      → depreciação mensal por centro
  FuncionarioCusto  → salário×(1+encargos)+ajuda de custo
  DespesaCusto      → rateada por ChaveRateio
  ChaveRateio       → peso manual OU automático (headcount/ativo/centro/funcionário)
  Parâmetros do mapa (% encargos, horas base, ajuste a praticar)
        │  MotorRateio.calcularMapa()
        ▼
  Custo Fixo por centro (A+B+C)
        │  rateio nível 1→2 (auxiliares + administração → produtivos)
        ▼
  Custo Fixo Final por centro produtivo (D+E+F) ÷ Horas Produtivas
        ▼
  Custo/Hora por centro (Apurado / A Praticar / Praticado)
        │  ação "Aplicar ao Orçamento"
        ▼
  grava CentroProducao.custoHora  → consumido pelo módulo Orçamento Gráfico
```

O Mapa é **versionado** (uma "foto" por competência/mês), pois os relatórios
reais mostram versões diferentes do mesmo mapa (agosto vs outubro/2023) com
totais distintos. Cada versão fica imutável após "fechada".

## Components and Interfaces

### Backend services
- `mapa-custo-calculo.service.ts` — motor puro de rateio (`calcularMapa`,
  `depreciacaoBem`, `rateioDespesa`, `resolverChave`). Recebe dados, retorna
  `ResultadoCentro[]`. Sem I/O direto → testável por golden cases.
- `mapa-custo.routes.ts` — rotas CRUD + ações, prefixo `/api/pcp/mapa-custo`.

### Rotas da API (prefixo `/api/pcp/mapa-custo`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista mapas (filtro competência/status) |
| POST | `/` | Cria mapa (competência) |
| GET | `/:id` | Detalhe do mapa + resultados |
| POST | `/:id/duplicar` | Duplica de outra competência (copia cadastros) |
| POST | `/:id/calcular` | Roda o motor de rateio (preenche ResultadoCentro) |
| POST | `/:id/fechar` | Fecha o mapa (imutável) |
| POST | `/:id/aplicar-orcamento` | Grava custoHoraPraticar em CentroProducao.custoHora |
| GET/POST/PUT/DELETE | `/:id/centros` \| `/bens` \| `/funcionarios` \| `/despesas` \| `/chaves` | CRUDs do mapa |
| GET | `/:id/relatorios/composicao` | Composição do Custo Hora (§11) |
| GET | `/:id/relatorios/distribuicao` | Distribuição do Custo Fixo (§10) |
| GET | `/:id/relatorios/custo-hora` | Mapa Custos/Hora / Resultado Apurado (R1) |

Todas as rotas filtram `empresaId` explicitamente. Ações de escrita bloqueadas
quando `status = FECHADO` (exceto `aplicar-orcamento`).

### Frontend (módulo PCP → Custos)
- `/pcp/mapa-custo` — lista de mapas por competência (badges Rascunho/Fechado).
- `/pcp/mapa-custo/novo` — cria/duplica competência.
- `/pcp/mapa-custo/[id]` — editor com abas: Centros, Bens a Depreciar,
  Funcionários (+ rateados), Despesas (+ chave), Chaves de Rateio, Parâmetros,
  **Resultado** (tabela Composição + botões Calcular / Aplicar ao Orçamento).
- Relatórios (PDF): Custos/Hora, Composição, Distribuição.

## Data Models

Novos models Prisma (nenhuma alteração destrutiva em models existentes;
`CentroProducao.custoHora` já existe e apenas recebe o valor "A Praticar").

```prisma
/// Uma "foto" do Mapa de Custos por competência (mês/ano). Imutável após fechar.
model MapaCusto {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  competencia   String   @db.VarChar(7)          // "2023-08"
  descricao     String?  @db.VarChar(200)
  status        String   @default("RASCUNHO") @db.VarChar(20) // RASCUNHO, FECHADO
  percEncargos      Decimal @default(60) @map("perc_encargos") @db.Decimal(5,2)
  horasProdutivasBase Int   @default(150) @map("horas_produtivas_base")
  ajustePraticarPerc Decimal @default(24) @map("ajuste_praticar_perc") @db.Decimal(5,2)
  custoFixoTotal    Decimal? @map("custo_fixo_total") @db.Decimal(14,2)
  taxaAdministrativa Decimal? @map("taxa_administrativa") @db.Decimal(5,2)
  totalFuncionarios Int?     @map("total_funcionarios")
  ativoImobilizado  Decimal? @map("ativo_imobilizado") @db.Decimal(14,2)
  depreciacaoMensal Decimal? @map("depreciacao_mensal") @db.Decimal(14,2)
  fechadoEm     DateTime? @map("fechado_em")
  criadoEm      DateTime @default(now()) @map("criado_em")
  atualizadoEm  DateTime @updatedAt @map("atualizado_em")
  centros       CentroCusto[]
  bens          BemDepreciar[]
  funcionarios  FuncionarioCusto[]
  despesas      DespesaCusto[]
  chaves        ChaveRateio[]
  resultados    ResultadoCentro[]
  @@unique([empresaId, competencia])
  @@map("mapa_custo")
}

/// Centro de custo dentro de um mapa. Natureza define o comportamento no rateio.
model CentroCusto {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  mapaCustoId   String   @map("mapa_custo_id")
  mapaCusto     MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  codigo        String   @db.VarChar(30)
  descricao     String   @db.VarChar(200)
  natureza      String   @db.VarChar(20)  // PRODUTIVO, AUXILIAR, ADMINISTRACAO
  centroProducaoId String? @map("centro_producao_id")
  usoOrcamento  Boolean  @default(true) @map("uso_orcamento")
  unidadesProdutivas Int  @default(1) @map("unidades_produtivas")
  turnos        Int      @default(1)
  horasExtras   Int      @default(0) @map("horas_extras")
  horasProdutivas Decimal? @map("horas_produtivas") @db.Decimal(10,2)
  posicao       Int      @default(0)
  status        Boolean  @default(true)
  bens          BemDepreciar[]
  funcionarios  FuncionarioCusto[]
  resultado     ResultadoCentro?
  @@unique([mapaCustoId, codigo])
  @@map("centro_custo")
}

/// Bem a depreciar (ativo imobilizado), vinculado a um centro. Gera depreciação mensal.
model BemDepreciar {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  mapaCustoId   String   @map("mapa_custo_id")
  mapaCusto     MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  centroCustoId String   @map("centro_custo_id")
  centroCusto   CentroCusto @relation(fields: [centroCustoId], references: [id], onDelete: Cascade)
  grupo         String   @db.VarChar(60)
  descricao     String   @db.VarChar(200)
  valor         Decimal  @db.Decimal(14,2)
  estado        String   @db.VarChar(20)   // OTIMO, BOM, REGULAR
  anosVidaUtil  Int      @map("anos_vida_util")
  residualPerc  Decimal  @default(0) @map("residual_perc") @db.Decimal(5,2)
  depreciacaoMensal Decimal? @map("depreciacao_mensal") @db.Decimal(14,2)
  status        Boolean  @default(true)
  @@map("bem_depreciar")
}

/// Funcionário lançado no mapa, vinculado a um centro (ou rateado — ver ChaveRateio).
model FuncionarioCusto {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  mapaCustoId   String   @map("mapa_custo_id")
  mapaCusto     MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  centroCustoId String?  @map("centro_custo_id")
  centroCusto   CentroCusto? @relation(fields: [centroCustoId], references: [id], onDelete: Cascade)
  nome          String   @db.VarChar(200)
  cargo         String?  @db.VarChar(120)
  salario       Decimal  @db.Decimal(12,2)
  ajudaCusto    Decimal  @default(0) @map("ajuda_custo") @db.Decimal(12,2)
  rateado       Boolean  @default(false)
  status        Boolean  @default(true)
  @@map("funcionario_custo")
}

/// Despesa mensal lançada no mapa, com a chave que define seu rateio.
model DespesaCusto {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  mapaCustoId   String   @map("mapa_custo_id")
  mapaCusto     MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  descricao     String   @db.VarChar(200)
  valor         Decimal  @db.Decimal(14,2)
  chaveRateioId String   @map("chave_rateio_id")
  status        Boolean  @default(true)
  @@map("despesa_custo")
}

/// Chave/critério de rateio reutilizável. Distribui um valor entre centros.
/// tipo: MANUAL (pesos fixos), HEADCOUNT (nº func. do centro), ATIVO (valor
///       dos bens do centro), CENTRO (destino único), FUNCIONARIO (rateio de
///       um funcionário específico).
model ChaveRateio {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  mapaCustoId   String   @map("mapa_custo_id")
  mapaCusto     MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  nome          String   @db.VarChar(120)
  tipo          String   @db.VarChar(20)
  funcionarioCustoId String? @map("funcionario_custo_id")
  destinos      DestinoRateio[]
  @@unique([mapaCustoId, nome])
  @@map("chave_rateio")
}

/// Um destino (centro) de uma chave de rateio, com seu peso. % = peso ÷ Σ pesos.
model DestinoRateio {
  id            String   @id @default(uuid())
  chaveRateioId String   @map("chave_rateio_id")
  chaveRateio   ChaveRateio @relation(fields: [chaveRateioId], references: [id], onDelete: Cascade)
  centroCustoId String   @map("centro_custo_id")
  peso          Decimal  @db.Decimal(12,4)
  @@map("destino_rateio")
}

/// Resultado calculado por centro (saída do motor). 1:1 com CentroCusto.
model ResultadoCentro {
  id              String   @id @default(uuid())
  empresaId       String   @map("empresa_id")
  mapaCustoId     String   @map("mapa_custo_id")
  mapaCusto       MapaCusto @relation(fields: [mapaCustoId], references: [id], onDelete: Cascade)
  centroCustoId   String   @unique @map("centro_custo_id")
  centroCusto     CentroCusto @relation(fields: [centroCustoId], references: [id], onDelete: Cascade)
  salariosEncargos Decimal @default(0) @map("salarios_encargos") @db.Decimal(14,2) // A
  depreciacoes     Decimal @default(0) @db.Decimal(14,2)                            // B
  despesas         Decimal @default(0) @db.Decimal(14,2)                            // C
  custoFixo        Decimal @default(0) @map("custo_fixo") @db.Decimal(14,2)         // D=A+B+C
  rateioAuxiliar   Decimal @default(0) @map("rateio_auxiliar") @db.Decimal(14,2)    // E
  rateioAdministracao Decimal @default(0) @map("rateio_administracao") @db.Decimal(14,2) // F
  custoFixoFinal   Decimal @default(0) @map("custo_fixo_final") @db.Decimal(14,2)   // G=D+E+F
  horasProdutivas  Decimal @default(0) @map("horas_produtivas") @db.Decimal(10,2)   // H
  custoHoraApurado Decimal @default(0) @map("custo_hora_apurado") @db.Decimal(12,4) // G/H
  custoHoraPraticar Decimal @default(0) @map("custo_hora_praticar") @db.Decimal(12,4)
  ajustePerc       Decimal @default(0) @map("ajuste_perc") @db.Decimal(6,2)
  @@map("resultado_centro")
}
```

### Migração (migrate-prod.ts)
CREATE TABLE IF NOT EXISTS para: mapa_custo, centro_custo, bem_depreciar,
funcionario_custo, despesa_custo, chave_rateio, destino_rateio,
resultado_centro. Índices por empresa_id e mapa_custo_id. Idempotente, testar
2× local. Sem alteração em tabelas existentes.

### Motor de rateio — pseudocódigo
```
1. depreciacaoBem(bem):
     base = valor − (valor × residualPerc/100)
     depMensal = base / (anosVidaUtil × 12) × fatorEstado(estado)
       // fatorEstado hoje neutro (1.0) — ver dúvida no steering sobre como o
       // Estado modula a depreciação.
2. Por centro (nível 0):
     A = Σ func. do centro: salario×(1+percEncargos/100) + ajudaCusto
     B = Σ depreciacaoBem dos bens do centro
     C = Σ despesas direcionadas ao centro (rateioDespesa)
     D = A + B + C
3. rateioDespesa(despesa) via ChaveRateio → % por centro:
     CENTRO=100% a um; HEADCOUNT=peso nº func.; ATIVO=peso Σ valor bens;
     MANUAL=pesos de DestinoRateio. valorCentro = valor × (peso ÷ Σ pesos).
4. Funcionários rateados (ChaveRateio FUNCIONARIO): distribui salario×(1+enc)+
     ajuda pelos destinos, somando em A de cada centro-destino.
5. Rateio nível 1→2: para cada AUXILIAR/ADMINISTRACAO, aplica sua chave sobre os
     PRODUTIVOS → E += Σ(D_aux × %); F += Σ(D_adm × %).
6. Por produtivo: G = D+E+F; H = unidades×horasBase+extras;
     custoHoraApurado = G/H; custoHoraPraticar = apurado×(1+ajuste%).
7. Consolidar totais no MapaCusto.
```
Todos os cálculos em `Prisma.Decimal` (nunca `number`) para precisão.

## Correctness Properties

Property 1: Conservação do custo fixo (nível 0) — Σ custoFixo de todos os
centros = custoFixoTotal do mapa (nenhum centavo criado/perdido no nível 0).

Property 2: Rateio soma 100% — para toda ChaveRateio, Σ (peso ÷ Σ pesos) = 1
(100%), com tolerância de arredondamento.

Property 3: Conservação no rateio de 2 níveis — Σ custoFixoFinal dos centros
PRODUTIVOS = custoFixoTotal (tudo que era auxiliar/administração foi
redistribuído nos produtivos; nada some nem é duplicado).

Property 4: Custo/hora não-negativo e coerente — para todo centro produtivo com
horasProdutivas > 0, custoHoraApurado = custoFixoFinal / horasProdutivas e
custoHoraApurado ≥ 0.

Property 5: Relação Apurado↔Praticar — custoHoraPraticar = custoHoraApurado ×
(1 + ajustePerc/100), dentro da tolerância de arredondamento.

Property 6: Idempotência do cálculo — calcular o mesmo mapa duas vezes produz
ResultadoCentro idênticos (recalcular não acumula valores).

Property 7: Imutabilidade do mapa fechado — um mapa com status FECHADO rejeita
qualquer escrita em seus cadastros (centros, bens, funcionários, despesas,
chaves).

## Error Handling

- Escrita em mapa FECHADO → 409 com mensagem clara.
- ChaveRateio sem destinos ou com Σ pesos = 0 → erro de validação no
  `calcular` (não dividir por zero); apontar a chave problemática.
- Centro produtivo com horasProdutivas = 0 → custo/hora não calculado (marca
  resultado como N/A, não divide por zero).
- Resíduo de rateio (arredondamento) → alocado ao centro de fechamento
  configurado (ex.: Acabamento Geral), replicando §11; se não houver, sobra
  registrada no total com aviso.
- `aplicar-orcamento` sem centroProducaoId vinculado → ignora o centro e
  reporta quais foram aplicados vs pulados.
- Multi-tenant: toda query filtra empresaId; retorno 404 (não 403) para ids de
  outra empresa (não vazar existência).

## Testing Strategy

Golden cases baseados nos relatórios reais da Wega (aritmética aberta — bate por
construção), como testes Vitest sobre o motor puro:
- Depreciação por bem e total (RI-1: foto Nov total 5.710.200 / dep. 34.537,22).
- Custo fixo por centro (§10 / Distribuição).
- Rateios (RI-6: Fábrica 9,09%×11; Corte Inicial 20%×5; "Quant. funcionários"
  por headcount, Σ = 111).
- Composição do Custo Hora (§11: (D+E+F)/H; ex. Roland Ultra → 327,52 A Praticar).
Property-based (fast-check) para P1–P6 (conservação, soma 100%, idempotência).
Escolher UMA "foto" oficial do mapa como referência (ver dúvida de reconciliação
de totais no steering). Tolerância: centavos por arredondamento.
