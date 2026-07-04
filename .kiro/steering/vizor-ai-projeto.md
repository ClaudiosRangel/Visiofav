---
inclusion: auto
---

# Vizor AI — Projeto de IA Integrada ao ERP

## STATUS ATUAL (implementado e em produção)

- **LLM**: `claude-haiku-4-5` via Anthropic SDK, com function calling (`src/modules/ai/ai.service.ts`, `ai-tools.ts`, `ai-executor.ts`, `ai-system-prompt.ts`).
- **Chat**: widget no frontend (`src/components/ai/ChatWidget.tsx`) com upload de XML, sugestões clicáveis (shortcuts locais sem LLM), markdown renderizado, fallback local rico quando sem API key ou em erro.
- **Persistência**: histórico salvo em `ConversaAI`.
- **Tools ativas** (30+): navegação, CRUD de pedidos de venda/compra, orçamentos, consultas (vendas, top clientes/produtos, estoque, financeiro, NF-e, tributação), cadastros (cliente/produto/fornecedor) com sanitização de campos (NCM/CPF/CNPJ/telefone sem formatação), PDV (sangria/suprimento), diagnóstico de pré-requisitos, verificação de configuração da empresa.
- **Agendamento de recebimento no WMS — AGORA REAL** (antes só navegava):
  - `consultar_disponibilidade_docas`: verifica disponibilidade real nas docas (via `autoSchedulerService.listarSlotsDisponiveis`), retorna múltiplos horários livres por doca; se o dia estiver lotado em todas as docas, busca automaticamente os próximos dias com disponibilidade (`buscarProximosDiasDisponiveis`, varre até 14 dias).
  - `agendar_recebimento_real`: cria de fato o registro em `AgendaWms` via `agendaService.criarAgendamento`, resolvendo fornecedor/pedido de compra por nome/número.
  - `consultar_agendamentos`: lista agendamentos reais do dia (antes só navegava).
  - Fluxo documentado no system prompt: IA sempre pergunta dia/hora → consulta disponibilidade real → apresenta opções → só agenda após confirmação explícita do usuário. Nunca inventa horários.
- **Integração com ERP externo**: novo model `ConfigIntegracao` já existia; tools `configurar_integracao_erp` e `consultar_integracao_erp` adicionadas para a IA perguntar/configurar durante onboarding (nome do ERP externo: SAP, TOTVS, Sankhya, Senior, Bling, etc.).
- **Onboarding guiado**: system prompt expandido com roteiro passo-a-passo (segmento → regime tributário → módulos → detalhes de WMS: CDs, formato de endereçamento, docas, coletor de dados, funcionários → integração com ERP externo → cadastros iniciais → certificado digital). A IA faz UMA pergunta por vez, nunca despeja tudo de uma vez.
- **Importação de XML — AGORA REAL**:
  - Upload do XML (`POST /api/ai/upload`) → `processarXml()` extrai dados via regex, mostra resumo (fornecedor/valor/itens/conciliação) e guarda o XML em cache temporário por empresa (`ai-xml-pendente.ts`, TTL 30min, em memória — se o processo reiniciar no Render o usuário só precisa reenviar).
  - Quando o usuário confirma ("sim", "pode importar", etc.), `ai.service.ts` intercepta a frase ANTES do LLM/shortcuts e chama a tool `importar_xml_compras_real` de forma determinística (não depende do modelo decidir chamar a tool).
  - `executarImportarXmlComprasReal` (em `ai-executor.ts`): valida o XML com `compraFiscalService.parseNFeXml`, verifica duplicidade (CNPJ+número+série), cadastra fornecedor automaticamente se não existir, cadastra produtos novos com NCM sanitizado, cria `PedidoCompra` + `CompraEfetivada`, gera `DocumentoFiscal` de entrada (via `compraFiscalService.criarDocFiscalEntrada`, dentro da mesma transação) e as `ContaPagar` (parcelas configuráveis). Se a empresa não usa WMS, marca o pedido como RECEBIDO; se usa WMS, sugere agendar o recebimento a seguir.
  - Tool também pode ser chamada manualmente pela IA (`importar_xml_compras_real`, sem args — XML já em cache do servidor).

## PRÓXIMOS PASSOS (pendente)
1. Aprendizado de comportamento do usuário (hoje é só um comentário no prompt, sem implementação real de tracking).
2. Expandir tools de PCP e Fiscal com o mesmo nível de detalhe que Vendas/Compras/WMS já têm.
3. Persistir o cache de XML pendente em banco/Redis em vez de memória do processo, para sobreviver a restarts do Render (hoje é aceitável pois TTL é curto e o usuário pode reenviar).


## Visão Geral

O Vizor AI é um assistente de inteligência artificial nativo integrado ao VisioFab ERP. Ele funciona como um "copilot" que ajuda o usuário em TODOS os módulos do sistema, desde configuração inicial até operações do dia a dia.

## Objetivos

1. **Conhecer todo o projeto** — A IA sabe tudo sobre todos os módulos, endpoints, campos e regras de negócio
2. **Configurar o sistema** — Faz perguntas inteligentes e configura baseado no perfil do cliente (segmento, regime, operações)
3. **Otimizar digitações** — Traduz linguagem natural e imagens em lançamentos (pedidos, notas, agendamentos, etc.)
4. **Tirar dúvidas** — Responde qualquer pergunta sobre o sistema com contexto da empresa
5. **Navegar e entregar** — Leva o usuário às telas corretas, gera relatórios, faz consultas sob demanda

## Arquitetura

