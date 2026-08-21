# Módulo de Orçamento Gráfico — Design Técnico

## Arquitetura

O módulo segue a mesma stack do projeto:
- **Backend**: Fastify + Prisma + PostgreSQL (Neon)
- **Frontend**: Next.js 15 + Mantine 7 + React Query

## Modelos de Dados (Prisma)

### Novos Models

```prisma
// Tipo de Embalagem ("Especialista" de cálculo)
model TipoEmbalagem {
  id                    String   @id @default(uuid())
  empresaId             String   @map("empresa_id")
  codigo                String   @db.VarChar(30)
  descricao             String   @db.VarChar(200)
  // Fórmulas de planificação (expressão matemática)
  formulaLargura        String   @map("formula_largura") @db.Text
  formulaAltura         String   @map("formula_altura") @db.Text
  // Parâmetros exigidos pelo wizard (JSON array)
  parametros            Json     // [{nome, label, unidade, obrigatorio, default}]
  // Processos obrigatórios (ex: ["IMPRESSAO", "CORTE_VINCO", "COLAGEM"])
  processosObrigatorios String[] @map("processos_obrigatorios")
  // Defaults (mm)
  abaColagemMm          Decimal  @default(15) @map("aba_colagem_mm") @db.Decimal(6,2)
  sangriaMm             Decimal  @default(3) @map("sangria_mm") @db.Decimal(6,2)
  pincaMm               Decimal  @default(10) @map("pinca_mm") @db.Decimal(6,2)
  imagemUrl             String?  @map("imagem_url") @db.Text
  status                Boolean  @default(true)
  criadoEm              DateTime @default(now()) @map("criado_em")
  atualizadoEm          DateTime @updatedAt @map("atualizado_em")

  orcamentos OrcamentoGrafico[]

  @@unique([empresaId, codigo])
  @@map("tipo_embalagem")
}

// Preço de Matéria-Prima
model PrecoMateriaPrima {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  produtoId     String?  @map("produto_id") // FK opcional para Produto existente
  descricao     String   @db.VarChar(200)
  tipo          String   @db.VarChar(20) // PAPEL, TINTA, VERNIZ, COLA, FACA, BOPP, OUTRO
  unidade       String   @db.VarChar(6) // KG, M2, UN, LT
  precoUnitario Decimal  @map("preco_unitario") @db.Decimal(12,4)
  fornecedorId  String?  @map("fornecedor_id")
  dataVigencia  DateTime @default(now()) @map("data_vigencia")
  status        Boolean  @default(true)
  criadoEm      DateTime @default(now()) @map("criado_em")
  atualizadoEm  DateTime @updatedAt @map("atualizado_em")

  @@map("preco_materia_prima")
}

// Parâmetros de Perda por Processo
model ParametroPerda {
  id               String  @id @default(uuid())
  empresaId        String  @map("empresa_id")
  tipoProcessoId   String? @map("tipo_processo_id") // FK TipoProcesso
  centroProducaoId String? @map("centro_producao_id") // opcional: perda específica por máquina
  perdaFixaFolhas  Int     @default(0) @map("perda_fixa_folhas") // folhas de acerto
  perdaVariavel    Decimal @default(5) @map("perda_variavel") @db.Decimal(5,2) // %
  criadoEm         DateTime @default(now()) @map("criado_em")

  @@unique([empresaId, tipoProcessoId, centroProducaoId])
  @@map("parametro_perda")
}

// Tabela de Margem / Política Comercial
model TabelaMargem {
  id          String  @id @default(uuid())
  empresaId   String  @map("empresa_id")
  nome        String  @db.VarChar(100)
  markup      Decimal @default(30) @db.Decimal(5,2) // % padrão
  impostos    Decimal @default(15) @db.Decimal(5,2) // %
  comissao    Decimal @default(5) @db.Decimal(5,2) // %
  despAdm     Decimal @default(5) @map("desp_adm") @db.Decimal(5,2) // %
  descontoMax Decimal @default(10) @map("desconto_max") @db.Decimal(5,2) // %
  status      Boolean @default(true)
  criadoEm    DateTime @default(now()) @map("criado_em")

  @@unique([empresaId, nome])
  @@map("tabela_margem")
}

// O Orçamento em si
model OrcamentoGrafico {
  id               String   @id @default(uuid())
  empresaId        String   @map("empresa_id")
  numero           Int
  versao           Int      @default(1)
  clienteId        String?  @map("cliente_id")
  clienteNome      String?  @map("cliente_nome") @db.VarChar(200) // para prospects
  vendedorId       String?  @map("vendedor_id")
  tipoEmbalagemId  String   @map("tipo_embalagem_id")
  tipoEmbalagem    TipoEmbalagem @relation(fields: [tipoEmbalagemId], references: [id])
  // Medidas informadas pelo vendedor (JSON)
  medidas          Json     // {L: 80, A: 150, P: 40, ...}
  // Resultados do cálculo (JSON completo)
  resultadoCalculo Json?    @map("resultado_calculo")
  // Parâmetros escolhidos
  papelId          String?  @map("papel_id")
  papelDescricao   String?  @map("papel_descricao") @db.VarChar(200)
  gramatura        Decimal? @db.Decimal(6,2)
  numCores         Int      @default(4) @map("num_cores")
  cores            Json?    // [{nome, tipo, cobertura%}]
  acabamentos      Json?    // [{tipo, parametros}]
  quantidade       Int
  // Valores calculados
  custoMaterial    Decimal? @map("custo_material") @db.Decimal(12,2)
  custoMaquina     Decimal? @map("custo_maquina") @db.Decimal(12,2)
  custoAcabamento  Decimal? @map("custo_acabamento") @db.Decimal(12,2)
  custoTotal       Decimal? @map("custo_total") @db.Decimal(12,2)
  precoVenda       Decimal? @map("preco_venda") @db.Decimal(12,2)
  precoUnitario    Decimal? @map("preco_unitario") @db.Decimal(12,4)
  margemReal       Decimal? @map("margem_real") @db.Decimal(5,2)
  // Status e fluxo
  status           String   @default("RASCUNHO") @db.VarChar(20) // RASCUNHO, ENVIADO, APROVADO, RECUSADO, VENCIDO
  validadeAte      DateTime? @map("validade_ate")
  motivoRecusa     String?  @map("motivo_recusa") @db.Text
  aprovadoEm       DateTime? @map("aprovado_em")
  pedidoVendaId    String?  @map("pedido_venda_id") // gerado ao aprovar
  // Variações de tiragem (simulações)
  variacoes        Json?    // [{quantidade, precoUnitario, precoTotal}]
  observacoes      String?  @db.Text
  criadoPorId      String   @map("criado_por_id")
  criadoEm         DateTime @default(now()) @map("criado_em")
  atualizadoEm     DateTime @updatedAt @map("atualizado_em")

  @@unique([empresaId, numero, versao])
  @@map("orcamento_grafico")
}
```

