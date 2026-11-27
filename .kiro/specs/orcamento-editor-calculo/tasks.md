# Tarefas — Editor do Cálculo

- [x] 1. Modelo da Linha de Produto
  - [x] 1.1 `LinhaProduto.modelo` no schema + `migrate-prod.ts` (ADD COLUMN IF NOT EXISTS; preenche pelo código/nome importado: CARTUCHO COMPOSTO → CARTUCHO_COMPOSTO etc., só onde estiver no default)
  - [x] 1.2 Rota do cadastro aceita/devolve `modelo`; tela de Linhas de Produto com o seletor
- [x] 2. Tabelas `folha_calculo_grafico` e `atividade_folha_grafico` (schema + migrate-prod, idempotente)
- [x] 3. Geração pura `gerar-folhas.ts` + testes (capa/micro/capa interna, repartição, regeração com manuais, AVULSO)
- [ ] 4. Serviço + rotas do Editor (GET editor, gerar, CRUD de folhas, ordem, copiar, atividades, detalhes); empresaId explícito, Rascunho, guarda do fluxo
- [ ] 5. Cálculo por folhas (`calcularItemPorFolhas`), tiragens e consolidado usando folhas quando existirem; camadas desligadas com folhas; ancoragem intacta; teste de não regressão (item sem folhas = mesmo valor)
- [ ] 6. Front: botão Editor + tela do Editor (grades Produto e Planos, incluir/copiar/excluir/reordenar, atividades com Aplicado sobre) — após aprovação do wireframe
- [ ] 7. Front: janela Planos (suporte, NC, opções, atividades do plano, impressão 1/2/3, tintas, custo ao vivo, campos manuais)
- [ ] 8. Front: janela Detalhes da atividade (parâmetros, materiais com cobertura, informação complementar)
- [ ] 9. Status Ped/OP por item na grade do orçamento (back: devolver pedido/OPs do item; front: coluna com link)
- [ ] 10. Checkpoint: testes, tsc nos dois projetos, conferência na tela com um Cartucho Composto e um Cartucho
