# Visão: Análise de Pedido → Ordem de Produção (do pedido até gerar a OP)

Este documento define **onde**, **quando** e **como** o Vizor deve realizar a
análise completa de um pedido antes de gerar a Ordem de Produção — cobrindo
verificação de estoque, cálculo de data de entrega, capacidade de produção e
previsão de compra de materiais.

Baseado nos padrões de SAP (CTP/aATP) e TOTVS Protheus (Liberação de Pedidos).

---

## 1. Como as grandes empresas fazem

### 1.1 SAP — CTP (Capable-to-Promise)

O SAP tem 3 níveis crescentes de sofisticação na resposta "posso prometer?":

| Nível | Nome | O que verifica |
|-------|------|---------------|
| **ATP** (Available-to-Promise) | Disponível para promessa | Só verifica **estoque de produto acabado** disponível (livre de reservas) |
| **aATP** (Advanced ATP) | ATP avançado | Estoque + alocações de produção + regras de substituição entre plantas |
| **CTP** (Capable-to-Promise) | Capaz de prometer | Se não tem estoque, **dispara o planejamento de produção (PP/DS)** para verificar se CONSEGUE produzir a tempo — checando capacidade de máquina E disponibilidade de componentes |

O **CTP é o padrão ideal**: no momento em que o pedido é criado/analisado, o
sistema responde não só "tenho em estoque?" mas "consigo fabricar até a data
pedida, considerando máquinas ocupadas e materiais disponíveis?". Se faltar
material, ele cria automaticamente **requisições de compra** e **ordens de
produção planejadas** (rephrased for compliance).

### 1.2 TOTVS Protheus — Liberação de Pedidos (MATA440)

No TOTVS o fluxo é:
1. Pedido de venda é criado (status inicial: **bloqueado**)
2. Uma rotina de **Liberação de Pedidos** analisa o pedido: verifica crédito,
   estoque, e libera item a item
3. O que determina se o pedido está apto é o conjunto de **liberações** — cada
   bloqueio (estoque, crédito, etc.) precisa ser resolvido
4. Só depois o pedido pode ser faturado ou gerar OP/separação (rephrased for compliance)

**Ponto-chave**: existe uma **tela dedicada de liberação/análise** entre o
pedido e a execução — não é feito "escondido" na criação do pedido.

### 1.3 Consenso do mercado

Todos os grandes ERPs têm uma **etapa de análise explícita** entre "pedido
registrado" e "produção iniciada". Essa etapa:
- É um **painel/menu dedicado** (não um botão perdido no pedido)
- Mostra o **semáforo** de cada requisito (estoque OK, capacidade OK, material a comprar)
- Permite ao planejador **decidir e confirmar** antes de comprometer recursos
- Ao confirmar, dispara em cascata: reservas, OPs, requisições de compra

---

## 2. Momento certo no fluxo do Vizor

```
Representante/Vendedor          PCP (novo menu)                Execução
─────────────────────          ───────────────                ────────
  Cria pedido        →   "Análise de Produção"       →    OP gerada
  (status                 (verifica tudo aqui)              + Reservas
   CONFIRMADO)                                              + Req. Compra
```

**O momento certo é DEPOIS do pedido confirmado e ANTES de gerar a OP** — numa
tela de análise dedicada. Nunca na criação do pedido (o vendedor não deve
esperar o cálculo pesado de MRP) nem depois da OP criada (tarde demais para
decidir).

---

## 3. Menu proposto: "Análise de Produção" (PCP)

### 3.1 Localização

Novo item no menu **PCP**, posicionado logo após "Ordens de Produção":

```
PCP
├── Programação
├── Ordens de Produção
├── Análise de Produção   ← NOVO (a "sala de decisão" do planejador)
├── Cadastros
└── ...
```

### 3.2 O que a tela mostra

Uma lista de **pedidos confirmados aguardando análise**, e ao abrir um pedido,
um painel com 4 blocos (os tópicos 1-5 do estudo):

```
┌─────────────────────────────────────────────────────────────┐
│  Pedido #123 — Cliente XYZ — Entrega desejada: 30/08/2026    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  📦 BLOCO 1 — PRODUTO ACABADO (tópico: estoque PA)            │
│  ├─ Necessário: 5.000 un                                      │
│  ├─ Em estoque (livre): 1.200 un  ✅                          │
│  └─ A PRODUZIR: 3.800 un          ⚠️                          │
│                                                               │
│  🧪 BLOCO 2 — MATERIAIS (tópico: estoque MP)                  │
│  ├─ Papel Triplex 350g: precisa 500kg | tem 800kg  ✅         │
│  ├─ Tinta Cyan: precisa 12kg | tem 3kg  ❌ FALTA 9kg          │
│  └─ Verniz UV: precisa 15kg | tem 0kg   ❌ FALTA 15kg         │
│                                                               │
│  🏭 BLOCO 3 — CAPACIDADE (tópico: fila de produção)           │
│  ├─ Impressão: livre a partir de 26/08                        │
│  ├─ Corte: livre a partir de 27/08                            │
│  └─ Fila atual considerada: 8 OPs à frente                    │
│                                                               │
│  📅 BLOCO 4 — DATA DE ENTREGA CALCULADA                       │
│  ├─ Início produção: 27/08/2026                               │
│  ├─ Fim produção: 29/08/2026                                  │
│  ├─ + lead compra tinta/verniz: +3 dias                       │
│  └─ ENTREGA VIÁVEL: 01/09/2026  ⚠️ (2 dias após o pedido)     │
│                                                               │
│  🛒 BLOCO 5 — COMPRAS NECESSÁRIAS                             │
│  ├─ Tinta Cyan 9kg → Fornecedor A (lead 3 dias)               │
│  └─ Verniz UV 15kg → Fornecedor B (lead 2 dias)               │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  [ Gerar Requisições de Compra ]  [ GERAR ORDEM DE PRODUÇÃO ] │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Ações disponíveis no painel

| Botão | O que faz |
|-------|-----------|
| **Gerar Requisições de Compra** | Cria as sugestões/requisições de compra dos materiais em falta |
| **Gerar Ordem de Produção** | Cria a OP, explode BOM, gera etapas, **reserva** os materiais disponíveis, agenda na fila com a data calculada |
| **Recalcular** | Reprocessa a análise (útil se estoque mudou) |

---

## 4. Como cada tópico é calculado (a lógica por trás)

### Tópico 1 — Estoque de Produto Acabado
```
disponivelPA = saldoWMS(produto) - reservas(produto)
aProduzir = max(0, quantidadePedido - disponivelPA)
Se aProduzir == 0 → não precisa OP (atende do estoque)
```

### Tópico 2 — Estoque de Materiais (MP)
```
Para cada item da BOM (explodida para 'aProduzir' unidades):
  necessario = quantidadeBOM × fator
  disponivel = saldoWMS(material) - reservas(material)
  falta = max(0, necessario - disponivel)
  Se falta > 0 → entra no bloco de compras
