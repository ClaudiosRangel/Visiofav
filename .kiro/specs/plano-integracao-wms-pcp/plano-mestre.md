# Plano Mestre de Integração WMS + PCP — VisioFab

## Visão Geral do Ecossistema Atual

| Projeto | Tecnologia | Função |
|---------|-----------|--------|
| **VisioFab.Wms.Back** | Fastify + Prisma + PostgreSQL | Backend unificado (ERP + WMS) — 67 módulos |
| **VisioFab.Wms.Front** | Next.js 15 + Mantine 7 | Frontend WMS/ERP (desktop/web) |
| **VisioFab.Web** | Next.js 15 + Firebase + Mantine 7 | PCP Gráfico (Ordens de Serviço, Kanban, Produção) |
| **VisioFab.App** | React Native/Expo 54 | App mobile WMS (coletor) |
| **PCP (Delphi)** | Delphi + Firebird | PCP legado (OP, Estrutura, Liberação, Apontamento) |

---

## Diagnóstico: O Que Já Existe e Funciona

### Backend (VisioFab.Wms.Back) — COMPLETO
- ✅ Multi-tenant (empresa + módulos por usuário)
- ✅ Compras → Agenda WMS → Recebimento → Conferência → Endereçamento
- ✅ Vendas → Onda Separação → Picking → Embalagem → Carregamento → Expedição
- ✅ Financeiro (Contas a Pagar/Receber)
- ✅ Fiscal (NF-e, CT-e)
- ✅ Integração externa (API Keys, Webhooks, importação CSV/XML)
- ✅ Inventário, Ressuprimento, Dashboard, Relatórios
- ✅ Roteirização e Mapa de Carregamento
- ✅ Endereçamento inteligente com abastecimento de picking

### Frontend WMS (VisioFab.Wms.Front) — COMPLETO
- ✅ Todas as telas operacionais WMS
- ✅ Módulos ERP (Compras, Vendas, Financeiro, Fiscal)

### PCP Web (VisioFab.Web) — PARCIAL
- ✅ Ordens de Serviço (OS) com Kanban
- ✅ Processos de Produção
- ✅ Cadastros gráficos (tipos cartão, cores, formato, gramatura, policromia, verniz)
- ✅ Máquinas e Cortadeira
- ✅ Picking, Conferência Saída, Expedição (conecta ao WMS via wmsApiClient)
- ⚠️ Usa Firebase como auth (diferente do JWT do backend WMS)
- ⚠️ Dados de produção no Firestore (não no PostgreSQL)

### App Mobile (VisioFab.App) — COMPLETO
- ✅ Conferência Entrada, Endereçamento, Separação, Embalagem, Carregamento, Inventário

### PCP Legado (Delphi) — REFERÊNCIA
- 📋 Estrutura de Produto (BOM), Roteiros, Centros Produtivos
- 📋 Ordem de Produção com programação e sequenciamento
- 📋 Liberação de Materiais (requisição ao almoxarifado)
- 📋 Apontamento de Produção (consumo real, perdas)
- 📋 Laudos de Qualidade
- 📋 Custeio de Produção

---

## Problema Central a Resolver

O **VisioFab.Web** (PCP gráfico) opera com Firebase/Firestore isolado, enquanto o **VisioFab.Wms.Back** é o backend unificado com PostgreSQL. Isso cria:

1. **Dados duplicados** — Produtos, clientes e OS existem em dois bancos diferentes
2. **Sem integração real PCP↔WMS** — A liberação de materiais no PCP não dispara separação no WMS
3. **Sem fluxo de retorno** — Produto acabado da produção não entra automaticamente no estoque WMS
4. **Sem rastreabilidade ponta-a-ponta** — Pedido de Venda → OP → Consumo MP → Produto Acabado → Expedição

---

## Plano de Ação: Unificação em 5 Fases

### FASE 1 — Módulo PCP no Backend Unificado (VisioFab.Wms.Back)

**Objetivo:** Criar o módulo PCP dentro do backend existente, usando o mesmo PostgreSQL, Prisma e padrões de API.

#### Novas Entidades (Prisma Schema)

