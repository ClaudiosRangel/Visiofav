/**
 * Serviço de Bloqueio Hierárquico — RF012
 *
 * Permite bloquear/liberar movimentações em qualquer nível da hierarquia:
 * DEPOSITO > ZONA > RUA > PREDIO > NIVEL > PRODUTO > LOTE
 *
 * Quando um nível superior é bloqueado, todos os endereços filhos são
 * automaticamente afetados (verificação em cascata no momento da movimentação).
 */

import { prisma } from '../../lib/prisma'

// ── Tipos ──────────────────────────────────────────────────────────────────

export type NivelBloqueio = 'DEPOSITO' | 'ZONA' | 'RUA' | 'PREDIO' | 'NIVEL' | 'PRODUTO' | 'LOTE'
export type TipoBloqueio = 'MANUTENCAO' | 'INVENTARIO' | 'QUARENTENA' | 'RECALL' | 'AVARIA' | 'OUTRO'

export interface CriarBloqueioInput {
  empresaId: string
  nivel: NivelBloqueio
  depositoId?: string
  zonaId?: string
  rua?: string
  predio?: string
  codigoNivel?: string
  produtoId?: string
  lote?: string
  motivo: string
  tipo: TipoBloqueio
  bloqueadoPorId: string
}

export interface LiberarBloqueioInput {
  bloqueioId: string
  liberadoPorId: string
}

export interface VerificarBloqueioInput {
  empresaId: string
  enderecoId: string
  produtoId?: string
  lote?: string
}

export interface ResultadoVerificacao {
  bloqueado: boolean
  motivos: string[]
  bloqueios: Array<{ id: string; nivel: NivelBloqueio; tipo: TipoBloqueio; motivo: string }>
}

// ── Funções ────────────────────────────────────────────────────────────────

/**
 * Cria um bloqueio hierárquico no nível especificado.
 * Valida que os parâmetros são consistentes com o nível.
 */
export async function criarBloqueio(input: CriarBloqueioInput) {
  const { empresaId, nivel, motivo, tipo, bloqueadoPorId } = input

  // Validar campos obrigatórios por nível
  if (nivel === 'DEPOSITO' && !input.depositoId) throw new Error('depositoId obrigatório para nível DEPOSITO')
  if (nivel === 'ZONA' && !input.zonaId) throw new Error('zonaId obrigatório para nível ZONA')
  if (nivel === 'RUA' && !input.rua) throw new Error('rua obrigatório para nível RUA')
  if (nivel === 'PREDIO' && !input.rua && !input.predio) throw new Error('rua e predio obrigatórios para nível PREDIO')
  if (nivel === 'NIVEL' && !input.codigoNivel) throw new Error('codigoNivel obrigatório para nível NIVEL')
  if (nivel === 'PRODUTO' && !input.produtoId) throw new Error('produtoId obrigatório para nível PRODUTO')
  if (nivel === 'LOTE' && (!input.produtoId || !input.lote)) throw new Error('produtoId e lote obrigatórios para nível LOTE')

  const bloqueio = await prisma.bloqueioHierarquico.create({
    data: {
      empresaId,
      nivel,
      depositoId: input.depositoId || null,
      zonaId: input.zonaId || null,
      rua: input.rua || null,
      predio: input.predio || null,
      codigoNivel: input.codigoNivel || null,
      produtoId: input.produtoId || null,
      lote: input.lote || null,
      motivo,
      tipo,
      bloqueadoPorId,
      ativo: true,
    },
  })

  return bloqueio
}

/**
 * Libera um bloqueio hierárquico existente (soft-delete via ativo=false).
 */
export async function liberarBloqueio(input: LiberarBloqueioInput) {
  const bloqueio = await prisma.bloqueioHierarquico.update({
    where: { id: input.bloqueioId },
    data: {
      ativo: false,
      liberadoPorId: input.liberadoPorId,
      liberadoEm: new Date(),
    },
  })
  return bloqueio
}

