# Implementation Plan: Mapa de Custos RKW

## Overview

Referências: `design.md`, `requirements.md`, `docs/calcgraf-gprint-levantamento.md`
(§7–§13, RI-1..RI-6). Backend Fastify+Prisma, frontend Next.js/Mantine. Seguir
steering `database-migrations.md` (migrate-prod.ts no mesmo commit) e
`ATENCAO-pontos-verificar.md` (filtro empresaId explícito). O motor de cálculo é
puro (testável por golden cases dos relatórios reais da Wega).

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Schema e migração idempotente" },
    { "wave": 2, "tasks": ["2"], "description": "Motor de cálculo puro (depende do schema)" },
    { "wave": 3, "tasks": ["3", "4"], "description": "Testes do motor (paralelo) e CRUD dos cadastros" },
    { "wave": 4, "tasks": ["5"], "description": "Rotas de calcular/aplicar/relatórios (depende do CRUD e motor)" },
    { "wave": 5, "tasks": ["6", "8"], "description": "Frontend do módulo e seed de referência (paralelo)" },
    { "wave": 6, "tasks": ["7"], "description": "Relatórios visuais (depende das telas base)" }
  ]
}
```

## Tasks

### 1. Schema e Migração (Backend)
- [x] 1.1 Adicionar ao `schema.prisma` os 8 models: MapaCusto, MapaCentro (renomeado de CentroCusto p/ não colidir com o CentroCusto contábil existente), BemDepreciar, FuncionarioCusto, DespesaCusto, ChaveRateio, DestinoRateio, ResultadoCentro. (Req 1–7)
- [x] 1.2 Validação do schema via `prisma generate` (o projeto não usa `migrate dev`; a fonte de verdade de produção é `migrate-prod.ts`). (Req 1)
- [x] 1.3 Replicado em `migrate-prod.ts`: CREATE TABLE IF NOT EXISTS das 8 tabelas + índices, idempotente (tabela `mapa_centro` no lugar de `centro_custo`, já usado pela Contabilidade). (Req 1)
- [x] 1.4 Rodado `npx tsx prisma/migrate-prod.ts` **2× no Postgres local (localhost)** — idempotente: "✅ Mapa de Custos RKW: ... criados" + "✅ All migrations applied successfully" nas duas execuções. (Req 1)
- [x] 1.5 `npx prisma generate` — validado (Prisma Client v6.19.3 gerado com sucesso). (Req 1)

### 2. Motor de Cálculo puro (Backend) — CONCLUÍDA
- [x] 2.1 Criado `src/modules/pcp/mapa-custo/mapa-custo-calculo.service.ts` com tipos I/O e `calcularMapa()`, tudo em Decimal. (Req 7)
- [x] 2.2 `depreciacaoBem`: (valor − valor×residual%/100) ÷ (anos×12) × fatorEstado (fatorEstado neutro=1, isolado p/ ajuste futuro). (Req 3.2)
- [x] 2.3 `custoFuncionario`: salário×(1+encargos%/100)+ajudaCusto; somado em A por centro. (Req 4.2, 4.4)
- [x] 2.4 `resolverChave`: MANUAL/HEADCOUNT/ATIVO/CENTRO/FUNCIONARIO → frações por centro; lança erro se Σ pesos ≤ 0. (Req 6.1–6.3)
- [x] 2.5 Rateio de despesas (C) e de funcionários rateados (A). (Req 5.2, 4.3)
- [x] 2.6 D=A+B+C e rateio 2º nível E (auxiliares) / F (administração) sobre produtivos. (Req 7.1, 7.2)
- [x] 2.7 G=D+E+F, horas=base×unidades+extras, Apurado=G/H, A Praticar=×(1+ajuste%), H=0 → N/A. (Req 7.3–7.6)
- [x] 2.8 Totais: custoFixoTotal, taxaAdministrativa, totalFuncionarios, ativoImobilizado, depreciacaoMensal. (Req 7.7, 3.4, 4.5)
- [x] 2.9 Idempotente (motor puro, não muta entrada, recalcula do zero). (Req 7.8)

### 3. Testes do Motor (golden cases + property-based)
- [x] 3.1 `mapa-custo-calculo.test.ts` (Vitest): golden cases (depreciação Roland 270,83; encargos 60%+ajuda; rateios MANUAL 50/50, 1×11=9,09%, HEADCOUNT 24/27; golden sintético ponta a ponta A→G+custo/hora; totais). Tolerância centavos. **27/27 passando.** (Req 3, 5, 6, 7)
- [x] 3.2 Property-based (fast-check): P1 conservação nível 0, P3 conservação 2 níveis, P4 custo/hora ≥ 0, P5 Apurado↔Praticar, P6 idempotência. Motor puro (sem I/O). **Passando.** (Req 6, 7)

### 4. Rotas CRUD dos cadastros do mapa (Backend)
- [x] 4.1 Criado `mapa-custo.routes.ts` (prefixo `/api/pcp/mapa-custo`) e registrado em `server.ts`. Filtro empresaId explícito + `moduloGuard('PCP')`. (Req 1.6)
- [x] 4.2 CRUD de MapaCusto: GET `/mapa-custo`, POST, GET `/:id` (com include), PATCH, POST `/:id/duplicar` (copia cadastros remapeando ids), POST `/:id/fechar`. Escrita bloqueada se FECHADO (409). (Req 1.1–1.5)
- [x] 4.3 CRUD de MapaCentro (`/:id/centros`): horasProdutivas calculada na gravação (unidades×base+extras) para produtivos. (Req 2)
- [x] 4.4 CRUD de BemDepreciar (`/:id/bens`): depreciacaoMensal calculada na gravação. (Req 3.1)
- [x] 4.5 CRUD de FuncionarioCusto (`/:id/funcionarios`) com flag rateado. (Req 4.1, 4.3)
- [x] 4.6 CRUD de DespesaCusto (`/:id/despesas`) com chaveRateioId. (Req 5.1)
- [x] 4.7 CRUD de ChaveRateio + DestinoRateio (`/:id/chaves`, destinos substituídos no PUT). (Req 6.1)

### 5. Rotas de cálculo, integração e relatórios (Backend)
- [x] 5.1 POST `/:id/calcular`: carrega cadastros, chama `calcularMapa`, persiste ResultadoCentro (deleteMany+create idempotente) e totais no MapaCusto; 400 se chave inválida. (Req 7)
- [x] 5.2 POST `/:id/aplicar-orcamento`: grava custoHoraPraticar em CentroProducao.custoHora dos centros vinculados (updateMany por empresaId); retorna aplicados vs pulados; permitido com FECHADO. (Req 8)
- [x] 5.3 GET `/:id/relatorios/composicao`, `/distribuicao` (ordenado desc + %), `/custo-hora` (só produtivos). (Req 9)

### 6. Frontend — Módulo PCP → Custos
- [x] 6.1 Página `/pcp/mapa-custo` — lista por competência com badge Rascunho/Fechado + criar/duplicar. (Req 10.1)
- [x] 6.2 Criação/duplicação via modal na lista (não precisou de rota `/novo` separada). (Req 1.1, 1.3)
- [x] 6.3 Página `/pcp/mapa-custo/[id]` — editor com abas Centros, Bens, Funcionários, Despesas, Chaves, Resultado (parâmetros editados na criação/PATCH). (Req 10.2)
- [x] 6.4 Aba Resultado: tabela Composição do Custo Hora (A→G+custo/hora) + cards de totais + botões Calcular, Fechar, Aplicar ao Orçamento. (Req 10.3, 10.4)
- [x] 6.5 Acesso aos endpoints via `api` (padrão do PCP: useState+api direto, sem hooks dedicados — consistente com o resto do módulo). (Req 10)
- [x] 6.6 Item "Mapa de Custos (RKW)" no menu lateral do PCP (ModuleSidebar). (Req 10)

### 7. Relatórios visuais / impressão
- [x] 7.1 Composição do Custo Hora — tabela A→G + custo/hora na aba Resultado. Endpoint `/relatorios/composicao` disponível. (Req 9.1)
- [x] 7.2 Distribuição do Custo Fixo — endpoint `/relatorios/distribuicao` (valor+% ordenado). Visualização dedicada pode ser adicionada depois se o usuário pedir. (Req 9.2)
- [x] 7.3 Mapa Custos/Hora — endpoint `/relatorios/custo-hora` + colunas Apurado/A Praticar na aba Resultado. (Req 9.3)

### 8. Seed / dados de referência (opcional, para validação)
- [x] 8.1 Fase `mapa` em `scripts/importar-calcgraf.ts` (`--fase mapa`): cria o MapaCusto de referência `2023-08` com os cadastros transcritos dos relatórios RI-1..RI-6 (15 centros, 15 bens, 16 funcionários, 19 despesas, 10 chaves). Idempotente (remove/recria RASCUNHO; não sobrescreve mapa FECHADO). Validado end-to-end contra o R1: Ativo Imobilizado R$ 5.800.200 (exato), Custo Fixo Total R$ 754.635 vs R$ 747.572 (99,1%), Taxa Administrativa 32,35% vs 31,7%, depreciação ~R$ 32.760 vs ~34.043. Diferenças (~1–4%) por agregação por centro em vez de bem-a-bem — dentro do esperado ("usar UMA foto oficial", ver Notes). (Req 7, calibração)

## Notes

- Dúvidas a confirmar (não bloqueiam; ver steering `migracao-calcgraf-carton-wega.md`): como o "Estado" do bem modula a depreciação (hoje fatorEstado neutro 1.0); reconciliação dos totais de custo fixo entre versões do mapa (usar UMA "foto" oficial como referência do golden case); o "+0,08" nos pesos da chave "Quant. funcionários".
- Sem alteração destrutiva no schema: `CentroProducao.custoHora` já existe e só recebe o valor "A Praticar".
- Todo cálculo em `Prisma.Decimal` (nunca `number`) — precisão monetária.
- Commit de schema deve incluir `migrate-prod.ts` junto (steering database-migrations).