```
┌─────────────────────────────────────────────────────────────────┐
│ MÓDULO PCP — Modelos Prisma                                     │
├─────────────────────────────────────────────────────────────────┤
│ CentroProducao        → Máquinas/setores produtivos             │
│ RecursoProducao       → Recursos (operadores, ferramentas)      │
│ TurnoProducao         → Turnos de trabalho                      │
│ EstruturaProduto      → BOM (Bill of Materials) — árvore        │
│ ItemEstrutura         → Itens da BOM (MP, intermediários)       │
│ RoteiroProducao       → Sequência de operações                  │
│ EtapaRoteiro          → Cada etapa do roteiro                   │
│ OrdemProducao (OP)    → Ordem de produção                       │
│ ItemOrdemProducao     → Itens da OP (materiais necessários)     │
│ ApontamentoProducao   → Registro de produção real               │
│ LiberacaoMaterial     → Requisição de material ao WMS           │
│ ItemLiberacao         → Itens da requisição                     │
│ LaudoQualidade        → Controle de qualidade                   │
│ PerdaProducao         → Registro de perdas/refugo               │
│                                                                 │
│ ESPECÍFICOS INDÚSTRIA GRÁFICA:                                  │
│ TipoCartao, TipoCor, TipoFormato, TipoGramatura,              │
│ TipoPolicromia, TipoVerniz                                      │
│ AtributoGrafico       → Vincula atributos gráficos ao Produto   │
└─────────────────────────────────────────────────────────────────┘
```

#### Novos Endpoints API

| Prefixo | Módulo |
|---------|--------|
| `/api/centros-producao` | CRUD centros produtivos |
| `/api/recursos-producao` | CRUD recursos |
| `/api/turnos-producao` | CRUD turnos |
| `/api/estruturas-produto` | BOM (árvore de materiais) |
| `/api/roteiros-producao` | Roteiros e etapas |
| `/api/ordens-producao` | CRUD + programação de OPs |
| `/api/apontamentos-producao` | Registro de produção |
| `/api/liberacoes-material` | Requisição de materiais |
| `/api/laudos-qualidade` | Controle de qualidade |
| `/api/atributos-graficos` | Tipos cartão/cor/formato/etc |

#### Controle de Acesso
- Novo módulo `PCP` no enum de módulos do `UsuarioEmpresa.modulos`
- Middleware `moduloGuard('PCP')` nos endpoints

---

### FASE 2 — Integração Bidirecional PCP ↔ WMS

**Objetivo:** Conectar os fluxos de produção com o armazém.

#### Fluxo 1: Liberação de Material (PCP → WMS)

```
OP Programada → Liberação de Material → [WMS] Onda de Separação Interna
                                              ↓
                                        Picking de MP
                                              ↓
                                        Entrega na Máquina
                                              ↓
                                        Baixa no Estoque WMS
```

**Implementação:**
- `POST /api/liberacoes-material` cria a liberação
- Se `empresa.usaWms = true`, dispara criação de `OndaSeparacao` com tipo `PRODUCAO`
- Novo campo `tipoOnda` em OndaSeparacao: `VENDA | PRODUCAO | TRANSFERENCIA`
- A separação segue o fluxo WMS existente (picking → conferência)
- Ao concluir, atualiza `LiberacaoMaterial.status = ENTREGUE`

#### Fluxo 2: Entrada de Produto Acabado (Produção → WMS)

```
Apontamento de Produção → Produto Acabado → [WMS] Nota Interna de Entrada
                                                    ↓
                                              Conferência
                                                    ↓
                                              Endereçamento
                                                    ↓
                                              Estoque Disponível
```

**Implementação:**
- `POST /api/apontamentos-producao` registra produção concluída
- Se `empresa.usaWms = true`, cria `NotaEntrada` com tipo `PRODUCAO`
- Segue fluxo WMS existente (conferência → endereçamento)
- Estoque do produto acabado fica disponível para vendas

#### Fluxo 3: Reserva de Estoque (PCP consulta WMS)

```
Programação de OP → Consulta BOM → Verifica Estoque WMS → Alerta de Falta
```

**Implementação:**
- `GET /api/ordens-producao/:id/verificar-materiais` consulta saldo WMS
- Retorna lista de materiais com: necessário, disponível, reservado, faltante
- Se faltante > 0, sugere criação de Pedido de Compra

#### Fluxo 4: Retorno de Sobras (Produção → WMS)

```
Apontamento com sobra → Devolução de MP → [WMS] Endereçamento de Retorno
```

**Implementação:**
- Campo `quantidadeDevolvida` no `ApontamentoProducao`
- Se sobra > 0, cria movimentação de retorno no WMS
- Gera nova etiqueta (bobina parcial, por exemplo)

---

### FASE 3 — Particularidades da Indústria Gráfica

**Objetivo:** Implementar as regras de negócio específicas do setor gráfico.

#### 3.1 Gestão de Bobinas (Consumo Parcial)

```prisma
model ControleBobina {
  id                String   @id @default(uuid())
  produtoId         String
  codigoBarrasUnico String   @unique
  pesoOriginalKg    Decimal
  pesoAtualKg       Decimal
  larguraMm         Int
  diametroMm        Int?
  bobinaPaiId       String?  // Se for retorno de sobra
  status            String   // DISPONIVEL, NA_MAQUINA, CONSUMIDA
  empresaId         String
}
```

