# Tasks — Várias tiragens por item

Design aprovado em 19/11/2026. P1 resolvida (escolha obrigatória da tiragem na aprovação).

- [x] 1. Schema: model `ItemTiragemOrcamentoGrafico` + `migrate-prod.ts` idempotente (rodar 2× local), mesmo commit
- [x] 2. Back: `tiragens-item.service.ts` (validação 1..20, cálculo por tiragem somando planos, espelho da referência)
  - [x] 2.1 Testes: validação, igualdade com o motor, soma dos planos por tiragem, ida e volta valor/margem (property), gravação com empresaId e 404 (22 testes)
  - [ ] 2.2 Teste do 12992 (R$ 5.192,05 / R$ 15.084,04) pela rota real: depende da tarefa 3, pois o serviço ainda não está ligado às rotas
- [ ] 3. Back: rotas (PUT item com `tiragens`, GET devolve `tiragens[]`, PUT de valor/margem por tiragem)
- [x] 4. Back: `fechamento-totalizador` lê as linhas por tiragem (uma linha por tiragem somando os itens; `itensSemEstaTiragem` avisa total parcial; item sem linhas segue como antes). Conferido na integração real
- [x] 5. Front: campo "Tiragens" no bloco comum da `TelaItem` (plano único e multi-plano): lista por vírgula, ponto de milhar, validação por valor, `tiragens` no payload só quando o campo muda. A leitura das tiragens iniciais pelas observações do orçamento (wizard antigo `ItemWizardModal`) não foi removida: o wizard é outro fluxo
- [x] 6. Front: `AbaFechamento` editável por tiragem (valor informado ou faixa)
- [x] 7. Aprovação: escolha obrigatória da tiragem quando o item tem mais de uma; PedidoVenda recebe só ela
- [ ] 8. (opcional) Backfill das tiragens dos cálculos migrados a partir de `CalculoTiragens`/`CalculoResAgrupamento`
- [ ] 9. Checkpoint: suítes, get_diagnostics, guard de marca legada e cores fixas





## Registro das tarefas 6 e 7 (implementadas)

- 6: secao 'Tiragens do item' na aba Fechamento (item selecionado por padrao, seletor de item). Margem e Valor Total editaveis por tiragem, selo 'digitado' e botao 'Voltar ao calculo' (PUT /tiragens/:quantidade com { limpar: true }). Arquivos: _orcamento/TiragensItemEditaveis.tsx, _orcamento/tiragens-editaveis.ts (+ teste).
- 7: POST /:id/aprovar aceita { tiragens: { [itemId]: quantidade } }. Item com mais de uma tiragem sem escolha (ou com tiragem inexistente) responde 400 code TIRAGEM_OBRIGATORIA com a lista de itens; a escolhida vira a referencia do item (ordem 0, espelhada no item) e o pedido usa o consolidado. Front abre o modal 'Tiragem aprovada'. Arquivos: hierarquia/aprovacao-tiragem.ts (+ teste), integracao local casos 4b/4c.
- Pendente: copiar item (item-copia.service) ainda nao copia as linhas de tiragem.
