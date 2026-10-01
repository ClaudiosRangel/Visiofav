# Fase `produtos` da importação Calcgraf → Vizor — Plano

Continuação do projeto de migração Carton Wega (ver steering
`migracao-calcgraf-carton-wega.md` e `docs/calcgraf-plano-de-acao.md`).
Este documento planeja a fase `produtos` do importador `scripts/importar-calcgraf.ts`.

## Decisão de escopo (confirmada com o usuário)

**A fase `produtos` importa as CATEGORIAS de produto do Calcgraf como
`TipoEmbalagem` do módulo Orçamento Gráfico — NÃO cria `Produto`/SKU.**

Motivo: os 12 registros de `Produtos` do Calcgraf **não são SKUs de estoque**.
São 9 tipos/categorias genéricos (o Calcgraf modela "produto" como categoria +
fórmula de planificação, não como item), 1 cancelado ("TESTE") e 2 duplicados
("Impressos" aparece 2×). Exemplos: Cartuchos, Cartucho Composto, Sacola,
Cartelas, Caixa, Invólucros, Impressos, Envelope, Display, Venda de Cartão.

O `Produto` do Vizor, por outro lado, é um SKU individual referenciado em ~30
tabelas — incluindo `OrdemProducao`, `ItemOrdemProducao`, `EstruturaProduto`,
`Estoque`, `SaldoEndereco`, `PedidoVenda`, etc. **Criar Produto a partir do
Calcgraf colidiria com produtos que já participam de OPs em programação real**
(receio explícito do usuário). Mapear as categorias em `TipoEmbalagem` **elimina
esse risco por completo**: `TipoEmbalagem` é tabela exclusiva do Orçamento
Gráfico e não tem nenhuma relação com `Produto`, PCP ou estoque.

### O que esta fase NÃO faz (travado, exige plano próprio depois)
- NÃO cria/edita `Produto` (SKU).
- NÃO toca em OP, estrutura (BOM), estoque, pedidos ou programação.
- Importar SKUs reais (de `CalculoAcabados`/`OpItem`) fica para uma fase futura
  SÓ se o usuário pedir, e exigirá de-para + salvaguardas contra colisão com
  produtos em uso (ver seção "Fase futura (travada)").

## Origem dos dados

`cartoon/export/Produtos.json` (12 linhas, já exportado). Campos usados:
`Codigo`, `Ativo` (ATIVO/CANCELADO), `Nome`, `Formato` ("3 dimensões",
"2 dimensões", "2 dim (aberto+fechado)", vazio), flags de colagem/aba/sanfona.

Regras de limpeza:
- Ignorar `Ativo === 'CANCELADO'` (ex.: "TESTE").
- Deduplicar por Nome normalizado (ex.: "Impressos" aparece 2×) — mantém a 1ª.
- Aparar espaços e corrigir acentuação (o export tem `Inv�lucros`, `dimens�es` —
  encoding Latin1; normalizar para UTF-8 ao ler, igual à fase precos).

## Destino: `TipoEmbalagem` (model existente)

```
TipoEmbalagem {
  empresaId, codigo (@@unique com empresaId), descricao,
  formulaLargura (Text), formulaAltura (Text),
  parametros (Json: [{nome,label,unidade,obrigatorio,default}]),
  processosObrigatorios (String[]),
  abaColagemMm, sangriaMm, pincaMm, status
}
```

Mapeamento Calcgraf → TipoEmbalagem:
| Calcgraf | TipoEmbalagem |
|---|---|
| `Codigo` (int) | `codigo` = `CG-<codigo>` (prefixo para não colidir com códigos já cadastrados manualmente no Vizor) |
| `Nome` | `descricao` |
| `Formato` | define os `parametros` do wizard e as fórmulas de planificação |
| `Ativo` | `status` (só importa ATIVO) |

### Fórmulas de planificação por Formato (aproximação inicial)
O Calcgraf guarda as fórmulas no fonte Delphi (inacessível). Para o MVP,
usamos planificações padrão da indústria por tipo de formato, que o usuário
refina depois na tela de TipoEmbalagem:
- **3 dimensões** (caixa/cartucho L×A×P): larg = `2*(L+P)+aba`, alt = `A+2*P+aba`.
  parâmetros: L, A, P (mm, obrigatórios).
