---
inclusion: auto
---

# Relatório de Validação Cadastral (Nescau/Bravecto) — rastreamento até 100%

Este arquivo é carregado automaticamente em toda sessão do Kiro neste
workspace. Ele existe para que **nenhuma sessão futura se perca** sobre o
estado de atendimento do documento do cliente:

**Fonte de verdade (o pedido do cliente):**
`2-RELATORIO DE OCORRENCIAS E AJUSTES.pdf` (raiz do `VisioFab.Wms.Back`,
"Relatório de Validação Cadastral de produtos WMS", 18/09/2026).

**Spec que fecha o que falta:**
`.kiro/specs/atributos-logisticos-shelf-life/` — cada bloco pendente vira
requisito/tarefa lá. **Ao concluir uma tarefa dessa spec, atualize a tabela
abaixo E marque a tarefa no `tasks.md` da spec.**

## Regras de continuidade entre sessões

1. **Sempre comece** conferindo a tabela de status abaixo antes de mexer em
   qualquer coisa de atributos logísticos / shelf life / hierarquia de produto.
2. **Sempre atualize** esta tabela ao concluir uma tarefa (status + data +
   commit). O steering deve refletir a realidade do código, não a intenção.
3. Este relatório usa dois produtos-exemplo (Achocolatado Nescau 370g e
   Bravecto), mas as regras valem para **qualquer produto** (multi-tenant).
4. O relatório mistira campos de **ERP** e de **WMS** — vários shelf lifes têm
   papéis complementares (ver bloco 3). Não colapsar tudo num campo só.

## Estado de atendimento por bloco do relatório

| Bloco do relatório | Status | Onde |
|---|---|---|
| **1. Hierarquia Mercadológica** (Dep→Seção→Categoria→Subcategoria; produto = folha via `familiaId`; código composto `01.02.04.001`) | ✅ **Completo** | specs `hierarquia-mercadologica` (fase 1) + `hierarquia-mercadologica-fase2` (relatório/filtro + migração). 4 níveis (padrão SAP/GS1); o "Nível 5/6 = SKU" do relatório é o próprio código do produto, não um nó da árvore. |
| **2. Atributos Logísticos — Tipo de Carga (conservação)** | ✅ **Já existia** | `Produto.ambienteExigido` (SECO/REFRIGERADO/CONGELADO) + motor put-away RF008. |
| **2. Atributos Logísticos — Tipo de Produto (volumetria/handling)** | ✅ **Já existia** | `Produto.tipoFisico` + `Produto.classificacaoArmazenagemId`. |
| **2. Atributos Logísticos — Característica/Periculosidade** (Isento/Perigoso/Inflamável) | 🟡 **Campo pronto; put-away pendente** | `Produto.periculosidade` criado (schema+migração) e aceito no cadastro (POST/PUT) — commit `<fase-cadastro>`. Falta o uso no motor de put-away (Tarefa 6 da spec `atributos-logisticos-shelf-life`). |
| **3. Shelf Life Total do fabricante** (ex.: 365 dias; calcular vencimento = fabricação + N) | 🟡 **Cálculo pronto; captura na doca pendente** | `Produto.shelfLifeTotalDias` criado; helper `validar-validade-produto` já calcula vencimento por fabricação. FALTA o campo "data de fabricação" na UI da conferência (item de frontend). |
| **3. Shelf Life Mínimo de RECEBIMENTO / RLM** (recusa na doca se < X% de vida útil, ex.: 270 dias / 75%) | ✅ **Backend pronto** | `Produto.percentualVidaUtilMinimoRecebimento` + bloqueio `RLM_PERCENTUAL` nos 3 canais da conferência (individual/código de barras/conferir-todos). Lógica pura `shelf-life-avancado.service` com PBT. |
| **3. Shelf Life de EXPEDIÇÃO por cliente** (ex.: 60 dias; regra no perfil do cliente; aplicada no picking/FEFO) | 🟡 **Campo pronto; picking pendente** | `Cliente.shelfLifeMinimoExpedicaoDias` criado e aceito no cadastro. Falta aplicar no FEFO/picking (Tarefa 7). Função pura `elegivelParaCliente` pronta. |
| **3. Trava de Quarentena automática** (faltando X dias p/ vencer, bloqueia lote p/ expedição + alerta) | 🟡 **Config pronta; automação pendente** | `Produto.diasQuarentenaVencimento` criado. Falta o avaliador que bloqueia no picking (Tarefa 8). Função pura `deveEntrarEmQuarentena` pronta. |
| **3. Exige Lote / Exige Validade / FEFO** | ✅ **Já existia** | `Produto.exigeLote`; FEFO na separação; validação de vencido na conferência. |
| **4. Bug do código automático** (gerava `00002` já em uso, sequencial travado) | ✅ **Corrigido** | `POST /produtos` consome o contador em transação (commit `a43386551`); `peekProximoCodigo` pula códigos ocupados (commit `b9c4d2de9`). |

## Campos do "Cadastro Mestre" do relatório já cobertos (referência)

Identificação (código SKU, descrição, EAN/GTIN, NCM, marca) e fiscais já
existem em `Produto`. DUN-14 (caixa master) e "descrição reduzida p/ coletor"
NÃO foram verificados — checar no cadastro de SKU/embalagem antes de assumir
que faltam (podem estar no módulo SKU, não no Produto).

## Definição de "100% atendido"

O relatório está 100% atendido quando todas as linhas ❌ acima virarem ✅,
com o cadastro de produto permitindo preencher periculosidade + os shelf lifes
multi-camada, e o WMS aplicando as travas de recebimento/expedição/quarentena
descritas. A spec `atributos-logisticos-shelf-life` é o veículo disso.
