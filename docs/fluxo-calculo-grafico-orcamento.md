# Fluxo — Cálculo Gráfico + Orçamento (Vizor / Carton Wega)

Este documento descreve, em diagramas Mermaid, como o **Orçamento Gráfico** e a
**Biblioteca de Cálculos Gráficos** (`CalculoGrafico`) se encaixam — o
equivalente Vizor ao fluxo "Orçamento usa Cálculo" + "Localiza o Cálculo Padrão"
do Calcgraf.

Conceito central: o **Cálculo Gráfico** é uma peça de engenharia reutilizável e
independente do orçamento (tem número próprio, fica localizável na biblioteca). O
**Orçamento** é o documento comercial, composto por 1..N **itens**. Um item pode
nascer do zero (wizard) ou ser **copiado** de um cálculo da biblioteca (foto
congelada — cópia, não vínculo).

Specs relacionadas: `.kiro/specs/biblioteca-calculos-graficos/`,
`.kiro/specs/orcamento-grafico/`. Isolamento multi-tenant: `empresaId` explícito
em toda query.

---

## 1. Visão geral (entidades e caminhos)

```mermaid
flowchart TB
  subgraph Biblioteca["Biblioteca de Calculos (CalculoGrafico)"]
    CG[("CalculoGrafico<br/>numero proprio + numeroCalcgraf<br/>FOTO congelada (resultadoCalculo)")]
  end

  subgraph Orcamento["Orcamento Grafico"]
    ORC[("OrcamentoGrafico<br/>cabecalho comercial + totais consolidados")]
    ITEM[("ItemOrcamentoGrafico<br/>1..N itens, cada um com sua FOTO<br/>+ calculoGraficoOrigemId")]
    ORC --- ITEM
  end

  subgraph Origem["Calcgraf (legado)"]
    ACERVO[("Acervo ~11.561 calculos<br/>CalculoHeader + filhas")]
  end

  MOTOR["calcularOrcamentoGrafico<br/>(motor puro, calibrado por golden)"]

  ACERVO -. "importacao (foto da origem, NAO recalcula)" .-> CG
  CG -- "Localizar Calculo: COPIA a foto" --> ITEM
  ITEM -- "calcula / recalcula" --> MOTOR
  CG -- "recalcular (opcional, preserva foto anterior)" --> MOTOR
  ITEM -- "consolida" --> ORC

  classDef store fill:#eef,stroke:#88a
  class CG,ORC,ITEM,ACERVO store
```

**Pontos-chave**
- A biblioteca (`CalculoGrafico`) e o item (`ItemOrcamentoGrafico`) compartilham
  o mesmo *shape* de engenharia (tipo, suporte, cores, acabamentos, faca/
  montagem, matriz, tinta). O mapeamento é único e testado
  (`calculoParaItemBody` / `itemBodyParaCalculo`).
- "Localizar Cálculo" **copia** (foto congelada). Editar o cálculo da biblioteca
  depois **não** altera itens já criados.
- A importação do acervo preserva a foto **da origem** (não roda o motor).

---

## 2. Fluxo do operador — Orçamento usando a biblioteca ("Localiza o Cálculo")

```mermaid
sequenceDiagram
  actor Op as Operador
  participant Wiz as Tela do Orcamento (detalhe)
  participant Mod as BuscaCalculoModal
  participant API as POST /orcamento-grafico/:id/itens/de-calculo
  participant SVC as calculo-grafico.service
  participant DB as PostgreSQL

  Op->>Wiz: abre orcamento (RASCUNHO) e clica "Localizar Calculo"
  Wiz->>Mod: abre modal de busca
  Op->>Mod: filtra (cliente / linha / produto / descricao / sigla / numero)
  Mod->>API: GET /calculo-grafico (empresaId da sessao)
  API-->>Mod: lista paginada (ResumoCalculo[])
  Op->>Mod: seleciona um calculo (opc.: nova tiragem)
  Mod->>API: POST itens/de-calculo { calculoId, novaQuantidade? }
  API->>SVC: obterCalculoGrafico(empresaId, calculoId)
  alt calculo de outra empresa
    API-->>Mod: 403 Acesso negado
  else calculo da empresa
    API->>DB: cria ItemOrcamentoGrafico (COPIA a foto)<br/>grava calculoGraficoOrigemId
    API->>DB: reconsolida totais do orcamento
    API-->>Mod: 201 item criado
    Mod-->>Wiz: fecha modal + recarrega (carregar())
  end
```

Alternativa (fluxo clássico, sem biblioteca): o botão **"Novo Item"** abre o
`ItemWizardModal` (Tipo → Medidas → Papel → Cores → Dados Técnicos →
Acabamentos → Diversos → Revisão) e cria o item calculando no backend. Os dois
caminhos coexistem.

---

## 3. Criar um Cálculo novo na biblioteca (numeração própria atômica)

```mermaid
flowchart TB
  A["POST /calculo-grafico (dados de engenharia + foto opcional)"] --> B["criarCalculoGrafico(params)"]
  B --> C{{"prisma.$transaction"}}
  C --> D["findFirst maior numero da empresa (empresaId explicito)"]
  D --> E["numero = (maior ?? 0) + 1"]
  E --> F["create CalculoGrafico<br/>origem = VIZOR, status = ATIVO"]
  F --> G{"commit da transacao"}
  G -- ok --> H["calculo nasce JA numerado e na biblioteca"]
  G -- "colisao @@unique(empresaId,numero)" --> I["rollback inteiro<br/>(sem registro orfao) -> retenta"]

  classDef tx fill:#efe,stroke:#8a8
  class C,D,E,F tx
```

