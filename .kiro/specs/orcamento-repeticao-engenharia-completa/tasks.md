# Implementation Plan

## Overview

Enriquecimento sob demanda (no puxar) + lote prioritário + tipo REPETIÇÃO +
cliente por CNPJ + conferência foto×recálculo. Foto IMUTÁVEL; nunca inventar
valor; `empresaId` explícito; não tocar PCP nem o motor. Backend
`VisioFab.Wms.Back`, frontend `VisioFab.Wms.Front`. Verificação por
`get_diagnostics` (tsc trava); vitest `--reporter=dot`; `npx tsx` NÃO usar
(trava — scripts de produção via `pg` direto em `.mjs`). NÃO commitar sem pedido.

## Tasks

- [x] 1. Schema + migração (aditiva, idempotente)
  - Em `schema.prisma`: `OrcamentoGrafico.tipo` (VarChar(12), default 'NOVO');
    `CalculoGrafico.engenhariaCompleta` (Boolean default false),
    `engenhariaPendentes` (Json?), `clienteDoc` (VarChar(20)?), `clienteCodigo` (Int?)
  - Em `prisma/migrate-prod.ts`: `ADD COLUMN IF NOT EXISTS` para os 5 campos (mesmo commit)
  - `npx prisma generate`; validar `get_diagnostics`
  - _Requirements: 2, 4.1, 4.2, 7_

- [x] 2. Foto rica com documento do cliente
  - [x] 2.1 `foto-rica.types.ts`: `cabecalho.clienteDoc?`/`clienteCodigo?`
    - _Requirements: 7.1_
  - [x] 2.2 `scripts/exportar-calculos-acervo-rico.mjs`: incluir `n.CNPJCPF`→clienteDoc e `h.CodNome`→clienteCodigo no SELECT de cabeçalhos; re-exportar
    - _Requirements: 7.1_
  - [x] 2.3 Script `pg` para re-gravar os 7.951 (idempotente — só acrescenta clienteDoc/clienteCodigo; NÃO altera foto/valores) em produção
    - _Requirements: 7.1, 2.2_

- [x] 3. Serviço de enriquecimento (de-para) — puro-ish, multi-tenant
  - `calculo-grafico/enriquecimento-engenharia.service.ts`:
    `enriquecerEngenharia(empresaId, calc) → { campos, pendentes }`
  - De-para por nome NORMALIZADO (trim/maiúsc/sem acento/colapsa espaço):
    papel/suporte→`SuporteGrafico`/`PrecoMateriaPrima`(PAPEL); gramatura do plano;
    cores→preço/rendimento de `PrecoMateriaPrima`(TINTA) preservando cobertura;
    acabamentos→`AcabamentoGrafico`→`acabamentosRicos`; máquina→`CentroProducao`(IMPRESSAO)
  - Cliente: `clienteDoc` normalizado (só dígitos) → `cliente.cpf_cnpj` normalizado, mesma empresa
  - 0 ou 2+ candidatos → `pendentes` (NUNCA inventar). NÃO ler/escrever `resultadoCalculo`. `empresaId` explícito
  - _Requirements: 1.2, 1.3, 1.5, 7.1, 7.2, 7.3, 8.1, 8.3_

- [x] 4. `garantirEngenhariaCompleta` (grava de volta + idempotente)
  - Em `calculo-grafico.service.ts`: se `engenhariaCompleta=false`, roda o serviço,
    grava campos resolvidos DE VOLTA no `CalculoGrafico` (Req 2), grava
    `engenhariaPendentes`, seta `engenhariaCompleta=true` quando sem pendência essencial
  - Não altera foto/totais. `empresaId` explícito. Idempotente
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.4_

- [x] 5. Rota `/de-calculo` → repetição com engenharia completa + cliente
  - Em `orcamento-grafico.routes.ts`: antes de `copiarCalculoParaItem`, chamar
    `garantirEngenhariaCompleta`; gravar `tipo='REPETICAO'` e `clienteId` resolvido
    no orçamento; manter atomicidade/404/403/409
  - Orçamento em branco permanece `tipo='NOVO'` (default)
  - _Requirements: 1.1, 1.4, 4.1, 4.3, 7.2, 7.4_

