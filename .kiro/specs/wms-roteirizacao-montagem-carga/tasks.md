# Implementation Plan: Roteirização e Montagem de Carga

## Overview

Plano de implementação para a funcionalidade de Roteirização e Montagem de Carga do WMS. A implementação segue uma ordem incremental: modelos de dados primeiro, depois CRUD de Rota, modificações em modelos existentes, melhorias no Carregamento, Mapa de Carregamento completo, relatórios e por fim as páginas frontend.

## Tasks

- [x] 1. Criar modelos Prisma e migração de banco de dados
  - [x] 1.1 Adicionar modelo Rota ao schema Prisma
    - Criar model `Rota` com campos: id, empresaId, codigo, descricao, transportadoraId, status, criadoEm, atualizadoEm
    - Adicionar constraint `@@unique([empresaId, codigo])` e `@@map("rota")`
    - Adicionar relação com Empresa
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Adicionar modelo MapaCarregamento ao schema Prisma
    - Criar model `MapaCarregamento` com campos: id, empresaId, numero, rotaId, veiculoPlaca, motorista, motoristaCpf, observacoes, status, motivoCancelamento, criadoPorId, canceladoPorId, fechadoPorId, emissaoEm, finalizadoEm, canceladoEm, criadoEm, atualizadoEm
    - Adicionar constraint `@@unique([empresaId, numero])` e `@@map("mapa_carregamento")`
    - Status inicial: AGUARDANDO_SEPARACAO
    - _Requirements: 10.1, 10.4_

  - [x] 1.3 Adicionar modelo MapaCarregamentoNf ao schema Prisma
    - Criar model `MapaCarregamentoNf` com campos: id, mapaCarregamentoId, nfeId, statusEntrega, motivoDevolucao
    - Adicionar constraint `@@unique([mapaCarregamentoId, nfeId])` e `@@map("mapa_carregamento_nf")`
    - Relação com MapaCarregamento (onDelete: Cascade) e Nfe
    - _Requirements: 10.3, 15.2_

  - [x] 1.4 Modificar modelos existentes (Cliente, PedidoVenda, Carregamento, Nfe)
    - Adicionar campo `rotaId` (opcional) em Cliente com relação para Rota
    - Adicionar campo `rotaId` (opcional) em PedidoVenda com relação para Rota
    - Adicionar campos `motorista`, `motoristaCpf`, `rotaId`, `motivoCancelamento`, `canceladoPorId`, `canceladoEm`, `emCarregamentoEm` em Carregamento
    - Adicionar campo `mapaOk` (Boolean, default false) em Nfe
    - Adicionar relação `mapasCarregamento MapaCarregamentoNf[]` em Nfe
    - _Requirements: 2.1, 3.1, 3.2, 9.5, 16.1, 18.1_

  - [x] 1.5 Gerar e executar migração Prisma
    - Executar `npx prisma migrate dev --name add-roteirizacao-montagem-carga`
    - Verificar que a migração foi aplicada sem erros
    - _Requirements: 1.1, 2.1, 3.1, 10.1, 16.1, 18.1_

- [x] 2. Implementar módulo Rota (CRUD backend)
  - [x] 2.1 Criar service de Rota
    - Criar `src/modules/rota/rota.service.ts` com classe `RotaService`
    - Implementar `criar(empresaId, data)`: valida unicidade de código por empresa, cria registro
    - Implementar `listar(empresaId, filtros)`: paginação com filtro de status
    - Implementar `buscarPorId(empresaId, id)`: busca com isolamento multi-tenant
    - Implementar `atualizar(empresaId, id, data)`: atualiza descrição, transportadoraId, status
    - Implementar `desativar(empresaId, id)`: soft delete (status = false)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 2.2 Escrever teste de propriedade para unicidade de código de Rota
    - **Property 1: Unicidade de código de Rota por Empresa**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 2.3 Escrever teste de propriedade para isolamento multi-tenant de Rota
    - **Property 2: Isolamento multi-tenant de Rota**
    - **Validates: Requirements 1.8**

  - [x] 2.4 Criar rotas HTTP de Rota
    - Criar `src/modules/rota/rota.routes.ts` com endpoints: POST `/`, GET `/`, GET `/:id`, PUT `/:id`, PATCH `/:id/desativar`
    - Registrar rotas em `src/server.ts` com prefix `/rotas`
    - Adicionar autenticação e moduloGuard
    - Validação de entrada com Zod schemas
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_

