/**
 * Rotas do CT-e (Conhecimento de Transporte Eletrônico) — Módulo Completo
 *
 * Endpoints:
 * - GET  /cte           — Listar CT-e com filtros e paginação
 * - GET  /cte/:id       — Detalhe de um CT-e
 * - POST /cte/emitir    — Emitir CT-e modelo 57
 * - POST /cte/:id/cancelar       — Cancelar CT-e autorizado
 * - POST /cte/:id/carta-correcao — Emitir CC-e para CT-e
 * - POST /cte/inutilizar         — Inutilizar faixa de numeração
 * - GET  /cte/:id/dacte          — Gerar DACTE em PDF
 * - GET  /cte/:id/xml            — Baixar XML autorizado
 * - POST /cte/:id/duplicar       — Duplicar CT-e existente
 *
 * Requirements: 6.8
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { cteEmissaoService } from './cte-emissao.service'
import { gerarDactePdf } from './cte-dacte-pdf.service'
import { parseNFeXml, autoCadastrarParticipante } from './cte-importar-nfe.service'
import { extrairTextoDanfePdf, parseDanfeTexto, derivarCodModelo } from './cte-danfe-parser.service'
import { buscarMunicipiosIBGE } from './cte-municipios.routes'
import { consultarCnpj } from './cte-consulta-cnpj.service'
import { ErroFiscal, CodigoErroFiscal } from '../../erros'
import { buildCTeXml, type DadosCTe } from './cte-xml-builder'
import { criarSefazClient, type SefazUrlResolver } from '../sefaz/sefaz-client'
import { obterUrlWebserviceCTe } from '../sefaz/sefaz-urls'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig } from '../sefaz/tipos'
import { certificadoService } from '../../certificado/certificado.service'

// === Schemas Zod ===

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listCteQuerySchema = z.object({
  status: z.string().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataAutorizacaoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataAutorizacaoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tomadorCpfCnpj: z.string().optional(),
  serie: z.coerce.number().int().min(0).optional(),
  numero: z.coerce.number().int().min(1).optional(),
  chaveAcesso: z.string().regex(/^\d{44}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const enderecoSchema = z.object({
  logradouro: z.string().max(60).default(''),
  numero: z.string().max(10).default(''),
  complemento: z.string().max(60).optional(),
  bairro: z.string().max(60).default(''),
  codigoMunicipio: z.string().max(7).default(''),
  municipio: z.string().max(60).default(''),
  uf: z.string().max(2).default(''),
  cep: z.string().max(8).default(''),
  codigoPais: z.string().optional(),
  pais: z.string().optional(),
})

const participanteSchema = z.object({
  cnpj: z.string().max(14).optional(),
  cpf: z.string().max(11).optional(),
  ie: z.string().max(20).optional(),
  razaoSocial: z.string().min(1).max(200),
  nomeFantasia: z.string().max(200).optional(),
  endereco: enderecoSchema,
  email: z.string().max(200).optional(),
  telefone: z.string().max(20).optional(),
})

const componenteValorSchema = z.object({
  nome: z.string().min(1).max(60),
  valor: z.number().min(0),
})

const infQuantidadeSchema = z.object({
  cUnid: z.string().regex(/^\d{2}$/),
  tpMed: z.string().min(1).max(20),
  qCarga: z.number().positive(),
})

const infNFeVinculadaSchema = z.object({
  chave: z.string().regex(/^\d{44}$/),
})

const veiculoSchema = z.object({
  placa: z.string().min(7).max(7),
  uf: z.string().length(2).regex(/^[A-Z]{2}$/),
  RENAVAM: z.string().max(11).optional(),
  tpProp: z.number().int().min(0).max(2).optional(),
  cpfCnpjProp: z.string().max(14).optional(),
  RNTRCProp: z.string().max(8).optional(),
  tpRod: z.string().max(2).optional(),
  tpCar: z.string().max(2).optional(),
})

const seguroSchema = z.object({
  respSeg: z.number().int().min(0).max(5),
  xSeg: z.string().max(30).optional(),
  nApol: z.string().max(20).optional(),
  nAver: z.string().max(40).optional(),
  vCarga: z.number().min(0).optional(),
})

const valePedagioSchema = z.object({
  cnpjForn: z.string().regex(/^\d{14}$/),
  cnpjPg: z.string().regex(/^\d{14}$/).optional(),
  cpfPg: z.string().regex(/^\d{11}$/).optional(),
  nCompra: z.string().max(20),
  vValePed: z.number().min(0),
})

const veiculoNovoSchema = z.object({
  chassi: z.string().min(1).max(17),
  cCor: z.string().max(4),
  xCor: z.string().max(40),
  // cMod = Código Marca Modelo da tabela RENAVAM/DENATRAN (1 a 6 caracteres,
  // conforme layout CT-e 4.00). NÃO é a descrição textual do modelo.
  cMod: z.string().min(1).max(6),
  vUnit: z.number().min(0),
  vFrete: z.number().min(0),
})

const emissaoCTeInputSchema = z.object({
  serie: z.number().int().min(0).max(999),
  cfop: z.string().regex(/^\d{4}$/),
  naturezaOp: z.string().min(1).max(100),
  tpServ: z.number().int().min(0).max(4),
  tpCTe: z.number().int().min(0).max(3).default(0),
  modal: z.string().regex(/^0[1-6]$/),
  tpEmis: z.number().int().min(1).max(9).default(1),

  // Municípios início/fim
  cMunIni: z.string().max(7).default(''),
  xMunIni: z.string().max(60).default(''),
  ufIni: z.string().max(2).default(''),
  cMunFim: z.string().max(7).default(''),
  xMunFim: z.string().max(60).default(''),
  ufFim: z.string().max(2).default(''),

  // Tomador
  tpTom: z.number().int().min(0).max(4),
  indIEToma: z.number().int().default(9),
  tomadorOutros: participanteSchema.optional(),

  // Participantes
  remetente: participanteSchema,
  destinatario: participanteSchema,
  expedidor: participanteSchema.optional(),
  recebedor: participanteSchema.optional(),

  // Valor da prestação
  vPrest: z.object({
    vTPrest: z.number().min(0),
    vRec: z.number().min(0),
    componentes: z.array(componenteValorSchema).optional(),
  }),

  // Impostos
  impostos: z.object({
    icms: z.object({
      cst: z.string().regex(/^(00|20|40|41|51|60|90|SN)$/),
      baseCalculo: z.number().min(0).optional(),
      aliquota: z.number().min(0).max(100).optional(),
      valor: z.number().min(0).optional(),
      percentualReducao: z.number().min(0).max(100).optional(),
      vCred: z.number().min(0).optional(),
      pDif: z.number().min(0).max(100).optional(),
      vICMSDif: z.number().min(0).optional(),
    }),
    vTotTrib: z.number().min(0).optional(),
    infAdFisco: z.string().max(2000).optional(),
  }),

  // CT-e Normal — Carga e Documentos
  infCTeNorm: z.object({
    infCarga: z.object({
      vCarga: z.number().min(0),
      proPred: z.string().min(1).max(60),
      xOutCat: z.string().max(30).optional(),
      infQ: z.array(infQuantidadeSchema).min(1),
    }),
    infDoc: z.object({
      infNFe: z.array(infNFeVinculadaSchema).optional(),
      infOutros: z.array(z.object({
        tpDoc: z.string().max(2),
        descOutros: z.string().max(100).optional(),
        nDoc: z.string().max(20).optional(),
        dEmi: z.string().optional(),
      })).optional(),
    }),
    infModal: z.object({
      RNTRC: z.string().max(20).optional(),
      veiculos: z.array(veiculoSchema).optional(),
    }).optional(),
    seguro: z.array(seguroSchema).optional(),
    valePedagio: z.array(valePedagioSchema).optional(),
    veicNovos: z.array(veiculoNovoSchema).optional(),
  }),

  // Complemento (opcional)
  complemento: z.object({
    xCaracAd: z.string().max(15).optional(),
    xCaracSer: z.string().max(30).optional(),
    xObs: z.string().max(2000).optional(),
  }).optional(),

  // Informações adicionais
  infAdFisco: z.string().max(2000).optional(),
  infCpl: z.string().max(5000).optional(),

  // Ambiente e contingência
  ambiente: z.number().int().min(1).max(2).default(2),
  forcarContingencia: z.boolean().default(false),
})

export type EmissaoCTeInput = z.infer<typeof emissaoCTeInputSchema>

// === Helpers ===

async function proximoNumeroCTe(empresaId: string, serie: number, ambiente: number): Promise<number> {
  // Buscar último número APENAS no ambiente correto
  // A constraint do banco DEVE incluir ambiente — se não incluir, o retry resolve
  const ultimo = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'CTE', serie, ambiente },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultimo?.numero || 0) + 1
}

function gerarCodigoNumerico(): string {
  return String(Math.floor(Math.random() * 99999999)).padStart(8, '0')
}

/**
 * Resolve a preferência de DACTE da empresa (modelo/orientação) a partir dos
 * parâmetros `cte.dacteModelo` / `cte.dacteOrientacao`. Fonte única usada tanto
 * pelo download do DACTE quanto pelo envio por e-mail, para que o PDF gerado
 * seja SEMPRE o mesmo nos dois caminhos (antes o e-mail ignorava a preferência
 * e mandava o modelo 1 retrato fixo).
 */
async function resolverPreferenciaDacte(empresaId: string): Promise<{ modelo: '1' | '2'; orientacao: 'retrato' | 'paisagem' }> {
  const parametros = await prisma.parametro.findMany({
    where: { empresaId, chave: { in: ['cte.dacteModelo', 'cte.dacteOrientacao'] } },
  })
  const paramsMap: Record<string, string> = {}
  for (const p of parametros) paramsMap[p.chave] = p.valor
  const modelo = (paramsMap['cte.dacteModelo'] || '1') as '1' | '2'
  const orientacao = (paramsMap['cte.dacteOrientacao'] || 'retrato') as 'retrato' | 'paisagem'
  return { modelo, orientacao }
}

/**
 * Formata um ZodError numa mensagem legível "campo: motivo", para que o
 * frontend consiga mostrar ao usuário exatamente qual campo reprovou em vez
 * de um genérico "Dados inválidos". Mapeia alguns caminhos técnicos do CT-e
 * para rótulos amigáveis.
 */