### Alterações em Models Existentes

```prisma
// CentroProducao — campos adicionais para orçamento
model CentroProducao {
  // ... campos existentes ...
  velocidade          Decimal? @db.Decimal(10,2) // folhas/hora ou metros/hora
  unidadeVelocidade   String?  @map("unidade_velocidade") @db.VarChar(20) // FOLHAS_HORA, METROS_HORA
  formatoFolhaLargura Int?     @map("formato_folha_largura") // mm
  formatoFolhaAltura  Int?     @map("formato_folha_altura") // mm
  pincaMm             Decimal? @map("pinca_mm") @db.Decimal(6,2) // mm
}
```

## Rotas da API

### Prefixo: `/api/orcamento-grafico`

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/tipos-embalagem` | Lista tipos de embalagem |
| POST | `/tipos-embalagem` | Cria tipo |
| PUT | `/tipos-embalagem/:id` | Atualiza tipo |
| GET | `/precos-mp` | Lista preços de matéria-prima |
| POST | `/precos-mp` | Cria/atualiza preço |
| GET | `/parametros-perda` | Lista parâmetros de perda |
| POST | `/parametros-perda` | Cria/atualiza |
| GET | `/tabelas-margem` | Lista tabelas de margem |
| POST | `/tabelas-margem` | Cria tabela |
| PUT | `/tabelas-margem/:id` | Atualiza |
| POST | `/calcular` | Executa cálculo completo (não salva) |
| POST | `/` | Cria orçamento (salva resultado) |
| GET | `/` | Lista orçamentos (paginado) |
| GET | `/:id` | Detalhe do orçamento |
| PUT | `/:id` | Atualiza orçamento |
| POST | `/:id/enviar` | Envia proposta ao cliente |
| POST | `/:id/aprovar` | Marca como aprovado (gera pedido) |
| POST | `/:id/recusar` | Marca como recusado com motivo |
| POST | `/:id/copiar` | Duplica orçamento (para nova versão) |
| POST | `/simular-tiragens` | Simula múltiplas tiragens |
| POST | `/importar` | Importação em massa (CSV/Excel) |

## Motor de Cálculo

### Função principal: `calcularOrcamentoGrafico(params)`

```typescript
interface ParamsOrcamento {
  tipoEmbalagem: TipoEmbalagem
  medidas: Record<string, number>
  papel: { gramatura: number; precoKg: number }
  maquinaImpressao: { velocidade: number; custoHora: number; formatoLargura: number; formatoAltura: number; pinca: number }
  cores: Array<{ nome: string; tipo: 'CMYK' | 'PANTONE'; coberturaPercent: number; precoKg: number; rendimentoM2Kg: number }>
  acabamentos: Array<{ tipo: string; custoHora: number; velocidade: number; custoMaterialM2?: number }>
  quantidade: number
  perdas: { impressao: number; corteVinco: number; colagem: number }
  margem: { impostos: number; comissao: number; despAdm: number; markup: number }
}

