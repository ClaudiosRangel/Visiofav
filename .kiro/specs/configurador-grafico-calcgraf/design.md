# Design — Configurador Gráfico (paridade Calcgraf) + Demonstração do CalculoSTC

> Base: `requirements.md` desta spec + steering
> `.kiro/steering/migracao-calcgraf-carton-wega.md`. Levantamento factual do
> schema do Calcgraf feito direto na base restaurada `CalcgrafCartonWega`.

## Overview

O objetivo é dar ao Vizor **acesso fácil e edição caso a caso** das configurações
de cálculo gráfico que hoje vivem no Calcgraf, e **demonstrar** (somente leitura)
a memória de custo por componente registrada no `CalculoSTC`.

Princípio central (já alinhado): **configuração = entrada editável**;
**`CalculoSTC` = saída/memória congelada (evidência, nunca editável)**. O design
reusa ao máximo os cadastros que o Vizor já tem e só cria estrutura nova onde há
lacuna real (3 lacunas: crédito fiscal do papel, tabela de custo por
vigência/coluna, tributação por operação).

Não-objetivos: reescrever o motor de cálculo; alterar a ancoragem (diferença zero
nos repetidos); editar o `CalculoSTC`/foto.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Frontend (Next 15 + Mantine 7) — módulo Orçamento Gráfico             │
│                                                                        │
│  Cadastros ▸ Configurador Gráfico                                      │
│   ├─ Itens de Custo (visão unificada por Origem)      [Req 2]          │
│   ├─ Papel/Suporte + Crédito Fiscal                   [Req 3.1–3.3]    │
│   ├─ Máquinas / Acabamentos                           [Req 3.4–3.5]    │
│   ├─ Tributação & Margens                             [Req 3.6]        │
│   └─ Tabelas de Custo (versões por vigência)          [Req 4]          │
│                                                                        │
│  Biblioteca de Cálculos ▸ [cálculo] ▸ Memória STC     [Req 5]          │
│   └─ read-only: componentes → MD/CT/SE → C.Prod                        │
└───────────────┬────────────────────────────────────────────────────────┘
                │ Axios (Bearer; empresa ativa na sessão)
┌───────────────▼────────────────────────────────────────────────────────┐
│ Backend (Fastify + Prisma + Zod) — prefixo /api                        │
│                                                                        │
│  configurador-grafico/ (módulo novo)                                   │
│   ├─ itens-custo.routes.ts        (visão unificada por Origem)         │
│   ├─ tabela-custo.routes.ts       (CRUD versões + vigência)            │
│   ├─ tributacao-grafica.routes.ts (CRUD tributação por operação)       │
│   └─ services puros:                                                   │
│       ├─ credito-fiscal.service.ts   (preço líquido do crédito)        │
│       ├─ vigencia-tabela.service.ts  (sobreposição + versão vigente)   │
│       └─ itens-custo-view.service.ts (unifica cadastros por Origem)    │
│                                                                        │
│  orcamento-grafico/calculo-grafico/                                    │
│   ├─ decomposicao-stc.service.ts  (JÁ EXISTE — reusar p/ memória STC)  │
│   └─ memoria-stc.routes.ts        (GET read-only, novo)                │
└───────────────┬────────────────────────────────────────────────────────┘
                │ Prisma (empresaId EXPLÍCITO em toda query)
