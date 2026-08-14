/**
 * Serviço de importação de NF-e para geração automática de CT-e
 *
 * Fluxo:
 * 1. Recebe XML da NF-e (ou extrai chave do PDF/DANFE)
 * 2. Parseia todos os dados relevantes
 * 3. Auto-cadastra remetente/destinatário se não existirem
 * 4. Retorna dados pré-preenchidos para CT-e
 */

import { prisma } from '../../../../lib/prisma'

// === Tipos ===

export interface DadosNFeParaCTe {
  chaveAcesso: string
  numero: number
  serie: number
  dataEmissao: string

  // Emitente da NF-e = Remetente do CT-e
  remetente: ParticipanteExtraido
  // Destinatário da NF-e = Destinatário do CT-e
  destinatario: ParticipanteExtraido

  // Carga
  valorCarga: number
  pesoBruto: number
  pesoLiquido: number
  produtos: string // descrição predominante
  volumes: number
  especie: string

  // Origem/Destino (cidades)
  origemCMun: string
  origemMun: string
  origemUf: string
  destinoCMun: string
  destinoMun: string
  destinoUf: string

  // Veículo (se transporte de veículo novo)
  veiculosNovos: VeiculoExtraido[]

  // CFOP sugerido
  cfopSugerido: string
}

export interface ParticipanteExtraido {
  cnpj: string
  cpf: string
  razaoSocial: string
  nomeFantasia: string
  ie: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  codigoMunicipio: string
  municipio: string
  uf: string
  cep: string
  email: string
  telefone: string
}

export interface VeiculoExtraido {
  chassi: string
  cCor: string
  xCor: string
  cMod: string
  vUnit: number
}

// === Parser de XML de NF-e ===

