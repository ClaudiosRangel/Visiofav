# Tasks WMS — Fase 2 (Evoluções)

## Análise SKU × Endereçamento × Ressuprimento (baseado no Delphi)

No sistema Delphi original, o SKU é central para o WMS. Cada produto tem múltiplos SKUs (embalagens) e cada SKU possui:
- **Dados Logísticos de Armazenagem**: endereço fixo, tipo de norma (FEFO/FIFO), pulmão regulador, nível mín/máx porta-palete, nível máx blocado
- **Dados Logísticos de Picking**: endereço de picking vinculado, tipo picking, capacidade, ponto de reposição (qtd e %), dias de reposição
- **Dados Logísticos de Expedição**: SKU de expedição, fracionado, absorve palete fechado, tipo produto, tipo carga
- **Validação de cubagem**: no endereçamento, valida se o SKU cabe no endereço (largura × altura × comprimento vs estrutura)
- **Operações de SKU**: cada SKU pode ter operações vinculadas (conferência, endereçamento, separação, etc.)

O endereçamento automático no Delphi:
1. Busca dados de armazenagem do produto/SKU
2. Busca dados de picking do produto/SKU
3. Monta matriz de endereços disponíveis (depósito → bairro → rua → prédio → nível → apto)
4. Valida cubagem do SKU vs estrutura do endereço
5. Gera movimentos de endereçamento (pulmão e picking)
6. Cria histórico de movimentação com saldo anterior/posterior

O ressuprimento no Delphi usa:
- Ponto de reposição (PONTOREP) — quantidade mínima no picking
- Ponto de reposição percentual (PONTOREPPERCENT) — % da capacidade
- Dias de reposição (PONTOREPDIAS) — frequência

---

## TASK-14: Dados Logísticos do Produto (Armazenagem + Picking + Expedição)
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** No Delphi, cada produto/SKU tem 3 conjuntos de dados logísticos que controlam onde e como o produto é armazenado, separado e expedido. No sistema atual, esses dados não existem.
- **Solução:**
  1. Criar models no Prisma: `DadosLogisticosArmazenagem`, `DadosLogisticosPicking`, `DadosLogisticosExpedicao`
  2. `DadosLogisticosArmazenagem`: skuId, sequencia, enderecoFixoId, tipoNorma (FEFO/FIFO/LIFO), pulmaoRegulador, nivelMinPP, nivelMaxPP, nivelMaxBlocado, fixo
  3. `DadosLogisticosPicking`: skuId, sequencia, enderecoPickingId, tipoPicking, capacidade, pontoReposicao, pontoReposicaoPercent, pontoReposicaoDias
  4. `DadosLogisticosExpedicao`: skuId, fracionado, absorbePaleteFechado, absorbePaleteFechadoCx, tipoProduto, tipoCargaId
  5. Criar rotas CRUD para cada um
  6. Integrar na tela de Dados Logísticos (nova aba no SKU ou página separada)
- **Arquivos:**
  - `prisma/schema.prisma` (3 novos models)
  - Criar: `src/modules/dados-logisticos/dados-logisticos.routes.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/dados-logisticos/page.tsx`

---

## TASK-15: Endereçamento Inteligente com SKU e Cubagem
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Backend
- **Problema:** O endereçamento automático atual distribui itens sequencialmente nos endereços livres, sem considerar cubagem, classificação ABC, tipo de norma ou endereço fixo do produto.
- **Solução:**
  1. No endereçamento automático, consultar dados logísticos de armazenagem do produto/SKU
  2. Se tem endereço fixo, usar esse endereço
  3. Validar cubagem: dimensões do SKU (lastro × camada × qtdEmbalagem) vs capacidade da estrutura do endereço
  4. Respeitar tipo de norma (FEFO: priorizar validade mais próxima, FIFO: priorizar entrada mais antiga)
  5. Respeitar classificação do produto vs classificação do endereço
  6. Respeitar ambiente de armazenagem (seco, refrigerado, congelado)
  7. Gerar movimentos separados para pulmão e picking
- **Arquivos:**
  - `src/modules/conferencia/conferencia-entrada.routes.ts` (rota enderecamento-automatico)
  - `src/modules/enderecamento/enderecamento-wms.routes.ts`

---