┌───────────────▼────────────────────────────────────────────────────────┐
│ PostgreSQL (Neon)                                                      │
│  Reuso: PrecoMateriaPrima, SuporteGrafico, CentroProducao,             │
│         AcabamentoGrafico, TabelaMargem, Parametro, CalculoGrafico     │
│  Novo:  TabelaCustoGrafico, TabelaCustoGraficoItem, TributacaoGrafica  │
│  Coluna nova: PrecoMateriaPrima.creditoPisCofinsPercent                │
└──────────────────────────────────────────────────────────────────────┘
```

Decisão de fundo: **não** criar um model espelho do `Itc` (2.300+ linhas) no
Vizor. O catálogo de "itens de custo por Origem" (Req 2) é uma **VISÃO unificada**
derivada dos cadastros que já existem — ver seção 4.2. Isso evita duplicar dado e
manter dois lugares de verdade.

## 3. De-para Calcgraf → Vizor (Req 1)

Será entregue também como documento `docs/calcgraf-config-de-para.md` (fonte única
para a migração). Resumo:

| Configuração (Calcgraf) | Conteúdo | Model Vizor | Status |
|---|---|---|---|
| `Itc` (Origem SUPORTE) | papel/suporte | `PrecoMateriaPrima` (tipo PAPEL) + `SuporteGrafico` | ✅ existe |
| `Itc` (Origem TINTA) | tinta | `PrecoMateriaPrima` (tipo TINTA) | ✅ existe |
| `Itc` (Origem MAT.ACABAMENTO) | BOPP/laminação | `AcabamentoGrafico` (MATERIAL) | ✅ existe |
| `Itc` (Origem MATRIZ IMPRESSÃO) | chapas/matriz | `AcabamentoGrafico`/itens diversos | ✅ parcial |
| `Itc` (Origem CENTRO DE CUSTO) | máquina (custo-hora) | `CentroProducao` (custoHora/velocidade/acerto) | ✅ existe |
| `Itc` (Origem SERVIÇO EXTERNO) | serviço terceiro | itensDiversos/servicosExternos | ✅ parcial |
| `TabelasCusto` + `Detalhe` | **preço por vigência/coluna** | — | ⚠️ **LACUNA** → `TabelaCustoGrafico(+Item)` |
| Crédito fiscal no papel | **PIS/COFINS 9,25% no MD** | — | ⚠️ **LACUNA** → `PrecoMateriaPrima.creditoPisCofinsPercent` |
| `TributacaoVenda` | **tributação por operação** (ICMS/IPI/PIS-COFINS/CBS, flags de crédito) | — | ⚠️ **LACUNA** → `TributacaoGrafica` |
| `CalculoTaxas` | taxas por cálculo (CodTaxa 2/−7/−10) | `TabelaMargem` (markup/impostos/comissão) + CEV do motor | ✅ parcial |
| `Agrupamentos` (1/2/3) | CT/MD/SE | constante no motor/decomposição | ✅ existe |
| `CalculoSTC` | **memória de custo (SAÍDA)** | `CalculoGrafico.custosCalcgraf` (JSON) | ✅ existe (não é config) |

As 3 lacunas viram as estruturas novas da seção 4. O resto é tela de
visualização/edição sobre o que já existe.

## Data Models

> Regra do projeto (steering `database-migrations`): toda alteração em
> `schema.prisma` entra no MESMO commit que a alteração idempotente equivalente
> em `prisma/migrate-prod.ts` (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT
> EXISTS` / `CREATE INDEX IF NOT EXISTS`). Testar 2× local antes do push.

### 4.1 Coluna nova — crédito fiscal do papel (Req 3.2/3.3)

```prisma
model PrecoMateriaPrima {
  // ...campos existentes...
  // Crédito de PIS/COFINS (%) descontado do custo do material direto, como o
  // Calcgraf faz (origem: TributacaoVenda.FlagCredPisCofins). Null/0 = sem crédito.
  creditoPisCofinsPercent Decimal? @map("credito_pis_cofins_percent") @db.Decimal(5, 2)
}
```

migrate-prod: `ALTER TABLE "preco_materia_prima" ADD COLUMN IF NOT EXISTS "credito_pis_cofins_percent" DECIMAL(5,2)`.

### 4.2 Itens de Custo por Origem — VISÃO (Req 2), sem tabela nova

Não há model novo. Um service unifica os cadastros existentes numa lista com
`origem` derivada da fonte:

| Fonte Vizor | Origem derivada |
|---|---|
| `PrecoMateriaPrima` tipo PAPEL | SUPORTE |
| `PrecoMateriaPrima` tipo TINTA | TINTA |
| `AcabamentoGrafico` natureza MATERIAL | MAT.ACABAMENTO |
| `CentroProducao` | CENTRO DE CUSTO |
| `AcabamentoGrafico`/serviço externo | SERVICO EXTERNO |

