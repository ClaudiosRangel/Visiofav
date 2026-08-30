# Design Document

## Overview

Consolidação do put-away de pulmão em um **motor único** (`Motor_Putaway`) que
implementa a regra RF008 do consultor (compatibilidade de área → proximidade "3
prédios/lado + varredura da rua" → capacidade/nível/cubagem → disponibilidade),
substituindo tanto a lógica simplificada de `enderecamento-automatico` quanto a
ordenação par/ímpar legada do `enderecamento-inteligente`. Inclui a correção de
isolamento multi-tenant do `SaldoEndereco` (#2 e #7) e o tratamento explícito de
put-away incompleto.

Fonte de verdade da regra (consultor):
#[[file:../../../1 - Regras de Manutenção dos Estoques.docx]]
#[[file:../../../2 - Regras de Manutenção dos Estoques (1).docx]]

## Architecture

### Estado atual (a substituir)

- `conferencia/conferencia-entrada.routes.ts` → `POST /enderecamento-automatico/:notaId`: distribui só em endereços 100% livres, sem RF004/RF008.
- `enderecamento-inteligente/enderecamento-inteligente.routes.ts` → `executarCadeiaPrioridade`: fixo → consolidação → livre → overflow; ordenação por `alocador-proximidade.service.ts` (par/ímpar). Grava `SaldoEndereco` sem `empresaId` no `POST /confirmar` e lê consolidação sem filtro de empresa.

### Estado alvo

```
Motor_Putaway (novo serviço puro: putaway-motor.service.ts)
  ├─ entrada: { produtoId, quantidade, empresaId, lote?, validade?, config }
  ├─ 1. resolver SKU master + capacidade de palete
  ├─ 2. filtrar candidatos por Compatibilidade_Area (RF004)   ← usa AmbienteArmazenagem/ClassificacaoProduto
  ├─ 3. montar cadeia de destino: FIXO → CONSOLIDAÇÃO → LIVRE → OVERFLOW
  │      (todas as consultas filtradas por empresaId)
  ├─ 4. ordenar LIVRE por Regra_Proximidade_RF008 (novo: proximidade-rf008.service.ts)
  ├─ 5. filtrar por capacidade nível/peso/cubagem (validador-cubagem.service.ts, reaproveitado)
  ├─ 6. greedy de alocação (motor-distribuicao.service.ts, reaproveitado)
  └─ saída: { alocacoes[], quantidadeAlocada, quantidadeRestante, incompleto }

Rotas passam a delegar ao Motor_Putaway:
  - enderecamento-inteligente POST /distribuir  → chama Motor_Putaway
  - enderecamento-inteligente POST /confirmar    → grava SaldoEndereco COM empresaId
  - conferencia-entrada POST /enderecamento-automatico/:notaId → chama Motor_Putaway por item
```

O algoritmo de picking/FEFO existente (`abastecimento-picking.service.ts`)
permanece e continua rodando antes do pulmão (não é escopo alterá-lo aqui).

## Components and Interfaces

### `putaway-motor.service.ts` (novo — orquestrador puro)
```ts
interface PutawayInput {
  produtoId: string
  empresaId: string
  quantidadeMaster: number
  skuMaster: SkuInfo
  skuMasterRaw: { largura; altura; comprimento; volume; pesoBruto }
  origem: { rua: string; predio: number }        // coordenada do picking/fixo
  nivelMin: number; nivelMax: number
  config: ConfigPutaway
  // candidatos já pré-carregados por camada (fixo/consolidação/livre/overflow)
  candidatosFixo: EnderecoCandidato[]
  candidatosConsolidacao: EnderecoCandidato[]
  candidatosLivre: EnderecoCandidato[]
  candidatosOverflow: EnderecoCandidato[]
}
interface PutawayResult {
  alocacoes: Alocacao[]
  quantidadeAlocada: number
  quantidadeRestante: number
  incompleto: boolean
}
function calcularPutaway(input: PutawayInput): PutawayResult
```
Função pura (sem I/O): a rota faz os `prisma.find*` (com `empresaId`) e passa os
candidatos prontos; o serviço aplica compatibilidade→proximidade→capacidade→greedy.

### `proximidade-rf008.service.ts` (novo — substitui `alocador-proximidade`)
```ts
interface ProximidadeRF008Input {
  candidatos: EnderecoCandidato[]
  ruaOrigem: string
  predioOrigem: number
  predio-varredura: number   // N prédios por lado (Config_Putaway)
  nivelMin: number; nivelMax: number
}
function ordenarRF008(input): EnderecoCandidato[]
```
Regra (RF008.7): dentro da rua de origem, ordenar por distância de prédio
priorizando **N prédios à direita** (predio+1..predio+N), depois **N à esquerda**
(predio-1..predio-N), depois o restante da rua (lado oposto), depois demais ruas
em ordem. Dentro do mesmo prédio: nível asc, apto asc. Filtro de nível
`nivelMin..nivelMax`. (Diferente do par/ímpar atual.)

### `compatibilidade-area.service.ts` (novo — RF004)
```ts
function areaCompativel(
  produto: { ambienteExigido: string | null; classificacaoArmazenagemId: string | null },
  endereco: { ambienteArmazenagemId: string | null; classificacaoProdutoId: string | null; ambienteDescricao?: string | null }
): boolean
```
Regra: produto sem restrição → compatível com tudo. Com restrição → só endereços
cujo ambiente/classificação batem. Mapeamento `ambienteExigido` (SECO/REFRIGERADO/
CONGELADO) ↔ `AmbienteArmazenagem` resolvido na rota (join) e passado ao serviço.

### Reaproveitados sem alteração de assinatura
- `conversor-unidade.service.ts` (`selecionarSkuMaster`, `converterParaUnidadeMaster`).
- `motor-distribuicao.service.ts` (`calcularDistribuicao`, `calcularCapacidadePalete`).
- `validador-cubagem.service.ts` (`validarCubagem`).

### Config (`wms-putaway-config.ts` + rota)
Padrão `Parametro` prefixo `wms.putaway.`:
- `wms.putaway.prediosVarreduraPorLado` (int, default 3 — RF008.7).
- `wms.putaway.usarClasseAbc` (bool, default false — enquanto o spec ABC não existir).
- `wms.putaway.politicaIncompleto` (`BLOQUEAR` | `PARCIAL`, default `PARCIAL` para preservar comportamento atual).

## Data Models

Nenhuma tabela nova é estritamente necessária — os campos exigidos já existem:
- `Endereco.ambienteArmazenagemId`, `Endereco.classificacaoProdutoId`, `Endereco.areaArmazenagem`, `Endereco.permiteOverflow`, `Endereco.codigoRua/Predio/Nivel/Apto`, `Endereco.empresaId`, `Endereco.estrutura`.
- `Produto.ambienteExigido`, `Produto.classificacaoArmazenagemId`, `Produto.curvaAbc`.
- `AmbienteArmazenagem`, `ClassificacaoProduto` (relacionamentos já existentes).
- `SaldoEndereco.empresaId` (já existe no schema; o problema é que **não é preenchido** em alguns caminhos).
- `DadosLogisticosArmazenagem.enderecoFixoId/nivelMinPP/nivelMaxPP`.

Alteração de schema prevista (mínima):
- Nenhuma coluna nova obrigatória. Se durante a implementação for necessário um
  índice para performance (ex.: `SaldoEndereco(empresaId, produtoId)`), ele entra
  com migração idempotente no `migrate-prod.ts` (Req 9.1).

Migração de dados (Req 9.2): backfill de `SaldoEndereco.empresaId` nulo a partir
do `Endereco.empresaId` (ou do `Produto.empresaId`) via `UPDATE ... WHERE empresa_id IS NULL`,
idempotente, sem descartar saldo.

## Correctness Properties

Property 1: Compatibilidade — nenhuma Alocacao é feita em endereço incompatível com o ambiente/classificação exigidos do produto.
**Validates: Requirements 2.1, 2.2, 2.4**

Property 2: Ordem de proximidade — para candidatos na rua de origem, a sequência das Alocacoes respeita a Regra_Proximidade_RF008 (N prédios à direita, depois N à esquerda, depois restante da rua, depois outras ruas).
**Validates: Requirements 3.2, 3.3, 3.4**

Property 3: Capacidade — a soma das quantidades alocadas em cada endereço nunca excede sua capacidade residual (palete e, quando definido, nível/peso/volume).
**Validates: Requirements 4.1, 4.2, 4.4**

Property 4: Conservação — `quantidadeAlocada + quantidadeRestante == quantidade` de entrada, e `incompleto ⟺ quantidadeRestante > 0`.
**Validates: Requirements 7.1**

Property 5: Isolamento multi-tenant — todo `SaldoEndereco` criado tem `empresaId` da nota/produto, e nenhuma consulta de saldo mistura empresas.
**Validates: Requirements 6.1, 6.2, 6.4**

Property 6: Prioridade da cadeia — quando há endereço fixo com capacidade, ele recebe alocação antes de consolidação/livre; consolidação antes de livre; overflow só quando os demais não cobrem.
**Validates: Requirements 5.1, 5.2, 5.4**

## Error Handling

- Sem SKU master → HTTP 422 explícito, nenhuma alocação (Req 1.4).
- Put_Away_Incompleto com política `BLOQUEAR` → HTTP 422 informando quantidade sem destino (Req 7.3).
- Put_Away_Incompleto com política `PARCIAL` → 200 com `quantidadeRestante` explícita (Req 7.4).
- Falha de I/O nas consultas de candidatos → erro propagado (não silenciar); nunca retornar alocação parcial "mascarando" erro.
- Config ausente → default documentado, sem erro (Req 8.2).

## Testing Strategy

- **Testes unitários (puros)** dos três serviços novos (`putaway-motor`, `proximidade-rf008`, `compatibilidade-area`) com casos-tabela cobrindo cada propriedade — incluindo property-based onde couber (proximidade e conservação).
- **Teste de migração idempotente**: rodar `migrate-prod.ts` 2x sem erro; validar backfill de `empresaId`.
- **QA E2E** (spec `qa-cobertura-recebimento-wms`, estendido): compatibilidade de área, ordem de proximidade, não-excesso de capacidade, isolamento multi-tenant, put-away incompleto.
- Verificação de baseline `tsc` (não introduzir novos erros além dos ~86 conhecidos).
```
