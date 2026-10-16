# Mapeamento do ROTEIRO/ETAPAS, MATERIAIS e VARIAÇÕES de uma OP do Calcgraf

Levantamento feito sobre o backup `CalcgrafCartonWega` (restaurado local), usando
a **OP 3000** como golden case — validado contra o print do Vizor (4 etapas) e o
documento/PDF do Calcgraf da mesma OP.

> Objetivo: estender o agente importador (`VisioFab.AgenteCalcgraf`) para trazer
> ETAPAS (roteiro), MATERIAIS completos e VARIAÇÕES — hoje o MVP só traz
> cabeçalho + materiais básicos + lotes/entregas.

## Descoberta-chave: o roteiro NÃO está nas tabelas `Op*`

As tabelas `Op*` (OpHeader/OpItem/OpItemEstrutura/OpComponente/OpSubItem/OpLote)
guardam só cabeçalho, materiais/componentes e lotes. **O roteiro de etapas vem
do CÁLCULO que originou a OP.** O vínculo é direto e confiável:

```
OpHeader.Numero = 3000  → OpHeader.Codigo = 3040
OpItemEstrutura (CodOpHeader=3040) → OpItemEstrutura.Codigo = 3040
CalculoHeader.CodOpItemEstrutura = 3040  ← ELO OP → CÁLCULO
  (pode haver +de 1 CalculoHeader com o mesmo CodOpItemEstrutura: o original e
   o recálculo. Usar o de MAIOR Codigo = mais recente. Ex.: 14585 e 14607 →
   usar 14607.)
```

## ETAPAS (roteiro) — `CalculoAtividades`

Fonte: `CalculoAtividades WHERE Codigo = <CalculoHeader.Codigo mais recente>`
ordenado por `itemSeq1, itemSeq2`. Cada linha é uma etapa.

Colunas usadas:
| Coluna | Uso |
|--------|-----|
| `tipo` | `I` = Impressão, `A` = Acabamento |
| `itemSeq1`, `itemSeq2` | sequência da etapa |
| `codAtividade` | → `Atividades.Codigo` (NOME da operação) |
| `codCentroCusto` | → `CentrosProducao.Codigo` (NOME da máquina/centro + Processo/Tipo) |
| `quantAcertos`, `tempoPorAcerto`, `tempoPrimeiroAcerto` | **setup (min)** = `quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto` |
| `producaoHora`, `tiragem` | **operação (min)** = `tiragem / producaoHora * 60` |

### Golden case OP 3000 (calc 14607) — bate 100% com o print do Vizor
```
tipo seq codAtv codCC  entradas prodHora qAcertos tPorAcerto tPrim  tiragem
I    0   2      4      1        2000     2        30         0      100000   → Impressão Offset Plana / Roland RZU 2cores
A    0   8      5      1        3000     1        0          15     100000   → Cortadeira (Grande)
A    1   19     16     1        2000     1        0          0      100000   → Guilhotina de envol
A    2   37     19     1        800      1        0          0      100000   → Laminação maior / Plastificadora maior
```
- `Atividades`: 2=Offset Plana, 8=Cortadeira (Grande), 19=Guilhotina de envol, 37=Laminação maior.
- `CentrosProducao`: 4=Roland RZU 2cores (Impressão/Offset Plana), 5=Cortadeira (Grande),
  16=Guilhotina de envol, 19=Plastificadora maior.
- Nome da etapa no Vizor = `"<Atividade.Nome> <CentroProducao.Nome>"` (ex.:
  "Impressão - Offset Plana Roland RZU 2cores").

## VARIAÇÕES / PLANOS — `CalculoPlanos`

Fonte: `CalculoPlanos WHERE Codigo = <calc>`. Cada plano é uma variação/
componente (ex.: TAMPA/CAIXA, ou frente/costa). Para a 3000 há 1 plano
"Impressos".

Colunas: `codPlano, nomePlano, codSuporte, gramatura, dimensao1, dimensao2,
aproveitamento, tiragem, quantModelos`.
Golden 3000: `1|Impressos|Stora Enzo Bobina|322g|185x1150|aprov=3|tir=100000`.

> **CORREÇÃO (validação 15/10/2026):** `CalculoPlanos` **NÃO tem coluna
> `Ordem`** (nem `CodItemEstoque`). Ordenar por `codPlano`. Nome do papel vem
> de `Suportes.Nome` (JOIN por `codSuporte = Suportes.Codigo`).

