/**
 * Integração PDV → NFC-e (modelo 65).
 *
 * Monta os dados de uma NFC-e a partir de uma `VendaPdv` FINALIZADA e emite
 * pelo motor existente (`nfceEmissaoService.emitir`). Reusa o mesmo padrão da
 * NF-e (município IBGE, forma de pagamento → tPag). A emissão de NFC-e é
 * síncrona e à vista (consumidor de balcão) — não gera conta a receber.
 *
 * Requirements: 1.1
 */

import { prisma } from '../../lib/prisma'
import { nfceEmissaoService } from '../fiscal/emissor-dfe/nfce/nfce-emissao.service'
import { buscarMunicipiosIBGE } from '../fiscal/emissor-dfe/cte/cte-municipios.routes'

/** De/para forma de pagamento do PDV → código tPag da NFC-e 4.00. */
function formaPdvParaTPag(forma: string): string {
  switch ((forma || '').toUpperCase()) {
    case 'DINHEIRO':
      return '01'
    case 'CARTAO_CREDITO':
      return '03'
    case 'CARTAO_DEBITO':
      return '04'
    case 'PIX':
      return '17'
    case 'VALE':
      return '05'
    default:
      return '99'
  }
}

async function resolverCodigoMunicipio(
  codigoAtual: string | null | undefined,
  nome: string | null | undefined,
  uf: string | null | undefined,
): Promise<string> {
  const atual = (codigoAtual ?? '').trim()
  if (atual.length === 7) return atual
  if (!nome || !uf) return atual
  const municipios = await buscarMunicipiosIBGE(uf)
  if (municipios.length === 0) return atual
  const norm = (s: string) => s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const alvo = norm(nome)
  return municipios.find((m) => norm(m.nome) === alvo)?.codigo ?? atual
}

export interface ResultadoNfcePdv {
  documentoFiscalId: string
  status: string
  chaveAcesso?: string
  numero?: number
  protocolo?: string
  codigoRejeicao?: number
  motivoRejeicao?: string
}

/**
 * Emite a NFC-e de uma venda de PDV finalizada. Retorna o resultado da emissão
 * (com chave quando autorizada). Lança erro só em falha inesperada; rejeição de
 * negócio volta no `status`/`motivoRejeicao`.
 */
export async function emitirNfceDeVendaPdv(
  empresaId: string,
  vendaId: string,
): Promise<ResultadoNfcePdv | null> {
  const venda = await prisma.vendaPdv.findFirst({
    where: { id: vendaId, empresaId },
    include: {
      itens: { where: { cancelado: false }, include: { produto: true } },
      pagamentos: true,
    },
  })
  if (!venda || venda.itens.length === 0) return null
  if (venda.nfceChave) return null // já emitida (idempotência simples)

  const empresa = await prisma.empresa.findUniqueOrThrow({
    where: { id: empresaId },
    select: {
      cnpj: true, razaoSocial: true, nomeFantasia: true, inscEstadual: true,
      logradouro: true, numero: true, bairro: true, cidade: true, codigoMunicipio: true,
      uf: true, cep: true, regimeTributario: true, ambienteNFe: true,
      respTecCnpj: true, respTecContato: true, respTecEmail: true, respTecFone: true,
      telefone: true,
    },
  })

  const uf = empresa.uf || ''
  const cMun = await resolverCodigoMunicipio(empresa.codigoMunicipio, empresa.cidade, uf)

  const serie = 1
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'NFCE', serie },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const nNF = (ultimo?.numero || 0) + 1

  const UF_CODES: Record<string, number> = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
    MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
    SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
    PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
  }

  const dadosNFCe = {
    modelo: 65,
    serie,
    nNF,
    cUF: UF_CODES[uf] || 35,
    cNF: String(Math.floor(Math.random() * 99999999)).padStart(8, '0'),
    tpEmis: 1,
    cMunFG: cMun,
    naturezaOp: 'VENDA',
    tipoOperacao: 1 as const,
    finalidade: 1 as const,
    dataEmissao: new Date(),
    ambiente: empresa.ambienteNFe,
    emitente: {
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      uf,
      ie: empresa.inscEstadual || undefined,
      crt: empresa.regimeTributario || 3,
      endereco: {
        logradouro: empresa.logradouro || '',
        numero: empresa.numero || '',
        bairro: empresa.bairro || '',
        codigoMunicipio: cMun,
        municipio: empresa.cidade || '',
        uf,
        cep: empresa.cep || '',
      },
    },
    destinatario: venda.cpfCnpjConsumidor
      ? { cpfCnpj: venda.cpfCnpjConsumidor, razaoSocial: 'CONSUMIDOR' }
      : undefined,
    itens: venda.itens.map((item, index) => ({
      nItem: index + 1,
      produtoId: item.produtoId,
      codigoProd: item.produto.codigo,
      descricao: item.produto.nome,
      ncm: item.produto.ncm || '00000000',
      cfop: item.produto.cfopEstadual || '5102',
      unidade: item.produto.unidade || 'UN',
      quantidade: Number(item.quantidade),
      valorUnitario: Number(item.precoUnitario),
      valorTotal: Number(item.valorTotal),
      valorDesconto: Number(item.desconto),
    })),
    pagamento: venda.pagamentos.map((p) => ({
      formaPagamento: formaPdvParaTPag(p.forma),
      valor: Number(p.valor),
    })),
    respTec: empresa.respTecCnpj
      ? {
          cnpj: empresa.respTecCnpj,
          contato: empresa.respTecContato || empresa.razaoSocial,
          email: empresa.respTecEmail || '',
          fone: empresa.respTecFone || (empresa.telefone ?? ''),
        }
      : undefined,
  }

  const resultado = await nfceEmissaoService.emitir({
    empresaId,
    dadosNFCe: dadosNFCe as any,
  })

  return {
    documentoFiscalId: (resultado as any).documentoFiscalId,
    status: (resultado as any).status,
    chaveAcesso: (resultado as any).chaveAcesso,
    numero: nNF,
    protocolo: (resultado as any).protocolo,
    codigoRejeicao: (resultado as any).codigoRejeicao,
    motivoRejeicao: (resultado as any).motivoRejeicao,
  }
}