- [ ] 3. Checkpoint — Verificar módulo Rota
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implementar associação Rota-Cliente e Rota-PedidoVenda
  - [ ] 4.1 Modificar endpoint de Cliente para aceitar rotaId
    - Atualizar endpoint de criação/atualização de Cliente para aceitar campo `rotaId`
    - Validar que rotaId pertence à mesma empresa do Cliente
    - _Requirements: 2.1, 2.2, 2.6_

  - [ ] 4.2 Implementar auto-preenchimento de rotaId no PedidoVenda
    - Modificar criação de PedidoVenda: se Cliente tem rotaId, preencher automaticamente no pedido
    - Permitir override manual do rotaId no PedidoVenda
    - Validar que rotaId pertence à mesma empresa
    - Rejeitar alteração de rotaId em PedidoVenda com status diferente de RASCUNHO (exceto admin)
    - _Requirements: 2.3, 2.4, 2.5, 18.1, 18.2, 18.3, 18.4, 18.5_

  - [ ]* 4.3 Escrever teste de propriedade para auto-preenchimento de rotaId
    - **Property 4: Auto-preenchimento de rotaId no PedidoVenda**
    - **Validates: Requirements 2.3, 2.4, 18.2**

  - [ ]* 4.4 Escrever teste de propriedade para validação cross-empresa de rotaId
    - **Property 3: Validação cross-empresa de rotaId**
    - **Validates: Requirements 2.6, 16.5, 18.4**

  - [ ]* 4.5 Escrever teste de propriedade para rejeição de rotaId em PedidoVenda não-RASCUNHO
    - **Property 20: Rejeição de rotaId em PedidoVenda não-RASCUNHO**
    - **Validates: Requirements 18.5**

