# Implementation Plan: Regras FEFO no Abastecimento de Picking (Entrada)

## Overview

A implementação estende o serviço puro `abastecimento-picking.service.ts` e
a rota de endereçamento inteligente para incorporar comparação de validade
(FEFO) na decisão de abastecimento do picking durante a entrada de
mercadorias. O trabalho está dividido em:

1. **Migração de banco** — novo campo `modo_abastecimento` em
   `dados_logisticos_picking`
2. **Lógica pura** — estender interfaces e função central do service com
   os checks de FEFO e bypass
3. **Função utilitária** — `obterMenorValidadePicking` para calcular a
   menor validade do picking
4. **Camada de rota** — buscar dados de validade e modo de operação na rota
   `/distribuir` e passá-los ao service
5. **Testes** — property-based tests (fast-check) para as 6 propriedades
   formais e testes unitários para edge cases

Linguagem: TypeScript (Fastify + Prisma + Vitest + fast-check).

## Tasks

- [x] 1. Migração de banco de dados — campo `modoAbastecimento`
  - Seguir o padrão idempotente documentado em `database-migrations.md`
  - _Requirements: 7.1, 7.2_

  - [x] 1.1 Adicionar campo `modoAbastecimento` ao model `DadosLogisticosPicking` em `schema.prisma`
    - Adicionar `modoAbastecimento String @default("VERIFICAR_PK") @map("modo_abastecimento") @db.VarChar(20)` ao model `DadosLogisticosPicking`
    - Rodar `npx prisma generate` para atualizar o client
    - _Requirements: 7.1_

  - [x] 1.2 Adicionar migração idempotente em `prisma/migrate-prod.ts`
    - Adicionar `ALTER TABLE dados_logisticos_picking ADD COLUMN IF NOT EXISTS modo_abastecimento VARCHAR(20) NOT NULL DEFAULT 'VERIFICAR_PK'`
    - Rodar `npx prisma migrate dev` localmente para gerar a migration formal
    - Rodar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas confirmando idempotência
    - _Requirements: 7.1, 7.2_

- [x] 2. Checkpoint — Migração validada
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Estender interfaces e lógica pura do service
  - Arquivo: `src/modules/enderecamento-inteligente/abastecimento-picking.service.ts`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.3, 8.3, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3_

  - [x] 3.1 Estender interface `DadosPickingConfig` com campos FEFO
    - Adicionar `validadePicking: Date | null` — menor validade encontrada no picking para este endereço/produto
    - Adicionar `modoAbastecimento: 'VERIFICAR_PK' | 'BYPASS_PULMAO'` — modo de operação do produto
    - _Requirements: 9.2, 9.3_

  - [x] 3.2 Estender interface `AbastecimentoPickingInput` com `validadeEntrada`
    - Adicionar `validadeEntrada: Date | null` — validade da mercadoria sendo endereçada
    - _Requirements: 8.3, 9.1_

  - [x] 3.3 Implementar função utilitária `obterMenorValidadePicking`
    - Recebe `validades: (Date | null)[]`, retorna a menor `Date` (mais próxima do vencimento) ou `null` se todas forem null/array vazio
    - Exportar a função para uso na rota
    - _Requirements: 8.1, 8.2_

  - [x] 3.4 Implementar check de bypass (`BYPASS_PULMAO`) em `calcularAbastecimentoPicking`
    - No início do loop de endereços, antes de qualquer outra verificação: se `config.modoAbastecimento === 'BYPASS_PULMAO'` → pular endereço, registrar aviso informando que o modo bypass está ativo
    - Tratar valores inválidos de `modoAbastecimento` como `VERIFICAR_PK` (default seguro) + registrar aviso
    - _Requirements: 6.1, 6.3_

  - [x] 3.5 Implementar check FEFO em `calcularAbastecimentoPicking`
    - Após o check de ponto de reposição, antes do cálculo de capacidade:
      - Se `input.validadeEntrada === null` → comportamento existente (só capacidade)
      - Se `config.validadePicking === null` → comportamento existente (picking vazio, só capacidade)
      - Se `input.validadeEntrada <= config.validadePicking` → permitir abastecimento (capacidade)
      - Se `input.validadeEntrada > config.validadePicking` → bloquear abastecimento, registrar aviso com as duas datas formatadas
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 9.4, 10.1, 10.2, 10.3_

  - [ ]* 3.6 Escrever property test — Validade menor ou igual permite abastecimento por capacidade
    - **Property 1: Validade menor ou igual permite abastecimento por capacidade**
    - Usar fast-check com generators de datas (range 2024-2027), capacidade (1-10000), saldoAtual (0-capacidade)
    - Verificar que para `validadeEntrada <= validadePicking` (ambas não-null) + `modoAbastecimento === 'VERIFICAR_PK'`, a quantidade abastecida é `min(quantidadeRestante, capacidade - saldoAtual)`
    - Mínimo 100 iterações
    - **Validates: Requirements 1.1, 1.2, 2.1, 10.2**

  - [ ]* 3.7 Escrever property test — Validade maior bloqueia picking completamente
    - **Property 2: Validade maior bloqueia picking completamente**
    - Verificar que para `validadeEntrada > validadePicking` (ambas não-null) + `modoAbastecimento === 'VERIFICAR_PK'`, a quantidade abastecida no picking é zero, independentemente de saldo/capacidade
    - Mínimo 100 iterações
    - **Validates: Requirements 3.1, 3.2, 10.3**

  - [ ]* 3.8 Escrever property test — Ausência de validade desativa FEFO
    - **Property 3: Ausência de validade no picking ou na entrada desativa FEFO**
    - Verificar que quando `validadeEntrada === null` OU `validadePicking === null` (com `modoAbastecimento === 'VERIFICAR_PK'`), o resultado é idêntico ao da lógica de capacidade pura (sem FEFO)
    - Mínimo 100 iterações
    - **Validates: Requirements 4.1, 4.2, 5.1, 5.2**

  - [ ]* 3.9 Escrever property test — Bypass pulmão ignora picking completamente
    - **Property 4: Bypass pulmão ignora picking completamente**
    - Verificar que para qualquer combinação de validades, capacidade e saldo onde `modoAbastecimento === 'BYPASS_PULMAO'`, a quantidade abastecida no picking é zero
    - Mínimo 100 iterações
    - **Validates: Requirements 6.1, 6.3**

  - [ ]* 3.10 Escrever property test — Aviso com datas ao bloquear por FEFO
    - **Property 5: Aviso com datas ao bloquear por FEFO**
    - Verificar que quando mercadoria é direcionada ao pulmão por regra FEFO (validadeEntrada > validadePicking, ambas não-null), o array `avisos` contém pelo menos uma mensagem com ambas as datas formatadas
    - Mínimo 100 iterações
    - **Validates: Requirements 9.4**

  - [ ]* 3.11 Escrever property test — Idempotência da decisão
    - **Property 6: Idempotência da decisão**
    - Verificar que invocar `calcularAbastecimentoPicking` duas vezes com os mesmos parâmetros produz resultados idênticos
    - Mínimo 100 iterações
    - **Validates: Requirements 10.1**

  - [ ]* 3.12 Escrever unit tests para edge cases e `obterMenorValidadePicking`
    - Casos de exemplo:
      - `obterMenorValidadePicking` com array vazio → null
      - `obterMenorValidadePicking` com todas null → null
      - `obterMenorValidadePicking` com 1 elemento → esse elemento
      - `obterMenorValidadePicking` com mix de nulls e datas → menor data
      - Bypass pulmão com picking vazio e validade da entrada menor que capacidade → zero no picking
      - Validade entrada = validade picking + picking cheio → zero no picking (capacidade esgotada)
      - Múltiplos endereços picking com modos diferentes (BYPASS_PULMAO no primeiro, VERIFICAR_PK no segundo)
      - Aviso FEFO contém formato correto de data
    - _Requirements: 4.1, 4.2, 5.1, 6.1, 8.1, 8.2, 9.4_

