# PROPOSTA — Orçamento Gráfico: Item × Planos × Atividades no Vizor

Status: **para aprovação do usuário. Nenhum código foi escrito.**
Base de conhecimento: `docs/orcamento-planos-calcgraf-HANDOFF.md` (seções 3, 12, 13, 14).

## 1. Princípios

1. **Tudo dirigido por cadastro.** Produto, tipo de plano e atividade deixam de ser fixos no código. A
   tela só mostra o que os cadastros e as relações permitem (igual ao Calcgraf).
2. **Três níveis visíveis:** Orçamento, Item, Plano (cor e rótulo próprios).
3. **Não mexer no motor de cálculo nem na ancoragem de custo** dos itens puxados. Os campos novos
   são de entrada e de apresentação; só entram no cálculo quando já existir regra para isso.
4. **Aditivo e idempotente:** colunas e tabelas novas com `IF NOT EXISTS`, `migrate-prod.ts` no mesmo
   commit do schema. Itens e planos existentes continuam funcionando.
5. Não escrever "Calcgraf" em texto visível ao usuário. O código importado fica em coluna interna.

## 2. Modelo de cadastros (backend)

### 2.1 Entidades novas
| Entidade | Papel | Origem na base |
|---|---|---|
| `ProdutoGrafico` | Produto da linha (Cartuchos, Caixa, Envelope, Display…). Guarda tributação 2026/2027, fechamento, base de preço, unidade, prazo, faturamento mínimo, tipo de cartucho, **modo de formato**, classificação fiscal | `Produtos` (12) |
| `TipoPlanoGrafico` | Tipo de plano (Cartão, Microondulado, Berço, Invólucros, Envelope, Base, Impressos, planos fixos). Guarda os parâmetros do plano (miolo, cálculo de formato, 1ª medida, ocorrências, quebra, corte duplo, suporte padrão, montagem/pinça, fibra default, frente=verso, caderno, margens) e `fixo` (sim/não) | `Planos` (14) + `_CaracteristicasPlano` |
| `RelacaoCadastroGrafico` | **Tabela genérica de relações**: `empresaId`, `tipoOrigem`, `idOrigem`, `tipoDestino`, `idDestino` (+ índice único). Espelha a `RelTabelas` | `RelTabelas` (2.094) |
| `DefaultProdutoPlano` | Valores iniciais do produto por plano: sem impressão, processo, cobertura, cores, área %, fabricante, atividades pré-marcadas | `ProdutosxPlanos`, `ProdutosxAtividades` |
| `CampoLivreProduto` | Rótulo de campo livre por produto (ARTE, PADRÃO) | fonte ainda não achada; cadastro simples |

Tipos da relação genérica: `SUPORTE, ITEM_DIVERSO, PLANO, COBERTURA_TINTA, ATIVIDADE, LINHA, ACONDICIONAMENTO,
CENTRO, PRODUTO, TINTA, MATRIZ, MATERIAL`. Pares usados: Produto×Plano, Produto×Atividade,
Produto×Acondicionamento, Produto×ItemDiverso, Plano×Atividade, Plano×Cobertura, Plano×ItemDiverso,
Plano×Suporte, Atividade×Material, Atividade×Centro, Atividade×Linha, Atividade×Tinta,
Matriz×Atividade, Matriz×Centro, Suporte×Atividade.

**Por que uma tabela genérica e não várias de junção:** o Calcgraf usa uma só, a tela de manutenção
("quais itens estão ligados") é a mesma para todos os pares, e a importação é 1 para 1. O custo é
perder chave estrangeira. Mitigação: validar o par permitido no serviço e na importação.

### 2.2 Reaproveitar o que já existe no Vizor
`LinhaProduto`, `AcabamentoGrafico` (já tem `planoProduto` PLANO|PRODUTO, `materiais` Json),
`RestricaoAcabamento`, `MaterialAcabamento`, `SuporteGrafico`, `CoberturaTinta`, `ProcessoImpressao`,
`CentroProducao`. Cada um ganha (se faltar) a coluna `codigoOrigem` para casar a importação. A relação
genérica aponta para os ids do Vizor. `TipoEmbalagem` continua só para o motor de planificação.

### 2.3 Campos novos em Item e Plano
- **`ItemOrcamentoGrafico`:** `produtoId`, atividades de produto selecionadas, acondicionamento
  (atividades 39/53), itens diversos, campos livres, "Informações complementares" (Venda de Cartão),
  unidade, formato de página (Lâminas), abas/sanfona (Sacola).
