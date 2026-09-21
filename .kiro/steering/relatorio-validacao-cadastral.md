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
| **2. Atributos Logísticos — Característica/Periculosidade** (Isento/Perigoso/Inflamável) | ✅ **Completo** | `Produto.periculosidade` + `Endereco.permitePerigosos`. `areaCompativel` (RF004) bloqueia produto PERIGOSO/INFLAMAVEL em endereço sem `permitePerigosos`; put-away aplica em todas as camadas. Cadastro de produto e endereço aceitam os campos. |
| **3. Shelf Life Total do fabricante** (ex.: 365 dias; calcular vencimento = fabricação + N) | ✅ **Completo** | `Produto.shelfLifeTotalDias` no cadastro; helper calcula vencimento por fabricação; a **Conferência de Entrada** (conferir-todos) tem coluna "Fabricação" que envia `dataFabricacao` e dispara o cálculo. (canais individual/coletor podem ganhar o campo depois; a grade principal cobre o fluxo). |
| **3. Shelf Life Mínimo de RECEBIMENTO / RLM** (recusa na doca se < X% de vida útil, ex.: 270 dias / 75%) | ✅ **Backend pronto** | `Produto.percentualVidaUtilMinimoRecebimento` + bloqueio `RLM_PERCENTUAL` nos 3 canais da conferência (individual/código de barras/conferir-todos). Lógica pura `shelf-life-avancado.service` com PBT. |
| **3. Shelf Life de EXPEDIÇÃO por cliente** (ex.: 60 dias; regra no perfil do cliente; aplicada no picking/FEFO) | ✅ **Completo** | `Cliente.shelfLifeMinimoExpedicaoDias`. `selecionarEnderecosFIFO` (onda-separacao) pula lotes que não atendem o mínimo do cliente (critério mais restritivo por produto quando a onda tem vários clientes). |
| **3. Trava de Quarentena automática** (faltando X dias p/ vencer, bloqueia lote p/ expedição + alerta) | ✅ **Completo (seleção)** | `Produto.diasQuarentenaVencimento`. `selecionarEnderecosFIFO` pula lotes a ≤ limiar de dias a vencer E exclui saldos `bloqueado=true` (o picking agora respeita bloqueio de lote — antes NÃO respeitava). Marcação em massa por job continua sendo opção futura. |
| **3. Exige Lote / Exige Validade / FEFO** | ✅ **Já existia** | `Produto.exigeLote`; FEFO na separação; validação de vencido na conferência. |
| **4. Bug do código automático** (gerava `00002` já em uso, sequencial travado) | ✅ **Corrigido** | `POST /produtos` consome o contador em transação (commit `a43386551`); `peekProximoCodigo` pula códigos ocupados (commit `b9c4d2de9`). |

## Campos do "Cadastro Mestre" do relatório já cobertos (referência)

Identificação (código SKU, descrição, EAN/GTIN, NCM, marca) e fiscais já
existem em `Produto`. DUN-14 (caixa master) e "descrição reduzida p/ coletor"
NÃO foram verificados — checar no cadastro de SKU/embalagem antes de assumir
que faltam (podem estar no módulo SKU, não no Produto).

## Filtro de Hierarquia disponível nas telas (Fase 2 + extensões)

O `FiltroCascataHierarquia` (Departamento→Seção→Categoria→Subcategoria, com opção
"sem hierarquia") está plugado em:
- **Cadastros → Produtos** (listagem) — filtra a lista de produtos.
- **Estoque → Consulta de Estoque** (aba "Por Endereço") — filtra os saldos.
Backend: `GET /produtos` e `GET /saldos` aceitam `nivelId`/`semHierarquia`; a
resolução de folhas descendentes é centralizada em
`hierarquia-mercadologica/resolver-folhas-nivel.service.ts` (filtro por prefixo
de `codigoHierarquico`, isolado por empresa, 400 se nível inválido).

## Definição de "100% atendido"

O relatório está 100% atendido quando todas as linhas ❌ acima virarem ✅,
com o cadastro de produto permitindo preencher periculosidade + os shelf lifes
multi-camada, e o WMS aplicando as travas de recebimento/expedição/quarentena
descritas. A spec `atributos-logisticos-shelf-life` é o veículo disso.
