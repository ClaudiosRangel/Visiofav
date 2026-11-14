---
inclusion: manual
---

# Orçamento gráfico: Item × Planos × Atividades (refino em andamento)

Documento-mestre: `docs/orcamento-planos-calcgraf-HANDOFF.md`. Leia antes de mexer na tela de orçamento ou em planos.

Regras desta frente:
- Não codar antes de fechar o desenho com o usuário. Comece pelas dúvidas da seção 9 do handoff.
- Ao criar spec, pergunte primeiro o ponto de entrada (requirements ou design).
- Três níveis: Orçamento, Item, Plano. Painel mestre-detalhe com grade de planos (Incluir/Editar/Excluir).
- Não alterar a ancoragem de custo dos itens puxados do Calcgraf nem o motor de cálculo.
- Não mencionar "Calcgraf" em textos visíveis das telas de orçamento.
- Schema novo exige `migrate-prod.ts` idempotente no mesmo commit.