## TASK-16: Ressuprimento Inteligente com Ponto de Reposição
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** O ressuprimento atual usa um saldo mínimo global (parâmetro). No Delphi, cada produto/SKU tem seu próprio ponto de reposição configurado nos dados logísticos de picking.
- **Solução:**
  1. Usar `DadosLogisticosPicking.pontoReposicao` e `pontoReposicaoPercent` por produto
  2. Calcular necessidade: se saldo no picking < pontoReposicao, gerar sugestão
  3. Buscar pulmão mais próximo com saldo (respeitar FEFO/FIFO)
  4. Calcular quantidade a repor: capacidade do picking - saldo atual
  5. Gerar OS de reposição automaticamente (ou sugestão para aprovação)
- **Arquivos:**
  - `src/modules/ressuprimento/ressuprimento.routes.ts`
  - `VisioFab.Wms.Front/src/app/(interna)/wms/ressuprimento/page.tsx`

---

## TASK-17: Controle de Lote e Validade (FEFO/FIFO)
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** O sistema registra lote e validade nos saldos, mas não usa essas informações na separação nem no endereçamento.
- **Solução:**
  1. Na separação, priorizar endereços com validade mais próxima (FEFO) ou entrada mais antiga (FIFO)
  2. No endereçamento, agrupar por lote
  3. Alertas de produtos próximos ao vencimento
  4. Bloqueio automático de produtos vencidos
  5. Relatório de produtos por validade
- **Arquivos:**
  - `src/modules/onda-separacao/onda-separacao.service.ts`
  - `src/modules/ressuprimento/ressuprimento.routes.ts`
  - Criar: `VisioFab.Wms.Front/src/app/(interna)/wms/validade/page.tsx`

---

## TASK-27: Consulta de Produtos no WMS — Permitir Alterar SKU
- **Prioridade:** Alta
- **Tipo:** Feature
- **Onde:** Frontend
- **Problema:** A página `/wms/consulta/produtos` é somente leitura ("Visualização somente leitura. Para cadastrar ou editar produtos, acesse o módulo de Compras."). O operador do WMS não consegue visualizar nem alterar os SKUs dos produtos sem sair do módulo WMS e ir ao configurador.
- **Solução:**
  1. Remover o alerta de "somente leitura" e adicionar botão de SKU em cada linha da tabela de produtos
  2. Ao clicar, abrir Drawer lateral com o componente `SkuPanel` (já existente) para gerenciar SKUs do produto
  3. Manter a consulta de produtos como leitura (não editar nome, código, etc.), mas permitir CRUD completo de SKU
  4. Isso permite que o operador do armazém configure embalagens, dimensões, pesos e paletização sem precisar acessar o configurador
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/wms/consulta/produtos/page.tsx`
  - Reutilizar: `VisioFab.Wms.Front/src/app/(interna)/configurador/produtos/SkuPanel.tsx`

---

## TASK-18: Menu Lateral — Adicionar Novas Páginas WMS
- **Prioridade:** Alta
- **Tipo:** Melhoria
- **Onde:** Frontend
- **Problema:** As páginas criadas (dashboard, conferência-saída, transferência, ressuprimento, relatórios, auditoria, SKU) precisam estar no menu de navegação do WMS.
- **Solução:** Adicionar ao menu lateral do WMS:
  - Dashboard WMS
  - Conferência de Saída
  - Transferência entre Endereços
  - Ressuprimento
  - Relatórios
  - Auditoria
  - SKU / Embalagens
  - Dados Logísticos
- **Arquivos:**
  - Componente de navegação/sidebar do WMS

---

## TASK-19: Prisma Migrate — Criar Tabelas Pendentes
- **Prioridade:** Alta
- **Tipo:** Técnico
- **Onde:** Backend
- **Problema:** Os models Sku, LogMovimentacao, Inventario, ItemInventario, AuditLog foram adicionados ao schema mas a migration não foi executada.
- **Solução:**
  ```bash
  npx prisma generate
  npx prisma migrate dev --name add_sku_log_inventario_audit
  ```
- **Arquivos:**
  - `prisma/schema.prisma`

---

## TASK-20: Dashboards com Gráficos
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Frontend
- **Problema:** O dashboard WMS mostra apenas números. Faltam gráficos visuais.
- **Solução:**
  1. Instalar Recharts ou Chart.js
  2. Gráfico de barras: ocupação por rua
  3. Gráfico de linha: recebimentos por dia (últimos 7 dias)
  4. Gráfico de pizza: OS por tipo de operação
  5. Gráfico de barras: produtividade por funcionário
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/wms/dashboard/page.tsx`

---