- [ ] 5. Implementar melhorias no Carregamento
  - [ ] 5.1 Criar StatusMachineService para Carregamento
    - Criar `src/modules/carregamento/status-machine.service.ts`
    - Implementar validação de transições: PENDENTE→EM_CARREGAMENTO, EM_CARREGAMENTO→CONCLUIDO, PENDENTE→CANCELADO, EM_CARREGAMENTO→CANCELADO
    - Rejeitar transições inválidas com erro 422 descritivo
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ]* 5.2 Escrever teste de propriedade para máquina de estados do Carregamento
    - **Property 6: Máquina de estados do Carregamento**
    - **Validates: Requirements 6.1, 6.2, 6.5**

  - [ ]* 5.3 Escrever teste de propriedade para imutabilidade de Carregamento concluído/cancelado
    - **Property 5: Imutabilidade de Carregamento concluído/cancelado**
    - **Validates: Requirements 3.5, 4.5, 5.3, 16.3**

  - [ ] 5.4 Adicionar campos motorista e rotaId ao Carregamento
    - Modificar endpoints de criação/atualização de Carregamento para aceitar motorista, motoristaCpf, rotaId
    - Validar que rotaId pertence à mesma empresa
    - Rejeitar atualizações em Carregamento CONCLUIDO ou CANCELADO
    - Adicionar filtro por rotaId na listagem de carregamentos
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ] 5.5 Implementar cancelamento de Carregamento
    - Criar endpoint `POST /carregamentos/:id/cancelar`
    - Exigir motivoCancelamento (não vazio)
    - Dissociar todos os CarregamentoVolume do carregamento
    - Reverter status de cada Volume para EMBALADO
    - Registrar canceladoPorId, canceladoEm
    - Rejeitar cancelamento de Carregamento CONCLUIDO
    - Usar `prisma.$transaction()` para atomicidade
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 5.6 Escrever teste de propriedade para cancelamento restaura volumes
    - **Property 7: Cancelamento de Carregamento restaura volumes**
    - **Validates: Requirements 4.3, 4.4**

  - [ ] 5.7 Implementar remoção de volume do Carregamento
    - Criar endpoint `DELETE /carregamentos/:id/volumes/:volumeId`
    - Reverter status do Volume para EMBALADO
    - Rejeitar se Carregamento CONCLUIDO ou CANCELADO
    - Retornar 404 se volume não está associado ao carregamento
    - Manter Carregamento no status atual mesmo se último volume removido
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 5.8 Escrever teste de propriedade para remoção de volume restaura status
    - **Property 8: Remoção de volume restaura status**
    - **Validates: Requirements 5.2**

  - [ ] 5.9 Implementar endpoint de transição de status do Carregamento
    - Criar endpoint `PATCH /carregamentos/:id/status`
    - Usar StatusMachineService para validar transição
    - Registrar timestamps: emCarregamentoEm, concluidoEm
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 6. Checkpoint — Verificar melhorias no Carregamento
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implementar seleção de NFs e totalização
  - [ ] 7.1 Criar endpoint de listagem de NFs disponíveis
    - Criar `src/modules/mapa-carregamento/mapa-carregamento.routes.ts`
    - Implementar `GET /mapas-carregamento/nfs-disponiveis`
    - Filtros: rotaId, clienteId, nfNumero, serie, cidade, bairro, vendedorId, período
    - Ordenação: número NF, código rota, cidade, bairro
    - Excluir NFs já associadas a Carregamento ou MapaCarregamento ativo (não cancelado)
    - Retornar apenas NFs com PedidoVenda.rotaId correspondente ao filtro rotaId
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 7.2 Escrever teste de propriedade para filtro de NFs por rota
    - **Property 9: Filtro de NFs disponíveis por rota**
    - **Validates: Requirements 7.2**

  - [ ]* 7.3 Escrever teste de propriedade para exclusão de NFs já carregadas
    - **Property 10: Exclusão de NFs já carregadas**
    - **Validates: Requirements 7.5, 9.7**

  - [ ] 7.4 Implementar endpoints de marcação/desmarcação de NFs
    - Implementar `POST /mapas-carregamento/nfs/marcar` (batch)
    - Implementar `POST /mapas-carregamento/nfs/desmarcar` (batch)
    - Implementar `POST /mapas-carregamento/nfs/marcar-rota` (todas NFs de uma rota)
    - Implementar `POST /mapas-carregamento/nfs/desmarcar-rota` (todas NFs de uma rota)
    - Setar flag `mapaOk` na NF
    - Rejeitar marcação de NF já em Carregamento ativo
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ] 7.5 Implementar TotalizacaoService
    - Criar `src/modules/mapa-carregamento/totalizacao.service.ts`
    - Implementar cálculo de totais por rota: quantidadeNfs, valorTotal (2 decimais), pesoTotalKg (3 decimais), totalVolumes
    - Implementar totalização geral (soma de todas as rotas)
    - Recalcular com base nos itens marcados (mapaOk) quando aplicável
    - Criar endpoint `GET /mapas-carregamento/totalizacao`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.6 Escrever teste de propriedade para totalização por rota
    - **Property 11: Totalização por rota é soma dos itens**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 8. Implementar Mapa de Carregamento (geração, status, cancelamento, transferência, fechamento)
  - [ ] 8.1 Criar MapaCarregamentoService
    - Criar `src/modules/mapa-carregamento/mapa-carregamento.service.ts`
    - Implementar `gerar(empresaId, data, usuarioId)`: numeração sequencial (max+1 por empresa), associar NFs marcadas, limpar flag mapaOk, definir status inicial baseado em usaColetor
    - Rejeitar se nenhuma NF marcada
    - Usar `prisma.$transaction()` para atomicidade
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ]* 8.2 Escrever teste de propriedade para numeração sequencial do Mapa
    - **Property 12: Numeração sequencial do Mapa de Carregamento**
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 8.3 Escrever teste de propriedade para geração associa NFs e limpa flags
    - **Property 13: Geração de mapa associa NFs marcadas e limpa flags**
    - **Validates: Requirements 10.3, 10.6**

  - [ ] 8.4 Implementar máquina de estados do Mapa de Carregamento
    - Adicionar validação de transições no StatusMachineService: AGUARDANDO_SEPARACAO→EM_CARREGAMENTO, EM_CARREGAMENTO→FINALIZADO, AGUARDANDO_SEPARACAO→CANCELADO, EM_CARREGAMENTO→CANCELADO
    - Criar endpoint `PATCH /mapas-carregamento/:id/status`
    - Registrar finalizadoEm ao transicionar para FINALIZADO
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 8.5 Escrever teste de propriedade para máquina de estados do Mapa
    - **Property 14: Máquina de estados do Mapa de Carregamento**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [ ] 8.6 Implementar cancelamento de Mapa de Carregamento
    - Criar endpoint `POST /mapas-carregamento/:id/cancelar`
    - Exigir motivoCancelamento
    - Dissociar todas NFs do mapa (deletar MapaCarregamentoNf)
    - Setar status CANCELADO
    - Rejeitar cancelamento de mapa FINALIZADO
    - Registrar canceladoPorId, canceladoEm
    - Usar `prisma.$transaction()`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 8.7 Escrever teste de propriedade para cancelamento de mapa libera NFs
    - **Property 15: Cancelamento de mapa libera NFs**
    - **Validates: Requirements 12.3**

  - [ ] 8.8 Implementar transferência de NFs entre mapas
    - Criar endpoint `POST /mapas-carregamento/transferir-nfs`
    - Aceitar sourceMapaId, targetMapaId, nfeIds
    - Rejeitar se mapa origem FINALIZADO
    - Rejeitar se mapa destino FINALIZADO ou CANCELADO
    - Atualizar referência de mapa nas NFs transferidas
    - Registrar auditoria da transferência
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 8.9 Escrever teste de propriedade para transferência respeita status
    - **Property 16: Transferência de NFs respeita status dos mapas**
    - **Validates: Requirements 13.2, 13.3**

  - [ ] 8.10 Implementar reemissão (consulta) de Mapa de Carregamento
    - Criar endpoint `GET /mapas-carregamento/:id`
    - Retornar dados completos: header + NFs associadas com detalhes
    - Permitir consulta em qualquer status (inclusive CANCELADO e FINALIZADO)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 8.11 Escrever teste de propriedade para reemissão em qualquer status
    - **Property 19: Reemissão de mapa funciona em qualquer status**
    - **Validates: Requirements 14.4**

  - [ ] 8.12 Implementar fechamento (closure) de Mapa de Carregamento
    - Criar endpoint `POST /mapas-carregamento/:id/fechar`
    - Aceitar lista de NFs com statusEntrega (ENTREGUE/DEVOLVIDO) e motivoDevolucao
    - Exigir motivoDevolucao para NFs com statusEntrega=DEVOLVIDO
    - Rejeitar fechamento se mapa não está EM_CARREGAMENTO
    - Transicionar status para FINALIZADO
    - Registrar fechadoPorId, finalizadoEm
    - Usar `prisma.$transaction()`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [ ]* 8.13 Escrever teste de propriedade para fechamento exige motivo devolução
    - **Property 17: Fechamento de mapa exige motivo para devoluções**
    - **Validates: Requirements 15.3**

  - [ ]* 8.14 Escrever teste de propriedade para fechamento exige EM_CARREGAMENTO
    - **Property 18: Fechamento de mapa exige status EM_CARREGAMENTO**
    - **Validates: Requirements 15.5**

  - [ ] 8.15 Criar endpoint de listagem de Mapas de Carregamento
    - Implementar `GET /mapas-carregamento` com paginação e filtros: número, período, status, motorista, placa, rotaId
    - _Requirements: 17.3_

  - [ ] 8.16 Registrar rotas do módulo mapa-carregamento em src/server.ts
    - Registrar `mapaCarregamentoRoutes` com prefix `/mapas-carregamento`
    - Adicionar autenticação e moduloGuard
    - _Requirements: 10.1_

