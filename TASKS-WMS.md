# Tasks Pendentes — Módulo WMS

## Bugs / Correções

### TASK-01: Conferência de Entrada — Itens não listam na tabela de notas pendentes ✅ CONCLUÍDA
- **Prioridade:** Alta
- **Tipo:** Bug
- **Onde:** Backend `conferencia/conferencia-entrada.routes.ts` → rota `GET /notas-pendentes`
- **Problema:** A rota retorna as notas com `include: { itens: true }` do Prisma, mas o `.map()` remove os itens do response, retornando apenas `totalItens` (número). O frontend espera `nota.itens` como array para exibir a contagem e para uso posterior, mas recebe `undefined`.
- **Solução:** Incluir o array `itens` no retorno da rota `GET /notas-pendentes` (pelo menos `id`, `item`, `descricao`, `codigoProduto`, `unidade`), ou garantir que o campo `totalItens` seja usado corretamente no frontend. Verificar também se o frontend em `conferencia-entrada/page.tsx` usa `nota.itens?.length` ou `nota.totalItens` na coluna "Itens".
- **Arquivos:**
  - `VisioFab.Wms.Back/src/modules/conferencia/conferencia-entrada.routes.ts` (rota GET /notas-pendentes)
  - `VisioFab.Wms.Front/src/app/(interna)/wms/conferencia-entrada/page.tsx` (coluna Itens na tabela)

---

## Funcionalidades Novas

### TASK-02: Tela de SKU dos Produtos ✅ CONCLUÍDA
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Frontend — Configurador
- **Problema:** O backend já possui CRUD completo de SKU (`/api/skus`) com campos: sequência, descrição, código de barras, unidade, qtd embalagem, dimensões (largura, altura, comprimento, volume), pesos (líquido, bruto, palete), lastro, camada e tipo palete. Porém **não existe nenhuma tela no frontend** para gerenciar SKUs. Nenhuma referência a "sku" ou "SKU" foi encontrada no código do frontend.
- **Solução:** Criar tela de SKU dentro do cadastro de produtos (aba ou seção dentro da página de edição do produto) ou como página separada no configurador (`/configurador/produtos/[id]/skus`). A tela deve permitir:
  - Listar SKUs do produto selecionado
  - Criar novo SKU (formulário com todos os campos)
  - Editar SKU existente
  - Excluir SKU
  - Cálculo automático de volume quando largura × altura × comprimento forem informados
- **Arquivos:**
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/configurador/produtos/[id]/skus/page.tsx`
  - Ou integrar como aba em: `VisioFab.Wms.Front/src/app/(interna)/configurador/produtos/page.tsx`
  - API já pronta: `VisioFab.Wms.Back/src/modules/sku/sku.routes.ts`

---

### TASK-03: Histórico de Manutenção de Estoque (Log de Movimentações) ✅ CONCLUÍDA
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** A rota `GET /manutencao-estoque/historico` retorna array vazio com mensagem placeholder. Não existe tabela de log de movimentações no schema Prisma.
- **Solução:**
  1. Criar model `LogMovimentacao` no schema Prisma (campos: id, empresaId, produtoId, enderecoId, tipo, quantidade, motivo, usuarioId, criadoEm)
  2. Registrar cada ajuste de estoque nessa tabela (no `POST /ajuste`)
  3. Implementar a rota `GET /historico` com filtros (produto, endereço, tipo, período)
  4. Criar seção/aba de histórico na tela de manutenção de estoque no frontend
- **Arquivos:**
  - `VisioFab.Wms.Back/prisma/schema.prisma` (novo model)
  - `VisioFab.Wms.Back/src/modules/manutencao-estoque/manutencao-estoque.routes.ts`
  - `VisioFab.Wms.Front/src/app/(interna)/wms/manutencao-estoque/page.tsx`

---

### TASK-04: Página de Gestão Operacional com Dados Reais ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Frontend
- **Problema:** A página `/gestao` usa dados hardcoded (arrays estáticos de agendamentos e veículos). Não consome nenhuma API.
- **Solução:** Conectar a página às APIs reais:
  - Agendamentos do dia: `GET /api/agenda-wms?data=YYYY-MM-DD`
  - Portaria/veículos: `GET /api/portaria/agendamentos-hoje`
  - Funcionários: `GET /api/funcionarios`
  - Docas: `GET /api/docas`
  - Adicionar KPIs calculados (ocupação de docas, veículos no pátio, etc.)
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/gestao/page.tsx`

