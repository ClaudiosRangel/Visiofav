import PDFDocument from 'pdfkit'
import {
  CONFIG_DEFAULT_EMBUTIDA,
  type TemplatePropostaConfig,
} from './template-proposta.service'

interface DadosCliente {
  nome: string
  cnpj?: string | null
  contato?: string | null
  email?: string | null
}

interface DadosEmpresa {
  razaoSocial: string
  cnpj?: string | null
  telefone?: string | null
  email?: string | null
  logoUrl?: string | null
}

interface Variacao {
  quantidade: number
  precoUnitario: number
  precoTotal: number
}

interface DadosOrcamento {
  numero: number
  versao: number
  tipoEmbalagem: string
  papelDescricao?: string | null
  gramatura?: number | null
  numCores: number
  cores?: Array<{ nome: string; tipo: string }> | null
  acabamentos?: Array<{ tipo: string }> | null
  quantidade: number
  custoMaterial?: number | null
  custoMaquina?: number | null
  custoAcabamento?: number | null
  custoTotal?: number | null
  precoVenda?: number | null
  precoUnitario?: number | null
  margemReal?: number | null
  variacoes?: Variacao[] | null
  validadeAte?: Date | null
  observacoes?: string | null
  criadoEm: Date
  // Campos extras para o estilo WEGA (proposta ao cliente Carton Wega).
  numeroCalcgraf?: number | null
  descricao?: string | null
  formatoFinal?: string | null
  especificacoes?: string | null
  condicaoPagamento?: string | null
  vendedorNome?: string | null
  imposto?: string | null
  programacaoEntrega?: string | null
  // Itens para a tabela multi-item do estilo WEGA (descrição rica por item).
  itens?: Array<{ descricao: string; quantidade: number; precoUnitario: number; precoTotal: number }> | null
}

interface ParamsPropostaPdf {
  orcamento: DadosOrcamento
  cliente: DadosCliente
  empresa: DadosEmpresa
  termos?: string
  /**
   * Config do template (layout/textos/blocos). Sem ela, usa a config embutida
   * que reproduz o layout fixo atual (não-regressão). Spec B1.
   */
  config?: TemplatePropostaConfig
}

/**
 * Gera PDF de proposta comercial para orçamento gráfico.
 * Retorna um Buffer com o PDF gerado.
 */