## TASK-21: Conferência por Código de Barras (Coletor)
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Frontend
- **Problema:** A rota `POST /conferir-por-barras/:notaId` já existe no backend, mas não há UI para conferência por leitura de código de barras.
- **Solução:**
  1. Criar modo "Coletor" na conferência de entrada
  2. Campo de input que recebe leitura do scanner (foco automático)
  3. Ao escanear, identifica o produto pelo código e incrementa a contagem
  4. Feedback sonoro/visual de sucesso ou erro
  5. Usar parâmetro WMS_CONF_DISPOSITIVO para alternar entre DIGITACAO e COLETOR
- **Arquivos:**
  - `VisioFab.Wms.Front/src/app/(interna)/wms/conferencia-entrada/page.tsx`

---

## TASK-22: Impressão Térmica (ZPL/EPL)
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** A impressão de etiquetas usa `window.open` com HTML. Em armazém real, usa-se impressoras térmicas Zebra com linguagem ZPL.
- **Solução:**
  1. Criar rota que gera etiqueta em formato ZPL
  2. Opção de enviar direto para impressora via raw printing
  3. Configuração de modelo de etiqueta por tipo (endereço, produto, volume)
- **Arquivos:**
  - `src/modules/etiqueta/etiqueta.routes.ts`

---

## TASK-23: DANFE PDF Real
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend
- **Problema:** A rota `GET /nfe/:id/danfe` retorna placeholder. Precisa gerar PDF real.
- **Solução:**
  1. Usar pdfkit ou puppeteer para gerar DANFE
  2. Layout padrão DANFE com dados da NF-e
  3. Código de barras da chave de acesso
- **Arquivos:**
  - `src/modules/nfe/nfe.routes.ts`

---

## TASK-24: Assinatura Digital NF-e e Comunicação SEFAZ
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend
- **Problema:** As rotas de assinatura e envio para SEFAZ são stubs.
- **Solução:**
  1. Implementar assinatura XML com node-forge (RSA-SHA1, C14N)
  2. Implementar comunicação SOAP com SEFAZ (NfeAutorizacao4)
  3. Consulta de protocolo (NfeRetAutorizacao4)
  4. Validação de certificado A1 (.pfx)
- **Arquivos:**
  - `src/modules/nfe/nfe-assinatura.ts`
  - `src/modules/nfe/nfe-sefaz.ts`

---

## TASK-25: Regras de Endereçamento por Classificação ABC
- **Prioridade:** Média
- **Tipo:** Feature
- **Onde:** Backend
- **Problema:** Produtos classe A (alto giro) devem ficar em endereços de fácil acesso (níveis baixos, próximos à doca). Não há essa lógica.
- **Solução:**
  1. Usar campo `curvaAbc` do produto (A, B, C)
  2. Classificação do endereço (END_CLASS_PROD no Delphi)
  3. No endereçamento, priorizar endereços compatíveis com a curva ABC
  4. A = níveis baixos, próximos à doca; C = níveis altos, distantes
- **Arquivos:**
  - `src/modules/conferencia/conferencia-entrada.routes.ts`

---

## TASK-26: Notificações em Tempo Real (WebSocket)
- **Prioridade:** Baixa
- **Tipo:** Feature
- **Onde:** Backend + Frontend
- **Problema:** Não há notificações em tempo real. O frontend usa polling (refetchInterval).
- **Solução:**
  1. Integrar @fastify/websocket no backend
  2. Emitir eventos: veículo chegou, conferência concluída, OS criada, estoque baixo
  3. No frontend, conectar WebSocket e mostrar notificações toast
- **Arquivos:**
  - `src/server.ts`
  - Criar: `src/modules/websocket/websocket.routes.ts`
  - `VisioFab.Wms.Front/src/components/NotificationProvider.tsx`

---

## Resumo por Prioridade

| Prioridade | Tasks |
|------------|-------|
| **Alta**   | TASK-14 (dados logísticos) ✅, TASK-15 (endereçamento inteligente) ✅, TASK-16 (ressuprimento inteligente) ✅, TASK-18 (menu lateral) ✅, TASK-19 (prisma migrate) ⚠️, TASK-27 (SKU na consulta produtos) ✅ |
| **Média**  | TASK-17 (lote/validade FEFO) ✅, TASK-20 (gráficos) ✅, TASK-21 (coletor barras) ✅, TASK-25 (classificação ABC) ✅ |
| **Baixa**  | TASK-22 (impressão ZPL) ✅, TASK-23 (DANFE PDF) ✅, TASK-24 (SEFAZ) ✅, TASK-26 (WebSocket) ✅ |