- Ao liberar bobina para produção: status = `NA_MAQUINA`
- Ao apontar consumo: registra peso consumido + perda de acerto
- Se sobra > 0: cria registro filho com novo código de barras

#### 3.2 Controle de Lotes (Tintas/Químicos)

- Campo `dataValidade` já existe em `SaldoEndereco` (shelf-life spec)
- Regra FEFO já implementada no endereçamento inteligente
- Adicionar: `codigoPantone`, `loteCorrespondencia` no cadastro de Produto/SKU
- Separação por lote de cor para garantir uniformidade em tiragens repetidas

#### 3.3 Conversão de Unidades

```typescript
// Serviço de conversão (já previsto no estudos.txt)
class ConversorUnidades {
  // Peso = Área(m²) × Gramatura(g/m²) × Quantidade
  calcularPesoFolhas(larguraMm: number, comprimentoMm: number, gramaturaGm2: number, qtdFolhas: number): number
  
  // Metros lineares de bobina a partir do peso
  calcularMetrosLineares(pesoKg: number, larguraMm: number, gramaturaGm2: number): number
  
  // Folhas a partir de resmas
  resmasParaFolhas(resmas: number, folhasPorResma: number): number
}
```

#### 3.4 Estoque de Terceiros

- Campo `proprietarioTipo` em `SaldoEndereco`: `PROPRIO | TERCEIRO`
- Campo `clienteProprietarioId` para material consignado
- Filtros de estoque separando próprio vs terceiros
- Relatório de posição de estoque de terceiros

#### 3.5 Paletização Dinâmica (Expedição)

- Cálculo de cubagem no `Volume` usando dimensões do produto acabado
- Peso total = (peso unitário × quantidade) + peso palete
- Validação de peso máximo por palete configurável

---

### FASE 4 — Migração do VisioFab.Web (Firebase → Backend Unificado)

**Objetivo:** Eliminar a duplicidade de dados migrando o PCP gráfico para o backend unificado.

#### Estratégia de Migração

1. **Manter o VisioFab.Web como frontend** (Next.js + Mantine — já funciona bem)
2. **Trocar o backend** de Firebase/Firestore para VisioFab.Wms.Back
3. **Usar o `wmsApiClient.ts` existente** como base (já conecta ao backend WMS)
4. **Migrar dados** do Firestore para PostgreSQL via script

#### Mapeamento de Entidades

| Firestore (atual) | PostgreSQL (novo) |
|-------------------|-------------------|
| ordens-servico | OrdemProducao |
| processos-producao | RoteiroProducao + EtapaRoteiro |
| maquinas | CentroProducao |
| produtos | Produto (já existe) + AtributoGrafico |
| tipos-cartao | TipoCartao |
| tipos-cores | TipoCor |
| tipos-formato | TipoFormato |
| tipos-gramatura | TipoGramatura |
| tipos-policromia | TipoPolicromia |
| tipos-verniz | TipoVerniz |
| clientes | Cliente (já existe) |

#### Autenticação
- Trocar Firebase Auth por JWT do backend (mesmo padrão do Wms.Front)
- Ou manter Firebase Auth no front e validar token Firebase no backend (adapter)

---

### FASE 5 — Fluxo Completo Ponta-a-Ponta

**Objetivo:** Garantir que o ciclo completo funcione harmonicamente.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLUXO COMPLETO — INDÚSTRIA GRÁFICA                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PEDIDO DE VENDA                                                        │
│       ↓                                                                 │
│  VERIFICAÇÃO DE ESTOQUE PA ──→ Se tem: vai direto para Separação WMS    │
│       ↓ (se não tem)                                                    │
│  GERAÇÃO DE OP (PCP)                                                    │
│       ↓                                                                 │
│  VERIFICAÇÃO DE ESTOQUE MP ──→ Se falta: gera Pedido de Compra          │
│       ↓                                                                 │
│  PROGRAMAÇÃO DA OP (Kanban/Gantt)                                       │
│       ↓                                                                 │
│  LIBERAÇÃO DE MATERIAIS ──→ WMS separa MP e entrega na máquina          │
│       ↓                                                                 │
│  PRODUÇÃO (Apontamento)                                                 │
│       ├── Consumo real de MP (baixa WMS)                                │
│       ├── Perda/Refugo (registro)                                       │
│       └── Sobra de MP (retorno ao WMS)                                  │
│       ↓                                                                 │
│  PRODUTO ACABADO ──→ Entrada no WMS (conferência + endereçamento)       │
│       ↓                                                                 │
│  LAUDO DE QUALIDADE (opcional)                                          │
│       ↓                                                                 │
│  SEPARAÇÃO WMS (Onda de Venda)                                          │
│       ↓                                                                 │
│  EMBALAGEM + PALETIZAÇÃO                                                │
│       ↓                                                                 │
│  CARREGAMENTO (Mapa + Roteirização)                                     │
│       ↓                                                                 │
│  EXPEDIÇÃO + NF-e                                                       │
│       ↓                                                                 │
│  FINANCEIRO (Contas a Receber)                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Sincronismos e Eventos (Webhooks Internos)