- **`PlanoCalculoGrafico`:** `tipoPlanoId`, ocorrências, tiragem própria, montagem, corte, formato aberto
  e final, processo, cobertura, **3 blocos de suporte** (capa externa, microondulado, capa interna, cada
  um com fabricante, suporte, fornecido), fibra, sentido da onda, ajuste de corte do micro, cores/processo/
  cobertura da capa interna, atividades de plano com restrição e material escolhidos.
- Sem apagar nada: o que já existe no item (processo, cobertura, fabricante etc.) continua e passa a ser
  o "plano único" para linhas fixas.

## 3. Tela (frontend)

Painel mestre-detalhe ao clicar no item do orçamento:

```
┌ ORÇAMENTO 3228 › ITEM 1  Caixa ─────────────────────────────────────────┐
│ DADOS DO ITEM (todo o produto)   │ PLANOS DO ITEM         [+ Incluir]     │
│ Produto, Descrição, Tiragens     │ Nome   Suporte  Cores  Formato  Custo  │
│ Modelos, Medidas, Abas, Tampa    │ ▶Cartão  …                              │
│ Atividades de PRODUTO            │  Micro   …              [Editar][Excluir]│
│ Acondicionamento, Itens diversos │ ───────────────────────────────────────│
│ Campos livres, Observação        │ PLANO SELECIONADO: Cartão               │
│                                  │ [Geral|Suportes|Cores|Acabamentos]      │
└──────────────────────────────────┴────────────────────────────────────────┘
```

Regras de comportamento (todas vindas dos cadastros):
1. Produto escolhido → define os tipos de plano do combo, as atividades de produto, o acondicionamento
   e o modo de formato (fechado+aberto, final, 3 dimensões, L×A×Sanfona+Abas).
2. Tipo de plano escolhido → define as atividades do plano, as coberturas e os suportes permitidos.
3. Atividade marcada → mostra ao lado suas restrições e materiais.
4. **Plano fixo** (Cartucho, Lâmina Simples, Sacola): sem grade, o formulário do plano abre junto do item.
   **Vários tipos permitidos** (Lâminas, Cartucho Composto): grade com Incluir, Editar, Excluir.
5. Plano em painel lateral (drawer) sobre o item, para o usuário ver o item e o plano juntos.
6. Cadastros: telas "Produtos", "Tipos de Plano" e "Relações" (matriz de marcação como a janela do
   Calcgraf) dentro de Orçamento Gráfico → Cadastros.

## 4. Importação
Script único e idempotente (`scripts/importar-cadastros-orcamento.ts`, `--empresa`, `--dry-run`),
lendo exportação da base restaurada (`sqlcmd -u`, UTF-16→UTF-8). Ordem: produtos, tipos de plano,
defaults, depois `RelTabelas` já traduzindo cada par de códigos para os ids do Vizor. Itens sem
equivalente são listados no relatório, nunca inventados. Execução em produção só com autorização.

## 5. Fases sugeridas (uma spec por fase, design-first)
1. **Cadastros e relações:** schema, importação, telas de cadastro. Sem mudar a tela do orçamento.
2. **Item guiado pelo cadastro:** produto define formato, atividades e acondicionamento. Começar pelo
   Cartucho (60% do uso), depois Lâmina Simples e Sacola.
3. **Planos com grade e drawer:** Cartucho Composto e Lâminas, campos ricos do plano.
4. **Atividade → restrição e material** no formulário, com valores informativos primeiro.
5. **Backfill** dos itens já puxados (só RASCUNHO), com autorização.

## 6. Riscos e decisões que preciso de você
1. Aprova a **tabela genérica de relações** (seção 2.1)? Alternativa: junções separadas, mais seguras e mais trabalhosas.
2. O **material escolhido** (Cola Branca ou Quente) deve influenciar preço agora ou só ser informativo? Hoje o Vizor só informa.
3. **Campos livres (ARTE, PADRÃO):** sem fonte no banco. Aceita cadastro simples por produto?
4. Prioridade das fases: confirma começar pela fase 1 e pelo Cartucho na fase 2?
5. O custo de planos extras (Cartucho Composto) continua em 0 como hoje, ou quer que cada plano calcule o próprio custo?