- [x] 4. Checkpoint — Service puro com FEFO implementado e testado
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrar na rota de endereçamento inteligente
  - Arquivo: `src/modules/enderecamento-inteligente/enderecamento-inteligente.routes.ts`
  - _Requirements: 6.2, 7.2, 7.3, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3_

  - [x] 5.1 Buscar `modoAbastecimento` de `DadosLogisticosPicking` na montagem de `dadosPickingConfigs[]`
    - No trecho que monta os dados de picking para a rota `/distribuir`, incluir o campo `modoAbastecimento` na query Prisma de `DadosLogisticosPicking`
    - Mapear para o campo correspondente em `DadosPickingConfig`
    - Filtrar sempre por `empresaId` (isolamento multi-tenant)
    - _Requirements: 7.2, 7.3, 9.3_

  - [x] 5.2 Buscar saldos do picking e calcular menor validade
    - Consultar `SaldoEndereco` filtrando por `enderecoId` (endereço de picking), `produtoId`, `empresaId`, onde `quantidade > 0` e `validade` não-null
    - Usar `obterMenorValidadePicking` para calcular a menor validade
    - Mapear o resultado para `validadePicking` em cada `DadosPickingConfig`
    - Em caso de falha na consulta (graceful degradation): considerar `validadePicking = null` → regra FEFO não aplicada
    - _Requirements: 8.1, 8.2_

  - [x] 5.3 Passar `validadeEntrada` no input do service
    - Extrair o campo `validade` do body da requisição (já existente no schema Zod da rota) e passá-lo como `validadeEntrada` (convertido para `Date`) em `AbastecimentoPickingInput`
    - _Requirements: 8.3, 9.1_

  - [ ]* 5.4 Escrever integration test — Rota `/distribuir` com `BYPASS_PULMAO` não retorna alocação picking
    - Configurar produto com `modoAbastecimento = 'BYPASS_PULMAO'` no banco de teste, chamar rota `/distribuir`, verificar ausência de alocações no picking
    - _Requirements: 6.2_

  - [ ]* 5.5 Escrever integration test — Alteração de modo surte efeito imediato
    - Alterar `modoAbastecimento` de `VERIFICAR_PK` para `BYPASS_PULMAO`, reexecutar endereçamento, confirmar mudança de comportamento
    - _Requirements: 7.3_

- [x] 6. Checkpoint final — Todos os testes passam, feature completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam as 6 propriedades de corretude formais definidas no design
- Unit tests cobrem edge cases e verificação de contratos de interface
- A migração usa `IF NOT EXISTS` — é seguro rodar múltiplas vezes em produção
- O service permanece como função pura — a obtenção de dados do banco é responsabilidade da rota
- Todas as queries na rota filtram por `empresaId` (padrão multi-tenant obrigatório)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5"] },
    { "id": 4, "tasks": ["3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "5.5"] }
  ]
}
```