| Evento | Origem | Destino | Ação |
|--------|--------|---------|------|
| `op.criada` | PCP | WMS | Reserva lógica de materiais |
| `op.liberacao_material` | PCP | WMS | Cria onda de separação interna |
| `separacao_producao.concluida` | WMS | PCP | Atualiza status liberação |
| `apontamento.concluido` | PCP | WMS | Entrada de PA + retorno de sobras |
| `estoque.abaixo_minimo` | WMS | PCP | Alerta para programação de OP |
| `pedido_venda.confirmado` | Vendas | PCP | Verifica necessidade de produção |
| `compra.recebida` | Compras | PCP | Libera OPs que aguardavam MP |

---

## O Que NÃO Fazer (Evitar Redundância)

| Funcionalidade | Já existe em | Não duplicar em |
|---------------|-------------|-----------------|
| Estoque/Saldo | Wms.Back (SaldoEndereco, Estoque) | PCP |
| Separação/Picking | Wms.Back (OndaSeparacao, ItemSeparacao) | PCP |
| Expedição | Wms.Back (Carregamento, Volume, Mapa) | PCP |
| Conferência | Wms.Back (ConferenciaEntrada, ConferenciaSaida) | PCP |
| Cadastro Produto | Wms.Back (Produto, SKU) | VisioFab.Web |
| Cadastro Cliente | Wms.Back (Cliente) | VisioFab.Web |
| NF-e | Wms.Back (Nfe) | PCP |
| Financeiro | Wms.Back (ContaPagar, ContaReceber) | PCP |

---

## Prioridade de Implementação

| # | Fase | Esforço | Impacto | Dependência |
|---|------|---------|---------|-------------|
| 1 | Cadastros PCP (Centros, Estrutura, Roteiros) | Médio | Alto | Nenhuma |
| 2 | Ordem de Produção (CRUD + Status) | Médio | Alto | Fase 1 |
| 3 | Liberação de Material → Onda WMS | Alto | Crítico | Fase 2 |
| 4 | Apontamento → Entrada PA no WMS | Alto | Crítico | Fase 2 |
| 5 | Atributos Gráficos (tipos) | Baixo | Médio | Fase 1 |
| 6 | Controle de Bobinas | Médio | Alto (gráficas) | Fase 3 |
| 7 | Conversão de Unidades | Baixo | Alto (gráficas) | Fase 1 |
| 8 | Migração VisioFab.Web → Backend unificado | Alto | Crítico | Fases 1-4 |
| 9 | Verificação de materiais (OP vs Estoque) | Médio | Alto | Fases 1-3 |
| 10 | Kanban/Programação visual | Médio | Médio | Fase 2 |

---

## Arquitetura Final Proposta

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENTES / INTERFACES                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VisioFab.Wms.Front     VisioFab.Web        VisioFab.App         │
│  (ERP + WMS Desktop)    (PCP Gráfico)       (Coletor Mobile)     │
│  Next.js + Mantine      Next.js + Mantine   React Native/Expo    │
│                                                                  │
└──────────────────┬──────────────┬──────────────┬─────────────────┘
                   │              │              │
                   └──────────────┼──────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │   VisioFab.Wms.Back        │
                    │   (Backend Unificado)      │
                    │   Fastify + Prisma + PG    │
                    ├───────────────────────────┤
                    │ Módulos:                   │
                    │  • AUTH (JWT)              │
                    │  • COMPRAS                 │
                    │  • VENDAS                  │
                    │  • FINANCEIRO              │
                    │  • FISCAL (NF-e, CT-e)     │
                    │  • WMS (completo)          │
                    │  • PCP (novo)              │
                    │  • INTEGRAÇÃO (API/Webhook)│
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │      PostgreSQL            │
                    │   (Banco Unificado)        │
                    └───────────────────────────┘
```

---

## Conclusão

O plano garante:

1. **Zero duplicidade** — Um único backend, um único banco, múltiplos frontends
2. **Harmonia lógica** — PCP consome e alimenta o WMS via eventos internos
3. **Multi-nicho** — O módulo PCP é genérico (qualquer indústria), com extensões gráficas opcionais
4. **Nada a mais** — Cada módulo tem responsabilidade clara, sem sobreposição
5. **Escalável** — Novos nichos (alimentício, farmacêutico) adicionam apenas seus atributos específicos
6. **Compatível** — Mantém tudo que já funciona, apenas adiciona e conecta
