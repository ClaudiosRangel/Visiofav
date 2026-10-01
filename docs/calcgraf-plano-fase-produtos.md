# Fase `produtos` da importação Calcgraf → Vizor — plano e análise de risco

> Status: **PLANEJAMENTO (fase TRAVADA)**. Nada é importado em `Produto` até
> este plano ser aprovado pelo usuário e o de-para validado em LOCAL.
> Contexto/regras: ver steering `migracao-calcgraf-carton-wega.md` e
> `ATENCAO-pontos-verificar.md`.

## 0. Por que este documento existe (o receio do usuário)

O usuário tem **receio de importar produtos do Calcgraf e afetar produtos já
cadastrados no Vizor que participam de OPs em programação de produção REAL**.
Esse receio é legítimo e é a razão de a fase estar travada. Este plano existe
para eliminar o risco antes de qualquer escrita em `Produto`.

## 1. Fato técnico que dimensiona o risco

`Produto` (schema.prisma ~L451) tem **`@@unique([empresaId, codigo])`**. Todo o
risco de duplicata/colisão gira em torno do campo `codigo` dentro da empresa.

`Produto` é COMPARTILHADO por ~60 relações. As que tocam produção real:
- `OrdemProducao.produtoId` (OPs — inclusive em programação).
- `EstruturaProduto.produtoId` (BOM), `RoteiroProducao.produtoId` (roteiro).
- `EtapaOrdemProducao` (via OP), painel de Programação.
- `SaldoEndereco.produtoId` / `Estoque` (WMS), `ItemPedidoVenda`, `ItemOrcamento`,
  `AtributoGrafico.produtoId` (parâmetros gráficos do orçamento).

Conclusão: **qualquer UPDATE/DELETE em um `Produto` existente, ou a criação de
um `codigo` que colida com um já usado numa OP, pode afetar produção real.**

## 2. Descoberta que REDUZ o risco (exploração do export)

`cartoon/export/Produtos.json` tem **apenas 12 registros**, e eles **NÃO são
SKUs reais de clientes**. São **tipos/famílias de embalagem**:

| Codigo | Nome | Natureza real |
|---|---|---|
| 1 | Cartuchos | tipo de embalagem |
| 2 | Cartucho Composto | tipo de embalagem |
| 3 | Sacola | tipo de embalagem |
| 4 | Cartelas | tipo de embalagem |
| 5 | Caixa | tipo de embalagem |
| ... | ... | (12 no total) |

Os campos são de GEOMETRIA/MONTAGEM (`Formato` "3 dimensões", `FlagPinca`,
`AbaColaLateral`, `flagSanfonaFundo`, `flagFormulaColagemLateral`, ...), não de
um item vendável específico. No Calcgraf, o item que entra numa OP é gerado por
CÁLCULO (`CalculoHeader` + cliente + dimensões + este tipo), não por um cadastro
fixo de "produtos acabados".

**Implicação no mapeamento:** esses 12 registros correspondem no Vizor a
**`TipoEmbalagem`** (fórmulas de planificação do Orçamento Gráfico), **NÃO** ao
model `Produto`. Importá-los como `TipoEmbalagem` **não toca** OPs/programação.

Os produtos acabados reais da Wega (os que entram em OP no Vizor hoje) vieram
por **importação de PDF de OP (GPrint)** ou cadastro manual — não deste export.
Ou seja, o export **não traz** os SKUs que estão em produção; traz os moldes.

## 3. Decisão de escopo proposta (para aprovação)

Dividir a "fase produtos" em duas, por nível de risco:

### 3a. Sub-fase `tipos-embalagem` (BAIXO risco) — RECOMENDADA primeiro
- Origem: `Produtos.json` (12 tipos) → model `TipoEmbalagem` do Orçamento Gráfico.
- **Não toca `Produto`.** Não afeta OP/programação/estoque.
- Idempotente por `(empresaId, codigo/nome)`; só cria/atualiza os moldes.
- Ganho: alimenta o motor de orçamento com as fórmulas de embalagem reais da Wega.
- Pré-checagem: confirmar os campos/fórmulas que o `TipoEmbalagem` do Vizor
  espera vs. as flags do Calcgraf (mapear planificação). Se faltar dado, criar
  o tipo com o mínimo e marcar para completar manualmente.

### 3b. Sub-fase `produtos-acabados` (ALTO risco) — TRAVADA até de-para
- **Só entra em cena SE** o usuário quiser trazer SKUs de clientes do Calcgraf
  (de `CalculoAcabados`/`Nomes`/pedidos), o que NÃO está nos exports atuais e
  exigiria novo export do SQL Server.
- **Regra dura:** NUNCA fazer UPDATE/DELETE em `Produto` existente. Só INSERT de
  código novo, e só depois do de-para abaixo passar 100%.