Grupo MD/CT/SE derivado da Origem (regra do Req 2.3). A edição de cada item
redireciona para o cadastro de origem (papel, máquina, acabamento) — a visão é de
leitura+navegação; a escrita acontece no cadastro específico (Req 3).

### 4.3 Tabela de Custo por vigência/coluna (Req 4) — models novos

```prisma
/// Versão de tabela de custo gráfico com validade por período (paridade
/// TabelasCusto do Calcgraf). Não pode haver vigência sobreposta na mesma empresa.
model TabelaCustoGrafico {
  id             String    @id @default(uuid())
  empresaId      String    @map("empresa_id")
  nome           String    @db.VarChar(100)
  vigenciaInicio DateTime  @map("vigencia_inicio") @db.Date
  vigenciaFim    DateTime? @map("vigencia_fim") @db.Date   // null = aberto
  ativo          Boolean   @default(true)
  criadoEm       DateTime  @default(now()) @map("criado_em")
  atualizadoEm   DateTime  @updatedAt @map("atualizado_em")

  itens TabelaCustoGraficoItem[]

  @@index([empresaId, vigenciaInicio])
  @@map("tabela_custo_grafico")
}

/// Valor de um item de custo numa versão de tabela, por COLUNA (1..4) e por tipo
/// de valor (as 6 colunas de valor do TabelasCustoDetalhe do Calcgraf).
model TabelaCustoGraficoItem {
  id            String  @id @default(uuid())
  tabelaId      String  @map("tabela_id")
  empresaId     String  @map("empresa_id")           // denormalizado p/ filtro
  // Referência ao item de custo (papel/tinta/máquina/acabamento) do Vizor.
  // itemTipo + itemId apontam para o cadastro de origem; itemCodigo/descricao p/ exibição.
  itemTipo      String  @db.VarChar(20)              // SUPORTE|TINTA|MAT_ACABAMENTO|CENTRO_CUSTO|...
  itemId        String? @map("item_id")              // id do cadastro de origem (quando houver)
  itemCodigo    String? @map("item_codigo") @db.VarChar(60)
  itemDescricao String? @map("item_descricao") @db.VarChar(200)
  coluna        Int                                   // 1..4
  valorTotal         Decimal? @map("valor_total")         @db.Decimal(14, 4)
  valorDireto        Decimal? @map("valor_direto")        @db.Decimal(14, 4)
  valorDepreciacao   Decimal? @map("valor_depreciacao")   @db.Decimal(14, 4)
  valorAdministracao Decimal? @map("valor_administracao") @db.Decimal(14, 4)
  valorOutros        Decimal? @map("valor_outros")        @db.Decimal(14, 4)
  valorFreteKg       Decimal? @map("valor_frete_kg")      @db.Decimal(14, 4)

  tabela TabelaCustoGrafico @relation(fields: [tabelaId], references: [id], onDelete: Cascade)

  @@index([tabelaId])
  @@index([empresaId, itemTipo])
  @@map("tabela_custo_grafico_item")
}
```

### 4.4 Tributação por operação (Req 3.6) — model novo

```prisma
/// Tributação por operação (paridade TributacaoVenda do Calcgraf). Alimenta o
/// CEV e os flags de crédito (incl. PIS/COFINS do papel e papel imune).
model TributacaoGrafica {
  id                 String   @id @default(uuid())
  empresaId          String   @map("empresa_id")
  nome               String   @db.VarChar(60)        // "ICMS + IPI", "ISS", ...
  ativo              Boolean  @default(true)
  aliquotaImposto    Decimal  @default(0) @map("aliquota_imposto")  @db.Decimal(6, 2) // ICMS %
  aliquotaIpi        Decimal  @default(0) @map("aliquota_ipi")      @db.Decimal(6, 2)
  pisCofinsPercent   Decimal  @default(0) @map("pis_cofins_percent") @db.Decimal(6, 2) // 9,25
  comissaoPercent    Decimal  @default(0) @map("comissao_percent")   @db.Decimal(6, 2)
  flagCredIcms       Boolean  @default(false) @map("flag_cred_icms")
  flagCredIpi        Boolean  @default(false) @map("flag_cred_ipi")
  flagCredPisCofins  Boolean  @default(false) @map("flag_cred_pis_cofins")
  flagPapelImune     Boolean  @default(false) @map("flag_papel_imune")
  prazoFinanciamento Int      @default(0) @map("prazo_financiamento")
  criadoEm           DateTime @default(now()) @map("criado_em")
  atualizadoEm       DateTime @updatedAt @map("atualizado_em")

  @@index([empresaId, ativo])
  @@map("tributacao_grafica")
}
```