- [x] 6. Conferência foto × recálculo (backend)
  - `GET /orcamento-grafico/:id/itens/:itemId/conferencia` (ou embutir no
    `/:id/itens/:itemId/calcular`): foto ORIGINAL × recálculo do motor, por
    componente + desvio %; ≤0,5% = confere. NÃO grava na foto. `empresaId` explícito
  - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [ ] 7. Lote prioritário (script) + relatório
  - `scripts/enriquecer-engenharia-lote.ts` (`pg`/idempotente): roda
    `enriquecerEngenharia` nos 366 produtos que mais repetem (começa pelos 56 de
    5+), grava de volta, relatório resolvidos×pendentes por cálculo. `--dry-run`. NÃO toca PCP
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 8. Frontend — repetição, A_COMPLETAR e conferência
  - [x] 8.1 Badge "Repetição" quando `tipo=REPETICAO` (lista + detalhe + relatório/proposta)
    - _Requirements: 4.4_
  - [ ] 8.2 `ItemWizardModal`/steps: chips "A completar" nos campos de `engenhariaPendentes`; campos já populados (engenharia completada)
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 8.3 `StepRevisao`: painel de Conferência (Calcgraf × Vizor × desvio); ≤0,5% verde, senão alerta; operador escolhe o valor da proposta
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Testes (property + exemplo)
  - [ ]* 9.1 Property 1 — Foto imutável. **Feature: orcamento-repeticao-engenharia-completa, Property 1** · **Validates: 1.5, 2.2, 6.5**
  - [x]* 9.2 Property 2 — Nunca inventa (A_COMPLETAR). **Property 2** · **Validates: 1.3, 5.3** (`matchUnicoPorNome`: 0/2+ candidatos → undefined)
  - [x]* 9.3 Property 3 — Idempotência. **Property 3** · **Validates: 2.1, 2.3, 3.4** (normalização idempotente/estável)
  - [x]* 9.4 Property 4 — Cliente por CNPJ normalizado. **Property 4** · **Validates: 7.1, 7.2, 7.3** (`matchClientePorDoc` invariante a máscara)
  - [ ]* 9.5 Property 5 — Tipo + rastreabilidade. **Property 5** · **Validates: 4.1, 4.2, 4.3**
  - [ ]* 9.6 Property 6 — Conferência de desvio. **Property 6** · **Validates: 6.1, 6.2, 6.3**
  - [ ]* 9.7 Property 7 — Isolamento multi-tenant. **Property 7** · **Validates: 7.4, 8.1, 8.2, 8.3, 8.4**
  - [ ]* 9.8 Exemplos/integração: puxar migrado→REPETICAO c/ engenharia+cliente; sem match→A_COMPLETAR; conferência ≤0,5% vs >0,5%
    - _Requirements: 1.1, 4.1, 6.2, 7.2_
  - fast-check 100+ iter, Prisma mockado, `npx vitest run <arq> --reporter=dot`

- [ ] 10. Checkpoint — validação
  - `get_diagnostics` nos arquivos tocados; dry-run do lote; validar o 11121 na tela (vem preenchido + cliente + conferência). Ensure all tests pass; ask the user if questions arise

## Notes
- Foto (`resultadoCalculo`) IMUTÁVEL em toda a feature.
- Schema + migrate-prod no MESMO commit (idempotente).
- De-para por nome normalizado; ambíguo/zero → A_COMPLETAR (nunca inventar).
- Cliente: de-para por CNPJ só dígitos (confirmado 8/8 em 2026).
- NÃO commitar sem pedido do usuário.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3"] },
    { "id": 2, "tasks": ["2.3", "4", "6"] },
    { "id": 3, "tasks": ["5", "7"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["9.1","9.2","9.3","9.4","9.5","9.6","9.7","9.8"] },
    { "id": 6, "tasks": ["10"] }
  ]
}
```
