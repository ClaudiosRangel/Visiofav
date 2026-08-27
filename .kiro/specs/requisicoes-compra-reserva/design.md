# Design — Requisições de Compra e Visibilidade de Reserva de Produção

## Visão Geral

A Análise de Produção do PCP já cria dois tipos de registro no banco quando o
usuário aciona os botões "Reservar Materiais" e "Gerar Requisições de Compra":

- **`ReservaProducao`** (empenho de estoque para uma OP)
- **`SugestaoCompra`** (requisição de compra do material em falta)

O backend cria esses registros corretamente, **mas o frontend não tem tela
para visualizá-los ou geri-los**. O resultado fica invisível: reservas não
aparecem em nenhuma consulta de estoque, e requisições de compra ficam órfãs
(existem no banco mas não há como convertê-las em pedido).

Este design cobre os dois gaps, seguindo o padrão consagrado dos ERPs de
referência (SAP S/4HANA, TOTVS Protheus, Odoo):

1. **Requisições de Compra** — nova tela no módulo **Compras**, com listagem,
   filtros e conversão para Pedido de Compra (padrão SAP ME57→ME21N / TOTVS
   SC→Pedido).
2. **Reservado/Disponível** — novas colunas na **Consulta de Saldos do WMS**,
   abatendo as reservas de produção do disponível (padrão universal ATP /
   SAP MD04: `Disponível = Estoque − Reservas`).

### Referência de mercado (justificativa das decisões)

- A requisição é um documento interno **sem compromisso com fornecedor**, que
  vive no módulo de Compras — é o comprador quem trabalha com ela (SAP MM,
  TOTVS SIGACOM). Conteúdo reformulado para conformidade de licenciamento.
- O reservado **não tem tela própria de listagem** na maioria dos ERPs: ele
  aparece abatendo a coluna "Disponível" na consulta de estoque. Seguimos esse
  padrão em vez de criar uma tela separada de "lista de reservas".

## Arquitetura

```
┌─────────────────────────┐     cria      ┌──────────────────────┐
│  PCP / Análise de        │──────────────>│  SugestaoCompra      │
│  Produção (existente)    │               │  (PENDENTE)          │
│  botões Reservar /       │               ├──────────────────────┤
│  Gerar Requisições       │──────────────>│  ReservaProducao     │
└─────────────────────────┘     cria      │  (ATIVA)             │
                                            └──────────────────────┘
                                                     │
                        ┌────────────────────────────┼────────────────────────┐
                        ▼                             ▼                        ▼
          ┌──────────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
          │ COMPRAS                  │  │ WMS                  │  │ (conversão)        │
          │ Requisições de Compra    │  │ Consulta de Saldos   │  │ SugestaoCompra     │
          │ (nova tela — lista SC)   │  │ + colunas Reservado/ │  │  → PedidoCompra    │
          │ agrupa por fornecedor    │  │   Disponível         │  │ (nova rota)        │
          │ converte em Pedido       │  │ (soma ReservaProducao)│  └────────────────────┘
          └──────────────────────────┘  └──────────────────────┘
```

## Modelos de Dados

Ambos os modelos **já existem** no `schema.prisma`. Nenhuma migração de schema
é necessária para o núcleo da feature.

### `SugestaoCompra` (existente — sem alteração)

```prisma
model SugestaoCompra {
  id                 String
  empresaId          String
  ordemProducaoId    String?   // OP de origem (pode ser null)
  produtoId          String
  descricao          String
  quantidade         Decimal
  unidadeMedida      String
  fornecedorId       String?   // fornecedor sugerido (via De/Para)
  fornecedorNome     String?
  dataNecessidade    DateTime?
  dataPedidoSugerida DateTime?
  leadTimeDias       Int
  status             String    // PENDENTE, CONVERTIDA, CANCELADA
  pedidoCompraId     String?   // preenchido ao converter (já existe no schema)
  observacao         String?
}
```

O campo `pedidoCompraId` **já existe** — foi previsto justamente para a
conversão. A rota de conversão só precisa preenchê-lo e mudar o status para
`CONVERTIDA`.

### `ReservaProducao` (existente — sem alteração)

```prisma
model ReservaProducao {
  id              String
  empresaId       String
  ordemProducaoId String
  produtoId       String
  quantidade      Decimal
  status          String   // ATIVA, CONSUMIDA, CANCELADA
  // ...
}
```