---

### TASK-05: Dashboard WMS com KPIs ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** Não existe dashboard específico do módulo WMS. O dashboard geral não mostra KPIs de armazém.
- **Solução:** Criar rota de KPIs no backend e dashboard no frontend com:
  - Ocupação do armazém (% endereços ocupados)
  - Recebimentos do dia (agendados vs concluídos)
  - OS abertas por tipo de operação
  - Ondas de separação em andamento
  - Produtividade (itens conferidos/endereçados/separados por hora)
  - Alertas (produtos vencendo, endereços bloqueados)
- **Arquivos:**
  - Criar: `VisioFab.Wms.Back/src/modules/dashboard-wms/dashboard-wms.routes.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/dashboard/page.tsx` ou integrar no `/dashboard`

---

### TASK-06: Tela de Conferência de Saída ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Frontend
- **Problema:** O backend possui módulo completo de conferência de saída (`/api/conferencias-saida`), mas não existe página dedicada no frontend. O fluxo de verificar volumes antes do carregamento não tem UI.
- **Solução:** Criar página `/wms/conferencia-saida` com:
  - Lista de ondas/pedidos prontos para conferência de saída
  - Tela de conferência (verificar volumes, quantidades, produtos)
  - Aprovação/rejeição da conferência
  - Integração com o fluxo de carregamento
- **Arquivos:**
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/conferencia-saida/page.tsx`
  - API já pronta: `VisioFab.Wms.Back/src/modules/conferencia-saida/conferencia-saida.routes.ts`

---

### TASK-07: Transferência entre Endereços (Mudança de Endereço) ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Frontend + Backend (ajustes)
- **Problema:** Não há tela para movimentar estoque de um endereço para outro dentro do armazém. O backend suporta OS com operação "MUDANCA_ENDERECO", mas falta fluxo dedicado.
- **Solução:** Criar tela `/wms/transferencia-endereco` com:
  - Selecionar endereço de origem (com saldo)
  - Selecionar produto e quantidade
  - Selecionar endereço de destino
  - Executar transferência (debitar origem, creditar destino)
  - Gerar OS de mudança de endereço automaticamente
- **Arquivos:**
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/transferencia-endereco/page.tsx`
  - Ajustar: `VisioFab.Wms.Back/src/modules/manutencao-estoque/manutencao-estoque.routes.ts` (nova rota de transferência)

---

