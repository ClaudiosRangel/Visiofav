import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    notaEntrada: { findUnique: vi.fn() },
    configIntegracao: { findUnique: vi.fn() },
    produto: { findFirst: vi.fn() },
    empresa: { findUnique: vi.fn() },
    itemNotaEntrada: { findUnique: vi.fn(), update: vi.fn() },
    divergenciaConferencia: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('./config-conferencia-produto.service', () => ({
  obterConfigBloqueio: vi.fn(),
}))

vi.mock('../pendencia-cce/pendencia-cce.service', () => ({
  criarPendencia: vi.fn(),
}))

vi.mock('../email-fiscal/email-fiscal.service', () => ({
  enviarEmailDivergencia: vi.fn(),
}))

import { prisma } from '../../lib/prisma'
import { obterConfigBloqueio } from './config-conferencia-produto.service'
import { criarPendencia } from '../pendencia-cce/pendencia-cce.service'
import { enviarEmailDivergencia } from '../email-fiscal/email-fiscal.service'
import { executarSegundaConferencia, processarDivergenciasPendentes } from './segunda-conferencia.service'

const mockedPrisma = vi.mocked(prisma, true)
const mockedObterConfigBloqueio = vi.mocked(obterConfigBloqueio)
const mockedCriarPendencia = vi.mocked(criarPendencia)
const mockedEnviarEmail = vi.mocked(enviarEmailDivergencia)

function itemNotaBase(overrides: Partial<any> = {}) {
  return {
    id: 'item-1',
    notaEntradaId: 'nota-1',
    codigoProduto: '000001',
    descricao: 'ACHOCOLATADO NESCAU',
    quantidade: 200,
    lote: 'L2026M07A',
    // Construtor local (ano, mês 0-indexado, dia) — mesmo formato produzido
    // por parsearValidade() para strings DD/MM/AAAA. Usar new Date('2027-07-01')
    // (interpretado como UTC meia-noite) causaria mismatch de dia em fusos
    // horários negativos (ex.: America/Sao_Paulo) ao comparar com mesmoDia().
    validade: new Date(2027, 6, 1),
    statusConferencia: 'PENDENTE_SEGUNDA_CONFERENCIA',
    ...overrides,
  }
}

describe('executarSegundaConferencia — notificação fiscal adiada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPrisma.configIntegracao.findUnique.mockResolvedValue({ integracaoAtiva: false } as any)
    mockedPrisma.empresa.findUnique.mockResolvedValue({ toleranciaQuantidadePercentualPadrao: null } as any)
    mockedPrisma.produto.findFirst.mockResolvedValue({ id: 'prod-1', exigeLote: true, toleranciaQuantidadePercentual: null } as any)
  })

  it('não dispara pendência CC-e nem e-mail — apenas registra a divergência (aceitarCcePendente=true, sem senha)', async () => {
    const item = itemNotaBase()
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ id: 'nota-1', itens: [item] } as any)
    mockedObterConfigBloqueio.mockResolvedValue({ aceitarSenha: false, aceitarCcePendente: true })
    mockedPrisma.divergenciaConferencia.create.mockResolvedValue({ id: 'div-1' } as any)

    const resultado = await executarSegundaConferencia(
      'nota-1',
      [{ itemNotaEntradaId: 'item-1', quantidadeConferida: 200, lote: 'LOTE-DIFERENTE', validade: '01/01/2061' }],
      'empresa-1',
      'user-1',
    )

    expect(mockedCriarPendencia).not.toHaveBeenCalled()
    expect(mockedEnviarEmail).not.toHaveBeenCalled()
    expect(mockedPrisma.divergenciaConferencia.create).toHaveBeenCalledTimes(1)
    expect(resultado.itens[0].resultado).toEqual({ status: 'divergenciaRegistrada', divergenciaId: 'div-1' })
    // Item liberado (CONFERIDO) mesmo sem notificação enviada ainda
    expect(mockedPrisma.itemNotaEntrada.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { statusConferencia: 'CONFERIDO' },
    })
  })

  it('não dispara pendência/e-mail quando aceitarSenha=true e aceitarCcePendente=true — apenas registra e retorna requerSenha', async () => {
    const item = itemNotaBase()
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ id: 'nota-1', itens: [item] } as any)
    mockedObterConfigBloqueio.mockResolvedValue({ aceitarSenha: true, aceitarCcePendente: true })
    mockedPrisma.divergenciaConferencia.create.mockResolvedValue({ id: 'div-2' } as any)

    const resultado = await executarSegundaConferencia(
      'nota-1',
      [{ itemNotaEntradaId: 'item-1', quantidadeConferida: 200, lote: 'LOTE-DIFERENTE', validade: '01/01/2061' }],
      'empresa-1',
      'user-1',
    )

    expect(mockedCriarPendencia).not.toHaveBeenCalled()
    expect(mockedEnviarEmail).not.toHaveBeenCalled()
    expect(mockedPrisma.divergenciaConferencia.create).toHaveBeenCalledTimes(1)
    expect(resultado.itens[0].resultado).toEqual({ status: 'requerSenha' })
    // Liberação do item continua dependendo do endpoint /autorizar-senha
    expect(mockedPrisma.itemNotaEntrada.update).not.toHaveBeenCalled()
  })

  it('bloqueia (reconferência obrigatória) quando nem senha nem CC-e estão habilitados', async () => {
    const item = itemNotaBase()
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ id: 'nota-1', itens: [item] } as any)
    mockedObterConfigBloqueio.mockResolvedValue({ aceitarSenha: false, aceitarCcePendente: false })

    const resultado = await executarSegundaConferencia(
      'nota-1',
      [{ itemNotaEntradaId: 'item-1', quantidadeConferida: 200, lote: 'LOTE-DIFERENTE', validade: '01/01/2061' }],
      'empresa-1',
      'user-1',
    )

    expect(mockedPrisma.divergenciaConferencia.create).not.toHaveBeenCalled()
    expect(resultado.itens[0].resultado).toEqual({ status: 'bloqueado' })
  })

  it('auto-resolve quando lote/validade coincidem com a NF-e na 2ª tentativa', async () => {
    const item = itemNotaBase()
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ id: 'nota-1', itens: [item] } as any)

    const resultado = await executarSegundaConferencia(
      'nota-1',
      [{ itemNotaEntradaId: 'item-1', quantidadeConferida: 200, lote: 'L2026M07A', validade: '01/07/2027' }],
      'empresa-1',
      'user-1',
    )

    expect(resultado.itens[0].resultado).toEqual({ status: 'resolvido' })
    expect(mockedObterConfigBloqueio).not.toHaveBeenCalled()
    expect(mockedPrisma.divergenciaConferencia.create).not.toHaveBeenCalled()
  })
})

