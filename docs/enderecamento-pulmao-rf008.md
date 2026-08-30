# Endereçamento de Pulmão — Motor RF008 (implementação)

Implementação do spec `.kiro/specs/enderecamento-pulmao-rf008`, que unifica o
put-away de pulmão conforme a regra RF008 do consultor logístico e corrige o
isolamento multi-tenant do `SaldoEndereco` (problemas estruturais #2 e #7).

Fonte de verdade da regra: `1 - Regras de Manutenção dos Estoques.docx` (RF008)
e `2 - Regras de Manutenção dos Estoques (1).docx` (ABC/giro — spec separado).

## O que foi implementado

### Onda 1 — Isolamento multi-tenant do saldo (#2/#7)
- `enderecamento-inteligente.routes.ts` (`POST /confirmar`): `saldoEndereco.create`
  passa a gravar `empresaId`; busca de saldo existente e leituras de saldo
  (fixo, consolidação, overflow) filtram por `empresaId` (aceitando legado
  `empresa_id NULL` de forma explícita).
- `conferencia-entrada.routes.ts`: `saldoEndereco.create` do `enderecamento-automatico`
  e do `enderecamento-manual` gravam `empresaId`; buscas filtram por empresa.
- `prisma/migrate-prod.ts`: backfill idempotente de `saldo_endereco.empresa_id`
  a partir do endereço (fallback: produto) + índice `(empresa_id, produto_id)`.
  Testado 2x localmente — idempotente.

### Ondas 2–3 — Serviços puros do motor (com testes)
- `compatibilidade-area.service.ts` (RF004): `areaCompativel(produto, endereco)`
  — ambiente (`SECO/REFRIGERADO/CONGELADO`) e classificação.
- `proximidade-rf008.service.ts` (RF008.7): `ordenarRF008` — N prédios à direita
  → N à esquerda → restante da rua → outras ruas. **Substitui o par/ímpar legado**
  (`alocador-proximidade.service.ts`, que deixou de ser usado no caminho).
- `putaway-motor.service.ts`: `calcularPutaway` — cadeia FIXO → CONSOLIDAÇÃO →
  LIVRE (ordenada RF008) → OVERFLOW, com uso opcional de curva ABC (default off).
- 21 testes unitários (vitest) passando.

### Onda 3 — Config_Putaway
- `wms-putaway-config.ts`: flags `Parametro` prefixo `wms.putaway.`:
  - `prediosVarreduraPorLado` (default 3 — RF008.7)
  - `usarClasseAbc` (default false)
  - `politicaIncompleto` (`PARCIAL` | `BLOQUEAR`, default `PARCIAL`)
  - Rota `GET/PATCH /api/wms/putaway/config` (PATCH restrito a ADMIN/SUPER_ADMIN).

### Ondas 4–5 — Integração nas rotas
- `POST /api/enderecamento-inteligente/distribuir`: passou a aplicar
  compatibilidade de área (RF004) e a ordenação RF008 (config-driven), mantendo
  o abastecimento de picking/FEFO intacto; resposta expõe `incompleto`.
- `POST /api/conferencia-entrada/enderecamento-automatico/:notaId`: a branch com
  SKU master passou a usar `calcularPutaway` (cadeia completa), em vez de só
  endereços 100% livres. Política de put-away incompleto aplicada:
  `BLOQUEAR` → 422 `PUTAWAY_INCOMPLETO`; `PARCIAL` → confirma o possível e retorna
  `itensSemDestino`.
- SKU master ausente no `/distribuir` → 422 (comportamento preservado).

### Onda 6 — Verificação
- `tsc --noEmit`: **86 erros** (= baseline conhecida; nenhum novo, nenhum nos
  arquivos tocados).
- Migração idempotente validada (2 execuções sem erro).

## Pendências / pontos em aberto (decisão do consultor/cliente)

1. **Política de put-away incompleto**: default ficou `PARCIAL` (preserva o
   comportamento atual — confirma o que couber e devolve a quantidade pendente).
   O consultor pode preferir `BLOQUEAR` (recusar a confirmação até tratar a
   mercadoria sem destino). Basta ajustar `wms.putaway.politicaIncompleto`.
2. **Overflow "elástico"**: o endereço de overflow SEM estrutura definida aceita
   quantidade ilimitada (não trava o put-away). Isso **não está nos documentos do
   consultor** — foi uma extensão anterior. Confirmar com ele se o overflow deve
   respeitar uma capacidade física máxima (hoje respeita capacidade só quando há
   estrutura definida no endereço).

## Isolamento de saldo — outros módulos FORA do escopo desta feature

O mesmo padrão de `saldoEndereco.create` sem `empresaId` existe em outros
módulos que NÃO foram tocados aqui (fora do escopo RF008). Ficam registrados
para tratamento futuro (mesma classe de bug #2/#7):
- `ressuprimento/ressuprimento.routes.ts`
- `manutencao-estoque/manutencao-estoque.routes.ts`
- `enderecamento/enderecamento-wms.routes.ts` (3 pontos)
- `enderecamento/enderecamento.routes.ts` (rota legada `/api/operacoes`)
- `demanda/demanda.service.ts`
- `bloqueio-wms/picking-dinamico.service.ts`

O backfill de `migrate-prod.ts` corrige os saldos legados já gravados por esses
caminhos, mas as gravações futuras deles continuam nascendo sem `empresaId` até
serem corrigidas. Recomendação: um spec/PR dedicado varrendo todos os
`saldoEndereco.create` para padronizar o `empresaId`.

## Como validar (QA)

Requisito 11 adicionado ao spec `qa-cobertura-recebimento-wms` (frontend):
compatibilidade de área, ordem RF008, não-excesso de capacidade, isolamento
multi-tenant e put-away incompleto por política.
