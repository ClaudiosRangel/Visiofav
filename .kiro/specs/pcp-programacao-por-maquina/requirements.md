# Requisitos — Programação de Produção por Máquina (substituir Excel)

## Contexto

O gerente da produção controla a programação em uma planilha Excel com abas por máquina/etapa. Cada aba representa a fila de trabalho de uma máquina, onde ele ordena as OPs por prioridade e acompanha status. O objetivo é substituir esse controle por um módulo sistêmico integrado ao PCP.

## Referência: Planilha "PROGRAMAÇÃO WEGA MARÇO 2026"

### Abas identificadas:
- **DADOS** — Base mestre de todas as OS (cadastro completo)
- **Programação Impr.** — Fila da(s) impressora(s) (Heidelberg CD 5 cores)
- **Cortadeira** — Fila da(s) cortadeira(s) (Makpel, Grande)
- **Programação Ac.** — Fila dos acabamentos (BOBST, AFT70, Colagem)
- **T.** — Ficha resumo de consulta por OP

### Campos usados na programação por máquina:
- Número OS, Cliente, Produto, Status (texto livre: "OK", "15.000 fls", "Fabricado 31.800")
- Quantidade, Tiragem, Entrega
- Matriz/Faca, Cores, Cartão, Gramatura, Formato, KG, Previsto

## Requisitos Funcionais

### Requisito 1: Visão por Tipo de Máquina (Tabs)

1. THE Sistema SHALL exibir a programação em **tabs** por tipo de etapa:
   - Tab "Impressão" — centros tipo MAQUINA com operação de impressão
   - Tab "Cortadeira" — centros tipo MAQUINA com operação de corte
   - Tab "Acabamento" — centros tipo MAQUINA com operação de acabamento (BOBST, AFT70, colagem, verniz)
   - Tab "Todos" — visão completa (como está hoje)
2. Cada tab mostra **apenas as etapas** vinculadas a centros do tipo correspondente
3. Se o centro não tem tipo definido, mostra em "Todos"

### Requisito 2: Reordenação por Drag-and-Drop

1. THE Sistema SHALL permitir arrastar etapas dentro de cada centro para definir **ordem de prioridade** na fila
2. A ordem é salva no campo `sequencia` da EtapaOrdemProducao (ou em campo `posicaoFila` novo)
3. A reordenação atualiza via API: `PATCH /api/pcp/etapas/reordenar` com array de IDs na nova ordem
4. A ordem persiste entre recarregamentos

### Requisito 3: Campos Adicionais Visíveis (como no Excel)

1. THE Sistema SHALL exibir na tabela de programação os seguintes campos (além dos atuais):
   - **Tiragem** (calculada: quantidade / montagem, ou campo explícito)
   - **Cartão/Material** (nome do papel/cartão principal)
   - **Gramatura** (g/m²)
   - **Formato** (dimensões do papel)
   - **KG** (peso total de MP necessário)
   - **Matriz/Faca** (referência da faca de corte)
   - **Cores** (qtd cores + tipo: "5x0 CMYK")
2. Estes dados vêm da OP e seus materiais/atributos

### Requisito 4: Status Textual por Etapa (como no Excel)

1. THE Sistema SHALL permitir que o operador registre um **status textual livre** na etapa (ex: "OK - 15.000 fls", "Fabricado 31.800 fls", "Aguardando bobina")
2. Campo `observacaoOperador` já existe na EtapaOrdemProducao — usar este campo
3. O status textual aparece na tabela e é editável inline (click para editar)

### Requisito 5: Indicadores Visuais

1. Linhas coloridas por status (como no Excel):
   - Verde: concluída/OK
   - Amarelo: em andamento
   - Vermelho: atrasada (entrega < hoje e não concluída)
   - Cinza: pendente
2. Badge de prioridade (URGENTE = vermelho, ALTA = laranja)
3. Indicador de progresso (% da tiragem produzida)

### Requisito 6: Filtros e Busca

1. Filtro por período de entrega
2. Filtro por status (PENDENTE, EM_ANDAMENTO, CONCLUIDA)
3. Busca por número OS, cliente ou produto
4. Filtro por prioridade

### Requisito 7: Integração com Dados da OP

1. Ao clicar numa etapa, abrir detalhe da OP (link para `/pcp/ordens-producao/:id`)
2. Mostrar total de KG necessário por máquina/dia (soma dos KGs na fila)
3. Mostrar previsão de conclusão (baseada em tempo das etapas anteriores na fila)

## API Backend (novos endpoints)

| Método | Rota | Função |
|--------|------|--------|
| `PATCH` | `/api/pcp/etapas/reordenar` | Reordena etapas na fila de uma máquina |
| `GET` | `/api/pcp/programacao/painel` | Já existe — adicionar campos extras |
| `PATCH` | `/api/pcp/etapas/:id/observacao` | Atualiza observação/status textual inline |

## Tela Frontend

Localização: `/pcp/programacao` (já existe — será evoluída)

```
┌─────────────────────────────────────────────────────────────┐
│ Programação de Produção                                      │
├──────┬──────────┬───────────┬─────────────┬────────────────┤
│ Todos│Impressão │ Cortadeira│ Acabamento  │ [Busca...]     │
├──────┴──────────┴───────────┴─────────────┴────────────────┤
│                                                              │
│ ▼ Heidelberg CD 5 Cores (3 em fila, 1 em andamento)         │
│ ┌────┬────────┬──────────┬──────┬────────┬──────┬────────┐ │
│ │ ⠿ │ OP     │ Produto  │ Qtd  │Tiragem │ KG   │ Status │ │
│ ├────┼────────┼──────────┼──────┼────────┼──────┼────────┤ │
│ │ ⠿ │ #2849  │ Cart..   │2.2M  │115.740 │18.4t │▶ 60%  │ │
│ │ ⠿ │ #2850  │ Cx Dis.. │ 55k  │ 13.750 │ 3.2t │Pendente│ │
│ │ ⠿ │ #2851  │ Cart..   │110k  │ 55.000 │ 8.1t │Pendente│ │
│ └────┴────────┴──────────┴──────┴────────┴──────┴────────┘ │
│                                                              │
│ ▼ Cortadeira Grande (2 em fila)                             │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

## Prioridade de Implementação

1. Tabs por tipo de máquina (visual)
2. Campos extras na tabela (tiragem, cartão, formato, KG)
3. Status textual editável inline
4. Drag-and-drop para reordenação
5. Indicadores visuais (cores, progresso)
6. Filtros e busca