## 4. De-para obrigatório antes de QUALQUER escrita em `Produto` (3b)

Script de PRÉ-CHECAGEM (dry-run, somente leitura), a rodar em LOCAL e depois
contra produção (Neon, read-only) antes de liberar:

1. **Inventário do que está em produção.** Listar todo `Produto` da empresa Wega
   que participa de produção real:
   - `produtoId` referenciado em `OrdemProducao` (qualquer status, com destaque
     para PROGRAMADA/LIBERADA/EM_PRODUCAO — a "programação real").
   - `produtoId` em `EstruturaProduto`, `RoteiroProducao`, `AtributoGrafico`,
     `SaldoEndereco`/`Estoque`.
   Gerar CSV `produtos-em-producao.csv` (id, codigo, nome, nº OPs, statuses).
2. **Colisão de código.** Para cada produto candidato do Calcgraf, calcular o
   `codigo` que ele teria no Vizor e checar se JÁ EXISTE em `Produto` da empresa:
   - Colisão → **NÃO importar** esse item; registrar em `colisoes.csv` para
     decisão manual (é o mesmo produto? então já existe, pular. É outro? então
     precisa de código distinto — prefixo `CG-` ou sufixo).
   - Sem colisão → candidato a INSERT novo (código livre).
3. **Relatório de decisão.** O script imprime: total candidatos, quantos
   colidem, quantos são INSERT seguro, e QUAIS colisões tocam produto em
   produção (essas são as críticas). **Zero escrita** nesta etapa.

Só depois de o usuário revisar `colisoes.csv` e aprovar, um segundo script faz
os INSERTs (nunca UPDATE/DELETE), envolto em `prisma.$transaction`, com um
`--dry-run` como default e `--apply` explícito para efetivar.

## 5. Salvaguardas técnicas (todas as escritas em Produto)

- **Somente INSERT** de código inexistente. Proibido UPDATE/DELETE de `Produto`.
- **empresaId explícito** da Wega (não confiar em prismaScoped — steering
  ATENCAO seção 2.1). Validar CNPJ 23.787.041/0001-75 antes de escrever.
- **Dry-run por padrão**; `--apply` obrigatório para gravar; tudo em transação.
- **Prefixo/namespace de código** para itens do Calcgraf (ex.: `CG-<codigo>`),
  evitando por construção qualquer colisão com os códigos do Vizor atuais —
  torna a colisão impossível em vez de só detectável. (A decidir com o usuário:
  prefixo garante segurança total mas cria códigos "diferentes" do sistema
  antigo.)
- **Produção só após:** (a) sub-fase rodada e validada em LOCAL; (b) de-para
  sem colisão crítica; (c) confirmação explícita do usuário; (d) connection
  string Neon via env fora do git.

## 6. Ordem recomendada e ESTADO

### DECISÃO DO USUÁRIO (esta sessão)
As OPs SEMPRE nascem por importação de PDF no Vizor. **Não importaremos SKUs de
clientes do Calcgraf** → a sub-fase 3b (`produtos-acabados`) está **DESCARTADA**.
Nenhum `Produto` real será tocado por esta migração.

### ✅ FEITO — sub-fase `tipos-embalagem` (3a)
`scripts/importar-calcgraf.ts --fase tipos-embalagem`: importa os 12 tipos do
`Produtos.json` → `TipoEmbalagem` (código `CG-EMB-<n>`). Idempotente (2ª execução:
0 criados, 12 atualizados — NÃO sobrescreve fórmulas ajustadas manualmente, só
metadados). Rodado em LOCAL na Wega `c8cee26b-...`. NÃO toca `Produto`/OP/
programação. **Fórmulas de planificação são BASE genérica por dimensionalidade
(2D/3D)** — o Calcgraf não exporta as fórmulas reais (código Delphi fechado);
ficam como ponto de calibração na tela Tipos de Embalagem.

### Produção
A sub-fase `tipos-embalagem` só cria `TipoEmbalagem` (não toca produção). Pode
ir para produção após validação visual + confirmação do usuário, junto com as
fases `precos`/`mapa`, quando o usuário decidir commitar/aplicar.

## 7. Resposta direta ao receio do usuário

- **Hoje não há problema criado:** nada foi importado em `Produto`. As fases
  feitas (`precos` → `PrecoMateriaPrima`; `mapa` → tabelas do RKW) NÃO tocam
  `Produto` nem OP/programação.
- **O export de `Produtos` não traz os SKUs em produção** — traz 12 tipos de
  embalagem (molde), que vão para `TipoEmbalagem`, sem risco.
- **Se um dia importarmos SKUs de clientes**, o de-para dry-run + regra
  "só INSERT, nunca UPDATE/DELETE" + prefixo `CG-` garante que nenhum produto
  que está numa OP em programação seja alterado ou sobrescrito.