### TASK-08: Filtros no Mapa do Armazém (Depósito e Zona) ✅ CONCLUÍDA
- **Prioridade:** Baixa
- **Tipo:** Melhoria
- **Onde:** Frontend
- **Problema:** O backend aceita filtros por `depositoId` e `zonaId` na rota `GET /posicionamento/mapa`, mas o frontend só expõe filtro por produto.
- **Solução:** Adicionar selects de Depósito e Zona na tela do mapa, carregando as opções das APIs `/api/depositos` e `/api/zonas`.
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/wms/mapa/page.tsx`

---

### TASK-09: Ressuprimento / Reposição Automática ✅ CONCLUÍDA
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** Não há módulo de ressuprimento automático (picking face → pulmão). O backend tem a operação "REPOSICAO" nas OS, mas não há fluxo automatizado nem UI dedicada.
- **Solução:**
  1. Criar lógica de verificação de nível mínimo por endereço de picking
  2. Gerar OS de reposição automaticamente quando o saldo do picking face ficar abaixo do mínimo
  3. Criar tela de gestão de reposições pendentes
- **Arquivos:**
  - Criar: `VisioFab.Wms.Back/src/modules/ressuprimento/ressuprimento.routes.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/ressuprimento/page.tsx`

---

### TASK-10: Relatórios Operacionais WMS ✅ CONCLUÍDA
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** Não existem relatórios operacionais do WMS.
- **Solução:** Criar módulo de relatórios com:
  - Produtividade por funcionário (itens/hora por operação)
  - Tempo médio de conferência e endereçamento
  - Acuracidade de inventário
  - Giro de estoque por endereço
  - Histórico de movimentações por período
- **Arquivos:**
  - Criar: `VisioFab.Wms.Back/src/modules/relatorios-wms/relatorios-wms.routes.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/relatorios/page.tsx`

---

### TASK-11: Log de Auditoria / Rastreabilidade ✅ CONCLUÍDA
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** Não há registro de quem fez o quê e quando nas operações WMS. Relacionado à TASK-03 mas com escopo mais amplo.
- **Solução:**
  1. Criar model `AuditLog` genérico (entidade, entidadeId, acao, usuarioId, dados, criadoEm)
  2. Registrar ações críticas: conferências, endereçamentos, ajustes, separações, carregamentos
  3. Criar tela de consulta de auditoria com filtros
- **Arquivos:**
  - `VisioFab.Wms.Back/prisma/schema.prisma` (novo model)
  - Criar: `VisioFab.Wms.Back/src/middleware/audit-log.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/auditoria/page.tsx`

---

### TASK-12: Expedição — Vincular Volumes a Carregamentos e Romaneio ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Melhoria
- **Onde:** Frontend
- **Problema:** A tela de expedição lista ondas e carregamentos, mas falta:
  - UI para vincular volumes específicos a um carregamento
  - Conferência de saída antes do carregamento
  - Romaneio de carga / lista de embarque para impressão
- **Solução:** Expandir a tela de expedição com:
  - Drag-and-drop ou seleção de volumes para carregamento
  - Botão de conferência de saída antes de confirmar
  - Geração e impressão de romaneio
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/expedicao/page.tsx`

---

### TASK-13: Inventário — Persistência e Rastreabilidade ✅ CONCLUÍDA
- **Prioridade:** Média
- **Tipo:** Melhoria
- **Onde:** Backend + Frontend
- **Problema:** O inventário funciona em memória (state local do React). A contagem não é persistida no banco. Falta modelo de "Inventário" com cabeçalho, itens e status para rastreabilidade.
- **Solução:**
  1. Criar models `Inventario` e `ItemInventario` no schema Prisma
  2. Criar rotas CRUD de inventário no backend
  3. Ajustar frontend para persistir contagens no banco
  4. Permitir inventários parciais (por zona, rua, produto)
- **Arquivos:**
  - `VisioFab.Wms.Back/prisma/schema.prisma` (novos models)
  - Criar: `VisioFab.Wms.Back/src/modules/inventario/inventario.routes.ts`
  - `VisioFab.Wms.Front/src/app/(interna)/wms/inventario/page.tsx`

---

## Resumo por Prioridade

| Prioridade | Tasks | Status |
|------------|-------|--------|
| **Alta**   | TASK-01 (bug conferência), TASK-02 (SKU), TASK-03 (histórico estoque) | ✅ Todas concluídas |
| **Média**  | TASK-04 (gestão real), TASK-05 (dashboard), TASK-06 (conf. saída), TASK-07 (transferência), TASK-12 (expedição), TASK-13 (inventário) | ✅ Todas concluídas |
| **Baixa**  | TASK-08 (filtros mapa), TASK-09 (ressuprimento), TASK-10 (relatórios), TASK-11 (auditoria) | ✅ Todas concluídas |
