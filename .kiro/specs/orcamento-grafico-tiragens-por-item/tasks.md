# Tasks — Várias tiragens por item

Design aprovado em 19/11/2026. P1 resolvida (escolha obrigatória da tiragem na aprovação).

- [x] 1. Schema: model `ItemTiragemOrcamentoGrafico` + `migrate-prod.ts` idempotente (rodar 2× local), mesmo commit
- [x] 2. Back: `tiragens-item.service.ts` (validação 1..20, cálculo por tiragem somando planos, espelho da referência)
  - [x] 2.1 Testes: validação, igualdade com o motor, soma dos planos por tiragem, ida e volta valor/margem (property), gravação com empresaId e 404 (22 testes)
  - [ ] 2.2 Teste do 12992 (R$ 5.192,05 / R$ 15.084,04) pela rota real: depende da tarefa 3, pois o serviço ainda não está ligado às rotas
- [ ] 3. Back: rotas (PUT item com `tiragens`, GET devolve `tiragens[]`, PUT de valor/margem por tiragem)
- [ ] 4. Back: `fechamento-totalizador` lê as linhas por tiragem
- [ ] 5. Front: campo "Tiragens" na `TelaItem` (plano único e multi-plano), remover leitura das observações
- [ ] 6. Front: `AbaFechamento` editável por tiragem (valor informado ou faixa)
- [ ] 7. Aprovação: escolha obrigatória da tiragem quando o item tem mais de uma; PedidoVenda recebe só ela
- [ ] 8. (opcional) Backfill das tiragens dos cálculos migrados a partir de `CalculoTiragens`/`CalculoResAgrupamento`
- [ ] 9. Checkpoint: suítes, get_diagnostics, guard de marca legada e cores fixas



