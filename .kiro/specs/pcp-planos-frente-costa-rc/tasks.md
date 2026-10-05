# Implementation Plan: PCP Planos, Frente/Costa e RC

## Overview

Ordem de execução: Fase A (RC, isolada) → Fase B (Planos) → Fase C (Frente/
Costa). Cada alteração de `schema.prisma` entra no MESMO commit que o
`migrate-prod.ts` correspondente (regra do projeto), testado 2× local.

## Tasks

---

## Fase A — Requisição de Corte (RC)

- [x] 1. Schema + migração da RC
  - Adicionar model `RequisicaoCorte` ao `schema.prisma` (campos do design).
  - Adicionar o `CREATE TABLE IF NOT EXISTS "requisicao_corte"` idempotente
    ao `migrate-prod.ts` (+ índice por empresa).
  - Rodar `npx prisma generate` e `npx tsx prisma/migrate-prod.ts` 2× local
    sem erro.
  - _Requisitos: 6.1, 6.2_

- [x] 2. Backend — rotas da RC
  - Criar `src/modules/pcp/requisicao-corte.routes.ts` (prefixo `/api/pcp`):
    GET lista, GET :id, POST (numero auto `NN/AAAA` por empresa/ano), PUT,
    DELETE. Filtro `empresaId` explícito + `moduloGuard` PCP.
  - Registrar em `server.ts`.
  - `get_diagnostics` sem erros nos arquivos tocados.
  - _Requisitos: 6.3, 6.4, 6.6, 6.7_

- [x] 3. Backend — PDF da 1ª via
  - Criar `requisicao-corte-pdf.service.ts` (pdfkit) com layout fiel ao
    FO-002/PCP + selo "1ª VIA".
  - Rota `GET /requisicoes-corte/:id/pdf` (aceita token via query param).
  - _Requisitos: 6.5_

- [x] 4. Frontend — modal "Adicionar RC" na aba Cortadeira
  - Botão "+ Adicionar RC" nos cards de centros tipo CORTADEIRA em
    `programacao/page.tsx`.
  - Modal com os campos do formulário; botões "Salvar" e "Salvar e Imprimir"
    (abre o PDF em nova aba após salvar).
  - `get_diagnostics` sem erros; `npm run build` do front passa.
  - _Requisitos: 6.3, 6.5_

- [ ] 5. (Opcional) Tela de listagem/reimpressão de RCs
  - Lista consumindo `GET /requisicoes-corte` com reabrir/reimprimir.
  - _Requisitos: 6.7_

---

## Fase B — Planos de Produção

- [ ] 6. Schema + migração dos planos
  - Adicionar model `PlanoOrdemProducao` + relação em `OrdemProducao` +
    campo `planoId` (nullable, `onDelete: SetNull`) em `EtapaOrdemProducao`.
  - `migrate-prod.ts`: `CREATE TABLE IF NOT EXISTS "plano_ordem_producao"`,
    `ADD COLUMN IF NOT EXISTS "plano_id"`, índice, e as 3 FKs em try/catch.
  - Rodar `npx prisma generate` + `migrate-prod.ts` 2× local sem erro;
    confirmar que etapas existentes ficam com `plano_id` NULL.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 7. Parser — extrair `planos[]` do PDF
  - Snapshot de regressão ANTES: `npx tsx scripts/testar-todos-pdfs-op.ts`
    (guardar saída).
  - Adicionar `extrairPlanos(texto)` ao `gprint-parser.ts` (casa tabela de
    materiais-por-plano com tabela processo-por-plano; deriva etapas da
    coluna Acabamento de cada plano).
  - Expor `planos: PlanoOp[]` em `DadosOpGprint`; preservar `etapas[]`
    achatado para o caminho de plano único (não-regressão).
  - Rodar o script DEPOIS e comparar: contagem de etapas por PDF não pode
    regredir.
  - _Requisitos: 2.1, 2.2, 2.3, 2.5_

- [ ] 8. Testes do parser
  - `gprint-parser.test.ts`: casos multi-plano (3 planos TAMPA/CAIXA/BOLSA),
    plano único (não-regressão) e detecção `7x5` (frente/costa flag).
  - _Requisitos: 2.1, 2.3, 2.4, 2.6_

