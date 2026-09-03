import { prisma } from '../../../lib/prisma'
import {
  CriteriosProspeccao,
  EmpresaEncontrada,
  ProspeccaoProvider,
  ResultadoBusca,
} from './prospeccao-provider'

/**
 * Provider que consulta a tabela local `estabelecimento_cnpj` — espelho do
 * dump oficial de CNPJ da Receita Federal, populado sob demanda por CNAE+UF
 * (scripts/importar-cnpj-oficial.ts).
 *
 * É a fonte de verdade da prospecção: dado público, gratuito, permite busca
 * massiva por CNAE+UF. Quando a base local ainda não foi importada (tabela
 * vazia para os critérios), retorna vazio com aviso claro para o usuário
 * saber que precisa rodar a importação do dump.
 */
export class ArquivoOficialProvider implements ProspeccaoProvider {
  readonly nome = 'arquivoOficial'

  async buscar(criterios: CriteriosProspeccao): Promise<ResultadoBusca> {
    const avisos: string[] = []
    const limite = criterios.limite && criterios.limite > 0 ? Math.min(criterios.limite, 5000) : 1000

    const where: Record<string, unknown> = {}

    // CNAEs: só dígitos, filtra por prefixo/igualdade. A Receita usa 7 dígitos.
    const cnaes = (criterios.cnaes || [])
      .map((c) => (c || '').replace(/\D/g, ''))
      .filter((c) => c.length > 0)
    if (cnaes.length > 0) {
      where.cnaePrincipal = { in: cnaes }
    }
    if (criterios.uf) where.uf = criterios.uf.toUpperCase()
    if (criterios.cidade) {
      where.cidade = { contains: criterios.cidade, mode: 'insensitive' }
    }
    if (criterios.situacao) {
      where.situacao = { equals: criterios.situacao, mode: 'insensitive' }
    }
    if (criterios.portes && criterios.portes.length > 0) {
      where.porte = { in: criterios.portes }
    }

    const registros = await prisma.estabelecimentoCnpj.findMany({
      where,
      take: limite,
      orderBy: { razaoSocial: 'asc' },
    })

    if (registros.length === 0) {
      // Verifica se a base está totalmente vazia (dump nunca importado) para
      // dar um aviso mais útil do que "nenhum resultado".
      const totalBase = await prisma.estabelecimentoCnpj.count()
      if (totalBase === 0) {
        avisos.push(
          'A base oficial de CNPJ ainda não foi importada. Rode a importação do dump da Receita (scripts/importar-cnpj-oficial.ts) para os CNAEs/UF desejados antes de prospectar.',
        )
      } else {
        avisos.push('Nenhuma empresa encontrada para os critérios informados na base oficial importada.')
      }
    } else if (registros.length >= limite) {
      avisos.push(`Resultado limitado a ${limite} empresas. Refine os critérios (CNAE/UF/cidade) para reduzir o volume.`)
    }

    const empresas: EmpresaEncontrada[] = registros.map((r) => ({
      cnpj: r.cnpj,
      razaoSocial: r.razaoSocial,
      nomeFantasia: r.nomeFantasia,
      cnaePrincipal: r.cnaePrincipal,
      cnaeDescricao: r.cnaeDescricao,
      situacao: r.situacao,
      porte: r.porte,
      logradouro: r.logradouro,
      numero: r.numero,
      complemento: r.complemento,
      bairro: r.bairro,
      cidade: r.cidade,
      uf: r.uf,
      cep: r.cep,
      telefone: r.telefone,
      email: r.email,
    }))

    return { empresas, avisos }
  }
}
