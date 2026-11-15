# Plano de Implementação — Orçamento Gráfico: Cadastros e Relações (Fase 1)

Convenções: back em `c:\Source\VisioFab.Wms.Back`, front em `c:\Source\VisioFab.Wms.Front` (repos separados). Commits só quando o usuário pedir.
Toda mudança de `schema.prisma` vai com `prisma/migrate-prod.ts` idempotente no mesmo commit, rodando 2x. `empresaId` explícito em toda query.
Validação por `get_diagnostics` e Vitest (iniciar o processo, aguardar cerca de 40 s, ler a saída, parar). Não rodar `tsc` inteiro nem `next build`.
Tarefas marcadas com `*` são opcionais (testes de propriedade extras).

## Tarefas

- [ ] 1. Schema e migração
  - [x] 1.1 Adicionar modelos novos ao `schema.prisma`: `ProdutoGrafico`, `TipoPlanoGrafico`, `DefaultProdutoPlano`, `RelacaoCadastroGrafico`, `ItemDiversoGrafico`, `CampoLivre`, `CampoLivreOpcao`, `AjusteProdutividade`, `QuebraGrafica`, `QuebraGraficaLimite`, `LimiteMontagem`, `SelecaoMaterialAcabamento`
    - Índices por `empresaId`, unicidade por `codigoOrigem` parcial e unicidade da relação genérica
    - _Requisitos: 1.1, 2.1, 3.2, 4.1, 7.1, 9.1, 10.1, 11.1, 12.1, 16.1_
  - [x] 1.2 Adicionar colunas aditivas em tabelas existentes
    - `AcabamentoGrafico`, `RestricaoAcabamento`, `MaterialAcabamento`, `ItemOrcamentoGrafico.produtoGraficoId`, `PlanoCalculoGrafico.tipoPlanoId`, `codigoOrigem` em `LinhaProduto`, `CoberturaTinta`, `ProcessoImpressao`, `CentroProducao`, `SuporteGrafico`
    - _Requisitos: 6.1, 6.2, 6.3, 16.2, 16.4_
  - [x] 1.3 Escrever a migração idempotente em `prisma/migrate-prod.ts`
    - `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, índices e índice único parcial, FK em `try/catch`
    - _Requisitos: 16.3_
  - [~] 1.4 Rodar `npx prisma generate` e `npx tsx prisma/migrate-prod.ts` duas vezes no banco local
    - Confirmar que a segunda execução não falha nem duplica
    - _Requisitos: 16.3_

- [ ] 2. Módulos puros e testes
  - [x] 2.1 Criar `relacoes-permitidas.ts` com a lista fechada de pares e o validador
    - _Requisitos: 4.2, 4.3_
  - [x] 2.2 Criar `material-selecao.service.ts` (puro) com o cálculo por TipoParam
    - Tipos 0, 1 e 4 calculam consumo e custo reaproveitando `consumoVerniz` e `consumoCaixa`
    - Tipos 2 e 3 devolvem situação `A_VERIFICAR` e custo neutro
    - Preço ausente devolve custo zero e `A_VERIFICAR`
    - _Requisitos: 7.3, 7.4, 7.5, 7.7_
  - [x] 2.3 Criar `custo-plano.service.ts` (puro) que soma atividades e materiais por plano e o total do item novo
    - _Requisitos: 8.1, 8.2_
  - [x] 2.4 Testes unitários dos três módulos (Vitest)
    - Pares válidos e inválidos, cada TipoParam, preço ausente, soma por plano
    - _Requisitos: 2.1, 4.3, 7.4, 8.1_
  - [ ]* 2.5 Testes de propriedade (fast-check)
    - Gravar a seleção duas vezes dá o mesmo resultado; a soma dos planos é igual ao total; tipos 2 e 3 nunca mudam o custo; item puxado nunca muda o total
    - _Requisitos: 7.5, 7.6, 7.9, 8.2, 8.3_

- [ ] 3. API de cadastros (back)
  - [x] 3.1 Rotas CRUD de Produto Gráfico e Tipo de Plano com Zod, `empresaId` explícito e 409 em código duplicado
    - Plano fixo não pode ser excluído
    - _Requisitos: 1.1, 1.4, 1.5, 2.1, 2.3, 2.4_
  - [x] 3.2 Rotas de Defaults do produto por plano
    - Rejeitar tipo de plano não relacionado ao produto com 422
    - _Requisitos: 3.1, 3.2, 3.3, 3.4_
  - [x] 3.3 Rotas de Relações: listar, `PUT` que substitui o conjunto em transação, verificação de órfãs
    - 400 para par inválido, 422 com ids inexistentes na empresa, idempotente
    - _Requisitos: 4.4, 4.5, 4.6, 4.7_
  - [x] 3.4 Rotas de Itens Diversos, Campos Livres (com opções), Ajustes de Produtividade, Quebras (com limites) e Limites de Montagem
    - Ajustes, quebras e limites sem nenhuma consulta pelo motor ou pelo PCP
    - _Requisitos: 9.1, 9.4, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_
  - [x] 3.5 Rotas de Parâmetros do orçamento (`orc.*`) com lista fechada, validação de faixa e valores padrão
    - _Requisitos: 13.1, 13.2, 13.3, 13.4_
  - [x] 3.6 Registrar as rotas em `server.ts` sob `/api/orcamento-grafico/cadastros/*` com `authenticate` e a permissão de cadastro do módulo
    - _Requisitos: 15.7, 16.1_
  - [x] 3.7 Testes das rotas com Prisma mockado: isolamento por empresa, 400, 409, 422 e filtros
    - _Requisitos: 4.3, 4.5, 16.1_

- [ ] 4. Catálogo para o orçamento
  - [x] 4.1 Criar `catalogo.service.ts` e `catalogo.routes.ts` com `GET /catalogo/produto/:id` e `GET /catalogo/plano/:id?produtoId=`
    - Ordem pelo roteiro, acondicionamento separado, só registros ativos da empresa
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 4.2 Testes do catálogo: ordem, separação de acondicionamento, filtro por empresa e por status
    - _Requisitos: 5.3, 5.4, 5.5_

- [ ] 5. Seleção de material e preço
  - [x] 5.1 Rotas `PUT /selecao-material` e `GET /selecao-material?itemId=`
    - Validar a relação Atividade→Material (422 com a lista permitida)
    - _Requisitos: 7.1, 7.2_
  - [x] 5.2 Refletir a seleção no `materiaisAcabamento` do item
    - Marcar as linhas criadas pela seleção, sem sobrescrever linhas manuais; gravar o valor unitário no momento
    - _Requisitos: 7.8, 7.10_
  - [x] 5.3 Aplicar a regra de itens puxados e novos
    - Item com `calculoGraficoOrigemId` grava a seleção com `aplicaNoPreco = false` e mantém o custo ancorado
    - Item novo ou recalculado soma o custo ao Material Direto e ao plano
    - _Requisitos: 7.3, 7.6, 8.1, 8.2, 8.3_
  - [x] 5.4 Testes de regressão
    - Total de item puxado inalterado após gravar seleção; suíte `orcamento-grafico` e `decomposicao-stc.service.test.ts` continuam verdes
    - _Requisitos: 8.4, 16.5_

- [ ] 6. Ajustes nas telas e rotas já existentes de Acabamentos e Materiais (back)
  - [x] 6.1 Expor os campos novos de atividade, restrição e material nas rotas existentes sem mudar o comportamento atual
    - _Requisitos: 6.1, 6.2, 6.3, 6.5_

- [ ] 7. Importador
  - [x] 7.1 Criar `scripts/exportar-cadastros-orcamento.mjs` (somente leitura, `sqlcmd -u`, UTF-16 para UTF-8) gerando `cartoon/export/CadastrosOrcamento.json`
    - _Requisitos: 14.9_
  - [x] 7.2 Criar `scripts/importar-cadastros-orcamento.ts` com `--empresa`, `--dry-run`, `--arquivo`, `--fase` e relatório
    - Fases: catálogos, produtos, planos, atividades, materiais, itens diversos, relações, roteiros, defaults, campos livres, ajustes, quebras e parâmetros
    - _Requisitos: 14.1, 14.2, 14.7_
  - [x] 7.3 Implementar o tradutor de códigos de tabela e o casamento por nome normalizado
    - Ambíguo ou sem equivalente vira "não casado"; tabela 9 descartada; nunca mescla nem inventa
    - _Requisitos: 14.5, 14.6_
  - [x] 7.4 Implementar idempotência por `(empresaId, codigoOrigem)` e preenchimento só de campos vazios
    - _Requisitos: 14.3, 14.4_
  - [x] 7.5 Aplicar a ordem do roteiro às relações e listar divergências
    - _Requisitos: 14.8_
  - [x] 7.6 Testes do importador com arquivo de amostra
    - `--dry-run` não grava; segunda execução cria zero; relatório lista não casados; acentos preservados
    - _Requisitos: 14.2, 14.3, 14.6, 14.9_
  - [x] 7.7 Rodar o importador no banco local (se disponível) e, em produção, **somente após dry-run revisado e autorização explícita do usuário**
    - Conexão de produção por variável de ambiente, nunca em arquivo versionado
    - _Requisitos: 14.10_

- [x] 8. Checkpoint do back
  - Rodar a suíte do módulo de orçamento gráfico e os novos testes; `get_diagnostics` nos arquivos tocados; confirmar migração 2x. Perguntar ao usuário antes de seguir

- [ ] 9. Telas de cadastro (front)
  - [x] 9.1 Criar hooks e tipos de acesso à API (padrão do projeto) e itens de menu em Orçamento Gráfico → Cadastros com a permissão do módulo
    - _Requisitos: 15.7_
  - [x] 9.2 Tela de Produtos (abas Dados, Tributação, Defaults por plano, Relações)
    - _Requisitos: 1.1, 1.2, 3.1, 15.1, 15.6_
  - [x] 9.3 Tela de Tipos de Plano
    - _Requisitos: 2.1, 2.2, 2.3, 15.1_
  - [x] 9.4 Tela de Relações com matriz de marcação (par, origem, destinos, salvar substituindo)
    - _Requisitos: 4.4, 15.2_
  - [x] 9.5 Tela de Itens Diversos com vínculo de atividades
    - _Requisitos: 9.1, 9.2, 15.1_
  - [x] 9.6 Tela de Campos Livres e suas opções
    - _Requisitos: 10.1, 10.2, 10.3, 15.1_
  - [x] 9.7 Telas de Ajustes de Produtividade (com aba Restrições Automáticas), Quebras e Limites de Montagem
    - Aviso de que ainda não influenciam o cálculo nem o PCP
    - _Requisitos: 11.2, 11.3, 12.1, 12.2, 12.3, 15.3_
  - [x] 9.8 Tela de Parâmetros do orçamento
    - _Requisitos: 13.1, 13.2, 15.1_
  - [x] 9.9 Abas Restrições e Materiais na tela de Acabamentos e campos novos na tela de Materiais de Acabamento
    - Indicação "Acondicionamento" e aviso discreto de `A_VERIFICAR`
    - _Requisitos: 6.3, 6.4, 15.4_
  - [~] 9.10 Revisão transversal das telas
    - Estados de carregamento, vazio e erro, mensagens legíveis, temas claro e escuro, nenhuma menção ao sistema legado
    - _Requisitos: 15.5, 15.6_
  - [ ]* 9.11 Testes de componente das telas mais críticas (matriz de Relações e formulário de Produto)
    - _Requisitos: 15.2_

- [ ] 10. Documentação e fechamento
  - [x] 10.1 Atualizar `docs/orcamento-planos-calcgraf-HANDOFF.md` com o estado da fase 1 e `.kiro/steering/migracao-calcgraf-carton-wega.md` com um resumo curto
    - _Requisitos: 16.5_
  - [~] 10.2 Checkpoint final: testes verdes, `get_diagnostics` limpo nos dois repositórios, perguntar ao usuário sobre commit e sobre a execução do importador em produção
    - _Requisitos: 14.10, 16.5_

## Ordem e dependências

1 → 2 → 3 e 4 (em paralelo, dependem de 1 e 2) → 5 (depende de 2, 3 e 4) → 6 → 7 (depende de 1 e 3) → 8 (checkpoint) → 9 (depende de 3 a 5) → 10.
As tarefas 2.2 a 2.5 e 7.1 não dependem do schema e podem começar antes.

## Pontos a verificar o funcionamento exato (não bloqueiam)

- Parâmetro 2 do TipoParam 3 e fórmulas dos TipoParam 2 e 3 (entram só como informativos).
- Unidade do preço de cada material e gramatura de cada verniz.
- Influência futura de Ajustes de Produtividade, Quebras e Limites de Montagem no PCP e no motor.
