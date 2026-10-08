import { describe, it, expect } from 'vitest'
import { verificarCodigoBarraDuplicado, mensagemConflito } from './sku-codigo-barra.service'

/**
 * Fake de `db` injetável — o helper só usa `db.sku.findMany({ where, select })`.
 * O fake filtra uma lista em memória aplicando as mesmas regras relevantes:
 * - código ∈ (codigoBarra | codigoBarraDun | codigoBarraDisplay)
 * - empresa (direta ou via produto)
 * - id != skuIdIgnorar
 */
interface SkuFake {
  id: string
  sequencia: number
  produtoId: string
  empresaId: string | null
  codigoBarra?: string | null
  codigoBarraDun?: string | null
  codigoBarraDisplay?: string | null
  produto: { codigo: string; nome: string; empresaId: string }
}

function makeDb(skus: SkuFake[]) {
  return {
    sku: {
      findMany: async ({ where }: any) => {
        const [codCond, empCond, idCond] = where.AND
        const codigos: string[] = codCond.OR[0].codigoBarra.in
        const empresaId: string = empCond.OR[0].empresaId
        const ignorar: string | undefined = idCond?.id?.not

        return skus
          .filter((s) => {
            const campos = [s.codigoBarra, s.codigoBarraDun, s.codigoBarraDisplay]
            const casaCodigo = campos.some((c) => c != null && codigos.includes(c))
            if (!casaCodigo) return false
            const casaEmpresa =
              s.empresaId === empresaId || (s.empresaId == null && s.produto.empresaId === empresaId)
            if (!casaEmpresa) return false
            if (ignorar && s.id === ignorar) return false
            return true
          })
          .sort((a, b) => a.sequencia - b.sequencia)
      },
    },
  }
}

const EMP = 'empresa-A'

const base: SkuFake = {
  id: 'sku-1',
  sequencia: 1,
  produtoId: 'prod-1',
  empresaId: EMP,
  codigoBarra: '7891000100103',
  produto: { codigo: 'K-OTHRINE', nome: 'K-Othrine', empresaId: EMP },
}

describe('verificarCodigoBarraDuplicado', () => {
  it('acusa colisão direta de EAN-13 na mesma empresa', async () => {
    const db = makeDb([base])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '7891000100103' })
    expect(r).not.toBeNull()
    expect(r?.campoConflitante).toBe('codigoBarra')
    expect(r?.produtoCodigo).toBe('K-OTHRINE')
  })

  it('acusa colisão CRUZADA (EAN-13 novo x DUN existente)', async () => {
    const comDun: SkuFake = { ...base, codigoBarra: null, codigoBarraDun: '17891000100100' }
    const db = makeDb([comDun])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '17891000100100' })
    expect(r?.campoConflitante).toBe('codigoBarraDun')
  })

  it('NÃO acusa quando o código é de outra empresa (isolamento multi-tenant)', async () => {
    const outraEmp: SkuFake = {
      ...base,
      empresaId: 'empresa-B',
      produto: { codigo: 'X', nome: 'X', empresaId: 'empresa-B' },
    }
    const db = makeDb([outraEmp])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '7891000100103' })
    expect(r).toBeNull()
  })

  it('ignora o próprio SKU na edição', async () => {
    const db = makeDb([base])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '7891000100103' }, 'sku-1')
    expect(r).toBeNull()
  })

  it('não dispara verificação para códigos vazios/nulos', async () => {
    const db = makeDb([base])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '', codigoBarraDun: null })
    expect(r).toBeNull()
  })

  it('resolve SKU legado com empresaId null pelo produto pai', async () => {
    const legado: SkuFake = {
      ...base,
      empresaId: null,
      produto: { codigo: 'LEG', nome: 'Legado', empresaId: EMP },
    }
    const db = makeDb([legado])
    const r = await verificarCodigoBarraDuplicado(db, EMP, { codigoBarra: '7891000100103' })
    expect(r?.produtoCodigo).toBe('LEG')
  })

  it('mensagemConflito descreve o campo e o produto', () => {
    const msg = mensagemConflito({
      codigo: '7891000100103',
      campoConflitante: 'codigoBarra',
      skuIdConflitante: 'sku-1',
      produtoId: 'prod-1',
      produtoCodigo: 'K-OTHRINE',
      produtoNome: 'K-Othrine',
    })
    expect(msg).toContain('EAN-13')
    expect(msg).toContain('K-OTHRINE')
  })
})
