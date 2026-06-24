# Implementation Plan: WMS Divergência Lote/Validade

## Overview

Implementação do tratamento de divergências de lote e validade na conferência de entrada. O plano segue 6 fases: Schema/Migração → Serviço de Lógica Pura → Configuração por Produto → Endpoint de Resolução → Integração com Conferência Existente → Frontend. Cada task referencia requisitos específicos e utiliza TypeScript com Fastify + Prisma no backend e Next.js + Mantine no frontend.

## Tasks

- [x] 1. Migração de banco e atualização do Prisma schema
  - [x] 1.1 Criar model ConfigConferenciaProduto no schema.prisma
    - Adicionar model com campos: id (uuid), empresaId, produtoId, modoResolucaoLote (VarChar(20) default "BLOQUEAR"), modoResolucaoValidade (VarChar(20) default "BLOQUEAR"), criadoEm, atualizadoEm
    - Adicionar constraint @@unique([empresaId, produtoId])
    - Adicionar @@map("config_conferencia_produto")
    - Adicionar relations para Empresa e Produto
    - Executar `prisma generate` para atualizar o client
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.2 Adicionar campo supervisorId ao model DivergenciaConferencia no schema.prisma
    - Adicionar `supervisorId String? @map("supervisor_id")`
    - Adicionar relation opcional para Usuario
    - _Requirements: 4.4_

  - [x] 1.3 Criar migração SQL em prisma/migrate-prod.ts
    - CREATE TABLE IF NOT EXISTS "config_conferencia_produto" com todos os campos, unique constraint em (empresa_id, produto_id)
    - ALTER TABLE "divergencia_conferencia" ADD COLUMN IF NOT EXISTS "supervisor_id" VARCHAR(36)
    - Adicionar índice em empresa_id para config_conferencia_produto
    - Seguir padrão existente com IF NOT EXISTS para idempotência
    - _Requirements: 1.1, 1.2, 1.4, 4.4_

- [x] 2. Implementar serviço de lógica pura para divergências
  - [x] 2.1 Criar src/modules/conferencia-entrada/divergencia-lote-validade.service.ts
    - Implementar tipos: ModoResolucao, DeteccaoDivergenciaInput, DeteccaoDivergenciaResult, ResolucaoInput, ResolucaoResult, TextoCCeLoteValidadeInput
    - Implementar constante MODOS_VALIDOS com os 4 modos
    - Implementar função `isModoValido(modo: string): modo is ModoResolucao`
    - Implementar função `detectarDivergenciaLote(input)`: retorna divergente=true se exigeLote=true e valores diferem (não-nulos, não-vazios)
    - Implementar função `detectarDivergenciaValidade(input)`: compara datas ignorando horas, retorna divergente=true se dias diferem
    - Implementar função `resolverModo(modo: ModoResolucao): ResolucaoResult` — retorna permitido/status/requerCCe conforme modo
    - Implementar função `gerarTextoCCeLoteValidade(input)`: gera string de correção contendo tipo, valor original e valor corrigido
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 5.1, 6.1_

  - [ ]* 2.2 Escrever property test para validação de enum de modo (Property 1)
    - **Property 1: Validação de enum de modo de resolução**
    - **Validates: Requirements 1.1, 1.2**
    - Usar fast-check para gerar strings arbitrárias e verificar: isModoValido retorna true ↔ valor é um dos 4 modos válidos

  - [ ]* 2.3 Escrever property test para detecção de divergência de lote (Property 3)
    - **Property 3: Detecção de divergência de lote**
    - **Validates: Requirements 2.1, 2.3**
    - Gerar pares (loteEsperado, loteConferido) com exigeLote=true e valores não-nulos/não-vazios diferentes; verificar divergente=true com tipo LOTE_DIVERGENTE e valores preservados

  - [ ]* 2.4 Escrever property test para detecção de divergência de validade (Property 4)
    - **Property 4: Detecção de divergência de validade**
    - **Validates: Requirements 2.2, 2.3**
    - Gerar pares de datas válidas que diferem no dia; verificar divergente=true com tipo VALIDADE_DIVERGENTE e valores preservados

  - [ ]* 2.5 Escrever property test para ACEITAR_LIVRE (Property 5)
    - **Property 5: ACEITAR_LIVRE resolve sem autenticação**
    - **Validates: Requirements 3.1**
    - Verificar que resolverModo('ACEITAR_LIVRE') retorna { permitido: true, novoStatus: 'ACEITA', requerCCe: false }

  - [ ]* 2.6 Escrever property test para BLOQUEAR (Property 7)
    - **Property 7: BLOQUEAR rejeita qualquer resolução**
    - **Validates: Requirements 6.1**
    - Verificar que resolverModo('BLOQUEAR') retorna { permitido: false } com mensagem informando bloqueio

  - [ ]* 2.7 Escrever property test para geração de texto CC-e (Property 8)
    - **Property 8: Geração de texto CC-e para lote/validade**
    - **Validates: Requirements 5.1**
    - Gerar dados arbitrários (tipo, valorEsperado, valorConferido, descricaoProduto) e verificar que texto contém tipo de correção, valor original e valor corrigido