export function gerarPropostaPdf(params: ParamsPropostaPdf): Promise<Buffer> {
  const { orcamento, cliente, empresa, termos } = params
  // Config do template (B1). Sem template → layout fixo atual (não-regressão).
  const config: TemplatePropostaConfig = params.config ?? CONFIG_DEFAULT_EMBUTIDA
  const cab = config.cabecalho
  const blocos = config.blocos

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = doc.page.width - 100 // margins

      // Estilo WEGA: layout da proposta ao cliente Carton Wega (doc dedicado).
      if (config.estilo === 'WEGA') {
        renderWega(doc, { orcamento, cliente, empresa, config, pageWidth })
        doc.end()
        return
      }

      // ── Header com dados da empresa (conforme config.cabecalho) ──
      if (cab.mostrarRazaoSocial) {
        doc.fontSize(18).font('Helvetica-Bold').text(empresa.razaoSocial, { align: 'center' })
      }
      if (cab.mostrarCnpj && empresa.cnpj) {
        doc.fontSize(9).font('Helvetica').text(`CNPJ: ${empresa.cnpj}`, { align: 'center' })
      }
      const contatoHeader = [
        cab.mostrarTelefone ? empresa.telefone : null,
        cab.mostrarEmail ? empresa.email : null,
      ].filter(Boolean).join(' | ')
      if (contatoHeader) {
        doc.fontSize(9).font('Helvetica').text(contatoHeader, { align: 'center' })
      }
      doc.moveDown(1)

      // ── Texto de introdução (opcional, do template) ──
      if (config.textos.introducao) {
        doc.fontSize(10).font('Helvetica').text(config.textos.introducao, { width: pageWidth })
        doc.moveDown(1)
      }

      // ── Título ──
      doc.fontSize(14).font('Helvetica-Bold')
        .text(`PROPOSTA COMERCIAL Nº ${orcamento.numero} v${orcamento.versao}`, { align: 'center' })
      doc.moveDown(0.5)

      // ── Linha separadora ──
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke()
      doc.moveDown(0.5)

      // ── Data e Validade (validade conforme bloco) ──
      const dataEmissao = formatarData(orcamento.criadoEm)
      doc.fontSize(10).font('Helvetica').text(`Data de emissão: ${dataEmissao}`)
      if (blocos.validade) {
        const dataValidade = orcamento.validadeAte ? formatarData(orcamento.validadeAte) : 'Não definida'
        doc.text(`Validade da proposta: ${dataValidade}`)
      }
      doc.moveDown(1)

      // ── Dados do Cliente ──
      doc.fontSize(12).font('Helvetica-Bold').text('CLIENTE')
      doc.fontSize(10).font('Helvetica')
        .text(`Nome: ${cliente.nome}`)
      if (cliente.cnpj) {
        doc.text(`CNPJ: ${cliente.cnpj}`)
      }
      doc.moveDown(1)

      // ── Detalhes do Produto (bloco engenharia) ──
      if (blocos.engenharia) {
        doc.fontSize(12).font('Helvetica-Bold').text('DETALHES DO PRODUTO')
        doc.fontSize(10).font('Helvetica')
          .text(`Tipo: ${orcamento.tipoEmbalagem}`)
        if (orcamento.papelDescricao) {
          doc.text(`Papel/Cartão: ${orcamento.papelDescricao}`)
        }
        if (orcamento.gramatura) {
          doc.text(`Gramatura: ${orcamento.gramatura} g/m²`)
        }
        doc.text(`Cores: ${orcamento.numCores}`)
        if (orcamento.cores && orcamento.cores.length > 0) {
          const coresStr = orcamento.cores.map(c => `${c.nome} (${c.tipo})`).join(', ')
          doc.text(`Detalhe: ${coresStr}`)
        }
        if (orcamento.acabamentos && orcamento.acabamentos.length > 0) {
          const acabStr = orcamento.acabamentos.map(a => a.tipo).join(', ')
          doc.text(`Acabamentos: ${acabStr}`)
        }
        doc.moveDown(1)
      }

      // ── Tabela de Preços por Tiragem ──
      doc.fontSize(12).font('Helvetica-Bold').text('TABELA DE PREÇOS')
      doc.moveDown(0.3)

      // Linha oficial (quantidade do orçamento). Quando o bloco variacoesTiragem
      // está ligado, mostra a grade completa de faixas; senão, só a oficial.
      const linhaOficial: Variacao = { quantidade: orcamento.quantidade, precoUnitario: orcamento.precoUnitario ?? 0, precoTotal: orcamento.precoVenda ?? 0 }
      const variacoes: Variacao[] = blocos.variacoesTiragem && orcamento.variacoes && orcamento.variacoes.length > 0
        ? orcamento.variacoes
        : [linhaOficial]

      // Header da tabela
      const tableTop = doc.y
      const col1 = 50
      const col2 = 200
      const col3 = 370

      doc.fontSize(9).font('Helvetica-Bold')
      doc.text('QUANTIDADE', col1, tableTop, { width: 140 })
      doc.text('PREÇO UNITÁRIO', col2, tableTop, { width: 160 })
      doc.text('PREÇO TOTAL', col3, tableTop, { width: 140 })

      doc.moveTo(50, tableTop + 14).lineTo(doc.page.width - 50, tableTop + 14).stroke()

      let yPos = tableTop + 20
      doc.font('Helvetica').fontSize(9)
      for (const v of variacoes) {
        doc.text(formatarNumero(v.quantidade), col1, yPos, { width: 140 })
        doc.text(formatarMoeda(v.precoUnitario), col2, yPos, { width: 160 })
        doc.text(formatarMoeda(v.precoTotal), col3, yPos, { width: 140 })
        yPos += 16
      }

      doc.moveTo(50, yPos).lineTo(doc.page.width - 50, yPos).stroke()
      doc.y = yPos + 10
      doc.moveDown(1)

      // ── Resumo de Custos (decomposição MD/CT/acabamento só se o bloco liga) ──
      if (orcamento.custoTotal) {
        doc.fontSize(12).font('Helvetica-Bold').text('RESUMO')
        doc.fontSize(10).font('Helvetica')
        if (blocos.decomposicaoCustos) {
          if (orcamento.custoMaterial) doc.text(`Material: ${formatarMoeda(Number(orcamento.custoMaterial))}`)
          if (orcamento.custoMaquina) doc.text(`Máquina: ${formatarMoeda(Number(orcamento.custoMaquina))}`)
          if (orcamento.custoAcabamento) doc.text(`Acabamento: ${formatarMoeda(Number(orcamento.custoAcabamento))}`)
        }
        doc.font('Helvetica-Bold').text(`Valor Total: ${formatarMoeda(Number(orcamento.precoVenda ?? orcamento.custoTotal))}`)
        doc.moveDown(1)
      }

      // ── Termos e Condições (texto do template tem prioridade; senão o padrão) ──
      const termosTexto = config.textos.condicoes || termos || 'Preços válidos para o período indicado. Frete não incluso, salvo negociação específica. Condição de pagamento: 28 dias após faturamento. Prazo de entrega a combinar conforme programação.'
      doc.fontSize(12).font('Helvetica-Bold').text('TERMOS E CONDIÇÕES')
      doc.fontSize(9).font('Helvetica').text(termosTexto, { width: pageWidth })
      doc.moveDown(1)

      // ── Observações (bloco) ──
      if (blocos.observacoes && orcamento.observacoes) {
        doc.fontSize(12).font('Helvetica-Bold').text('OBSERVAÇÕES')
        doc.fontSize(9).font('Helvetica').text(orcamento.observacoes, { width: pageWidth })
        doc.moveDown(1)
      }

      // ── Footer (rodapé do template tem prioridade sobre o padrão) ──
      const footerY = doc.page.height - 80
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
      if (config.textos.rodape) {
        doc.text(config.textos.rodape, 50, footerY, { align: 'center', width: pageWidth })
      } else {
        doc.text(empresa.razaoSocial, 50, footerY, { align: 'center', width: pageWidth })
        const footerContato = [empresa.telefone, empresa.email].filter(Boolean).join(' | ')
        if (footerContato) {
          doc.text(footerContato, 50, footerY + 12, { align: 'center', width: pageWidth })
        }
      }
      doc.text(`Proposta gerada em ${formatarData(new Date())}`, 50, footerY + 24, { align: 'center', width: pageWidth })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

// ── Renderizador do estilo WEGA (proposta ao cliente Carton Wega) ──
// Layout em docs/modelo-proposta-cliente-carton-wega.md. Mostra só o preço
// final por tiragem/item (sem decomposição de custo). Suporta 1 item (bloco de
// dados do produto + tabela Qtd/Unit/Total) e multi-item (tabela
// Qtd/Descrição/Unit/Total com quebra de página).

interface RenderWegaCtx {
  orcamento: DadosOrcamento
  cliente: DadosCliente
  empresa: DadosEmpresa
  config: TemplatePropostaConfig
  pageWidth: number
}

const IMPORTANTE_PADRAO = [
  'A gráfica não se responsabiliza por impressões realizadas sem provas de cor.',
  'Este Orçamento está apoiado na informação fornecida pelo cliente. Qualquer reajuste nos preços estará apoiado nas diferenças que se encontrem na recepção dos arquivos originais do cliente.',
  'Reservamos o direito de entregar 10% a mais ou a menos da quantidade solicitada, de acordo com as normas A.B.T.G - ASSOCIAÇÃO BRASILEIRA DE TECNOLOGIA GRÁFICA.',
  'Os processos de fabricação só terão início após confirmação do pedido e aprovação de arte.',
]

function dataPorExtenso(data: Date): string {
  const d = new Date(data)
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`
}

function renderWega(doc: PDFKit.PDFDocument, ctx: RenderWegaCtx): void {
  const { orcamento, cliente, empresa, config, pageWidth } = ctx
  const left = 50
  const right = doc.page.width - 50

  // 1. Cabeçalho da empresa (razão social centralizada — o logo real exige
  //    binário; usamos o nome em destaque como o layout aprovado).
  doc.fontSize(16).font('Helvetica-Bold').text(empresa.razaoSocial, { align: 'center' })
  doc.moveDown(1)

  // 2. Linha: cidade/data à esquerda; Proposta/Cálculo nº à direita.
  const linhaY = doc.y
  const cidade = config.textos.cidadeData ? `${config.textos.cidadeData}, ` : ''
  doc.fontSize(10).font('Helvetica')
    .text(`${cidade}${dataPorExtenso(orcamento.criadoEm)}`, left, linhaY, { width: 320 })
  doc.font('Helvetica-Bold')
    .text(`Proposta nº   ${orcamento.numero}`, 360, linhaY, { width: right - 360, align: 'right' })
  if (orcamento.numeroCalcgraf) {
    doc.text(`Cálculo nº   ${orcamento.numeroCalcgraf}`, 360, linhaY + 14, { width: right - 360, align: 'right' })
  }
  doc.y = linhaY + 32
  doc.moveDown(0.5)

  // 3. Destinatário.
  doc.fontSize(10).font('Helvetica').text('À', left)
  doc.font('Helvetica-Bold').text((cliente.nome || '').toUpperCase(), left)
  doc.font('Helvetica')
  if (cliente.contato) doc.text(`At. Sr(a): ${cliente.contato}`, left)
  if (cliente.email) doc.text(`E-mail: ${cliente.email}`, left)
  doc.moveDown(0.5)

  // 4. Saudação (editável via textos.introducao).
  const saudacao = config.textos.introducao
    || 'Prezado(s) senhor(es),\nConforme solicitado, encaminhamos abaixo nossa proposta:'
  doc.fontSize(10).font('Helvetica').text(saudacao, left, doc.y, { width: pageWidth })
  doc.moveDown(0.8)

  const itens = orcamento.itens && orcamento.itens.length > 0 ? orcamento.itens : null
  const multiItem = !!itens && itens.length > 1

  if (!multiItem) {
    // 5. Bloco de dados do produto (1 item).
    const campo = (rot: string, val?: string | null) => {
      if (!val) return
      const y = doc.y
      doc.font('Helvetica-Bold').text(rot, left, y, { width: 110, continued: false })
      doc.font('Helvetica').text(val, left + 110, y, { width: pageWidth - 110 })
    }
    campo('Produto:', orcamento.tipoEmbalagem)
    campo('Descrição:', orcamento.descricao)
    campo('Formato Final:', orcamento.formatoFinal)
    campo('Especificações:', orcamento.especificacoes)
    if (orcamento.acabamentos && orcamento.acabamentos.length > 0) {
      campo('Acabamentos:', orcamento.acabamentos.map((a) => a.tipo).join(', '))
    }
    doc.moveDown(1)

    // 6. Tabela Quantidade | Unitário | Total (faixas de tiragem/variações).
    const linhas = orcamento.variacoes && orcamento.variacoes.length > 0
      ? orcamento.variacoes
      : [{ quantidade: orcamento.quantidade, precoUnitario: orcamento.precoUnitario ?? 0, precoTotal: orcamento.precoVenda ?? 0 }]
    const c1 = left, c2 = 230, c3 = 400
    const topo = doc.y
    doc.fontSize(10).font('Helvetica-Bold')
    doc.text('Quantidade', c1, topo, { width: 150 })
    doc.text('Unitário', c2, topo, { width: 150 })
    doc.text('Total (R$)', c3, topo, { width: 150 })
    let y = topo + 18
    doc.font('Helvetica')
    for (const v of linhas) {
      doc.text(formatarNumero(v.quantidade), c1, y, { width: 150 })
      doc.text(formatarMoeda(v.precoUnitario), c2, y, { width: 150 })
      doc.text(formatarMoeda(v.precoTotal), c3, y, { width: 150 })
      y += 16
    }
    doc.y = y + 6
  } else {
    // 6'. Tabela multi-item: Quantidade | Descrição | Unitário | Valor Total.
    const c1 = left, c2 = 120, c3 = 400, c4 = 470
    const desenharCabecalho = () => {
      const topo = doc.y
      doc.fontSize(9).font('Helvetica-Bold')
      doc.text('Quantidade', c1, topo, { width: 65 })
      doc.text('Descrição', c2, topo, { width: 275 })
      doc.text('Unitário', c3, topo, { width: 65 })
      doc.text('Valor Total', c4, topo, { width: right - c4 })
      doc.moveTo(left, topo + 14).lineTo(right, topo + 14).stroke()
      doc.y = topo + 20
    }
    desenharCabecalho()
    doc.fontSize(9).font('Helvetica')
    for (const it of itens as NonNullable<typeof itens>) {
      // Quebra de página quando falta espaço (deixa margem para o bloco final).
      if (doc.y > doc.page.height - 160) {
        doc.fontSize(8).font('Helvetica-Oblique').text('continua...', left, doc.page.height - 120, { width: pageWidth, align: 'right' })
        doc.addPage()
        doc.fontSize(8).font('Helvetica-Oblique').text('...continuação', left)
        doc.moveDown(0.5)
        desenharCabecalho()
        doc.fontSize(9).font('Helvetica')
      }
      const y = doc.y
      doc.text(formatarNumero(it.quantidade), c1, y, { width: 65 })
      doc.text(it.descricao, c2, y, { width: 275 })
      doc.text(formatarMoeda(it.precoUnitario), c3, y, { width: 65 })
      doc.text(formatarMoeda(it.precoTotal), c4, y, { width: right - c4 })
      // avança conforme a altura da descrição (pode quebrar em várias linhas)
      const alturaDesc = doc.heightOfString(it.descricao, { width: 275 })
      doc.y = y + Math.max(16, alturaDesc + 4)
    }
    doc.moveDown(0.5)
  }

  // 7. Rodapé de condições (Cond.Pagto / Validade / Vendedor / Imposto / Prog.).
  doc.moveDown(0.5)
  const condY = doc.y
  doc.fontSize(10)
  const linhaCond = (rotE: string, valE: string, rotD?: string, valD?: string, y?: number) => {
    const yy = y ?? doc.y
    doc.font('Helvetica-Bold').text(rotE, left, yy, { width: 90, continued: false })
    doc.font('Helvetica').text(valE, left + 90, yy, { width: 150 })
    if (rotD) {
      doc.font('Helvetica-Bold').text(rotD, 320, yy, { width: 70 })
      doc.font('Helvetica').text(valD ?? '', 390, yy, { width: right - 390 })
    }
  }
  const validade = orcamento.validadeAte ? `${Math.max(0, Math.round((new Date(orcamento.validadeAte).getTime() - Date.now()) / 86400000))} dias` : '10 dias'
  linhaCond('Cond. Pagto:', orcamento.condicaoPagamento || 'a combinar', 'Validade:', validade, condY)
  doc.y = condY + 16
  linhaCond('Vendedor:', orcamento.vendedorNome || '—', 'Imposto:', orcamento.imposto || 'ICMS + IPI', doc.y)
  doc.y += 16
  doc.font('Helvetica-Bold').text('Programação Entrega:', left, doc.y, { width: 140, continued: true })
    .font('Helvetica').text(`  ${orcamento.programacaoEntrega || 'a combinar'}`)
  doc.moveDown(1.5)

  // 8. Bloco IMPORTANTE (editável via textos.condicoes).
  doc.fontSize(9).font('Helvetica-Bold').text('IMPORTANTE:', left)
  doc.font('Helvetica')
  if (config.textos.condicoes) {
    doc.text(config.textos.condicoes, left, doc.y, { width: pageWidth })
  } else {
    for (const linha of IMPORTANTE_PADRAO) {
      doc.text(`- ${linha}`, left, doc.y, { width: pageWidth })
    }
  }
  doc.moveDown(1)

  // 9-11. Autorização + assinatura + atenciosamente.
  doc.fontSize(9).text('Autorizo a confecção do(s) item(ns) acima assinalado(s).', left, doc.y, { width: pageWidth })
  doc.moveDown(2)
  doc.moveTo(left, doc.y).lineTo(left + 300, doc.y).stroke()
  doc.moveDown(0.3)
  doc.text('Assinatura do Cliente', left)
  doc.moveDown(1)
  doc.text('Atenciosamente,', left)
  doc.text(config.textos.rodape || `${empresa.razaoSocial} Indústria de Embalagens`, left)
}

// ── Utilitários ──

function formatarData(data: Date): string {
  const d = new Date(data)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR')
}