Já existe o helper `somarReservasAtivas(empresaId, produtoId)` em
`reserva-producao.service.ts` que soma as reservas ATIVAS de um produto — será
reaproveitado na consulta de saldos.

## Componentes e Interfaces

### Backend

#### B1. Rota de conversão SugestaoCompra → PedidoCompra

Nova rota no módulo de sugestão de compra (ou em pedido-compra):

```
POST /api/pcp/analise-producao/sugestoes-compra/converter
Body: { sugestaoIds: string[], fornecedorId: string }
```

Lógica (transação):
1. Valida que todas as sugestões pertencem à `empresaId` do usuário e estão
   `PENDENTE` (isolamento multi-tenant obrigatório — regra do projeto).
2. Agrupa por fornecedor (o body traz o fornecedor escolhido para o lote).
3. Cria **um** `PedidoCompra` (status RASCUNHO) com um `ItemPedidoCompra` por
   sugestão (produto, quantidade, unidade).
4. Marca cada `SugestaoCompra` como `CONVERTIDA` e preenche `pedidoCompraId`.
5. Retorna `{ pedidoCompraId, numero, itensCriados }`.

Idempotência: sugestões já `CONVERTIDA` são ignoradas (não recriam item).

#### B2. Rota de listagem de requisições (reuso)

Já existe `GET /pcp/analise-producao/sugestoes-compra` (com filtro por status
e ordemProducaoId). Será estendida para aceitar filtro por `fornecedorId` e
`produtoId`, e para retornar dados do produto (nome/código) via join.

#### B3. Rotas de manutenção de requisição

```
PATCH  /api/pcp/analise-producao/sugestoes-compra/:id   → editar qtd/fornecedor
DELETE /api/pcp/analise-producao/sugestoes-compra/:id   → cancelar (status CANCELADA)
```

#### B4. Consulta de Saldos consciente das duas origens (WMS x ERP)

**Contexto crítico (as duas formas de estoque):** o Vizor tem dois modelos de
saldo que coexistem, e a mesma lógica `calcularSaldo()` do PCP
(`verificacao-estoque.service.ts`) já resolve qual vale:

| Modelo | Granularidade | Tem endereço? |
|--------|---------------|:---:|
| `SaldoEndereco` (WMS) | por endereço + lote + validade | ✅ sim |
| `Estoque` (ERP)       | global por produto            | ❌ não |

Regra dinâmica já implementada: **se há `SaldoEndereco` (WMS) > 0, o físico vem
do WMS (com endereço); senão cai para o `Estoque` global do ERP (sem endereço)**.
O `reservado` total = reservas de venda (`Estoque.reservado`) + reservas de
produção (`Σ ReservaProducao ATIVA`).

A Consulta de Saldos precisa refletir esse duplo modelo. Nova rota agregada
**por produto** (não substitui a listagem por endereço atual — complementa):

```
GET /api/saldos/consolidado
→ para cada produto com saldo (WMS ou ERP):
  {
    produtoId, codigo, nome, unidade,
    origem: 'WMS' | 'ERP',           // de onde veio o físico (reuso de calcularSaldo)
    fisico,                          // Σ SaldoEndereco (WMS) OU Estoque.quantidade (ERP)
    reservadoVenda,                  // Estoque.reservado
    reservadoProducao,               // Σ ReservaProducao ATIVA
    reservado,                       // soma dos dois
    disponivel,                      // fisico − reservado (clamp 0)
    enderecos: [                     // SÓ quando origem = 'WMS'
      { enderecoCompleto, lote, validade, quantidade }
    ]
  }
```

**Exibição no frontend (item F2):** a tabela por produto mostra
`Origem` (badge WMS/ERP), `Físico`, `Reservado`, `Disponível`. Quando a origem é
**WMS**, uma linha expansível (ou tooltip) mostra **onde está** — os endereços
e lotes que compõem o físico. Quando é **ERP**, não há endereço (saldo global),
e isso fica explícito pelo badge "ERP" (sem detalhe de local).

Isso resolve o ponto levantado: o estoque que abastece o PCP fica visível com
**origem e localização**, respeitando qual das duas formas de estoque a empresa
usa naquele produto. Reaproveita `calcularSaldo()` para não duplicar a regra de
decisão WMS↔ERP (evita divergência entre o que o PCP vê e o que a tela mostra).