- [x] 3. Checkpoint — Verificar serviço de lógica pura
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implementar serviço de configuração e validação de supervisor
  - [x] 4.1 Criar src/modules/conferencia-entrada/config-conferencia-produto.service.ts
    - Implementar interface ConfigResolucao com modoResolucaoLote e modoResolucaoValidade
    - Implementar constante CONFIG_PADRAO com ambos modos BLOQUEAR
    - Implementar função `obterModoResolucao(empresaId, produtoId): Promise<ConfigResolucao>` — busca no Prisma, retorna CONFIG_PADRAO se não encontrar
    - _Requirements: 1.3, 2.4_

  - [ ]* 4.2 Escrever property test para padrão BLOQUEAR (Property 2)
    - **Property 2: Padrão BLOQUEAR quando sem configuração**
    - **Validates: Requirements 1.3**
    - Verificar que para qualquer par (empresaId, produtoId) sem registro, retorna ambos modos BLOQUEAR

  - [x] 4.3 Implementar validação de credenciais de supervisor
    - Criar função `validarCredenciaisSupervisor(input: ValidacaoSupervisorInput): Promise<ValidacaoSupervisorResult>` no serviço de divergência ou em módulo separado
    - Buscar usuário por login na mesma empresa
    - Verificar perfil SUPERVISOR ou ADMIN
    - Validar senha com bcrypt
    - Retornar mensagens genéricas para não revelar qual campo está incorreto
    - _Requirements: 4.2, 4.3, 4.5, 4.6_

  - [ ]* 4.4 Escrever property test para validação de perfil do supervisor (Property 6)
    - **Property 6: Validação de perfil do supervisor**
    - **Validates: Requirements 4.2, 4.4**
    - Gerar combinações (perfil, senha) e verificar: perfil diferente de SUPERVISOR/ADMIN → valido=false; perfil correto + senha correta → valido=true