describe('processarDivergenciasPendentes — notificação fiscal disparada na aprovação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna contadores zerados sem tocar em pendência/e-mail quando não há divergências pendentes', async () => {
    mockedPrisma.divergenciaConferencia.findMany.mockResolvedValue([])

    const resultado = await processarDivergenciasPendentes('nota-1', 'empresa-1')

    expect(resultado).toEqual({ pendenciasCriadas: 0, emailsEnviados: 0, emailsFalharam: 0, falhas: [] })
    expect(mockedCriarPendencia).not.toHaveBeenCalled()
    expect(mockedEnviarEmail).not.toHaveBeenCalled()
  })

  it('cria pendência CC-e para cada divergência PENDENTE quando integração ativa', async () => {
    mockedPrisma.divergenciaConferencia.findMany.mockResolvedValue([
      { id: 'div-1', itemNotaEntradaId: 'item-1', tipo: 'LOTE_DIVERGENTE', loteEsperado: 'A', loteConferido: 'B', validadeEsperada: null, validadeConferida: null },
    ] as any)
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ fornecedor: 'Nestlé', numero: 1233, dataEmissao: new Date() } as any)
    mockedPrisma.configIntegracao.findUnique.mockResolvedValue({ integracaoAtiva: true } as any)
    mockedPrisma.itemNotaEntrada.findUnique.mockResolvedValue({ codigoProduto: '000001', descricao: 'NESCAU' } as any)
    mockedCriarPendencia.mockResolvedValue({ id: 'pendencia-1' } as any)

    const resultado = await processarDivergenciasPendentes('nota-1', 'empresa-1')

    expect(mockedCriarPendencia).toHaveBeenCalledTimes(1)
    expect(mockedEnviarEmail).not.toHaveBeenCalled()
    expect(resultado.pendenciasCriadas).toBe(1)
    expect(mockedPrisma.divergenciaConferencia.update).toHaveBeenCalledWith({
      where: { id: 'div-1' },
      data: { status: 'PENDENTE_CCE' },
    })
  })

  it('envia e-mail fiscal e reporta falha sem descartar silenciosamente quando integração inativa e SMTP falha', async () => {
    mockedPrisma.divergenciaConferencia.findMany.mockResolvedValue([
      { id: 'div-2', itemNotaEntradaId: 'item-2', tipo: 'VALIDADE_DIVERGENTE', loteEsperado: null, loteConferido: null, validadeEsperada: new Date(), validadeConferida: new Date() },
    ] as any)
    mockedPrisma.notaEntrada.findUnique.mockResolvedValue({ fornecedor: 'Nestlé', numero: 1233, dataEmissao: new Date() } as any)
    mockedPrisma.configIntegracao.findUnique.mockResolvedValue({ integracaoAtiva: false } as any)
    mockedPrisma.itemNotaEntrada.findUnique.mockResolvedValue({ codigoProduto: '000001', descricao: 'NESCAU' } as any)
    mockedEnviarEmail.mockResolvedValue({ sucesso: false, motivo: 'SMTP_NAO_CONFIGURADO' })

    const resultado = await processarDivergenciasPendentes('nota-1', 'empresa-1')

    expect(mockedCriarPendencia).not.toHaveBeenCalled()
    expect(mockedEnviarEmail).toHaveBeenCalledTimes(1)
    expect(resultado.emailsFalharam).toBe(1)
    expect(resultado.falhas).toEqual([{ divergenciaId: 'div-2', motivo: 'SMTP_NAO_CONFIGURADO' }])
  })
})