migrate-prod: 3 `CREATE TABLE IF NOT EXISTS` + índices + 1 `ADD COLUMN`.

## 5. Serviços puros (testáveis sem Prisma)

### 5.1 `credito-fiscal.service.ts` (Req 3.3)
```ts
// Preço líquido = preço bruto dividido pelo fator do crédito (como o Calcgraf).
// Ex.: 7,45 com 9,25% → 7,45 / 1,0925 = 6,82(1...) → arredonda 2 casas = 6,83.
export function precoLiquidoCredito(precoBruto: number, creditoPercent: number): number {
  if (!(creditoPercent > 0)) return round2(precoBruto)
  return round2(precoBruto / (1 + creditoPercent / 100))
}
```
Property-based (fast-check): preço líquido ≤ bruto; crédito 0 → líquido = bruto;
monotonicidade (crédito maior → líquido menor).

### 5.2 `vigencia-tabela.service.ts` (Req 4.3/4.6)
```ts
export interface Vigencia { inicio: Date; fim: Date | null } // fim null = aberto
// Duas vigências se sobrepõem se [iniA,fimA] ∩ [iniB,fimB] ≠ ∅ (fim null = +∞).
export function sobrepoe(a: Vigencia, b: Vigencia): boolean
// Seleciona a versão vigente numa data; retorna no máximo UMA (invariante garantido
// pelo bloqueio de sobreposição). undefined se nenhuma cobre a data (Req 4.4).
export function versaoVigenteNaData<T extends Vigencia>(versoes: T[], data: Date): T | undefined
```
Property-based: sem sobreposição ⇒ `versaoVigenteNaData` retorna 0 ou 1; nunca 2+.

### 5.3 `itens-custo-view.service.ts` (Req 2)
`montarItensCusto(cadastros)` → lista unificada `{ origem, grupo, codigo, descricao,
valor, fonteTipo, fonteId }`. `grupoDaOrigem(origem)` aplica a regra MD/CT/SE
(reusa a mesma lógica de `decomposicao-stc.service.ts`). Puro.

### 5.4 Reuso — `decomposicao-stc.service.ts` (Req 5)
Já existe (`normalizarCustosStc`/`aplicarDecomposicaoStc`). A memória STC reusa
`normalizarCustosStc(calc.custosCalcgraf)` para agrupar MD/CT/SE e ligar cada
componente à Origem. Nada novo no cálculo.

## Components and Interfaces

> Esta seção consolida as rotas/serviços (backend) e as telas (frontend).

### Rotas / Serviços (backend) — módulo `configurador-grafico/`

Prefixo `/api/configurador-grafico` (ou dentro de `/api/orcamento-grafico`),
`authenticate` + filtro `empresaId` EXPLÍCITO em toda query.

| Método | Rota | Descrição | Req |
|---|---|---|---|
| GET | `/itens-custo` | visão unificada por Origem (filtros: origem, busca) | 2 |
| GET | `/tabelas-custo` | lista versões da empresa | 4.5 |
| POST | `/tabelas-custo` | cria versão; **409 se vigência sobrepõe** | 4.3 |
| PUT | `/tabelas-custo/:id` | edita versão; revalida sobreposição | 4.3 |
| GET | `/tabelas-custo/vigente?data=` | versão vigente na data (ou 404 "sem vigência") | 4.4/4.6 |
| GET/POST/PUT | `/tributacao` | CRUD tributação por operação | 3.6 |
| PUT | `/papel/:id/credito-fiscal` | grava `creditoPisCofinsPercent` + retorna preço líquido | 3.2/3.3 |
| GET | `/calculo-grafico/:id/memoria-stc` | **read-only** memória STC (MD/CT/SE + componentes + Origem) | 5 |