function extrair(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`)
  const match = xml.match(regex)
  return match ? match[1].trim() : ''
}

function extrairBloco(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  const match = xml.match(regex)
  return match ? match[1] : ''
}

function extrairTodosOsBlocos(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  const matches: string[] = []
  let m
  while ((m = regex.exec(xml)) !== null) {
    matches.push(m[1])
  }
  return matches
}

export function parseNFeXml(xml: string): DadosNFeParaCTe {
  // Extrair chave de acesso
  const chaveMatch = xml.match(/Id="NFe(\d{44})"/)
  const chaveAcesso = chaveMatch ? chaveMatch[1] : ''

  // IDE
  const ideBloco = extrairBloco(xml, 'ide')
  const numero = parseInt(extrair(ideBloco, 'nNF')) || 0
  const serie = parseInt(extrair(ideBloco, 'serie')) || 0
  const dataEmissao = extrair(ideBloco, 'dhEmi')

  // Emitente (= remetente do CT-e)
  const emitBloco = extrairBloco(xml, 'emit')
  const enderEmitBloco = extrairBloco(emitBloco, 'enderEmit')
  const remetente: ParticipanteExtraido = {
    cnpj: extrair(emitBloco, 'CNPJ'),
    cpf: extrair(emitBloco, 'CPF'),
    razaoSocial: extrair(emitBloco, 'xNome'),
    nomeFantasia: extrair(emitBloco, 'xFant'),
    ie: extrair(emitBloco, 'IE'),
    logradouro: extrair(enderEmitBloco, 'xLgr') || extrair(enderEmitBloco, 'xlr'),
    numero: extrair(enderEmitBloco, 'nro'),
    complemento: extrair(enderEmitBloco, 'xCpl'),
    bairro: extrair(enderEmitBloco, 'xBairro'),
    codigoMunicipio: extrair(enderEmitBloco, 'cMun'),
    municipio: extrair(enderEmitBloco, 'xMun'),
    uf: extrair(enderEmitBloco, 'UF'),
    cep: extrair(enderEmitBloco, 'CEP'),
    email: extrair(emitBloco, 'email'),
    telefone: extrair(emitBloco, 'fone'),
  }

  // Destinatário
  const destBloco = extrairBloco(xml, 'dest')
  const enderDestBloco = extrairBloco(destBloco, 'enderDest')
  const destinatario: ParticipanteExtraido = {
    cnpj: extrair(destBloco, 'CNPJ'),
    cpf: extrair(destBloco, 'CPF'),
    razaoSocial: extrair(destBloco, 'xNome'),
    nomeFantasia: extrair(destBloco, 'xFant'),
    ie: extrair(destBloco, 'IE'),
    logradouro: extrair(enderDestBloco, 'xLgr') || extrair(enderDestBloco, 'xlr'),
    numero: extrair(enderDestBloco, 'nro'),
    complemento: extrair(enderDestBloco, 'xCpl'),
    bairro: extrair(enderDestBloco, 'xBairro'),
    codigoMunicipio: extrair(enderDestBloco, 'cMun'),
    municipio: extrair(enderDestBloco, 'xMun'),
    uf: extrair(enderDestBloco, 'UF'),
    cep: extrair(enderDestBloco, 'CEP'),
    email: extrair(destBloco, 'email'),
    telefone: extrair(destBloco, 'fone'),
  }

  // Totais
  const totalBloco = extrairBloco(xml, 'ICMSTot')
  const valorCarga = parseFloat(extrair(totalBloco, 'vNF')) || 0

  // Transporte / Volumes
  const transpBloco = extrairBloco(xml, 'transp')
  const volBloco = extrairBloco(transpBloco, 'vol')
  const pesoBruto = parseFloat(extrair(volBloco, 'pesoB')) || 0
  const pesoLiquido = parseFloat(extrair(volBloco, 'pesoL')) || 0
  const volumes = parseInt(extrair(volBloco, 'qVol')) || 1
  const especie = extrair(volBloco, 'esp') || 'VOLUMES'

  // Produtos — pegar descrição do primeiro item como predominante
  const detBlocos = extrairTodosOsBlocos(xml, 'det')
  let produtoPred = ''
  if (detBlocos.length > 0) {
    produtoPred = extrair(detBlocos[0], 'xProd')
    if (detBlocos.length > 1) {
      produtoPred += ` (+${detBlocos.length - 1} itens)`
    }
  }

  // Veículos novos (grupo <veicProd> dentro de <det>)
  const veiculosNovos: VeiculoExtraido[] = []
  for (const det of detBlocos) {
    const veicBloco = extrairBloco(det, 'veicProd')
    if (veicBloco) {
      veiculosNovos.push({
        chassi: extrair(veicBloco, 'chassi'),
        cCor: extrair(veicBloco, 'cCor'),
        xCor: extrair(veicBloco, 'xCor'),
        cMod: extrair(veicBloco, 'cMod'),
        vUnit: parseFloat(extrair(det, 'vProd')) || 0,
      })
    }
  }

  // Se tem veículos, produto predominante é VEICULO
  if (veiculosNovos.length > 0) {
    produtoPred = 'VEICULO NOVO'
  }

  // Origem = endereço do emitente; Destino = endereço do destinatário
  const origemUf = remetente.uf
  const destinoUf = destinatario.uf

  // CFOP automático
  const cfopSugerido = origemUf === destinoUf ? '5353' : '6353'

  return {
    chaveAcesso,
    numero,
    serie,
    dataEmissao,
    remetente,
    destinatario,
    valorCarga,
    pesoBruto,
    pesoLiquido,
    produtos: produtoPred,
    volumes,
    especie,
    origemCMun: remetente.codigoMunicipio,
    origemMun: remetente.municipio,
    origemUf,
    destinoCMun: destinatario.codigoMunicipio,
    destinoMun: destinatario.municipio,
    destinoUf,
    veiculosNovos,
    cfopSugerido,
  }
}

// === Auto-cadastro de participante ===

export async function autoCadastrarParticipante(
  empresaId: string,
  participante: ParticipanteExtraido,
): Promise<string | null> {
  const doc = participante.cnpj || participante.cpf
  if (!doc) return null

  // Verificar se já existe no cadastro de Clientes
  const clienteExistente = await prisma.cliente.findFirst({
    where: { empresaId, cpfCnpj: doc },
    select: { id: true },
  })

  if (clienteExistente) return clienteExistente.id

  // Criar cliente automaticamente
  try {
    const novoCliente = await prisma.cliente.create({
      data: {
        empresaId,
        cpfCnpj: doc,
        razaoSocial: participante.razaoSocial || participante.cnpj,
        nomeFantasia: participante.nomeFantasia || undefined,
        inscEstadual: participante.ie || undefined,
        logradouro: participante.logradouro || undefined,
        numero: participante.numero || undefined,
        complemento: participante.complemento || undefined,
        bairro: participante.bairro || undefined,
        cidade: participante.municipio || undefined,
        uf: participante.uf || undefined,
        cep: participante.cep || undefined,
        email: participante.email || undefined,
        telefone: participante.telefone || undefined,
        status: true,
      } as any,
    })
    return novoCliente.id
  } catch {
    // Se falhar (constraint unique, etc), retorna null
    return null
  }
}