- [x] 5. Implementar endpoint de resolução e integrar com conferência
  - [x] 5.1 Criar rota POST /conferencia-entrada/resolver-divergencia-lv
    - Validar body com Zod (divergenciaId uuid, acao enum ACEITAR/REJEITAR, credenciaisSupervisor opcional)
    - Extrair empresaId do JWT
    - Buscar divergência por ID + empresaId (multi-tenancy)
    - Se não encontrada → 404 genérico
    - Buscar produto e ConfigConferenciaProduto
    - Determinar modo aplicável (lote→modoResolucaoLote, validade→modoResolucaoValidade)
    - Implementar switch por modo: BLOQUEAR→422, ACEITAR_LIVRE→ACEITA, ACEITAR_SENHA→validar credenciais, ACEITAR_CCE→emitir CC-e via CceService
    - Retornar RespostaResolucao com divergenciaId, status, modo, cce (se aplicável), mensagem
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.2 Estender rota POST /conferir-todos/:notaId para incluir modo de resolução
    - Após detectar divergência de lote/validade, consultar ConfigConferenciaProduto do produto
    - Incluir modoResolucao no resultado de cada divergência retornada
    - Retornar ResultadoDivergenciaLoteValidade com itemId, descricao, divergenciaId, tipo, valorEsperado, valorConferido, modoResolucao, status
    - _Requirements: 2.4, 7.2_

  - [ ]* 5.3 Escrever property test para isolamento multi-tenancy (Property 9)
    - **Property 9: Isolamento multi-tenancy**
    - **Validates: Requirements 8.2, 8.5**
    - Verificar que divergência de empresaId X consultada com empresaId Y retorna 404

  - [ ]* 5.4 Escrever property test para completude da resposta (Property 11)
    - **Property 11: Completude da resposta de resolução**
    - **Validates: Requirements 8.4**
    - Verificar que respostas 2xx contêm divergenciaId, status, modo e mensagem; quando modo ACEITAR_CCE, contém campo cce

- [x] 6. Checkpoint — Verificar endpoints backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implementar frontend de divergências
  - [x] 7.1 Criar componente DivergenciaLoteValidadePanel
    - Criar componente que recebe lista de ResultadoDivergenciaLoteValidade e notaId
    - Renderizar um DivergenciaCard por item com diferenciação visual por modo (cores e ícones Mantine: green/IconCheck para LIVRE, yellow/IconLock para SENHA, blue/IconFileText para CCE, red/IconBan para BLOQUEAR)
    - Implementar ação por modo: botão "Aceitar" direto para LIVRE, botão "Liberar" que abre modal para SENHA, botão "Aceitar (CC-e)" para CCE, texto orientativo sem botão para BLOQUEAR
    - _Requirements: 7.1, 7.2, 7.3, 3.2, 6.2, 6.3_

  - [x] 7.2 Criar ModalSenhasSupervisor
    - Formulário com campos usuário e senha
    - Submit chama endpoint /resolver-divergencia-lv com credenciaisSupervisor
    - Exibir erro genérico se credenciais inválidas
    - Fechar modal e atualizar estado ao sucesso
    - _Requirements: 4.1, 4.5_

  - [x] 7.3 Implementar gate de finalização e hook React Query
    - Criar hook `useResolverDivergenciaLV()` com useMutation + invalidateQueries
    - Implementar lógica de gate: botão de finalização desabilitado enquanto existir divergência PENDENTE
    - Habilitar finalização quando todas divergências resolvidas (ACEITA ou BLOQUEADA)
    - Exibir mensagem explicativa quando gate bloqueia finalização
    - _Requirements: 7.4, 7.5_

  - [ ]* 7.4 Escrever property test para gate de finalização (Property 10)
    - **Property 10: Gate de finalização por divergências pendentes**
    - **Validates: Requirements 7.4, 7.5**
    - Gerar listas de divergências com status variados e verificar: finalização habilitada ↔ nenhuma PENDENTE

  - [x] 7.5 Integrar DivergenciaLoteValidadePanel na página de conferência de entrada
    - Importar e renderizar painel na tela de resultado de conferência (conferencia-entrada/page.tsx)
    - Separar visualmente de divergências de quantidade existentes
    - Passar callback onResolucaoCompleta para atualizar estado da página
    - _Requirements: 7.1_

- [x] 8. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- Todas as operações devem respeitar isolamento multi-tenant (empresaId)
- O CceService existente é reutilizado para emissão de CC-e — apenas gerar texto de correção específico para lote/validade
- Mensagens de erro de autenticação de supervisor devem ser genéricas (segurança)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "5.1", "5.2"] },
    { "id": 5, "tasks": ["5.3", "5.4"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "7.5"] }
  ]
}
```