Edição de máquina/acabamento/margem reusa as rotas de cadastro já existentes
(CentroProducao, AcabamentoGrafico, TabelaMargem) — não recriar.

`GET /memoria-stc` resposta (exemplo 12992):
```json
{
  "numeroCalcgraf": 12992,
  "materialDireto": 4113.94, "custoTransformacao": 1078.11, "servicoExterno": 0,
  "custoProducao": 5192.05,
  "componentes": [
    { "origem": "SUPORTE", "grupo": "MD", "descricao": "Stora Enzo Bobina 415", "valorTotal": 3010.75 },
    { "origem": "CENTRO DE CUSTO", "grupo": "CT", "descricao": "Offset Plana Roland RVU 4 cores", "valorTotal": 732.79 }
    // ... (10 componentes no total)
  ],
  "temMemoria": true
}
```
Se `custosCalcgraf` nulo → `{ temMemoria: false }` (Req 5.7).

### Telas (frontend) — módulo Orçamento Gráfico ▸ Cadastros

- **Itens de Custo** (`/orcamento-grafico/configurador/itens-custo`): grid Mantine
  com coluna Origem + badge MD/CT/SE; filtro por Origem; clique abre o cadastro de
  origem para editar. (Req 2)
- **Papel/Suporte + Crédito Fiscal**: na tela de preços de material, campo
  "Crédito PIS/COFINS %" + exibição do preço líquido calculado ao lado do bruto.
  (Req 3.1–3.3)
- **Tributação & Margens** (`/.../configurador/tributacao`): CRUD das operações
  (alíquotas, flags de crédito, papel imune). (Req 3.6)
- **Tabelas de Custo** (`/.../configurador/tabelas-custo`): lista de versões com
  vigência; ao salvar com sobreposição → erro claro de conflito. (Req 4)
- **Memória STC** (na Biblioteca de Cálculos, botão no detalhe do cálculo OU na
  Revisão do item): painel read-only com os componentes agrupados em MD/CT/SE,
  subtotais e C.Prod, cada linha mostrando a Origem. Reusa o `custosCalcgraf`.
  (Req 5)

## 8. Fórmulas-chave
- **Crédito fiscal do papel**: `precoLiquido = precoBruto / (1 + credito%/100)`.
  12992: 7,45 / 1,0925 = 6,83.
- **Grupo por Origem**: SUPORTE|TINTA|MAT.ACABAMENTO|MATRIZ IMPRESSÃO → MD;
  CENTRO DE CUSTO → CT; SERVIÇO EXTERNO → SE.
- **C.Prod (demonstração)**: `MD + CT + SE` = soma dos componentes do STC
  (12992 = 4.113,94 + 1.078,11 + 0 = 5.192,05).
- **Versão vigente**: maior `vigenciaInicio` cuja faixa cobre a data; com bloqueio
  de sobreposição, há no máximo uma.

## Correctness Properties

Propriedades verificáveis (property-based com fast-check) dos serviços puros.

### Property 1: Crédito reduz ou mantém o preço
`precoLiquidoCredito(p, c) <= p` para todo `p >= 0, c >= 0`; e `c == 0 ⇒ líquido == p`.
**Validates: Requirements 3.2, 3.3**

### Property 2: Monotonicidade do crédito
`c1 < c2 ⇒ precoLiquido(p,c1) >= precoLiquido(p,c2)`.
**Validates: Requirements 3.3**

