/**
 * Integration Tests - Cross-Dock & Logística Reversa
 *
 * Estes testes requerem um banco de dados PostgreSQL rodando.
 * Configure a variável DATABASE_URL com uma conexão de teste antes de executar.
 *
 * Para rodar:
 *   DATABASE_URL="postgresql://..." npx vitest run tests/integration/fase1-cross-dock.integration.test.ts
 *
 * Setup necessário:
 * 1. Banco PostgreSQL de teste com schema aplicado (npx prisma db push)
 * 2. Dados base: empresa, usuário, produtos, endereços, docas
 */

import { describe, it } from 'vitest'

describe.skip('Integration: Cross-Dock fluxo completo', () => {
  it('TODO: identifica match nota entrada → pedido venda', () => {})
  it('TODO: confirma cross-dock e gera OS de movimentação', () => {})
  it('TODO: move para staging e expede com baixa de saldo', () => {})
})

describe.skip('Integration: Logística Reversa fluxo completo', () => {
  it('TODO: cria RA, recebe, inspeciona e define disposição', () => {})
  it('TODO: gera nota de crédito com valor correto', () => {})
})
