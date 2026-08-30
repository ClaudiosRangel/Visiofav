# Implementation Plan

## Overview

Sequência de implementação do Motor_Putaway (RF008) com objetivo claro: unificar
o put-away de pulmão numa regra única conforme o consultor, corrigir o isolamento
multi-tenant do saldo (#2/#7) e tratar put-away incompleto. A ordem prioriza
**primeiro as correções estruturais de segurança de dados** (isolamento), depois
os serviços puros testáveis, depois a integração nas rotas, e por fim o QA.

Objetivo mensurável: um único motor de put-away, com compatibilidade de área,
proximidade RF008 e capacidade honradas, sem gravar saldo sem `empresaId`, e sem
mercadoria "sem destino" silenciosa.

## Tasks

- [x] 1. Correção estrutural de isolamento multi-tenant do saldo (#2 e #7)
- [x] 1.1 Preencher `empresaId` ao gravar `SaldoEndereco` no `enderecamento-inteligente` (`POST /confirmar`)
  - Alterar os `saldoEndereco.create` para incluir `empresaId`; incluir `empresaId` no `LogMovimentacao`.
  - Filtrar por `empresaId` a leitura de consolidação e de capacidade residual (aceitar legado null de forma explícita/documentada).
  - _Requirements: 6.1, 6.2, 6.3_
- [x] 1.2 Migração idempotente de backfill de `empresaId` em `SaldoEndereco` legado
  - Adicionar em `prisma/migrate-prod.ts` `UPDATE saldo_endereco SET empresa_id = ...` a partir do endereço/produto, idempotente (só onde `empresa_id IS NULL`).
  - Se necessário índice `(empresa_id, produto_id)`, criar com `CREATE INDEX IF NOT EXISTS`.
  - Testar rodando `migrate-prod.ts` 2x sem erro.
  - _Requirements: 6.1, 9.1, 9.2_

- [x] 2. Serviços puros do Motor_Putaway (testáveis isoladamente)
- [x] 2.1 `compatibilidade-area.service.ts` (RF004)
  - Implementar `areaCompativel(produto, endereco)`: produto sem restrição → compatível; com restrição → só ambiente/classificação compatíveis.
  - Testes-tabela cobrindo compatível/incompatível/sem-restrição.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
- [x] 2.2 `proximidade-rf008.service.ts` (RF008.7 — substitui par/ímpar)
  - Implementar `ordenarRF008`: N prédios à direita → N à esquerda → restante da rua → outras ruas; nível/apto asc; filtro `nivelMin..nivelMax`; `N` parametrizável.
  - Testes (incluindo property-based) de que a ordem respeita a regra do consultor.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
- [x] 2.3 `putaway-motor.service.ts` (orquestrador puro)
  - Implementar `calcularPutaway`: aplica compatibilidade → cadeia FIXO/CONSOLIDAÇÃO/LIVRE/OVERFLOW → proximidade RF008 na camada livre → capacidade (reaproveita `validarCubagem`/`calcularCapacidadePalete`) → greedy (`calcularDistribuicao`).
  - Retorna `{ alocacoes, quantidadeAlocada, quantidadeRestante, incompleto }`; `incompleto ⟺ quantidadeRestante > 0`.
  - Testes de conservação, prioridade da cadeia e não-excesso de capacidade.
  - _Requirements: 1.3, 4.1, 4.4, 5.1, 5.2, 5.4, 7.1_
- [x] 2.4 Uso opcional de classe ABC na ordenação (consome, não calcula)
  - Quando `Config_Putaway.usarClasseAbc` e `Produto.curvaAbc` existirem, usar como critério adicional sem violar a proximidade da rua de origem.
  - _Requirements: 3.5_

- [x] 3. Configuração Config_Putaway
- [x] 3.1 `wms-putaway-config.ts` + rota de leitura/escrita
  - Flags no padrão `Parametro` prefixo `wms.putaway.`: `prediosVarreduraPorLado` (default 3), `usarClasseAbc` (default false), `politicaIncompleto` (`BLOQUEAR`|`PARCIAL`, default `PARCIAL`).
  - Escrita restrita a perfil administrativo; defaults quando ausente.
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Integração nas rotas (delegar ao Motor_Putaway)
- [x] 4.1 `enderecamento-inteligente POST /distribuir` delega ao Motor_Putaway
  - Rota carrega candidatos por camada COM `empresaId`, resolve ambiente/classificação, chama `calcularPutaway`, retorna resultado (com `incompleto`/`quantidadeRestante`).
  - Remover/aposentar `alocador-proximidade.service.ts` (par/ímpar) do caminho.
  - _Requirements: 1.1, 1.3, 2.4, 3.1_
- [x] 4.2 `conferencia-entrada POST /enderecamento-automatico/:notaId` usa o Motor_Putaway
  - Substituir a lógica "somente endereços livres" pela chamada ao Motor_Putaway por item; gravar `SaldoEndereco` com `empresaId`.
  - _Requirements: 1.1, 1.2, 6.1_
- [x] 4.3 Tratamento de Put_Away_Incompleto na confirmação
  - Política `BLOQUEAR` → 422 com quantidade sem destino; `PARCIAL` → confirma possível e retorna pendente explícito.
  - _Requirements: 7.2, 7.3, 7.4_
- [x] 4.4 Rejeição por SKU master ausente
  - Manter/garantir HTTP 422 explícito quando não há SKU master, sem alocar.
  - _Requirements: 1.4_

- [x] 5. Verificação e QA
- [x] 5.1 Estender `qa-cobertura-recebimento-wms` com asserções do Motor_Putaway
  - Compatibilidade de área, ordem de proximidade RF008, não-excesso de capacidade, isolamento multi-tenant do saldo, put-away incompleto por política.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
- [x] 5.2 Validação de build e migração
  - `tsc --noEmit` sem novos erros além da baseline (~86); `migrate-prod.ts` idempotente 2x.
  - _Requirements: 9.1, 9.3_

## Task Dependency Graph

```
1.1 ─┬─ 1.2
     │
2.1 ─┤
2.2 ─┼─ 2.3 ─ 2.4
     │
3.1 ─┘
        │
   (1.*, 2.*, 3.*) ─ 4.1 ─┬─ 4.2 ─ 4.3 ─ 4.4
                          │
                    (4.*) ─ 5.1 ─ 5.2
```

- Task 1 (isolamento — prioridade máxima, correção estrutural) é independente e pode começar já.
- Tasks 2.1, 2.2, 3.1 são independentes entre si; 2.3 depende de 2.1+2.2; 2.4 depende de 2.3.
- Task 4 (integração) depende de 1, 2 e 3 concluídas.
- Task 5 (QA/validação) depende da task 4.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "2.1", "2.2", "3.1"] },
    { "wave": 2, "tasks": ["1.2", "2.3"] },
    { "wave": 3, "tasks": ["2.4"] },
    { "wave": 4, "tasks": ["4.1"] },
    { "wave": 5, "tasks": ["4.2", "4.3", "4.4"] },
    { "wave": 6, "tasks": ["5.1", "5.2"] }
  ]
}
```

## Notes

- Fonte de verdade da regra: documentos do consultor (Parte 1 RF008 e Parte 2 ABC).
- **Regra obrigatória do projeto**: qualquer alteração em `schema.prisma` exige a
  alteração idempotente equivalente em `migrate-prod.ts` no mesmo commit
  (steering `database-migrations.md`).
- **Isolamento multi-tenant** é classe de bug histórica — a task 1 vem primeiro
  de propósito (steering `ATENCAO-pontos-verificar.md`).
- Não commitar direto em `main` do backend sem necessidade; push em `main`
  dispara deploy no Render. Criar branch e staging seletivo.
- A classificação ABC/giro (Doc Parte 2) é um spec separado (`slotting-abc-giro`);
  aqui o motor apenas consome a classe quando existir (task 2.4), com default
  desligado.
- Overflow permanece como último recurso; alinhar com o consultor se ele deve
  respeitar capacidade física (hoje é "elástico").