- [ ] 9. Checkpoint — Verificar Mapa de Carregamento
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implementar relatórios de expedição
  - [ ] 10.1 Criar módulo de relatórios de expedição
    - Criar `src/modules/relatorio-expedicao/relatorio-expedicao.routes.ts`
    - Implementar `GET /relatorios/expedicao/total-roteiro`: totais por rota (NFs, valor, peso, volumes) para período
    - Implementar `GET /relatorios/expedicao/total-expedicao`: totais gerais de expedição para período
    - Implementar `GET /relatorios/expedicao/consulta-mapas`: listagem de mapas com filtros (número, período, status, motorista, placa)
    - Implementar `GET /relatorios/expedicao/romaneio/:mapaId`: romaneio com informações de rota e sequência de entrega
    - Retornar dados em formato adequado para exibição em tela e geração de PDF
    - Isolar dados por empresa do usuário autenticado
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [ ] 10.2 Registrar rotas de relatórios em src/server.ts
    - Registrar `relatorioExpedicaoRoutes` com prefix `/relatorios/expedicao`
    - Adicionar autenticação e moduloGuard
    - _Requirements: 17.1_

- [ ] 11. Checkpoint — Verificar relatórios
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Frontend — Página de Cadastro de Rotas
  - [ ] 12.1 Criar página de listagem de Rotas
    - Criar `VisioFab.Wms.Front/src/app/(interna)/wms/rotas/page.tsx`
    - Tabela com colunas: código, descrição, transportadora, status
    - Paginação, filtro por status (ativo/inativo)
    - Botões: Nova Rota, Editar, Desativar
    - _Requirements: 1.4, 1.7_

  - [ ] 12.2 Criar modal/formulário de criação/edição de Rota
    - Campos: código, descrição, transportadora (select), status
    - Validação de campos obrigatórios
    - Feedback de erro para código duplicado
    - _Requirements: 1.1, 1.3, 1.6_

  - [ ] 12.3 Adicionar campo Rota no cadastro de Cliente
    - Adicionar select de Rota no formulário de Cliente existente
    - Carregar rotas ativas da empresa
    - _Requirements: 2.1, 2.2_