function formatarErroZod(err: any): { message: string; erros: any } {
  const rotulos: Record<string, string> = {
    'infCTeNorm.veicNovos.cMod': 'Cód. Modelo do veículo (DENATRAN) — deve ter no máximo 6 caracteres (código da tabela RENAVAM, não a descrição)',
    'infCTeNorm.veicNovos.chassi': 'Chassi do veículo',
    'infCTeNorm.veicNovos.cCor': 'Cód. Cor do veículo — máximo 4 caracteres',
    'infCTeNorm.infCarga.proPred': 'Produto predominante da carga',
    'cMunIni': 'Município de início',
    'cMunFim': 'Município de fim',
  }
  const issues = Array.isArray(err.errors) ? err.errors : []
  const detalhes = issues.map((e: any) => {
    const pathArr = (e.path || []).filter((p: any) => typeof p !== 'number')
    const pathKey = pathArr.join('.')
    const rotulo = rotulos[pathKey] || pathArr.join(' → ') || 'campo'
    return `${rotulo}: ${e.message}`
  })
  const message = detalhes.length > 0
    ? `Dados inválidos — ${detalhes.join('; ')}`
    : 'Dados inválidos'
  return { message, erros: err.errors }
}

/** Normaliza nome de município (maiúsculas, sem acento) para comparação. */
function normalizarNomeMunicipio(nome: string): string {
  return nome.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Garante que o código IBGE informado corresponde ao nome+UF do município.
 * A SEFAZ rejeita (cStat "Código de Município diverge do nome") quando o
 * cMun não bate com o xMun. Este validador consulta a lista oficial do IBGE
 * por UF e, se o código informado não corresponder ao nome, corrige o código
 * pelo nome (match exato normalizado). Retorna o código a usar e um aviso
 * quando houve correção. Se não for possível resolver, mantém o código
 * original (a validação/SEFAZ tratam o erro depois).
 */
async function resolverCodigoMunicipio(
  codigoInformado: string,
  nomeMunicipio: string,
  uf: string,
): Promise<{ codigo: string; corrigido: boolean; aviso?: string }> {
  const cod = (codigoInformado || '').trim()
  const nome = (nomeMunicipio || '').trim()
  const ufNorm = (uf || '').trim().toUpperCase()

  if (!nome || ufNorm.length !== 2) {
    return { codigo: cod, corrigido: false }
  }

  let municipios: Array<{ codigo: string; nome: string; uf: string }>
  try {
    municipios = await buscarMunicipiosIBGE(ufNorm)
  } catch {
    // Falha ao consultar IBGE — não bloquear, manter o código original.
    return { codigo: cod, corrigido: false }
  }
  if (!municipios || municipios.length === 0) {
    return { codigo: cod, corrigido: false }
  }

  const buscaNome = normalizarNomeMunicipio(nome)
  const porNome = municipios.find(m => normalizarNomeMunicipio(m.nome) === buscaNome)

  // Se o código informado já é válido para essa UF, checar se bate com o nome.
  const porCodigo = municipios.find(m => m.codigo === cod)

  if (porCodigo && porNome && porCodigo.codigo === porNome.codigo) {
    // Código e nome coerentes — nada a fazer.
    return { codigo: cod, corrigido: false }
  }

  if (porNome) {
    // Nome encontrado no IBGE — o código correto é o do nome. Corrige se
    // divergir do informado (inclui o caso do código apontar para outro
    // município da mesma UF, ex.: Petrópolis 3304557 vs Paty do Alferes 3303906).
    if (porNome.codigo !== cod) {
      return {
        codigo: porNome.codigo,
        corrigido: true,
        aviso: `Código IBGE de "${nome}/${ufNorm}" corrigido de ${cod || '(vazio)'} para ${porNome.codigo}.`,
      }
    }
    return { codigo: cod, corrigido: false }
  }

  // Nome não encontrado no IBGE — não corrigir, deixar a validação/SEFAZ decidir.
  return { codigo: cod, corrigido: false }
}

function obterCodigoUF(uf: string): number {
  const UF_CODES: Record<string, number> = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
    MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
    SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
    PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
  }
  return UF_CODES[uf.toUpperCase()] || 35
}

// === Plugin de rotas ===