```

### Tópico 3 — Capacidade (fila de produção)
```
Para cada etapa do roteiro:
  centro = centroProducao da etapa
  filaAtual = etapas PENDENTES/EM_ANDAMENTO no centro (soma de tempos)
  inicioPossivel = agora + filaAtual (respeitando turnos)
```

### Tópico 4 — Data de Entrega (backward + forward)
```
tempoProducao = Σ (setup + operação×qtd + espera) de todas as etapas
inicioProducao = maior(hoje, dataDesejada - tempoProducao - filaCapacidade)
Se algum material falta:
  inicioProducao = maior(inicioProducao, hoje + maiorLeadTimeCompra)
dataEntregaViavel = inicioProducao + tempoProducao + filaCapacidade + leadExpedicao
```

### Tópico 5 — Compras
```
Para cada material em falta:
  quantidade = falta (ajustada por lote mínimo)
  fornecedor = último fornecedor OU preferencial do cadastro
  dataNecessidade = inicioProducao
  dataPedidoSugerida = dataNecessidade - leadTimeFornecedor
  → gera SugestaoCompra
```

---

## 5. Plano de implementação (ponto a ponto)

Como você pediu para ir ponto a ponto, sugiro esta ordem — cada um entregável
e testável isoladamente, e todos alimentam o painel "Análise de Produção":

| Ordem | Ponto | Entrega |
|-------|-------|---------|
| **1º** | Verificação de estoque (PA + MP) | Service que calcula disponível vs necessário, considerando reservas. Base de tudo. |
| **2º** | Reserva de estoque | Ao gerar OP, empenhar materiais disponíveis (impede uso duplo) |
| **3º** | Cálculo de data + capacidade | Somar tempos do roteiro + fila das máquinas (backward/forward) |
| **4º** | Requisição de compra automática | Gerar sugestões de compra dos materiais em falta |
| **5º** | Painel "Análise de Produção" + Gerar OP | Tela que junta tudo e o botão final que dispara OP + reservas + compras |

Os pontos 1-4 são **services no backend** (lógica pura, testável). O ponto 5 é
a **tela** que consome todos eles e fecha o fluxo.

---

## 6. Modelo de dados novo necessário

| Model | Finalidade | Já existe? |
|-------|-----------|-----------|
| `ReservaEstoque` | Empenho de material/PA por OP | ⚠️ Parcial (`LiberacaoMaterial`) — avaliar reuso |
| `SugestaoCompra` | Requisição gerada pelo MRP antes de virar Pedido de Compra | ❌ Criar |
| Campo `leadTimeDias` em `Produto`/`Fornecedor` | Prazo de entrega do fornecedor | ⚠️ Verificar se existe |
| `AnaliseProducao` (opcional) | Snapshot da análise feita (auditoria) | ❌ Opcional |

---

## 7. Recomendação final

**Sim, criar o menu "Análise de Produção" no PCP é o caminho certo** — é
exatamente o que SAP (CTP) e TOTVS (Liberação de Pedidos) fazem: uma sala de
decisão entre o pedido e a produção.

Proponho implementar **ponto a ponto os services (1 a 4)** primeiro, validando
cada um, e por fim montar o **painel (ponto 5)** que os orquestra. Assim cada
peça é testável e o cliente vê progresso incremental.

---

## Referências

- [SAP — Capable-to-Promise (CTP) PP/DS](https://help.sap.com/saphelp_snc70/helpdata/en/64/7294375960a42be10000009b38f8cf/content.htm) (rephrased for compliance)
- [SAP — Advanced ATP (aATP) S/4HANA](https://learning.sap.com/courses/functions-innovations-in-sap-s-4hana-sales/using-advanced-available-to-promise-aatp-in-sap-s-4hana_ef38afd2-4730-433f-854a-613b8e4afec5) (rephrased for compliance)
- [TOTVS — Liberação de Pedidos de Venda (MATA440)](https://centraldeatendimento.totvs.com/hc/pt-br/articles/13316189225751) (rephrased for compliance)
- [TOTVS — Bloqueios do Pedido de Vendas](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360014207291) (rephrased for compliance)

Content was rephrased for compliance with licensing restrictions.