- [ ] 13. Frontend — Página de Montagem de Carga aprimorada
  - [ ] 13.1 Criar página de Montagem de Carga
    - Criar `VisioFab.Wms.Front/src/app/(interna)/wms/montagem-carga/page.tsx`
    - Painel de filtros: rota, cliente, NF número, série, cidade, bairro, vendedor, período
    - Tabela de NFs disponíveis com checkbox de seleção
    - Botões: Marcar Selecionados, Desmarcar Selecionados, Marcar Toda Rota, Desmarcar Toda Rota
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4_

  - [ ] 13.2 Implementar painel de totalização por rota
    - Exibir totais agrupados por rota: qtd NFs, valor, peso, volumes
    - Exibir totalização geral
    - Atualizar totais ao marcar/desmarcar NFs
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 13.3 Implementar formulário de geração de Mapa de Carregamento
    - Modal com campos: placa veículo, motorista, CPF motorista, observações, usa coletor (toggle)
    - Botão "Gerar Mapa" que chama endpoint de geração
    - Feedback de sucesso com número do mapa gerado
    - _Requirements: 10.4, 10.5, 10.7_

  - [ ] 13.4 Implementar tela de consulta/reemissão de Mapas
    - Criar `VisioFab.Wms.Front/src/app/(interna)/wms/mapas-carregamento/page.tsx`
    - Listagem de mapas com filtros: número, período, status, motorista, placa
    - Ações: Visualizar (reemissão), Cancelar, Fechar
    - _Requirements: 14.1, 14.4, 17.3_

  - [ ] 13.5 Implementar modal de fechamento de Mapa
    - Listar NFs do mapa com select de status (ENTREGUE/DEVOLVIDO)
    - Campo de motivo obrigatório para devoluções
    - Botão "Confirmar Fechamento"
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ] 13.6 Implementar modal de transferência de NFs entre Mapas
    - Select de mapa destino
    - Checkbox para selecionar NFs a transferir
    - Validação visual de status dos mapas
    - _Requirements: 13.1, 13.4_

- [ ] 14. Frontend — Página de Relatórios de Expedição
  - [ ] 14.1 Criar página de relatórios de expedição
    - Criar `VisioFab.Wms.Front/src/app/(interna)/wms/relatorios-expedicao/page.tsx`
    - Tabs ou menu: Total por Roteiro, Total Expedição, Consulta Mapas, Romaneio
    - Filtros por período, rota, status
    - Tabelas com dados dos relatórios
    - Botão de impressão/exportação PDF
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [ ] 15. Frontend — Melhorias na página de Carregamento existente
  - [ ] 15.1 Adicionar campos motorista e rota na tela de Carregamento
    - Adicionar campos motorista, CPF motorista, rota (select) no formulário de carregamento
    - Adicionar filtro por rota na listagem
    - _Requirements: 3.3, 3.4, 16.2, 16.4_

  - [ ] 15.2 Adicionar ações de cancelamento e remoção de volume
    - Botão "Cancelar Carregamento" com modal de motivo
    - Botão "Remover Volume" em cada linha da tabela de volumes
    - Desabilitar ações para carregamentos CONCLUIDO/CANCELADO
    - _Requirements: 4.1, 4.2, 5.1, 5.3_

- [ ] 16. Final checkpoint — Verificar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requirements específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de corretude definidas no design
- Testes unitários validam exemplos específicos e edge cases
- Todas as operações que modificam múltiplas tabelas devem usar `prisma.$transaction()`
- O projeto usa TypeScript em todo o stack (backend e frontend)
