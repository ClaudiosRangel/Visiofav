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

## 6. Decisões fixadas (14/11/2026, com base em como o Calcgraf faz; ver handoff seção 15)
1. **Relações:** tabela genérica única, igual à `RelTabelas`. Validar o par permitido no serviço e na importação.
2. **Material escolhido** (Cola Branca ou Quente, BOPP etc.) **influencia o preço**, como no Calcgraf.
   Vale só para itens novos ou recalculados. **Itens puxados do acervo mantêm o custo ancorado** (não mudam).
   O significado de `ParamAcab1/2` ainda não está confirmado; até confirmar, o consumo usa a regra atual do Vizor.
3. **Campos livres (ARTE, PADRÃO):** **corrigido em 14/11/2026 (handoff seção 17.1).** São campos de lista da
   Solicitação (ARTE: Alteração, Novo, Repetição; PADRÃO: Amostra, Contratual, Pasta Padrão), obrigatórios na
   solicitação e copiados ao pedido. Cadastro configurável por proprietário, sem efeito no preço.
4. **Ordem das fases:** fase 1 (cadastros e relações), depois Cartucho na fase 2, como na seção 5.
5. **Custo por plano:** o Calcgraf calcula por plano (atividades e materiais gravam o plano). No Vizor:
   - nos itens puxados, o custo dos planos continua em 0 (detalhamento), para não mexer no total ancorado;
   - nos itens novos, o custo do plano é a soma das suas atividades e materiais, e o total do item é a soma dos planos.
   - dividir o custo dos itens puxados por plano fica para fase posterior, usando as linhas por plano da base de cálculo.

## 6.1 Respostas do usuário (14/11/2026) que valem para a spec da fase 1
1. Tabela genérica de relações: **aprovada**.
2. Material influencia o preço: **implementar já na fase 1/2**, tudo alinhado (cadastro, relação, parâmetro e cálculo
   coerentes). Itens puxados do acervo continuam ancorados.
3. Campos livres (ARTE, PADRÃO, Motivos de Recusa): **implementar já** (cadastro configurável por proprietário),
   mesmo que não seja prioridade.
4. Ajuste de Produtividade, Restrições Automáticas, Quebras e Limites de Montagem: **só cadastro e visualização
   agora**. A influência no PCP e no motor fica para depois.
5. `ParamAcab` tipos 2 e 3: deixar registrado como **ponto a verificar o funcionamento exato**.
6. **Telas de cadastro e de visualização incluídas no escopo** (não só backend).
7. Autorizado commitar e publicar a documentação e a spec. Importação em produção continua exigindo dry-run antes.

## 7. Pendências (resolvidas e abertas; detalhe na seção 16 do handoff)
- `ParamAcab1/2` e `TipoParamAcab`: **resolvido em grande parte.** O tipo define o significado (0 sem parâmetro,
  1 % de cobertura frente/verso, 2 dimensões em mm, 3 medida linear em mm, 4 quantidade). Guardar os dois
  parâmetros e o tipo; aplicar fórmula de preço só nos tipos 0, 1 e 4; tipos 2 e 3 ficam informativos até
  validar contra um cálculo real.
- Tabela 9 da `RelTabelas`: **descartada** (resíduo desalinhado, não importar).
- ARTE e PADRÃO: opções fixas, cadastro simples por produto.
- Aberto: `ParamAcab2` com tipo 3, e telas de Editorial e Rótulo, se vierem a ser usadas.
