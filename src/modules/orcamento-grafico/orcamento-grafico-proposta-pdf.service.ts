import PDFDocument from 'pdfkit'

interface DadosCliente {
  nome: string
  cnpj?: string | null
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
}

interface ParamsPropostaPdf {
  orcamento: DadosOrcamento
  cliente: DadosCliente
  empresa: DadosEmpresa
  termos?: string
}

/**
 * Gera PDF de proposta comercial para orçamento gráfico.
 * Retorna um Buffer com o PDF gerado.
 */
export function gerarPropostaPdf(params: ParamsPropostaPdf): Promise<Buffer> {
  const { orcamento, cliente, empresa, termos } = params

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = doc.page.width - 100 // margins

      // ── Header com dados da empresa ──
      doc.fontSize(18).font('Helvetica-Bold').text(empresa.razaoSocial, { align: 'center' })
      if (empresa.cnpj) {
        doc.fontSize(9).font('Helvetica').text(`CNPJ: ${empresa.cnpj}`, { align: 'center' })
      }
      if (empresa.telefone || empresa.email) {
        const contato = [empresa.telefone, empresa.email].filter(Boolean).join(' | ')
        doc.fontSize(9).text(contato, { align: 'center' })
      }
      doc.moveDown(1)

      // ── Título ──
      doc.fontSize(14).font('Helvetica-Bold')
        .text(`PROPOSTA COMERCIAL Nº ${orcamento.numero} v${orcamento.versao}`, { align: 'center' })
      doc.moveDown(0.5)

      // ── Linha separadora ──
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke()
      doc.moveDown(0.5)

      // ── Data e Validade ──
      const dataEmissao = formatarData(orcamento.criadoEm)
      const dataValidade = orcamento.validadeAte ? formatarData(orcamento.validadeAte) : 'Não definida'
      doc.fontSize(10).font('Helvetica')
        .text(`Data de emissão: ${dataEmissao}`)
        .text(`Validade da proposta: ${dataValidade}`)
      doc.moveDown(1)

      // ── Dados do Cliente ──
      doc.fontSize(12).font('Helvetica-Bold').text('CLIENTE')
      doc.fontSize(10).font('Helvetica')
        .text(`Nome: ${cliente.nome}`)
      if (cliente.cnpj) {
        doc.text(`CNPJ: ${cliente.cnpj}`)
      }
      doc.moveDown(1)

      // ── Detalhes do Produto ──
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

      // ── Tabela de Preços por Tiragem ──
      doc.fontSize(12).font('Helvetica-Bold').text('TABELA DE PREÇOS')
      doc.moveDown(0.3)

      const variacoes: Variacao[] = orcamento.variacoes && orcamento.variacoes.length > 0
        ? orcamento.variacoes
        : [{ quantidade: orcamento.quantidade, precoUnitario: orcamento.precoUnitario ?? 0, precoTotal: orcamento.precoVenda ?? 0 }]

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

      // ── Resumo de Custos ──
      if (orcamento.custoTotal) {
        doc.fontSize(12).font('Helvetica-Bold').text('RESUMO')
        doc.fontSize(10).font('Helvetica')
        if (orcamento.custoMaterial) doc.text(`Material: ${formatarMoeda(Number(orcamento.custoMaterial))}`)
        if (orcamento.custoMaquina) doc.text(`Máquina: ${formatarMoeda(Number(orcamento.custoMaquina))}`)
        if (orcamento.custoAcabamento) doc.text(`Acabamento: ${formatarMoeda(Number(orcamento.custoAcabamento))}`)
        doc.font('Helvetica-Bold').text(`Valor Total: ${formatarMoeda(Number(orcamento.precoVenda ?? orcamento.custoTotal))}`)
        doc.moveDown(1)
      }

      // ── Termos e Condições ──
      const termosTexto = termos || 'Preços válidos para o período indicado. Frete não incluso, salvo negociação específica. Condição de pagamento: 28 dias após faturamento. Prazo de entrega a combinar conforme programação.'
      doc.fontSize(12).font('Helvetica-Bold').text('TERMOS E CONDIÇÕES')
      doc.fontSize(9).font('Helvetica').text(termosTexto, { width: pageWidth })
      doc.moveDown(1)

      // ── Observações ──
      if (orcamento.observacoes) {
        doc.fontSize(12).font('Helvetica-Bold').text('OBSERVAÇÕES')
        doc.fontSize(9).font('Helvetica').text(orcamento.observacoes, { width: pageWidth })
        doc.moveDown(1)
      }

      // ── Footer ──
      const footerY = doc.page.height - 80
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
      doc.text(empresa.razaoSocial, 50, footerY, { align: 'center', width: pageWidth })
      const footerContato = [empresa.telefone, empresa.email].filter(Boolean).join(' | ')
      if (footerContato) {
        doc.text(footerContato, 50, footerY + 12, { align: 'center', width: pageWidth })
      }
      doc.text(`Proposta gerada em ${formatarData(new Date())}`, 50, footerY + 24, { align: 'center', width: pageWidth })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
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