interface ResultadoOrcamento {
  encaixe: { aproveitamento: number; folhasNecessarias: number; percentAproveitamento: number }
  papel: { pesoKg: number; custo: number }
  tinta: { custoTotal: number; detalhePorCor: Array<{ cor: string; consumoKg: number; custo: number }> }
  maquinas: { custoTotal: number; detalhePorEtapa: Array<{ etapa: string; tempoMin: number; custo: number }> }
  acabamentos: { custoTotal: number; detalhePorAcabamento: Array<{ tipo: string; custo: number }> }
  custoTotal: number
  precoVenda: number
  precoUnitario: number
  margemReal: number
  breakdown: { papel: number; tinta: number; maquina: number; acabamento: number; overhead: number }
}
```

## Avaliador de Fórmulas

Para as fórmulas de planificação (`formulaLargura`, `formulaAltura`), usar
uma lib segura de avaliação de expressões matemáticas (ex: `mathjs` ou
implementação própria simples com operadores +, -, *, /, parênteses).

Variáveis disponíveis: nomes dos parâmetros do tipo (L, A, P, ABA, SANGRIA).

## Frontend

### Páginas:
- `/orcamento-grafico` — Lista de orçamentos (grid com filtros)
- `/orcamento-grafico/novo` — Wizard de criação
- `/orcamento-grafico/:id` — Detalhe / edição
- `/orcamento-grafico/cadastros` — Sub-menu de cadastros
  - `/tipos-embalagem` — CRUD
  - `/precos-materiais` — CRUD
  - `/parametros-perda` — CRUD
  - `/tabelas-margem` — CRUD

### Wizard (Stepper Mantine):
Step 1: Cliente → Step 2: Tipo → Step 3: Medidas → Step 4: Material →
Step 5: Cores → Step 6: Acabamentos → Step 7: Revisão/Preço