### Property 3: Golden do crédito (fórmula pura + preço real do papel)
A fórmula pura `bruto/(1+c)` com 9,25% sobre 7,45 dá **6,82**. O preço EFETIVO do
papel no 12992 é **6,83**, que corresponde a um crédito de **~9,08%**
(7,45/6,83 = 1,0908) — o "6,83 = 7,45÷1,0925" era aproximação. O percentual é
parametrizável por papel para acomodar o valor real: `precoLiquidoCredito(7.45, 9.08) == 6.83`.
**Validates: Requirements 3.3**

### Property 4: Sem sobreposição ⇒ no máximo uma versão vigente
Dado um conjunto de versões em que nenhum par sobrepõe, `versaoVigenteNaData`
retorna 0 ou 1 versão, nunca 2+.
**Validates: Requirements 4.3, 4.6**

### Property 5: Sobreposição é detectada e simétrica
`sobrepoe(a,b) == sobrepoe(b,a)` e é verdadeira sse as faixas se intersectam
(fim null = +∞).
**Validates: Requirements 4.3**

### Property 6: C.Prod = MD + CT + SE
Na memória STC, a soma dos subtotais por grupo = custo de produção, para qualquer
conjunto de componentes.
**Validates: Requirements 5.3**

### Property 7: Golden STC 12992
MD 4.113,94 + CT 1.078,11 + SE 0 = 5.192,05.
**Validates: Requirements 5.4**

### Property 8: Classificação total por Origem
Todo item da visão recebe exatamente um grupo MD/CT/SE conforme a Origem.
**Validates: Requirements 2.3**

## Error Handling

- **Vigência sobreposta** (Req 4.3): POST/PUT de tabela de custo retorna **409**
  com mensagem indicando a versão conflitante (nome + faixa de vigência).
- **Sem vigência na data** (Req 4.4): GET `/tabelas-custo/vigente` retorna **404**
  com indicação de ausência de tabela vigente para a data.
- **Origem inválida** (Req 2.4): salvar item com Origem fora do conjunto → **400**
  listando os valores válidos.
- **Acesso cross-tenant** (Req 6.2): registro de outra empresa → **403/404**
  (padrão do projeto), nunca retornar o dado.
- **Cálculo sem memória STC** (Req 5.7): `/memoria-stc` retorna `temMemoria:false`
  (200), o front exibe "sem memória de custo registrada".
- Erros de validação Zod são mapeados para 400 com campo+motivo (padrão do módulo).

## Testing Strategy
- **Vitest + fast-check** (puros): `credito-fiscal` (P1–P3), `vigencia-tabela`
  (P4–P5), `itens-custo-view` (P8), e golden da memória STC 12992 (P6–P7)
  reusando `normalizarCustosStc`.
- **Rotas**: 409 em vigência sobreposta; 404 "sem vigência"; read-only do
  `/memoria-stc`; isolamento por empresaId; 400 em Origem inválida.
- Rodar via `control_pwsh_process` + `--reporter=dot` (steering). Validar arquivos
  tocados com `get_diagnostics` (tsc inteiro trava nesta máquina).

## 10. Multi-tenant & Não-regressão
- `empresaId` EXPLÍCITO em TODA query (não confiar só no `prismaScoped` — bypass
  SUPER_ADMIN; steering ATENCAO-pontos-verificar §2.1). Acesso a registro de outra
  empresa → negado (Req 6.2).
- O motor `calcularOrcamentoGrafico` e a `ancorarCustoCalcgraf` NÃO são alterados;
  a demonstração STC é somente leitura sobre `custosCalcgraf` (Req 7.4). 12992
  permanece 5.192,05 (Req 7.3). As novas configs só afetam cálculos que as usarem
  (Req 7.2).

## 11. Sequência de implementação sugerida
1. Doc de-para `docs/calcgraf-config-de-para.md` (Req 1).
2. Services puros + testes (crédito fiscal, vigência, itens-custo-view).
3. Schema + migrate-prod (coluna crédito + 3 tabelas novas) no mesmo commit.
4. Rotas backend (itens-custo, tabelas-custo, tributação, crédito-fiscal, memória-stc).
5. Telas frontend (Cadastros do Orçamento Gráfico + painel Memória STC).
6. Golden/validação 12992 na API + não-regressão da suíte orcamento-grafico.