Invariante (Property 5): nunca existe um cálculo com número mas fora da
biblioteca — a numeração e a gravação acontecem na **mesma** transação.

---

## 4. Ler (foto congelada) vs Recalcular (preserva histórico)

```mermaid
flowchart LR
  subgraph Ler["GET /calculo-grafico/:id  — Property 9"]
    L1["obterCalculoGrafico(empresaId, id)"] --> L2["retorna a FOTO como esta<br/>NAO dispara o motor"]
  end

  subgraph Recalc["POST /calculo-grafico/:id/recalcular — Property 10"]
    R1["carrega calculo (empresaId)"] --> R2["reconstroi input<br/>registroParaEngenharia -> calculoParaItemBody"]
    R2 --> R3["calcularItem (cadastros ATUAIS)"]
    R3 -- "ItemOrcamentoError (cadastro ausente)" --> R4["preserva a foto original<br/>re-lanca o erro (400)"]
    R3 -- ok --> R5["anexa foto atual a fotosAnteriores"]
    R5 --> R6["grava nova foto + custo/valor"]
  end
```

Regra: **leitura nunca recalcula**. Recalcular é uma ação explícita que **soma**
a foto anterior ao histórico (`fotosAnteriores`) antes de gravar a nova — a foto
original nunca é perdida.

---

## 5. Máquina de estados do Orçamento (comercial)

```mermaid
stateDiagram-v2
  [*] --> RASCUNHO: criar orcamento
  RASCUNHO --> RASCUNHO: add/editar/remover itens<br/>(Novo Item ou Localizar Calculo)
  RASCUNHO --> ENVIADO: enviar proposta (exige preco)
  ENVIADO --> APROVADO: aprovar (gera PedidoVenda)
  ENVIADO --> RECUSADO: recusar (exige motivo)
  ENVIADO --> VENCIDO: validade expira
  APROVADO --> [*]
  RECUSADO --> [*]
  VENCIDO --> [*]

  note right of RASCUNHO
    Itens so podem ser
    adicionados/editados
    em RASCUNHO
  end note
```

Observação: o **Cálculo Gráfico** (biblioteca) tem seu próprio `status`
(`ATIVO` / `RASCUNHO` / `ARQUIVADO`) independente do status comercial do
orçamento — a busca padrão lista `ATIVO`.

---

## 6. Migração do acervo Calcgraf → Biblioteca (idempotente, resiliente)

```mermaid
flowchart TB
  SQL[("SQL Server restaurado<br/>CalcgrafCartonWega")] -->|"sqlcmd -u (UTF-16 -> UTF-8)"| JSON["cartoon/export/CalculosAcervo.json"]
  JSON --> SCR["scripts/importar-calculos-calcgraf.ts"]
  SCR --> CORTE{"--desde-numero / --desde-ano ?"}
  CORTE --> LOTE["lotes de 500 (comRetry - pooler Neon)"]
  LOTE --> IMP["importarAcervo({ empresaId, linhas, dryRun })"]

  IMP --> MAP["mapearLinhaParaCalculo (pura)"]
  MAP -->|"linha corrompida"| REL["relatorio[] + conta 'erros'<br/>(NAO aborta)"]
  MAP -->|"ok"| IDEM{"ja existe (empresaId, numeroCalcgraf)?"}
  IDEM -->|"sim"| IGN["ignora (nao duplica) + conta 'ignorados'"]
  IDEM -->|"nao + !dryRun"| CRIA["criarCalculoGrafico<br/>origem = MIGRADO_CALCGRAF<br/>FOTO da origem (nao recalcula)"]
  CRIA --> OKC["conta 'importados'"]

  OKC --> RES["resumo { importados, atualizados, ignorados, erros }"]
  IGN --> RES
  REL --> RES

  classDef warn fill:#fee,stroke:#c88
  class REL warn
```

Invariantes do importador:
- **Idempotência** (Property 11): reimportar não duplica — colisão por
  `(empresaId, numeroCalcgraf)` é ignorada e mantida inalterada.
- **Conservação** (Property 12): `importados + atualizados + ignorados + erros ==
  total de linhas`.
- **Foto da origem** (Req 6.2): a migração **não** roda o motor — grava os
  agregados de custo/valor que vieram do Calcgraf (igual ao tratamento do 7343).

> Pendência conhecida: o exportador SQL Server → JSON ainda não foi escrito; o
> `brutoParaLinha` do script é tolerante, mas os nomes de coluna devem ser
> conferidos contra o export real antes do `--apply` em produção. Rodar sempre
> `--dry-run` primeiro.

---

## 7. Mapa de rotas (resumo)

```mermaid
flowchart LR
  subgraph Biblioteca["/api/calculo-grafico"]
    B1["GET /            (busca/lista)"]
    B2["GET /:id         (foto)"]
    B3["POST /           (criar)"]
    B4["PUT /:id         (atualizar)"]
    B5["POST /:id/recalcular"]
    B6["DELETE /:id"]
    B7["POST /importar-acervo (ADMIN)"]
  end

  subgraph Orcamento["/api/orcamento-grafico"]
    O1["POST /:id/itens            (novo item - wizard)"]
    O2["POST /:id/itens/de-calculo (copiar da biblioteca)"]
    O3["POST /:id/reaproveitar     (repetir orcamento inteiro)"]
  end

  B1 --> O2
  B2 --> O2
```