A listagem por endereço atual (`GET /api/saldos`) permanece intacta para quem
quer ver linha-a-linha; a nova visão consolidada por produto é a que ganha as
colunas de reserva/disponível.

### Frontend

#### F1. Tela "Requisições de Compra" (módulo Compras)

Nova rota: `/compras/requisicoes` — item no `ModuleSidebar` do módulo `compras`.

- Tabela: seleção (checkbox), Produto, Qtd, Unidade, Fornecedor Sugerido,
  OP Origem, Data Necessidade, Status (badge).
- Filtros: Status (Pendente/Convertida/Cancelada), Fornecedor, busca por produto.
- Ações em lote (padrão da suite): selecionar várias → botão **"Gerar Pedido
  de Compra"** → modal que confirma o fornecedor (pré-preenchido com o sugerido)
  e cria o pedido via B1.
- Ação por linha: editar qtd, cancelar requisição.
- Após conversão, link para o Pedido de Compra criado (`/compras/pedidos/:id`).

#### F2. Visão por produto na Consulta de Saldos (Origem + Reservado + Disponível)

Em `/estoque` (`estoque/page.tsx`), adicionar uma aba/toggle **"Por Produto"**
(além da visão "Por Endereço" atual), consumindo `GET /api/saldos/consolidado`:

- Colunas: Produto, **Origem** (badge WMS/ERP), Físico, **Reservado**
  (venda + produção, com tooltip discriminando), **Disponível** (verde).
- Quando **Origem = WMS**: linha expansível mostrando os **endereços/lotes**
  onde o produto está (responde "onde está o estoque que abastece o PCP").
- Quando **Origem = ERP**: sem endereço (saldo global), badge "ERP" deixa claro.

A visão "Por Endereço" (tabela atual) permanece como está. Sem tela nova —
apenas uma segunda visão na mesma página, exatamente como o mercado faz
(efeito da reserva visível onde já se olha o estoque, respeitando as duas
formas de armazenar saldo).

## Fluxo Completo (end-to-end)

```
1. PCP → Análise de Produção → "Gerar Requisições de Compra"
   → cria SugestaoCompra (PENDENTE) por material em falta
2. Comprador → Compras → Requisições de Compra
   → vê a lista, filtra por fornecedor
   → seleciona N requisições do mesmo fornecedor
   → "Gerar Pedido de Compra" → cria 1 PedidoCompra (RASCUNHO)
   → SugestaoCompra vira CONVERTIDA
3. PCP → Análise de Produção → "Reservar Materiais"
   → cria ReservaProducao (ATIVA)
4. WMS → Consulta de Saldos
   → colunas Reservado / Disponível refletem o empenho
```

## Tratamento de Erros

- Conversão com fornecedor ausente: se a sugestão não tem `fornecedorId` e o
  usuário não escolher um no modal, bloquear com mensagem clara.
- Conversão de sugestão já convertida: ignorar (idempotente), avisar quantas
  foram efetivamente convertidas.
- Isolamento multi-tenant: toda query filtra por `empresaId` do usuário
  (regra crítica do projeto — ver steering `ATENCAO-pontos-verificar.md`).
- Saldos sem reserva: `reservado = 0`, `disponivel = quantidade` (sem quebrar
  a tela atual).

## Estratégia de Testes

- **Backend**: teste da rota de conversão (cria pedido, marca convertida,
  idempotência, isolamento por empresa). Teste do cálculo reservado/disponível.
- **Frontend/E2E**: estender a suite `tests/e2e-qa` com um teste que abre
  Requisições de Compra, e um que valida as colunas Reservado/Disponível na
  Consulta de Saldos.

## Decisões de Design (confirmadas)

**D1 — Granularidade do Reservado na Consulta de Saldos: RESOLVIDA.**
Visão **por produto** (agregada), com **badge de origem (WMS/ERP)** e, quando
a origem é WMS, **linha expansível mostrando os endereços/lotes** onde o
produto está. Reaproveita a regra `calcularSaldo()` do PCP (que já decide
dinamicamente entre SaldoEndereco/WMS e Estoque/ERP conforme a presença de
saldo endereçado). Respeita as duas formas de armazenar estoque do sistema.

**D2 — Módulo da rota de conversão: RESOLVIDA.**
Mantida sob `/pcp/analise-producao/sugestoes-compra/converter` (perto de onde
as sugestões nascem, sem fragmentar o service que já as gera). A tela de UI
fica em Compras (`/compras/requisicoes`), consumindo essa rota.