## MATERIAIS — tintas + papel + mat. acabamento (do cálculo)

- **Papel/suporte**: `CalculoPlanos.codSuporte` → cadastro de suporte (nome do papel).
  Golden 3000: suporte 8 = "Stora Enzo Bobina 322".
- **Tintas**: `CalculoTintas WHERE Codigo=<calc>` → `codTinta`, `areaTinta` (% de
  cobertura), `ComplementoNome` (nome Pantone). Golden 3000:
  `4|85|AMARELO - 123C` + `5|15|VERDE - CW0138` (bate EXATO com o PDF).
- **Mat. acabamento**: `CalculoMatAcabamento WHERE Codigo=<calc>` → `CodMaterial`,
  `codAtvAcabamento` (liga à etapa de acabamento). Golden 3000: `14|37` (material
  da laminação = BOPP Brilho do PDF).

  > **CORREÇÃO (validação 15/10/2026):** `CalculoMatAcabamento` **NÃO tem
  > coluna de quantidade** (só `CodMaterial`, `codAtvAcabamento`,
  > `codPlanoAcabado`, params de acabamento). O nome do material vem de
  > **`Itc.Descritivo`** (JOIN `Itc.Codigo = CodMaterial`) — a tabela `Itc`
  > **NÃO tem coluna `Nome`**; o campo de nome é `Descritivo`. Tintas:
  > `CalculoTintas` tem `Codigo, codTinta, areaTinta, ComplementoNome` (ok).

## ENTREGAS — `OpLote` (JÁ IMPLEMENTADO)

`OpLote WHERE CodOpItemEstrutura = OpItemEstrutura.Codigo` → `Tiragem`,
`DataPrometida`, `OrdemFilaOp`, `Status`. Golden 3000: 1 lote, tiragem 100000.

## Plano de implementação (agente + backend)

1. **Reader do agente** (`calcgraf-reader.ts`): após achar as OpHeader, para cada
   OP resolver `CalculoHeader.CodOpItemEstrutura = OpItemEstrutura.Codigo` (maior
   Codigo). Ler `CalculoAtividades` (etapas), `CalculoPlanos` (variações+papel),
   `CalculoTintas` + `CalculoMatAcabamento` (materiais). Resolver nomes com
   `Atividades`, `CentrosProducao`, cadastro de suporte, catálogo de tinta.
   Montar no DTO: `etapas[]` (sequencia, centro, descricao, setupMin, operacaoMin),
   `variacoes[]`, `materiais[]` enriquecidos. SEQUENCIAL (tedious = 1 req/conexão).
2. **Backend** (`ingestao-op-calcgraf.service.ts`): `criarEtapas` já existe; passar
   a gravar centro/tempos. Criar `VariacaoOrdemProducao` a partir de `variacoes[]`.
   Resolver `CentroProducao` por nome (como o importador de PDF faz) ou criar.
3. **Hash**: incluir etapas/variações no `calcularHashOp` (os dois lados) para a
   idempotência refletir mudança de roteiro.
4. Validar contra a OP 3000 (4 etapas) e algumas outras do backup.

## VALIDAÇÃO da regra (feita 16/10/2026, sobre o backup — 3193 OPs ativas)

- **Regra confirmada**: `CalculoHeader` de **maior `Codigo`** com
  `CodOpItemEstrutura = OpItemEstrutura.Codigo` é o cálculo correto (original +
  recálculo coexistem; o recálculo tem Codigo maior).
- Amostra 3120–3138: todas com 2 CalculoHeader; o recente tem de 3 a 21 etapas
  (coerente com a complexidade do produto).
- Varredura geral das 3193 OPs ativas:
  - **39 OPs** NÃO acham cálculo (`calcRecente IS NULL`) — provável OP avulsa/
    sem orçamento. Para essas, o importador mantém o comportamento atual
    (cabeçalho + materiais, SEM etapas do cálculo). ~1,2% — caso de borda aceito.
  - **0 OPs** têm cálculo recente com 0 atividades. Ou seja: TEM cálculo ⇒ TEM
    etapas. A cobertura do roteiro é ~98,8%.
- Query de validação (reproduzível): `WITH ops AS (SELECT ... MAX(ch.Codigo) ...
  FROM OpHeader h JOIN OpItemEstrutura e ... )` contando `calcRecente IS NULL` e
  `CalculoAtividades = 0`.