export async function cteRoutes(app: FastifyInstance) {

  // ==========================================================================
  // GET /cte/defaults — Retorna configurações padrão da empresa para pré-preencher
  // ==========================================================================
  app.get('/cte/defaults', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: {
        rntrc: true,
        serieCTe: true,
        ambienteCTe: true,
        ambienteNFe: true,
        uf: true,
        cidade: true,
        cep: true,
        inscEstadual: true,
        razaoSocial: true,
        nomeFantasia: true,
        cnpj: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
      },
    })

    if (!empresa) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }

    // Buscar parâmetros CT-e da tabela Parametro
    const parametros = await prisma.parametro.findMany({
      where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
    })
    const params: Record<string, string> = {}
    for (const p of parametros) {
      params[p.chave] = p.valor
    }

    return {
      rntrc: empresa.rntrc || '',
      serie: empresa.serieCTe || 1,
      ambiente: empresa.ambienteCTe || empresa.ambienteNFe || 2,
      ufEmitente: empresa.uf || '',
      // Padrões configuráveis (tabela Parametro, prefixo cte.)
      naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
      modal: params['cte.modal'] || '01',
      cstIcms: params['cte.cstIcms'] || '00',
      aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
      seguradora: params['cte.seguradora'] || '',
      apolice: params['cte.apolice'] || '',
      dacteModelo: params['cte.dacteModelo'] || '1',
      dacteOrientacao: params['cte.dacteOrientacao'] || 'retrato',
    }
  })

  // ==========================================================================
  // PUT /cte/defaults — Salvar configurações padrão CT-e da empresa
  // ==========================================================================
  app.put('/cte/defaults', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = z.object({
      naturezaOp: z.string().max(100).optional(),
      modal: z.string().max(2).optional(),
      cstIcms: z.string().max(3).optional(),
      aliqIcms: z.number().min(0).max(100).optional(),
      seguradora: z.string().max(30).optional(),
      apolice: z.string().max(20).optional(),
      dacteModelo: z.enum(['1', '2']).optional(),
      dacteOrientacao: z.enum(['retrato', 'paisagem']).optional(),
    }).parse(request.body)

    // Salvar cada campo como parâmetro
    const campos = Object.entries(body).filter(([_, v]) => v != null)
    for (const [chave, valor] of campos) {
      await prisma.parametro.upsert({
        where: { empresaId_chave: { empresaId: user.empresaId, chave: `cte.${chave}` } },
        create: { empresaId: user.empresaId, chave: `cte.${chave}`, valor: String(valor) },
        update: { valor: String(valor) },
      })
    }

    return { sucesso: true }
  })

  // ==========================================================================
  // GET /cte/buscar-participantes?q=HAVASA — Busca por razão social (autocomplete)
  // ==========================================================================
  app.get('/cte/buscar-participantes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const { q } = z.object({ q: z.string().min(2) }).parse(request.query)
    const busca = q.trim()

    // Buscar em Clientes
    const clientes = await prisma.cliente.findMany({
      where: {
        empresaId: user.empresaId,
        OR: [
          { razaoSocial: { contains: busca, mode: 'insensitive' } },
          { nomeFantasia: { contains: busca, mode: 'insensitive' } },
          { cpfCnpj: { contains: busca } },
        ],
      },
      take: 10,
    })

    // Buscar em Fornecedores
    const fornecedores = await prisma.fornecedor.findMany({
      where: {
        empresaId: user.empresaId,
        OR: [
          { razaoSocial: { contains: busca, mode: 'insensitive' } },
          { nomeFantasia: { contains: busca, mode: 'insensitive' } },
          { cnpj: { contains: busca } },
        ],
      },
      take: 10,
    })

    const resultados = [
      ...clientes.map((c: any) => ({
        tipo: 'cliente' as const,
        id: c.id,
        cnpj: c.cpfCnpj || '',
        razaoSocial: c.razaoSocial || '',
        nomeFantasia: c.nomeFantasia || '',
        ie: c.inscEstadual || '',
        logradouro: c.logradouro || '',
        numero: c.numero || '',
        complemento: c.complemento || '',
        bairro: c.bairro || '',
        codigoMunicipio: c.codigoMunicipio || '',
        municipio: c.cidade || '',
        uf: c.uf || '',
        cep: c.cep || '',
        email: c.email || '',
        telefone: c.telefone || '',
      })),
      ...fornecedores.map((f: any) => ({
        tipo: 'fornecedor' as const,
        id: f.id,
        cnpj: f.cnpj || '',
        razaoSocial: f.razaoSocial || '',
        nomeFantasia: f.nomeFantasia || '',
        ie: f.inscEstadual || '',
        logradouro: f.logradouro || '',
        numero: f.numero || '',
        complemento: f.complemento || '',
        bairro: f.bairro || '',
        codigoMunicipio: '',
        municipio: f.cidade || '',
        uf: f.uf || '',
        cep: f.cep || '',
        email: f.email || '',
        telefone: f.telefone || '',
      })),
    ]

    // Remover duplicados (mesmo CNPJ aparecendo como cliente E fornecedor)
    const vistos = new Set<string>()
    const unicos = resultados.filter(r => {
      const chave = r.cnpj || r.razaoSocial
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return true
    })

    return unicos.slice(0, 15)
  })

  // ==========================================================================
  // GET /cte/buscar-participante/:cpfCnpj — Busca cliente/fornecedor pelo CPF/CNPJ
  // ==========================================================================
  app.get('/cte/buscar-participante/:cpfCnpj', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const { cpfCnpj } = z.object({ cpfCnpj: z.string().min(11).max(14) }).parse(request.params)

    // Buscar no cadastro de Clientes
    const cliente = await prisma.cliente.findFirst({
      where: { empresaId: user.empresaId, cpfCnpj: { contains: cpfCnpj } },
    })

    if (cliente) {
      return {
        encontrado: true,
        tipo: 'cliente',
        cnpj: (cliente as any).cpfCnpj || '',
        razaoSocial: (cliente as any).razaoSocial || (cliente as any).nome || '',
        nomeFantasia: (cliente as any).nomeFantasia || '',
        ie: (cliente as any).inscEstadual || '',
        logradouro: (cliente as any).logradouro || '',
        numero: (cliente as any).numero || '',
        complemento: (cliente as any).complemento || '',
        bairro: (cliente as any).bairro || '',
        codigoMunicipio: (cliente as any).codigoMunicipio || '',
        municipio: (cliente as any).cidade || '',
        uf: (cliente as any).uf || '',
        cep: (cliente as any).cep || '',
        email: (cliente as any).email || '',
        telefone: (cliente as any).telefone || '',
      }
    }

    // Buscar no cadastro de Fornecedores
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { empresaId: user.empresaId, cnpj: { contains: cpfCnpj } },
    })

    if (fornecedor) {
      return {
        encontrado: true,
        tipo: 'fornecedor',
        cnpj: (fornecedor as any).cnpj || '',
        razaoSocial: (fornecedor as any).razaoSocial || (fornecedor as any).nome || '',
        nomeFantasia: (fornecedor as any).nomeFantasia || '',
        ie: (fornecedor as any).inscEstadual || '',
        logradouro: (fornecedor as any).logradouro || '',
        numero: (fornecedor as any).numero || '',
        complemento: (fornecedor as any).complemento || '',
        bairro: (fornecedor as any).bairro || '',
        codigoMunicipio: (fornecedor as any).codigoMunicipio || '',
        municipio: (fornecedor as any).cidade || '',
        uf: (fornecedor as any).uf || '',
        cep: (fornecedor as any).cep || '',
        email: (fornecedor as any).email || '',
        telefone: (fornecedor as any).telefone || '',
      }
    }

    return { encontrado: false }
  })

  // ==========================================================================
  // GET /cte/observacoes-padrao — Listar observações padrão da empresa
  // ==========================================================================
  app.get('/cte/observacoes-padrao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const observacoes = await prisma.observacaoPadraoCte.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { codigo: 'asc' },
    })

    return observacoes
  })

  // ==========================================================================
  // POST /cte/observacoes-padrao — Criar observação padrão
  // ==========================================================================
  app.post('/cte/observacoes-padrao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = z.object({
      codigo: z.string().min(1).max(20),
      texto: z.string().min(1),
    }).parse(request.body)

    const existente = await prisma.observacaoPadraoCte.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })
    if (existente) {
      return reply.status(409).send({ message: `Código "${body.codigo}" já existe` })
    }

    const obs = await prisma.observacaoPadraoCte.create({
      data: { empresaId: user.empresaId, codigo: body.codigo, texto: body.texto },
    })

    return obs
  })

  // ==========================================================================
  // PUT /cte/observacoes-padrao/:id — Atualizar observação padrão
  // ==========================================================================
  app.put('/cte/observacoes-padrao/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigo: z.string().min(1).max(20).optional(),
      texto: z.string().min(1).optional(),
      ativo: z.boolean().optional(),
    }).parse(request.body)

    const obs = await prisma.observacaoPadraoCte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!obs) {
      return reply.status(404).send({ message: 'Observação não encontrada' })
    }

    const atualizada = await prisma.observacaoPadraoCte.update({
      where: { id },
      data: { ...body },
    })

    return atualizada
  })

  // ==========================================================================
  // DELETE /cte/observacoes-padrao/:id — Excluir observação padrão
  // ==========================================================================
  app.delete('/cte/observacoes-padrao/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const obs = await prisma.observacaoPadraoCte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!obs) {
      return reply.status(404).send({ message: 'Observação não encontrada' })
    }

    await prisma.observacaoPadraoCte.delete({ where: { id } })
    return { sucesso: true }
  })

  // ==========================================================================
  // POST /cte/importar-nfe — Importar NF-e (XML) para gerar CT-e automático
  // ==========================================================================
  app.post('/cte/importar-nfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        xml: z.string().min(100, 'XML inválido ou vazio'),
      }).parse(request.body)

      // Parsear XML da NF-e
      const dados = parseNFeXml(body.xml)

      if (!dados.chaveAcesso) {
        return reply.status(422).send({ message: 'Não foi possível extrair a chave de acesso do XML' })
      }

      // Verificar se a chave já está vinculada a algum CT-e (exceto cancelados, mesmo ambiente)
      const empresaAmb = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { ambienteCTe: true, ambienteNFe: true },
      })
      const ambienteAtual = empresaAmb?.ambienteCTe || empresaAmb?.ambienteNFe || 2

      const cteExistente = await prisma.documentoFiscal.findFirst({
        where: {
          empresaId: user.empresaId,
          tipo: 'CTE',
          ambiente: ambienteAtual,
          status: { notIn: ['CANCELADO'] },
          xmlEnviado: { contains: dados.chaveAcesso },
        },
        select: { id: true, numero: true, serie: true, status: true },
      })
      const avisoNfeDuplicada = cteExistente
        ? `Atenção: esta NF-e já está vinculada ao CT-e nº ${cteExistente.numero} / série ${cteExistente.serie} (${cteExistente.status}).`
        : null

      // Auto-cadastrar remetente e destinatário
      const remetenteId = await autoCadastrarParticipante(user.empresaId, dados.remetente)
      const destinatarioId = await autoCadastrarParticipante(user.empresaId, dados.destinatario)

      // Buscar defaults da empresa
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { rntrc: true, serieCTe: true, uf: true },
      })

      const parametros = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
      })
      const params: Record<string, string> = {}
      for (const p of parametros) params[p.chave] = p.valor

      return {
        sucesso: true,
        avisoNfeDuplicada,
        dadosExtraidos: dados,
        cadastros: {
          remetenteId,
          destinatarioId,
          remetenteCadastrado: !!remetenteId,
          destinatarioCadastrado: !!destinatarioId,
        },
        ctePrePreenchido: {
          serie: empresa?.serieCTe || 1,
          cfop: dados.cfopSugerido,
          naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
          modal: params['cte.modal'] || '01',
          tpServ: 0,
          tpTom: 0, // Remetente como tomador (padrão transporte)
          cMunIni: dados.origemCMun,
          xMunIni: dados.origemMun,
          ufIni: dados.origemUf,
          cMunFim: dados.destinoCMun,
          xMunFim: dados.destinoMun,
          ufFim: dados.destinoUf,
          remetente: dados.remetente,
          destinatario: dados.destinatario,
          infCarga: {
            vCarga: dados.valorCarga,
            proPred: dados.produtos,
            pesoBruto: dados.pesoBruto,
          },
          nfesVinculadas: [{ chave: dados.chaveAcesso }],
          veicNovos: dados.veiculosNovos,
          rntrc: empresa?.rntrc || '',
          cstIcms: params['cte.cstIcms'] || '00',
          aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
        },
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao processar NF-e' })
    }
  })

  // ==========================================================================
  // POST /cte/importar-danfe-pdf — Importar DANFE (PDF) para gerar CT-e
  // ==========================================================================
  app.post('/cte/importar-danfe-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      // Receber o PDF como base64 no body (simples, sem multipart)
      const body = z.object({
        pdfBase64: z.string().min(100, 'PDF inválido ou vazio'),
      }).parse(request.body)

      // Converter base64 para Buffer
      const base64Data = body.pdfBase64.replace(/^data:application\/pdf;base64,/, '')
      const pdfBuffer = Buffer.from(base64Data, 'base64')

      // Extrair texto do PDF
      const texto = await extrairTextoDanfePdf(pdfBuffer)

      if (!texto || texto.trim().length < 50) {
        return reply.status(422).send({ message: 'Não foi possível extrair texto do PDF. O arquivo pode ser uma imagem (escaneado).' })
      }

      // Parsear dados do DANFE
      const dados = parseDanfeTexto(texto)

      if (!dados.chaveAcesso) {
        return reply.status(422).send({
          message: 'Não foi possível encontrar a chave de acesso de 44 dígitos no PDF. Verifique se é um DANFE válido.',
          textoExtraido: texto.substring(0, 500),
        })
      }

      // Verificar se a chave já está vinculada a algum CT-e (exceto cancelados, mesmo ambiente)
      const empresaAmbPdf = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { ambienteCTe: true, ambienteNFe: true },
      })
      const ambienteAtualPdf = empresaAmbPdf?.ambienteCTe || empresaAmbPdf?.ambienteNFe || 2

      const cteExistentePdf = await prisma.documentoFiscal.findFirst({
        where: {
          empresaId: user.empresaId,
          tipo: 'CTE',
          ambiente: ambienteAtualPdf,
          status: { notIn: ['CANCELADO'] },
          xmlEnviado: { contains: dados.chaveAcesso },
        },
        select: { id: true, numero: true, serie: true, status: true },
      })
      const avisoNfeDuplicada = cteExistentePdf
        ? `Atenção: esta NF-e já está vinculada ao CT-e nº ${cteExistentePdf.numero} / série ${cteExistentePdf.serie} (${cteExistentePdf.status}).`
        : null

      // Montar resposta similar à importação de XML
      const origemUf = dados.emitente.uf
      const destinoUf = dados.destinatario.uf
      const cfopSugerido = origemUf && destinoUf ? (origemUf === destinoUf ? '5353' : '6353') : '5353'

      // Buscar defaults
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { rntrc: true, serieCTe: true },
      })
      const parametros = await prisma.parametro.findMany({
        where: { empresaId: user.empresaId, chave: { startsWith: 'cte.' } },
      })
      const params: Record<string, string> = {}
      for (const p of parametros) params[p.chave] = p.valor

      // === ROTEIRO COMPLETO DE IMPORTAÇÃO ===

      // 1. Resolver códigos IBGE dos municípios
      let cMunIni = ''
      let cMunFim = ''
      if (origemUf && dados.emitente.municipio) {
        const munsOrigem = await buscarMunicipiosIBGE(origemUf)
        const buscaOrigem = dados.emitente.municipio.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const found = munsOrigem.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === buscaOrigem)
          || munsOrigem.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith(buscaOrigem))
          || munsOrigem.find(m => buscaOrigem.startsWith(m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
        if (found) cMunIni = found.codigo
      }
      if (destinoUf && dados.destinatario.municipio) {
        const munsDest = await buscarMunicipiosIBGE(destinoUf)
        const buscaDest = dados.destinatario.municipio.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const found = munsDest.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === buscaDest)
          || munsDest.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith(buscaDest))
          || munsDest.find(m => buscaDest.startsWith(m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
        if (found) cMunFim = found.codigo
      }

      // 2. Para cada participante: buscar no cadastro → consultar BrasilAPI → mesclar com PDF
      async function resolverParticipante(cnpj: string, dadosPdf: any, cMun: string) {
        const doc = cnpj?.replace(/\D/g, '') || ''
        let resultado = {
          cnpj: doc,
          cpf: '',
          razaoSocial: dadosPdf.razaoSocial || '',
          nomeFantasia: '',
          ie: dadosPdf.ie || '',
          logradouro: '',
          numero: '',
          complemento: '',
          bairro: '',
          codigoMunicipio: cMun,
          municipio: dadosPdf.municipio || '',
          uf: dadosPdf.uf || '',
          cep: '',
          email: '',
          telefone: '',
        }
        let cadastrado = false

        if (!doc || doc.length !== 14) return { ...resultado, cadastrado }

        // Passo 1: buscar no cadastro de Clientes
        const clienteExistente = await prisma.cliente.findFirst({
          where: { empresaId: user.empresaId!, cpfCnpj: doc },
        })

        if (clienteExistente) {
          cadastrado = true
          const c = clienteExistente as any
          resultado = {
            ...resultado,
            razaoSocial: c.razaoSocial || c.nome || resultado.razaoSocial,
            nomeFantasia: c.nomeFantasia || '',
            ie: c.inscEstadual || resultado.ie,
            logradouro: c.logradouro || '',
            numero: c.numero || '',
            complemento: c.complemento || '',
            bairro: c.bairro || '',
            codigoMunicipio: c.codigoMunicipio || cMun,
            municipio: c.cidade || resultado.municipio,
            uf: c.uf || resultado.uf,
            cep: c.cep || '',
            email: c.email || '',
            telefone: c.telefone || '',
          }
          return { ...resultado, cadastrado }
        }

        // Passo 2: não encontrou no cadastro → consultar BrasilAPI
        const dadosCnpj = await consultarCnpj(doc)
        if (dadosCnpj) {
          resultado = {
            ...resultado,
            razaoSocial: dadosCnpj.razaoSocial || resultado.razaoSocial,
            nomeFantasia: dadosCnpj.nomeFantasia || '',
            // IE: BrasilAPI não retorna → manter do PDF
            ie: resultado.ie || '',
            logradouro: dadosCnpj.logradouro || '',
            numero: dadosCnpj.numero || '',
            complemento: dadosCnpj.complemento || '',
            bairro: dadosCnpj.bairro || '',
            codigoMunicipio: cMun || '',
            municipio: dadosCnpj.cidade || resultado.municipio,
            uf: dadosCnpj.uf || resultado.uf,
            cep: dadosCnpj.cep || '',
            email: dadosCnpj.email || '',
            telefone: dadosCnpj.telefone || '',
          }

          // Resolver cMun se veio vazio e temos cidade+uf da BrasilAPI
          if (!resultado.codigoMunicipio && dadosCnpj.cidade && dadosCnpj.uf) {
            const muns = await buscarMunicipiosIBGE(dadosCnpj.uf)
            const busca = dadosCnpj.cidade.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            const found = muns.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === busca)
            if (found) resultado.codigoMunicipio = found.codigo
          }
        }

        // Passo 3: auto-cadastrar para próxima vez
        try {
          await prisma.cliente.create({
            data: {
              empresaId: user.empresaId!,
              cpfCnpj: doc,
              razaoSocial: resultado.razaoSocial,
              nomeFantasia: resultado.nomeFantasia || undefined,
              inscEstadual: resultado.ie || undefined,
              logradouro: resultado.logradouro || undefined,
              numero: resultado.numero || undefined,
              complemento: resultado.complemento || undefined,
              bairro: resultado.bairro || undefined,
              cidade: resultado.municipio || undefined,
              uf: resultado.uf || undefined,
              cep: resultado.cep || undefined,
              email: resultado.email || undefined,
              telefone: resultado.telefone || undefined,
              status: true,
            } as any,
          })
          cadastrado = true
        } catch { /* unique constraint — já existe */ cadastrado = true }

        return { ...resultado, cadastrado }
      }

      const remResolvido = await resolverParticipante(dados.emitente.cnpj, dados.emitente, cMunIni)
      const destResolvido = await resolverParticipante(dados.destinatario.cnpj, dados.destinatario, cMunFim)

      // Atualizar cMun se foi resolvido pela consulta CNPJ
      if (remResolvido.codigoMunicipio && !cMunIni) cMunIni = remResolvido.codigoMunicipio
      if (destResolvido.codigoMunicipio && !cMunFim) cMunFim = destResolvido.codigoMunicipio

      // Fallback final: se ainda não tem cMunFim, tentar resolver pelo nome do município
      if (!cMunFim) {
        const munNomeFim = destResolvido.municipio || dados.destinatario.municipio || ''
        const ufFimResolv = destResolvido.uf || destinoUf || ''
        if (munNomeFim && ufFimResolv) {
          const munsF = await buscarMunicipiosIBGE(ufFimResolv)
          const buscaF = munNomeFim.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const foundF = munsF.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === buscaF)
            || munsF.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(buscaF))
            || munsF.find(m => buscaF.includes(m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
          if (foundF) cMunFim = foundF.codigo
        }
      }
      // Mesmo para cMunIni
      if (!cMunIni) {
        const munNomeIni = remResolvido.municipio || dados.emitente.municipio || ''
        const ufIniResolv = remResolvido.uf || origemUf || ''
        if (munNomeIni && ufIniResolv) {
          const munsI = await buscarMunicipiosIBGE(ufIniResolv)
          const buscaI = munNomeIni.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const foundI = munsI.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === buscaI)
            || munsI.find(m => m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(buscaI))
            || munsI.find(m => buscaI.includes(m.nome.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
          if (foundI) cMunIni = foundI.codigo
        }
      }

      return {
        sucesso: true,
        avisoNfeDuplicada,
        origem: 'PDF',
        cadastros: {
          remetenteCadastrado: remResolvido.cadastrado,
          destinatarioCadastrado: destResolvido.cadastrado,
        },
        dadosExtraidos: {
          chaveAcesso: dados.chaveAcesso,
          numero: dados.numero,
          serie: dados.serie,
          remetente: { ...dados.emitente, ...remResolvido },
          destinatario: { ...dados.destinatario, ...destResolvido },
          valorCarga: dados.valorTotal,
          pesoBruto: dados.pesoBruto,
          produtos: dados.produtos || 'MERCADORIAS',
          origemMun: remResolvido.municipio || dados.emitente.municipio,
          origemUf: remResolvido.uf || origemUf,
          destinoMun: destResolvido.municipio || dados.destinatario.municipio,
          destinoUf: destResolvido.uf || destinoUf,
          veiculosNovos: dados.veiculos?.map(v => ({ chassi: v.chassi, xCor: v.cor, cMod: v.cMod || derivarCodModelo(v.modelo) })) || [],
        },
        ctePrePreenchido: {
          serie: empresa?.serieCTe || 1,
          cfop: cfopSugerido,
          naturezaOp: params['cte.naturezaOp'] || 'PRESTACAO DE SERVICO DE TRANSPORTE',
          modal: params['cte.modal'] || '01',
          tpServ: 0,
          tpTom: 0,
          cMunIni: remResolvido.codigoMunicipio || cMunIni,
          xMunIni: remResolvido.municipio || dados.emitente.municipio,
          ufIni: remResolvido.uf || origemUf,
          cMunFim: destResolvido.codigoMunicipio || cMunFim,
          xMunFim: destResolvido.municipio || dados.destinatario.municipio,
          ufFim: destResolvido.uf || destinoUf,
          remetente: remResolvido,
          destinatario: destResolvido,
          infCarga: {
            vCarga: dados.valorTotal,
            proPred: dados.produtos || 'MERCADORIAS',
            pesoBruto: dados.pesoBruto,
          },
          nfesVinculadas: [{ chave: dados.chaveAcesso }],
          veicNovos: await Promise.all((dados.veiculos || []).map(async (v: any) => {
            let cCor = ''
            if (v.cor) {
              const corNorm = v.cor.trim().toUpperCase()
              const corExistente = await (prisma as any).corVeiculo.findFirst({
                where: { empresaId: user.empresaId!, descricao: corNorm },
              })
              if (corExistente) {
                cCor = corExistente.codigo
              } else {
                // Auto-cadastrar: gerar próximo código sequencial
                const todas = await (prisma as any).corVeiculo.findMany({ where: { empresaId: user.empresaId! }, select: { codigo: true } })
                const maxCod = (todas as any[]).map((c: any) => parseInt(c.codigo, 10)).filter((n: number) => !isNaN(n)).reduce((m: number, n: number) => Math.max(m, n), 0)
                const novoCodigo = String(maxCod + 1).padStart(2, '0')
                await (prisma as any).corVeiculo.create({ data: { empresaId: user.empresaId!, codigo: novoCodigo, descricao: corNorm } })
                cCor = novoCodigo
              }
            }
            return { chassi: v.chassi, cCor, xCor: v.cor || '', cMod: v.cMod || derivarCodModelo(v.modelo) || '', vUnit: dados.valorTotal, vFrete: 0 }
          })),
          rntrc: empresa?.rntrc || '',
          cstIcms: params['cte.cstIcms'] || '00',
          aliqIcms: params['cte.aliqIcms'] ? Number(params['cte.aliqIcms']) : 12,
        },
      }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro ao processar PDF' })
    }
  })

  // ==========================================================================
  // GET /cte — Listar CT-e com filtros e paginação
  // ==========================================================================
  app.get('/cte', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listCteQuerySchema.parse(request.query)

      const where: any = { empresaId: user.empresaId, tipo: 'CTE' }

      // Filtrar por ambiente da empresa (produção só vê produção, homologação só vê homologação)
      const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId }, select: { ambienteCTe: true, ambienteNFe: true } })
      const ambienteAtual = empresa?.ambienteCTe || empresa?.ambienteNFe || 2
      where.ambiente = ambienteAtual

      if (filtros.status) where.status = filtros.status.toUpperCase()
      if (filtros.serie != null) where.serie = filtros.serie
      if (filtros.numero) where.numero = filtros.numero
      if (filtros.chaveAcesso) where.chaveAcesso = filtros.chaveAcesso
      if (filtros.tomadorCpfCnpj) where.destCpfCnpj = filtros.tomadorCpfCnpj

      if (filtros.dataInicio || filtros.dataFim) {
        where.dataEmissao = {}
        if (filtros.dataInicio) where.dataEmissao.gte = new Date(filtros.dataInicio)
        if (filtros.dataFim) where.dataEmissao.lte = new Date(`${filtros.dataFim}T23:59:59.999Z`)
      }

      if (filtros.dataAutorizacaoInicio || filtros.dataAutorizacaoFim) {
        where.dataAutorizacao = {}
        if (filtros.dataAutorizacaoInicio) where.dataAutorizacao.gte = new Date(filtros.dataAutorizacaoInicio)
        if (filtros.dataAutorizacaoFim) where.dataAutorizacao.lte = new Date(`${filtros.dataAutorizacaoFim}T23:59:59.999Z`)
      }

      const skip = (filtros.page - 1) * filtros.limit

      const [dados, total] = await Promise.all([
        prisma.documentoFiscal.findMany({
          where,
          orderBy: { criadoEm: 'desc' },
          skip,
          take: filtros.limit,
          select: {
            id: true,
            serie: true,
            numero: true,
            chaveAcesso: true,
            status: true,
            naturezaOp: true,
            dataEmissao: true,
            destCpfCnpj: true,
            destRazao: true,
            valorTotal: true,
            valorFrete: true,
            protocolo: true,
            dataAutorizacao: true,
            contingencia: true,
            ambiente: true,
            criadoEm: true,
            xmlEnviado: true,
          },
        }),
        prisma.documentoFiscal.count({ where }),
      ])

      return {
        data: dados.map(d => {
          // Extrair origem/destino do payload JSON
          let origemDestino: string | null = null
          if (d.xmlEnviado) {
            try {
              const payload = JSON.parse(d.xmlEnviado)
              const munIni = payload.xMunIni || payload.municipioInicio
              const ufIni = payload.ufInicio || payload.ufIni || ''
              const munFim = payload.xMunFim || payload.municipioFim
              const ufFim = payload.ufFim || ''
              if (munIni && munFim) {
                origemDestino = `${munIni}/${ufIni} → ${munFim}/${ufFim}`
              } else if (munIni) {
                origemDestino = `${munIni}/${ufIni}`
              }
            } catch { /* ignore parse errors */ }
          }
          const { xmlEnviado, ...rest } = d
          return {
            ...rest,
            tomadorRazao: d.destRazao,
            valorTotal: Number(d.valorTotal),
            origemDestino,
          }
        }),
        total,
        page: filtros.page,
        limit: filtros.limit,
        totalPages: Math.ceil(total / filtros.limit),
        ambiente: ambienteAtual,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cte/:id — Detalhe de um CT-e
  // ==========================================================================
  app.get('/cte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        include: {
          eventos: { orderBy: { dataEvento: 'desc' } },
        },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      return {
        ...doc,
        valorTotal: Number(doc.valorTotal),
        valorFrete: Number(doc.valorFrete),
        valorIcms: Number(doc.valorIcms),
        // Para CT-e não-autorizado/cancelado, retornar os dados do payload para permitir edição
        dadosEmissao: !['AUTORIZADO', 'CANCELADO'].includes(doc.status) && doc.xmlEnviado
          ? (() => { try { return JSON.parse(doc.xmlEnviado) } catch { return null } })()
          : null,
        xmlEnviado: undefined, // Não retornar XML bruto
        xmlAutorizado: undefined,
        xmlRetorno: undefined,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/gravar — Gravar CT-e como DIGITADA (sem transmitir)
  // ==========================================================================
  app.post('/cte/gravar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoCTeInputSchema.parse(request.body)

      const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
      if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

      const ambienteCte = empresa.ambienteCTe || empresa.ambienteNFe || 2
      let nCT = await proximoNumeroCTe(user.empresaId, body.serie, ambienteCte)

      // Gravar como DocumentoFiscal com status DIGITADA (sem gerar XML/transmitir)
      // Retry em caso de unique constraint (race condition ou constraint antiga sem ambiente)
      let documento: any = null
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        try {
          documento = await prisma.documentoFiscal.create({
            data: {
              empresaId: user.empresaId,
              tipo: 'CTE',
              modelo: 57,
              serie: body.serie,
              numero: nCT,
              status: 'DIGITADA',
              naturezaOp: body.naturezaOp,
              dataEmissao: new Date(),
              tipoOperacao: 1,
              finalidade: 1,
              emitenteCnpj: (empresa.cnpj || '').replace(/\D/g, ''),
              emitenteRazao: empresa.razaoSocial || '',
              emitenteUf: empresa.uf || '',
              destCpfCnpj: (body.destinatario.cnpj || body.destinatario.cpf || '').replace(/\D/g, '') || null,
              destRazao: body.destinatario.razaoSocial || null,
              destUf: body.destinatario.endereco?.uf || null,
              valorTotal: body.vPrest.vTPrest || 0,
              valorFrete: body.vPrest.vTPrest || 0,
              valorIcms: body.impostos.icms.valor || 0,
              ambiente: body.ambiente,
              xmlEnviado: JSON.stringify(body),
            },
          })
          break // sucesso
        } catch (createErr: any) {
          if (createErr.code === 'P2002') {
            // Unique constraint — incrementar número e tentar novamente
            nCT++
          } else {
            throw createErr
          }
        }
      }

      if (!documento) {
        return reply.status(500).send({ message: 'Não foi possível gerar número único para o CT-e. Tente novamente.' })
      }

      // Auto-salvar observação como padrão (se tiver infCpl e não existir igual cadastrada)
      if (body.infCpl && body.infCpl.trim().length > 5) {
        try {
          const textoObs = body.infCpl.trim()
          const existente = await prisma.observacaoPadraoCte.findFirst({
            where: { empresaId: user.empresaId, texto: textoObs },
          })
          if (!existente) {
            // Gerar próximo código sequencial OBS-N
            const todas = await prisma.observacaoPadraoCte.findMany({
              where: { empresaId: user.empresaId },
              select: { codigo: true },
            })
            const maxNum = todas
              .map(o => { const m = o.codigo.match(/^OBS-?(\d+)$/i); return m ? parseInt(m[1]) : 0 })
              .reduce((max, n) => Math.max(max, n), 0)
            const novoCodigo = `OBS${maxNum + 1}`
            await prisma.observacaoPadraoCte.create({
              data: { empresaId: user.empresaId, codigo: novoCodigo, texto: textoObs },
            })
          }
        } catch { /* silencioso — não impedir gravação do CT-e */ }
      }

      return reply.status(201).send({
        sucesso: true,
        id: documento.id,
        numero: nCT,
        serie: body.serie,
        status: 'DIGITADA',
        message: 'CT-e gravado com sucesso. Use a ação "Transmitir" para enviar à SEFAZ.',
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send(formatarErroZod(err))
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gravar' })
    }
  })

  // ==========================================================================
  // PUT /cte/:id — Atualizar CT-e DIGITADA (edição)
  // ==========================================================================
  app.put('/cte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = emissaoCTeInputSchema.parse(request.body)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) return reply.status(404).send({ message: 'CT-e não encontrado' })

      if (!['DIGITADA', 'PENDENTE', 'REJEITADO'].includes(doc.status)) {
        return reply.status(422).send({
          message: `Só é possível editar CT-e com status DIGITADA, PENDENTE ou REJEITADO. Status atual: ${doc.status}`,
        })
      }

      await prisma.documentoFiscal.update({
        where: { id },
        data: {
          naturezaOp: body.naturezaOp,
          destCpfCnpj: (body.destinatario.cnpj || body.destinatario.cpf || '').replace(/\D/g, '') || null,
          destRazao: body.destinatario.razaoSocial || null,
          destUf: body.destinatario.endereco?.uf || null,
          valorTotal: body.vPrest.vTPrest || 0,
          valorFrete: body.vPrest.vTPrest || 0,
          valorIcms: body.impostos.icms.valor || 0,
          ambiente: body.ambiente,
          xmlEnviado: JSON.stringify(body),
        },
      })

      return reply.status(200).send({
        sucesso: true,
        id,
        numero: doc.numero,
        serie: doc.serie,
        status: 'DIGITADA',
        message: 'CT-e atualizado com sucesso.',
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send(formatarErroZod(err))
      }
      return reply.status(500).send({ message: err.message || 'Erro ao atualizar' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/transmitir — Transmitir CT-e DIGITADA à SEFAZ
  // ==========================================================================
  app.post('/cte/:id/transmitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) return reply.status(404).send({ message: 'CT-e não encontrado' })

      if (doc.status !== 'DIGITADA' && doc.status !== 'REJEITADO' && doc.status !== 'PENDENTE') {
        return reply.status(422).send({
          message: `Só é possível transmitir CT-e com status DIGITADA, PENDENTE ou REJEITADO. Status atual: ${doc.status}`,
        })
      }

      // Recuperar payload salvo
      let body: any
      try {
        body = JSON.parse(doc.xmlEnviado || '{}')
      } catch {
        return reply.status(422).send({ message: 'Dados do CT-e corrompidos. Exclua e grave novamente.' })
      }

      const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
      if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

      const ufEmitente = empresa.uf || ''

      const dadosCTe: DadosCTe = {
        cUF: obterCodigoUF(ufEmitente),
        cCT: gerarCodigoNumerico(),
        nCT: doc.numero,
        serie: doc.serie,
        modelo: 57,
        tpEmis: body.tpEmis || 1,
        ambiente: empresa.ambienteCTe || empresa.ambienteNFe || 2,
        cfop: body.cfop || '5353',
        naturezaOp: body.naturezaOp || '',
        tpServ: body.tpServ || 0,
        dataEmissao: new Date(),
        tpCTe: body.tpCTe || 0,
        modal: body.modal || '01',
        cMunIni: body.cMunIni || '',
        xMunIni: body.xMunIni || '',
        ufIni: body.ufIni || '',
        cMunFim: body.cMunFim || '',
        xMunFim: body.xMunFim || '',
        ufFim: body.ufFim || '',
        tpTom: body.tpTom || 0,
        indIEToma: body.indIEToma || 9,
        emitente: {
          cnpj: (empresa.cnpj || '').replace(/\D/g, ''),
          ie: (empresa.inscEstadual || '').replace(/\D/g, ''),
          razaoSocial: empresa.razaoSocial || '',
          nomeFantasia: empresa.nomeFantasia || undefined,
          endereco: {
            logradouro: empresa.logradouro || '',
            numero: empresa.numero || '',
            complemento: empresa.complemento || undefined,
            bairro: empresa.bairro || '',
            codigoMunicipio: empresa.codigoMunicipio || empresa.cidade || '',
            municipio: empresa.cidade || '',
            uf: ufEmitente,
            cep: empresa.cep || '',
          },
        },
        remetente: body.remetente as any,
        destinatario: body.destinatario as any,
        expedidor: body.expedidor as any,
        recebedor: body.recebedor as any,
        vPrest: body.vPrest as any,
        impostos: body.impostos as any,
        infCTeNorm: {
          infCarga: body.infCTeNorm?.infCarga,
          infDoc: {
            infNFe: body.infCTeNorm?.infDoc?.infNFe,
            infOutros: body.infCTeNorm?.infDoc?.infOutros,
          },
          infModal: body.infCTeNorm?.infModal,
          veicNovos: body.infCTeNorm?.veicNovos,
        },
        complemento: body.complemento,
        infAdFisco: body.infAdFisco,
        infCpl: body.infCpl,
        tomadorOutros: body.tomadorOutros,
      }

      const resultado = await cteEmissaoService.transmitirExistente({
        empresaId: user.empresaId,
        documentoFiscalId: id,
        dadosCTe,
        forcarContingencia: body.forcarContingencia || false,
      })

      // Atualizar o documento existente com o resultado
      await prisma.documentoFiscal.update({
        where: { id },
        data: {
          status: resultado.status,
          chaveAcesso: resultado.chaveAcesso || undefined,
          protocolo: resultado.protocolo || undefined,
          xmlAutorizado: resultado.xmlAutorizado || resultado.xmlAssinado || undefined,
          codigoRejeicao: resultado.codigoRejeicao || undefined,
          motivoRejeicao: resultado.motivoRejeicao || undefined,
          dataAutorizacao: resultado.sucesso ? new Date() : undefined,
        },
      })

      return reply.status(resultado.sucesso ? 200 : 422).send({
        ...resultado,
        documentoId: id,
        // Incluir 'message' para compatibilidade com o frontend (onError procura por esse campo)
        message: resultado.sucesso
          ? 'CT-e autorizado com sucesso'
          : `Rejeição SEFAZ (cStat ${resultado.codigoRejeicao}): ${resultado.motivoRejeicao || 'Motivo não informado'}`,
      })
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao transmitir' })
    }
  })

  // ==========================================================================
  // GET /cte/:id/preview-xml — Visualizar XML que será enviado à SEFAZ (sem transmitir)
  // ==========================================================================
  app.get('/cte/:id/preview-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) return reply.status(404).send({ message: 'CT-e não encontrado' })

      // Recuperar payload salvo
      let body: any
      try {
        body = JSON.parse(doc.xmlEnviado || '{}')
      } catch {
        return reply.status(422).send({ message: 'Dados do CT-e corrompidos.' })
      }

      const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
      if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

      const ufEmitente = empresa.uf || ''

      const dadosCTe: DadosCTe = {
        cUF: obterCodigoUF(ufEmitente),
        cCT: gerarCodigoNumerico(),
        nCT: doc.numero,
        serie: doc.serie,
        modelo: 57,
        tpEmis: body.tpEmis || 1,
        ambiente: empresa.ambienteCTe || empresa.ambienteNFe || 2,
        cfop: body.cfop || '5353',
        naturezaOp: body.naturezaOp || '',
        tpServ: body.tpServ || 0,
        dataEmissao: new Date(),
        tpCTe: body.tpCTe || 0,
        modal: body.modal || '01',
        cMunIni: body.cMunIni || '',
        xMunIni: body.xMunIni || '',
        ufIni: body.ufIni || '',
        cMunFim: body.cMunFim || '',
        xMunFim: body.xMunFim || '',
        ufFim: body.ufFim || '',
        tpTom: body.tpTom || 0,
        indIEToma: body.indIEToma || 9,
        emitente: {
          cnpj: (empresa.cnpj || '').replace(/\D/g, ''),
          ie: (empresa.inscEstadual || '').replace(/\D/g, ''),
          razaoSocial: empresa.razaoSocial || '',
          nomeFantasia: empresa.nomeFantasia || undefined,
          endereco: {
            logradouro: empresa.logradouro || '',
            numero: empresa.numero || '',
            complemento: empresa.complemento || undefined,
            bairro: empresa.bairro || '',
            codigoMunicipio: empresa.codigoMunicipio || empresa.cidade || '',
            municipio: empresa.cidade || '',
            uf: ufEmitente,
            cep: empresa.cep || '',
          },
        },
        remetente: body.remetente as any,
        destinatario: body.destinatario as any,
        expedidor: body.expedidor as any,
        recebedor: body.recebedor as any,
        vPrest: body.vPrest as any,
        impostos: body.impostos as any,
        infCTeNorm: {
          infCarga: body.infCTeNorm?.infCarga,
          infDoc: {
            infNFe: body.infCTeNorm?.infDoc?.infNFe,
            infOutros: body.infCTeNorm?.infDoc?.infOutros,
          },
          infModal: body.infCTeNorm?.infModal,
          veicNovos: body.infCTeNorm?.veicNovos,
        },
        complemento: body.complemento,
        infAdFisco: body.infAdFisco,
        infCpl: body.infCpl,
        tomadorOutros: body.tomadorOutros,
      }

      const xml = buildCTeXml(dadosCTe)

      reply.header('Content-Type', 'application/xml; charset=utf-8')
      reply.header('Content-Disposition', `inline; filename="CTe-${doc.numero}-${doc.serie}-preview.xml"`)
      return reply.send(xml)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro ao gerar preview' })
    }
  })

  // ==========================================================================
  // DELETE /cte/:id — Excluir CT-e não transmitido (DIGITADA/PENDENTE/REJEITADO)
  // ==========================================================================
  app.delete('/cte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) return reply.status(404).send({ message: 'CT-e não encontrado' })

      if (!['DIGITADA', 'PENDENTE', 'REJEITADO'].includes(doc.status)) {
        return reply.status(422).send({
          message: `Não é possível excluir CT-e com status ${doc.status}. Apenas DIGITADA, PENDENTE ou REJEITADO podem ser excluídos.`,
        })
      }

      await prisma.documentoFiscal.delete({ where: { id } })

      return reply.status(200).send({ sucesso: true, message: 'CT-e excluído com sucesso.' })
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro ao excluir' })
    }
  })

  // ==========================================================================
  // POST /cte/emitir — Emitir CT-e modelo 57 (gravar + transmitir em um passo)
  // ==========================================================================
  app.post('/cte/emitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emissaoCTeInputSchema.parse(request.body)

      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })

      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      const ufEmitente = empresa.uf || ''
      const ambienteEmissao = empresa.ambienteCTe || empresa.ambienteNFe || 2
      const nCT = await proximoNumeroCTe(user.empresaId, body.serie, ambienteEmissao)

      // Garantir coerência código IBGE x nome do município (evita rejeição
      // "Código de Município diverge do nome"). Corrige o código pelo nome+UF
      // quando divergir — ex.: Petrópolis enviado com código 3303906
      // (Paty do Alferes) é corrigido para 3304557.
      const avisosMunicipio: string[] = []
      const munIniResolvido = await resolverCodigoMunicipio(body.cMunIni, body.xMunIni, body.ufIni)
      const munFimResolvido = await resolverCodigoMunicipio(body.cMunFim, body.xMunFim, body.ufFim)
      const munEnvResolvido = await resolverCodigoMunicipio(
        empresa.codigoMunicipio || '', empresa.cidade || '', ufEmitente,
      )
      if (munIniResolvido.aviso) avisosMunicipio.push(munIniResolvido.aviso)
      if (munFimResolvido.aviso) avisosMunicipio.push(munFimResolvido.aviso)
      if (munEnvResolvido.aviso) avisosMunicipio.push(munEnvResolvido.aviso)
      if (avisosMunicipio.length > 0) {
        request.log.warn({ avisosMunicipio, cte: nCT }, 'CT-e: código(s) de município corrigido(s) antes da transmissão')
      }

      const dadosCTe: DadosCTe = {
        cUF: obterCodigoUF(ufEmitente),
        cCT: gerarCodigoNumerico(),
        nCT,
        serie: body.serie,
        modelo: 57,
        tpEmis: body.tpEmis,
        ambiente: body.ambiente,
        cfop: body.cfop,
        naturezaOp: body.naturezaOp,
        tpServ: body.tpServ,
        dataEmissao: new Date(),
        tpCTe: body.tpCTe,
        modal: body.modal,
        cMunIni: munIniResolvido.codigo,
        xMunIni: body.xMunIni,
        ufIni: body.ufIni,
        cMunFim: munFimResolvido.codigo,
        xMunFim: body.xMunFim,
        ufFim: body.ufFim,
        tpTom: body.tpTom,
        indIEToma: body.indIEToma,
        emitente: {
          cnpj: (empresa.cnpj || '').replace(/\D/g, ''),
          ie: (empresa.inscEstadual || '').replace(/\D/g, ''),
          razaoSocial: empresa.razaoSocial || '',
          nomeFantasia: empresa.nomeFantasia || undefined,
          CRT: empresa.regimeTributario || 1,
          fone: empresa.telefone || undefined,
          endereco: {
            logradouro: empresa.logradouro || '',
            numero: empresa.numero || '',
            complemento: empresa.complemento || undefined,
            bairro: empresa.bairro || '',
            codigoMunicipio: munEnvResolvido.codigo || empresa.codigoMunicipio || empresa.cidade || '',
            municipio: empresa.cidade || '',
            uf: ufEmitente,
            cep: empresa.cep || '',
          },
        },

        remetente: body.remetente as any,
        destinatario: body.destinatario as any,
        expedidor: body.expedidor as any,
        recebedor: body.recebedor as any,
        vPrest: body.vPrest as any,
        impostos: body.impostos as any,
        infCTeNorm: {
          infCarga: body.infCTeNorm.infCarga,
          infDoc: {
            infNFe: body.infCTeNorm.infDoc.infNFe,
            infOutros: body.infCTeNorm.infDoc.infOutros?.map(o => ({
              ...o,
              dEmi: o.dEmi ? new Date(o.dEmi) : undefined,
            })),
          },
          infModal: body.infCTeNorm.infModal as any,
          veicNovos: body.infCTeNorm.veicNovos,
        },
        complemento: body.complemento,
        infAdFisco: body.infAdFisco,
        infCpl: body.infCpl,
        tomadorOutros: body.tomadorOutros,
      }

      const resultado = await cteEmissaoService.emitir({
        empresaId: user.empresaId,
        dadosCTe,
        forcarContingencia: body.forcarContingencia,
      })

      const statusCode = resultado.sucesso ? 200 : 422
      return reply.status(statusCode).send(resultado)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send(formatarErroZod(err))
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/consultar-sefaz — Consulta situação real do CT-e na SEFAZ
  // ==========================================================================
  app.post('/cte/:id/consultar-sefaz', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const documento = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId },
        select: { id: true, chaveAcesso: true, emitenteCnpj: true, emitenteUf: true, ambiente: true },
      })

      if (!documento) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      if (!documento.chaveAcesso) {
        return reply.status(422).send({ message: 'CT-e não possui chave de acesso (nunca foi transmitido)' })
      }

      // Montar XML de consulta CT-e
      const ambiente = documento.ambiente || Number(process.env.SEFAZ_AMBIENTE) || 2
      const xmlConsulta = `<consSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><tpAmb>${ambiente}</tpAmb><xServ>CONSULTAR</xServ><chCTe>${documento.chaveAcesso}</chCTe></consSitCTe>`

      // Obter certificado
      const certificado = await certificadoService.obterParaAssinatura(
        documento.emitenteCnpj, user.empresaId
      )

      const ambienteSefaz = ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO

      const sefazConfig: SefazConfig = {
        ambiente: ambienteSefaz,
        uf: documento.emitenteUf || 'RJ',
        timeoutMs: 30000,
        maxRetentativas: 2,
        intervaloRetentativaMs: 3000,
        certificadoPfx: certificado.pfxBuffer,
        certificadoSenha: certificado.senha,
      }

      const urlResolver: SefazUrlResolver = {
        resolverUrl: (_uf: string, svc: ServicoSefaz, _amb: number) => {
          return obterUrlWebserviceCTe(svc, ambienteSefaz)
        },
      }

      const client = criarSefazClient(sefazConfig, urlResolver)
      const resposta = await client.transmitir(xmlConsulta, ServicoSefaz.CTE_CONSULTA)

      return {
        sucesso: true,
        cStat: resposta.codigoStatus,
        xMotivo: resposta.motivoStatus,
        protocolo: resposta.protocolo || null,
        dataRecebimento: resposta.dataRecebimento || null,
      }
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send({
          message: err.message,
          codigo: err.codigo,
          detalhes: err.detalhes,
        })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao consultar SEFAZ' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/cancelar — Cancelar CT-e autorizado
  // ==========================================================================
  app.post('/cte/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        justificativa: z.string().min(15).max(255),
      }).parse(request.body)

      // Validar pertence à empresa
      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const resultado = await cteEmissaoService.cancelar({
        documentoFiscalId: id,
        justificativa: body.justificativa,
      })

      if (!resultado.sucesso) {
        const motivo = resultado.erros?.map(e => `${e.descricao} (cStat: ${e.codigo})`).join('; ') || 'Falha no cancelamento'
        return reply.status(422).send({ ...resultado, message: motivo })
      }

      return reply.status(200).send({ ...resultado, message: 'CT-e cancelado com sucesso' })
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/carta-correcao — Emitir CC-e para CT-e
  // ==========================================================================
  app.post('/cte/:id/carta-correcao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        textoCorrecao: z.string().min(15).max(1000),
        grupoAlterado: z.string().max(50).optional(),
        campoAlterado: z.string().max(50).optional(),
      }).parse(request.body)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
      })
      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const resultado = await cteEmissaoService.cartaCorrecao({
        documentoFiscalId: id,
        textoCorrecao: body.textoCorrecao,
        grupoAlterado: body.grupoAlterado,
        campoAlterado: body.campoAlterado,
      })

      if (!resultado.sucesso) {
        const motivo = resultado.erros?.map(e => `${e.descricao} (cStat: ${e.codigo})`).join('; ') || 'Falha na CC-e'
        return reply.status(422).send({ ...resultado, message: motivo })
      }

      return reply.status(200).send({ ...resultado, message: 'Carta de Correção registrada com sucesso' })
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/inutilizar — Inutilizar faixa de numeração de CT-e
  // ==========================================================================
  app.post('/cte/inutilizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        serie: z.number().int().min(0).max(999),
        numeroInicial: z.number().int().min(1),
        numeroFinal: z.number().int().min(1),
        justificativa: z.string().min(15).max(255),
        ambiente: z.number().int().min(1).max(2).default(2),
      }).parse(request.body)

      if (body.numeroFinal < body.numeroInicial) {
        return reply.status(400).send({
          message: 'Número final deve ser >= número inicial',
        })
      }

      if (body.numeroFinal - body.numeroInicial > 999) {
        return reply.status(400).send({
          message: 'Faixa máxima permitida: 1000 números por vez',
        })
      }

      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
      })
      if (!empresa) {
        return reply.status(404).send({ message: 'Empresa não encontrada' })
      }

      // Registrar inutilização no banco
      for (let num = body.numeroInicial; num <= body.numeroFinal; num++) {
        await prisma.documentoFiscal.create({
          data: {
            empresaId: user.empresaId,
            tipo: 'CTE',
            modelo: 57,
            serie: body.serie,
            numero: num,
            status: 'INUTILIZADO',
            dataEmissao: new Date(),
            tipoOperacao: 1,
            emitenteCnpj: (empresa.cnpj || '').replace(/\D/g, ''),
            emitenteRazao: empresa.razaoSocial || '',
            emitenteUf: empresa.uf || '',
            ambiente: body.ambiente,
          },
        })
      }

      return reply.status(200).send({
        sucesso: true,
        serie: body.serie,
        numeroInicial: body.numeroInicial,
        numeroFinal: body.numeroFinal,
        quantidadeInutilizada: body.numeroFinal - body.numeroInicial + 1,
      })
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cte/:id/dacte — Gerar DACTE em PDF
  // ==========================================================================
  app.get('/cte/:id/dacte', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      // Query params opcionais para override de modelo/orientação
      const query = z.object({
        modelo: z.enum(['1', '2']).optional(),
        orientacao: z.enum(['retrato', 'paisagem']).optional(),
      }).parse(request.query)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        include: { empresa: true },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      if (!['AUTORIZADO', 'CANCELADO'].includes(doc.status)) {
        return reply.status(422).send({
          message: `DACTE só disponível para CT-e AUTORIZADO ou CANCELADO. Status: ${doc.status}`,
        })
      }

      // Buscar preferência da empresa (pode ser overridden via query params).
      // Mesma fonte usada pelo envio por e-mail (resolverPreferenciaDacte),
      // para que o PDF do menu e o do e-mail sejam idênticos.
      const prefDacte = await resolverPreferenciaDacte(user.empresaId)
      const modelo = query.modelo || prefDacte.modelo
      const orientacao = query.orientacao || prefDacte.orientacao

      const pdfBuffer = await gerarDactePdf(doc, doc.empresa, { modelo, orientacao })

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="DACTE-${doc.numero}-${doc.serie}.pdf"`)
      return reply.send(pdfBuffer)
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro ao gerar DACTE' })
    }
  })

  // ==========================================================================
  // GET /cte/:id/xml — Baixar XML autorizado
  // ==========================================================================
  app.get('/cte/:id/xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        select: { xmlAutorizado: true, xmlEnviado: true, numero: true, serie: true, chaveAcesso: true },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      const xml = doc.xmlAutorizado || doc.xmlEnviado
      if (!xml) {
        return reply.status(422).send({ message: 'XML não disponível para este CT-e' })
      }

      const nomeArquivo = doc.chaveAcesso
        ? `${doc.chaveAcesso}-cte.xml`
        : `CTe-${doc.serie}-${doc.numero}.xml`

      reply.header('Content-Type', 'application/xml')
      reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
      return reply.send(xml)
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/duplicar — Duplicar CT-e existente (facilita emissão)
  // ==========================================================================
  app.post('/cte/:id/duplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        select: {
          naturezaOp: true,
          destCpfCnpj: true,
          destRazao: true,
          destUf: true,
          valorTotal: true,
          valorFrete: true,
        },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      // Retorna dados para preenchimento do formulário (frontend usa para pré-popular)
      return {
        naturezaOp: doc.naturezaOp,
        tomador: {
          cpfCnpj: doc.destCpfCnpj,
          razaoSocial: doc.destRazao,
          uf: doc.destUf,
        },
        valorTotal: Number(doc.valorTotal),
        valorFrete: Number(doc.valorFrete),
      }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/:id/enviar-email — Enviar XML e DACTE por e-mail
  // ==========================================================================
  app.post('/cte/:id/enviar-email', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = z.object({
        emails: z.array(z.string().email()).min(1, 'Informe ao menos um e-mail'),
        incluirPdf: z.boolean().default(true),
        incluirXml: z.boolean().default(true),
      }).parse(request.body)

      const doc = await prisma.documentoFiscal.findFirst({
        where: { id, empresaId: user.empresaId, tipo: 'CTE' },
        include: { empresa: true },
      })

      if (!doc) {
        return reply.status(404).send({ message: 'CT-e não encontrado' })
      }

      if (doc.status !== 'AUTORIZADO' && doc.status !== 'CANCELADO') {
        return reply.status(422).send({ message: `Só é possível enviar por e-mail CT-e AUTORIZADO ou CANCELADO. Status atual: ${doc.status}` })
      }

      // Buscar configuração SMTP do banco (config por empresa)
      const nodemailer = require('nodemailer')
      const configSmtp = await prisma.configSmtp.findUnique({ where: { empresaId: user.empresaId } })

      // Fallback para variáveis de ambiente (compatibilidade)
      const smtpHost = configSmtp?.host || process.env.SMTP_HOST
      const smtpUser = configSmtp?.usuario || process.env.SMTP_USER
      const smtpPass = configSmtp?.senha || process.env.SMTP_PASS
      const smtpPort = configSmtp?.porta || Number(process.env.SMTP_PORT) || 587

      if (!smtpHost || !smtpUser || !smtpPass) {
        return reply.status(422).send({ message: 'Configuração SMTP não encontrada. Acesse Configurações → Email/SMTP para configurar o servidor de e-mail.' })
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        tls: (configSmtp?.usarTls ?? true) ? { rejectUnauthorized: false } : undefined,
      })

      const attachments: any[] = []

      if (body.incluirXml && doc.xmlAutorizado) {
        const nomeXml = doc.chaveAcesso ? `${doc.chaveAcesso}-cte.xml` : `CTe-${doc.serie}-${doc.numero}.xml`
        attachments.push({ filename: nomeXml, content: doc.xmlAutorizado, contentType: 'application/xml' })
      }

      if (body.incluirPdf) {
        try {
          const prefDacte = await resolverPreferenciaDacte(user.empresaId)
          const pdfBuffer = await gerarDactePdf(doc, doc.empresa, prefDacte)
          attachments.push({ filename: `DACTE-${doc.numero}-${doc.serie}.pdf`, content: pdfBuffer, contentType: 'application/pdf' })
        } catch (pdfErr: any) {
          console.warn(`[cte-email] Falha ao gerar PDF DACTE: ${pdfErr.message}`)
        }
      }

      if (attachments.length === 0) {
        return reply.status(422).send({ message: 'Nenhum anexo disponível para envio (XML ou PDF)' })
      }

      const from = configSmtp?.emailFrom || process.env.SMTP_FROM || smtpUser
      const empresa = doc.empresa
      const assunto = `CT-e nº ${doc.numero} - ${empresa?.razaoSocial || 'Emitente'}`
      const valorFormatado = Number(doc.valorTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">CT-e nº ${doc.numero}</h2>
          <p style="margin: 0 0 12px;"><strong>${empresa?.razaoSocial || 'Emitente'}</strong>${empresa?.cnpj ? ` — CNPJ: ${empresa.cnpj}` : ''}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
            <tr><td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">Chave de Acesso</td><td style="padding: 6px; border: 1px solid #ddd;">${doc.chaveAcesso || 'N/A'}</td></tr>
            <tr><td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">Série</td><td style="padding: 6px; border: 1px solid #ddd;">${doc.serie}</td></tr>
            <tr><td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">Valor da Prestação</td><td style="padding: 6px; border: 1px solid #ddd;">${valorFormatado}</td></tr>
            <tr><td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">Status</td><td style="padding: 6px; border: 1px solid #ddd;">${doc.status}</td></tr>
            <tr><td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">Protocolo</td><td style="padding: 6px; border: 1px solid #ddd;">${doc.protocolo || 'N/A'}</td></tr>
          </table>
          <p style="font-size: 12px; color: #666;">E-mail enviado automaticamente por ${empresa?.razaoSocial || 'Vizor ERP'}.</p>
        </div>
      `.trim()

      await transporter.sendMail({
        from,
        to: body.emails.join(', '),
        subject: assunto,
        html,
        attachments,
      })

      return { sucesso: true, message: `E-mail enviado com sucesso para ${body.emails.join(', ')}` }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao enviar e-mail' })
    }
  })

  // ==========================================================================
  // POST /cte/transmitir-lote — Transmitir vários CT-e em sequência
  // ==========================================================================
  app.post('/cte/transmitir-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        ids: z.array(z.string().uuid()).min(1).max(50),
      }).parse(request.body)

      const resultados: Array<{ id: string; numero?: number; sucesso: boolean; status?: string; message?: string }> = []

      for (const docId of body.ids) {
        try {
          const doc = await prisma.documentoFiscal.findFirst({
            where: { id: docId, empresaId: user.empresaId, tipo: 'CTE' },
          })
          if (!doc) {
            resultados.push({ id: docId, sucesso: false, message: 'CT-e não encontrado' })
            continue
          }
          if (!['DIGITADA', 'REJEITADO', 'PENDENTE'].includes(doc.status)) {
            resultados.push({ id: docId, numero: doc.numero, sucesso: false, message: `Status ${doc.status} não permite transmissão` })
            continue
          }

          let payload: any
          try { payload = JSON.parse(doc.xmlEnviado || '{}') } catch { payload = {} }

          const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
          if (!empresa) {
            resultados.push({ id: docId, numero: doc.numero, sucesso: false, message: 'Empresa não encontrada' })
            continue
          }

          const ufEmitente = empresa.uf || ''
          const dadosCTe: DadosCTe = {
            cUF: obterCodigoUF(ufEmitente),
            cCT: gerarCodigoNumerico(),
            nCT: doc.numero,
            serie: doc.serie,
            modelo: 57,
            tpEmis: payload.tpEmis || 1,
            ambiente: empresa.ambienteCTe || empresa.ambienteNFe || 2,
            cfop: payload.cfop || '5353',
            naturezaOp: payload.naturezaOp || '',
            tpServ: payload.tpServ || 0,
            dataEmissao: new Date(),
            tpCTe: payload.tpCTe || 0,
            modal: payload.modal || '01',
            cMunIni: payload.cMunIni || '',
            xMunIni: payload.xMunIni || '',
            ufIni: payload.ufIni || '',
            cMunFim: payload.cMunFim || '',
            xMunFim: payload.xMunFim || '',
            ufFim: payload.ufFim || '',
            tpTom: payload.tpTom || 0,
            indIEToma: payload.indIEToma || 9,
            emitente: {
              cnpj: (empresa.cnpj || '').replace(/\D/g, ''),
              ie: (empresa.inscEstadual || '').replace(/\D/g, ''),
              razaoSocial: empresa.razaoSocial || '',
              nomeFantasia: empresa.nomeFantasia || undefined,
              endereco: {
                logradouro: empresa.logradouro || '',
                numero: empresa.numero || '',
                complemento: empresa.complemento || undefined,
                bairro: empresa.bairro || '',
                codigoMunicipio: empresa.codigoMunicipio || empresa.cidade || '',
                municipio: empresa.cidade || '',
                uf: ufEmitente,
                cep: empresa.cep || '',
              },
            },
            remetente: payload.remetente as any,
            destinatario: payload.destinatario as any,
            expedidor: payload.expedidor as any,
            recebedor: payload.recebedor as any,
            vPrest: payload.vPrest as any,
            impostos: payload.impostos as any,
            infCTeNorm: {
              infCarga: payload.infCTeNorm?.infCarga,
              infDoc: {
                infNFe: payload.infCTeNorm?.infDoc?.infNFe,
                infOutros: payload.infCTeNorm?.infDoc?.infOutros,
              },
              infModal: payload.infCTeNorm?.infModal,
              veicNovos: payload.infCTeNorm?.veicNovos,
            },
            complemento: payload.complemento,
            infAdFisco: payload.infAdFisco,
            infCpl: payload.infCpl,
            tomadorOutros: payload.tomadorOutros,
          }

          const resultado = await cteEmissaoService.transmitirExistente({
            empresaId: user.empresaId,
            documentoFiscalId: docId,
            dadosCTe,
            forcarContingencia: payload.forcarContingencia || false,
          })

          await prisma.documentoFiscal.update({
            where: { id: docId },
            data: {
              status: resultado.status,
              chaveAcesso: resultado.chaveAcesso || undefined,
              protocolo: resultado.protocolo || undefined,
              xmlAutorizado: resultado.xmlAutorizado || resultado.xmlAssinado || undefined,
              codigoRejeicao: resultado.codigoRejeicao || undefined,
              motivoRejeicao: resultado.motivoRejeicao || undefined,
              dataAutorizacao: resultado.sucesso ? new Date() : undefined,
            },
          })

          resultados.push({
            id: docId,
            numero: doc.numero,
            sucesso: resultado.sucesso,
            status: resultado.status,
            message: resultado.sucesso ? 'Autorizado' : resultado.motivoRejeicao,
          })
        } catch (err: any) {
          resultados.push({ id: docId, sucesso: false, message: err.message || 'Erro inesperado' })
        }
      }

      const autorizados = resultados.filter(r => r.sucesso).length
      const rejeitados = resultados.filter(r => !r.sucesso).length

      return {
        resumo: { total: body.ids.length, autorizados, rejeitados },
        resultados,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/enviar-email-lote — Enviar e-mail para múltiplos CT-e
  // ==========================================================================
  app.post('/cte/enviar-email-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        emails: z.array(z.string().email()).min(1),
        incluirPdf: z.boolean().default(true),
        incluirXml: z.boolean().default(true),
      }).parse(request.body)

      const nodemailer = require('nodemailer')
      const configSmtp = await prisma.configSmtp.findUnique({ where: { empresaId: user.empresaId } })
      const smtpHost = configSmtp?.host || process.env.SMTP_HOST
      const smtpUser = configSmtp?.usuario || process.env.SMTP_USER
      const smtpPass = configSmtp?.senha || process.env.SMTP_PASS
      if (!smtpHost || !smtpUser || !smtpPass) {
        return reply.status(422).send({ message: 'Configuração SMTP não encontrada. Acesse Configurações → Email/SMTP.' })
      }

      const smtpPort = configSmtp?.porta || Number(process.env.SMTP_PORT) || 587
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        tls: (configSmtp?.usarTls ?? true) ? { rejectUnauthorized: false } : undefined,
      })

      const resultados: Array<{ id: string; numero?: number; sucesso: boolean; message?: string }> = []
      const prefDacteLote = await resolverPreferenciaDacte(user.empresaId)

      for (const docId of body.ids) {
        try {
          const doc = await prisma.documentoFiscal.findFirst({
            where: { id: docId, empresaId: user.empresaId, tipo: 'CTE', status: { in: ['AUTORIZADO', 'CANCELADO'] } },
            include: { empresa: true },
          })
          if (!doc) {
            resultados.push({ id: docId, sucesso: false, message: 'CT-e não encontrado ou status inválido' })
            continue
          }

          const attachments: any[] = []
          if (body.incluirXml && doc.xmlAutorizado) {
            const nomeXml = doc.chaveAcesso ? `${doc.chaveAcesso}-cte.xml` : `CTe-${doc.serie}-${doc.numero}.xml`
            attachments.push({ filename: nomeXml, content: doc.xmlAutorizado, contentType: 'application/xml' })
          }
          if (body.incluirPdf) {
            try {
              const pdfBuf = await gerarDactePdf(doc, doc.empresa, prefDacteLote)
              attachments.push({ filename: `DACTE-${doc.numero}-${doc.serie}.pdf`, content: pdfBuf, contentType: 'application/pdf' })
            } catch { /* skip */ }
          }

          if (attachments.length === 0) {
            resultados.push({ id: docId, numero: doc.numero, sucesso: false, message: 'Nenhum anexo disponível' })
            continue
          }

          const from = configSmtp?.emailFrom || process.env.SMTP_FROM || smtpUser
          await transporter.sendMail({
            from,
            to: body.emails.join(', '),
            subject: `CT-e nº ${doc.numero} - ${doc.empresa?.razaoSocial || 'Emitente'}`,
            html: `<p>CT-e nº ${doc.numero} | Chave: ${doc.chaveAcesso || 'N/A'} | Valor: R$ ${Number(doc.valorTotal).toFixed(2)}</p>`,
            attachments,
          })

          resultados.push({ id: docId, numero: doc.numero, sucesso: true, message: 'Enviado' })
        } catch (err: any) {
          resultados.push({ id: docId, sucesso: false, message: err.message })
        }
      }

      return { resumo: { total: body.ids.length, enviados: resultados.filter(r => r.sucesso).length, falhas: resultados.filter(r => !r.sucesso).length }, resultados }
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cte/cancelar-lote — Cancelar vários CT-e autorizados
  // ==========================================================================
  app.post('/cte/cancelar-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = z.object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        justificativa: z.string().min(15).max(255),
      }).parse(request.body)

      const resultados: Array<{ id: string; numero?: number; sucesso: boolean; message?: string }> = []

      for (const docId of body.ids) {
        try {
          const doc = await prisma.documentoFiscal.findFirst({
            where: { id: docId, empresaId: user.empresaId, tipo: 'CTE' },
            select: { id: true, numero: true, status: true },
          })
          if (!doc) {
            resultados.push({ id: docId, sucesso: false, message: 'CT-e não encontrado' })
            continue
          }
          if (doc.status !== 'AUTORIZADO') {
            resultados.push({ id: docId, numero: doc.numero, sucesso: false, message: `Status ${doc.status} não permite cancelamento` })
            continue
          }

          const resultado = await cteEmissaoService.cancelar({
            documentoFiscalId: docId,
            justificativa: body.justificativa,
          })

          resultados.push({
            id: docId,
            numero: doc.numero,
            sucesso: resultado.sucesso,
            message: resultado.sucesso ? 'Cancelado' : resultado.erros?.map(e => e.descricao).join('; '),
          })
        } catch (err: any) {
          resultados.push({ id: docId, sucesso: false, message: err.message })
        }
      }

      return { resumo: { total: body.ids.length, cancelados: resultados.filter(r => r.sucesso).length, falhas: resultados.filter(r => !r.sucesso).length }, resultados }
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

} // fim cteRoutes