- [ ] 9. Confirmação da importação — criar planos e vincular etapas
  - Em `importacao-op.routes.ts`: quando `dados.planos.length >= 2`, criar
    um `PlanoOrdemProducao` por plano e vincular cada etapa recriada via
    `planoId`. Quando `< 2`, caminho atual intacto (planoId NULL).
  - Reimportação: adicionar
    `planoOrdemProducao.deleteMany({ where: { ordemProducaoId } })` antes de
    recriar; manter TODAS as travas de confirmação atuais inalteradas.
  - `get_diagnostics` sem erros.
  - _Requisitos: 2.1, 2.2, 5.1, 5.2, 5.3, 5.4_

- [ ] 10. Painel — expor e exibir o plano
  - Backend `GET /pcp/programacao/painel`: incluir
    `plano: { select: { id, nome, tipo } }` nas etapas (sem N+1), filtrando
    por `empresaId` da OP.
  - Frontend `programacao/page.tsx`: badge/sufixo "· {plano.nome}" quando a
    etapa tiver plano; sem plano = render atual inalterado.
  - Confirmar manualmente que a conclusão da OP segue inalterada
    (every CONCLUIDA) e que OPs legadas (planoId NULL) aparecem como hoje.
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 11. Ajuste do preview de importação (frontend) para planos
  - Avaliar e, se necessário, agrupar as etapas por plano na tela de preview,
    permitindo revisar/vincular centro por plano. Manter indexação de etapas
    consistente com o backend (`centrosVinculados` por índice).
  - _Requisitos: 2.1, 2.2_

---

## Fase C — Frente e Costa

- [ ] 12. Parser — detectar frente/costa
  - No `extrairPlanos`, marcar `frenteCosta` quando Cores for `NxM` (N>0,
    M>0); derivar `coresFrente`/`coresCosta`; ler tiragem `qtd x 2` como base
    `qtd`.
  - Teste unitário do caso `7x5` + `8.250 x 2`.
  - _Requisitos: 3.1, 3.2_

- [ ] 13. Confirmação — gerar planos FACE
  - Quando um plano vier `frenteCosta`, criar 2 `PlanoOrdemProducao` tipo
    `FACE` (FRENTE/COSTA), COSTA com `faceDeId` → FRENTE, mesma tiragem base.
  - Distribuir etapas conforme regra confirmada (default: impressão por face,
    acabamento na FRENTE) — CONFIRMAR com o usuário antes de implementar.
  - Garantir que a OP continua com `numero` único.
  - _Requisitos: 3.1, 3.2, 3.3, 3.5_

- [ ] 14. Painel — exibir faces
  - Verificar que FRENTE/COSTA aparecem como linhas próprias (reusa o badge
    de plano da task 10; sem código extra além de dados corretos).
  - _Requisitos: 3.4_

---

## Encerramento

- [ ] 15. Verificação final e documentação
  - Build back (`npm run build`) e front (`npm run build`) passam.
  - Atualizar o steering `pcp-modulo.md` com a seção de Planos/Frente-Costa/RC
    (novos models, rotas, comportamento de `planoId` NULL).
  - Rodar `scripts/testar-todos-pdfs-op.ts` uma última vez (sem regressão).
  - Commit conforme política do projeto (schema + migrate-prod juntos; branch
    nova; back e front são repos separados).

## Task Dependency Graph

Fase A (RC) é independente das Fases B/C e pode ser executada em paralelo.
Fase C depende da Fase B (planos).

```json
{
  "waves": [
    { "wave": 1, "tasks": [1, 6], "description": "Schemas + migrações (RC e Planos) — independentes entre si" },
    { "wave": 2, "tasks": [2, 7], "description": "Backend RC + parser de planos" },
    { "wave": 3, "tasks": [3, 8, 9], "description": "PDF da RC, testes do parser, confirmação cria planos" },
    { "wave": 4, "tasks": [4, 10, 12], "description": "Frontend RC, painel exibe plano, parser detecta frente/costa" },
    { "wave": 5, "tasks": [5, 11, 13], "description": "Lista RC (opcional), preview por plano, confirmação gera FACE" },
    { "wave": 6, "tasks": [14], "description": "Painel exibe faces" },
    { "wave": 7, "tasks": [15], "description": "Verificação final, docs e commit" }
  ]
}
```

## Notes

- Módulo em produção (Carton Wega): priorizar não-regressão. `planoId NULL` =
  comportamento atual em todos os pontos.
- Toda mudança de schema: `schema.prisma` + `migrate-prod.ts` no mesmo commit,
  idempotente, testado 2× local.
- Antes de implementar a task 13 (distribuição de etapas entre FRENTE/COSTA),
  CONFIRMAR a regra com o usuário.
- Nunca commitar direto em `main` — branch nova. Back e front são repos
  separados.
