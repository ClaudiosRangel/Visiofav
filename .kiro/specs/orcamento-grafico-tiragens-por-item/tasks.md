# Tasks — Várias tiragens por item

Design aprovado em 19/11/2026. P1 resolvida (escolha obrigatória da tiragem na aprovação).

- [x] 1. Schema: model `ItemTiragemOrcamentoGrafico` + `migrate-prod.ts` idempotente (rodar 2× local), mesmo commit
- [ ] 2. Back: `tiragens-item.service.ts` (validação 1..20, cálculo por tiragem somando planos, espelho da referência)
  - [ ]* 2.1 Property tests: soma dos planos por tiragem; item sem linhas igual ao legado; isolamento por empresa
  - [ ] 2.2 Teste de igualdade de custo: 12992 segue em R$ 5.192,05 / R$ 15.084,04
- [ ] 3. Back: rotas (PUT item com `tiragens`, GET devolve `tiragens[]`, PUT de valor/margem por tiragem)
- [ ] 4. Back: `fechamento-totalizador` lê as linhas por tiragem
- [ ] 5. Front: campo "Tiragens" na `TelaItem` (plano único e multi-plano), remover leitura das observações
- [ ] 6. Front: `AbaFechamento` editável por tiragem (valor informado ou faixa)
- [ ] 7. Aprovação: escolha obrigatória da tiragem quando o item tem mais de uma; PedidoVenda recebe só ela
- [ ] 8. (opcional) Backfill das tiragens dos cálculos migrados a partir de `CalculoTiragens`/`CalculoResAgrupamento`
- [ ] 9. Checkpoint: suítes, get_diagnostics, guard de marca legada e cores fixas