- **2 dimensões** (cartela/plano L×A): larg = `L+sangria`, alt = `A+sangria`.
  parâmetros: L, A.
- **2 dim (aberto+fechado)** (impressos): larg = `Laberto`, alt = `Aaberto`.
  parâmetros: Laberto, Aaberto, Lfechado, Afechado.
- **vazio** (Envelope/Display/Impressos livre): fórmula genérica L/A, parâmetros L, A.

> IMPORTANTE: essas fórmulas são um PONTO DE PARTIDA editável, não a paridade
> exata do Calcgraf. A paridade fina de planificação é do Bloco 1/2 (calibração
> por golden cases), não desta importação de catálogo. O objetivo aqui é
> popular o catálogo de tipos para o usuário não começar do zero.

## Idempotência

`@@unique([empresaId, codigo])` → upsert lógico por `(empresaId, codigo)`
(find + update/create, mesmo padrão da fase precos). Rodar 2× não duplica.
Como o `codigo` usa prefixo `CG-`, a fase é **aditiva e reversível**: não
sobrescreve `TipoEmbalagem` criados manualmente (que não têm o prefixo), e um
`deleteMany({ codigo: { startsWith: 'CG-' } })` limpa só o que ela importou.

## Salvaguardas (mesmo sem tocar em Produto)

1. **Filtro empresaId explícito** em toda query (steering ATENCAO-pontos-verificar).
2. **Prefixo `CG-` no código** — isola o que a importação cria; nunca colide com
   cadastro manual; permite limpeza seletiva.
3. **Idempotente** (upsert por codigo) — rodar N vezes = mesmo resultado.
4. **Só LEITURA do JSON** — nenhuma escrita fora de `TipoEmbalagem`.
5. **Empresa parametrizável** (`--empresa <id>`) — nunca assume empresa.
6. **Local primeiro** — validar na Wega local antes de qualquer cogitação de
   produção; produção só com confirmação explícita (política do steering).

## Implementação (no `scripts/importar-calcgraf.ts`)

- Nova função `importarProdutos(empresaId)` + case `'produtos'` no `main()`.
- Reusa `lerJson`, `arg`. Normaliza encoding Latin1→UTF-8 do Nome/Formato.
- Loga resumo: criados/atualizados/ignorados (cancelados/duplicados).
- Conferência: total esperado = 9 categorias únicas ativas.

## Fase futura (TRAVADA) — importar SKUs reais de produto acabado

Se um dia o usuário quiser trazer os PRODUTOS-ITEM reais (não as categorias),
a fonte provável é `CalculoAcabados` (11.103) / `OpItem` (4.255) do Calcgraf.
Isso exige, ANTES de qualquer escrita:
1. **De-para obrigatório**: casar produto Calcgraf ↔ Produto Vizor por código/
   descrição, com revisão humana; nunca criar cego.
2. **Salvaguarda anti-colisão**: bloquear update/insert em qualquer `Produto`
   que tenha `OrdemProducao`, `ItemOrdemProducao`, `EstruturaProduto`, saldo ou
   pedido vinculado — só permitir criar SKUs realmente novos.
3. **Dry-run**: relatório do que criaria/atualizaria/pularia, para o usuário
   aprovar antes de aplicar.
4. Rodar contra PRODUÇÃO (Neon) só após validação local + confirmação (a Wega
   real está em produção; local está vazia de produtos/OPs).
Esta fase NÃO está no escopo atual.

## Checklist de execução
- [ ] Implementar `importarProdutos` + case `produtos`.
- [ ] `get_diagnostics` no script (0 erros).
- [ ] Rodar `--fase produtos` na Wega local 2× (idempotência) e conferir 9 tipos.
- [ ] Atualizar steering `migracao-calcgraf-carton-wega.md` (fase produtos feita).
- [ ] NÃO commitar (política do usuário: acumular local).