```
Frontend (Chat Widget)           Backend (/api/ai)              LLM (Claude API)
┌──────────────────┐            ┌──────────────────┐           ┌──────────────┐
│ Chat flutuante   │───POST────▶│ AI Controller    │──────────▶│ Claude Haiku │
│ - Texto livre    │            │ - Context Builder│           │ Function Call│
│ - Upload imagem  │            │ - Function Exec  │◀──────────│ - ações      │
│ - Sugestões      │◀───JSON────│ - Navigation     │           └──────────────┘
│ - Navegação auto │            │ - OCR (Tesseract)│
└──────────────────┘            └──────────────────┘
```

## Funcionalidades Detalhadas

### F1. Assistente Multi-Módulo
- Prompt do sistema contém documentação de TODOS os módulos
- Sabe: Vendas, Compras, Fiscal, Financeiro, WMS, PCP, Cadastros
- Responde perguntas sobre qualquer funcionalidade

### F2. Wizard de Configuração Inteligente
- No primeiro acesso, faz perguntas sobre o negócio
- Sugere e aplica configurações (regime tributário, CFOP padrão, estratégia WMS, etc.)
- Perguntas adaptativas: segmento → regime → operações → tributação → WMS

### F3. Lançamentos por Linguagem Natural / Imagem
- "Crie pedido para Cliente X com 10 UN do produto Y" → POST /api/pedidos-venda
- "Agende recebimento amanhã 14h na doca 2" → POST /api/agenda
- Upload DANFE (foto) → OCR → extrai dados → lança nota de entrada
- Upload boleto → OCR → cria conta a pagar

### F4. Suporte e Dúvidas
- RAG sobre documentação do sistema
- Contexto da empresa (dados reais: produtos, clientes, configurações)
- Exemplos: "Como cancelo uma NF-e?", "O que é CFOP 5102?"

### F5. Navegação e Entrega de Resultados
- "Me mostra vendas do mês" → navega para /vendas/relatorios com filtros
- "Abre pedido 1234" → navega para /vendas/pedidos/{id}
- "Qual estoque do produto ABC?" → consulta e responde inline
- "Gere relatório de comissões" → navega para /vendas/comissoes

## Tecnologias

| Componente | Tecnologia | Custo |
|---|---|---|
| LLM | Claude 3.5 Haiku (Anthropic) | ~$5-30/empresa/mês |
| OCR | Tesseract.js (local) | $0 |
| Function Calling | JSON Schema (50+ ações) | Incluso no LLM |
| Chat UI | Componente Mantine customizado | $0 |
| Embeddings (futuro) | Ada-002 ou local | Opcional |

## Fases de Implementação

### Fase 1 — OCR + Lançamento Automático (PRIORIDADE)
- Upload de DANFE → extrai dados → lança nota de entrada
- Upload de boleto → cria conta a pagar
- Usa Tesseract.js (sem custo de API)
- Impacto: elimina digitação manual de notas

### Fase 2 — Chat com Function Calling (CORE)
- Chat widget no frontend (canto inferior direito)
- Backend processa mensagem → envia ao LLM com contexto + tools
- LLM decide: responder OU executar ação (function calling)
- Ações: criar pedido, agendar, consultar estoque, navegar, etc.

### Fase 3 — Configuração Inteligente
- Wizard guiado por IA no onboarding
- Perguntas sobre segmento e operação
- Configuração automática de tributação, WMS, parâmetros

### Fase 4 — Voz + Mobile
- Speech-to-text (Whisper API) no app mobile
- Comandos por voz: "apontar produção da OP 1234, 50 peças"
- Vision API para identificar produtos por foto

## Endpoints da API AI

```
POST /api/ai/chat          — Enviar mensagem (texto ou imagem)
GET  /api/ai/sugestoes     — Sugestões contextuais para o usuário
POST /api/ai/ocr           — Upload de imagem para OCR
POST /api/ai/configurar    — Wizard de configuração (step by step)
GET  /api/ai/historico     — Histórico de conversas do usuário
```

## Estrutura de Resposta do Chat

```typescript
interface AIResponse {
  resposta: string           // Texto para exibir ao usuário
  acao?: {
    tipo: 'NAVEGAR' | 'EXECUTAR' | 'MOSTRAR_DADOS'
    rota?: string            // Para NAVEGAR: rota do frontend
    params?: Record<string, any> // Query params ou filtros
    resultado?: any          // Para MOSTRAR_DADOS: dados inline
  }
  sugestoes?: string[]       // Sugestões de próximos comandos
}
```

## Function Calling — Lista de Ações Disponíveis

### Vendas
- criarPedidoVenda, editarPedidoVenda, confirmarPedido, cancelarPedido
- criarOrcamento, converterOrcamento, finalizarVendaPdv
- consultarVendas, relatorioVendasPeriodo, curvaABC

### Compras
- criarPedidoCompra, importarXml, efetivarCompra
- consultarPedidosCompra

### Fiscal
- emitirNFe, cancelarNFe, inutilizarNFe
- consultarNFe, gerarSPED, simularTributos

### Financeiro
- criarContaPagar, criarContaReceber, baixarTitulo
- consultarFluxoCaixa, consultarInadimplencia

### WMS
- agendarRecebimento, consultarEstoque, gerarEtiqueta
- criarOndaSeparacao, consultarEnderecos

### Cadastros
- criarCliente, criarProduto, criarFornecedor
- consultarCliente, consultarProduto

### Configuração
- configurarEmpresa, configurarTributacao, configurarWMS
- configurarModulos

### Navegação
- abrirTela, abrirRelatorio, abrirCadastro
- voltarPagina, irParaModulo

## Referências
- Backend: src/modules/ai/ (a criar)
- Frontend: src/components/ai/ChatWidget.tsx (a criar)
- API Claude: https://docs.anthropic.com/
- Tesseract.js: https://github.com/naptha/tesseract.js