/**
 * Verifica se um endereço (e opcionalmente produto/lote) está bloqueado
 * em QUALQUER nível da hierarquia. Consulta em cascata: endereço individual
 * → nível → prédio → rua → zona → depósito → produto → lote.
 *
 * Retorna todos os bloqueios ativos que afetam a posição consultada.
 */
export async function verificarBloqueio(input: VerificarBloqueioInput): Promise<ResultadoVerificacao> {
  const { empresaId, enderecoId, produtoId, lote } = input

  // Buscar dados do endereço para montar as condições de hierarquia
  const endereco = await prisma.endereco.findUnique({
    where: { id: enderecoId },
    select: {
      id: true, depositoId: true, zonaId: true,
      codigoRua: true, codigoPredio: true, codigoNivel: true,
      bloqueado: true, motivoBloqueio: true, quarentena: true,
      inventarioAtivo: true,
    },
  })

  if (!endereco) {
    return { bloqueado: false, motivos: [], bloqueios: [] }
  }

  const bloqueiosEncontrados: ResultadoVerificacao['bloqueios'] = []
  const motivos: string[] = []

  // 1. Verificar bloqueio no endereço individual
  if (endereco.bloqueado) {
    motivos.push(`Endereço bloqueado: ${endereco.motivoBloqueio || 'sem motivo'}`)
  }
  if (endereco.quarentena) {
    motivos.push('Endereço em quarentena')
  }
  if (endereco.inventarioAtivo) {
    motivos.push('Endereço em inventário ativo — movimentações bloqueadas')
  }

  // 2. Verificar bloqueios hierárquicos ativos que afetam este endereço
  const conditions: any[] = []

  // Bloqueio por depósito
  if (endereco.depositoId) {
    conditions.push({ nivel: 'DEPOSITO', depositoId: endereco.depositoId })
  }

  // Bloqueio por zona
  if (endereco.zonaId) {
    conditions.push({ nivel: 'ZONA', zonaId: endereco.zonaId })
  }

  // Bloqueio por rua
  if (endereco.codigoRua) {
    conditions.push({ nivel: 'RUA', rua: endereco.codigoRua })
  }

  // Bloqueio por prédio
  if (endereco.codigoRua && endereco.codigoPredio) {
    conditions.push({ nivel: 'PREDIO', rua: endereco.codigoRua, predio: endereco.codigoPredio })
  }

  // Bloqueio por nível
  if (endereco.codigoNivel) {
    conditions.push({ nivel: 'NIVEL', codigoNivel: endereco.codigoNivel })
  }

  // Bloqueio por produto
  if (produtoId) {
    conditions.push({ nivel: 'PRODUTO', produtoId })
  }

  // Bloqueio por lote
  if (produtoId && lote) {
    conditions.push({ nivel: 'LOTE', produtoId, lote })
  }

  if (conditions.length > 0) {
    const bloqueios = await prisma.bloqueioHierarquico.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: conditions,
      },
    })

    for (const b of bloqueios) {
      bloqueiosEncontrados.push({
        id: b.id,
        nivel: b.nivel as NivelBloqueio,
        tipo: b.tipo as TipoBloqueio,
        motivo: b.motivo,
      })
      motivos.push(`Bloqueio ${b.nivel} (${b.tipo}): ${b.motivo}`)
    }
  }

  // 3. Verificar bloqueio por lote no SaldoEndereco
  if (produtoId && lote) {
    const saldoBloqueado = await prisma.saldoEndereco.findFirst({
      where: { enderecoId, produtoId, lote, bloqueado: true },
    })
    if (saldoBloqueado) {
      motivos.push(`Lote ${lote} bloqueado: ${saldoBloqueado.motivoBloqueioLote || 'sem motivo'}`)
    }
  }

  return {
    bloqueado: motivos.length > 0,
    motivos,
    bloqueios: bloqueiosEncontrados,
  }
}

/**
 * Lista todos os bloqueios ativos de uma empresa.
 */
export async function listarBloqueiosAtivos(empresaId: string) {
  return prisma.bloqueioHierarquico.findMany({
    where: { empresaId, ativo: true },
    orderBy: { bloqueadoEm: 'desc' },
  })
}
