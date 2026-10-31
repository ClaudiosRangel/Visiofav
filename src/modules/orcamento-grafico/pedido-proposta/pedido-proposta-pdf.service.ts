/**
 * PDF do Pedido/Proposta (RFQ) — spec comercial-pedido-proposta.
 *
 * Imprime TODOS os campos preenchidos no formulário RFQ (os da planilha Carton
 * Wega inclusive), organizados em seções, com o logo/cabeçalho da empresa.
 * Reaproveita o padrão pdfkit do `orcamento-grafico-proposta-pdf.service.ts`.
 *
 * Função PURA de montagem: recebe os dados já carregados (sem Prisma aqui).
 */
import PDFDocument from 'pdfkit'

export interface DadosEmpresaRfq {
  razaoSocial: string
  cnpj?: string | null
  telefone?: string | null
  email?: string | null
  logoUrl?: string | null
}

/** Campo exibível: rótulo + valor. Valores vazios são filtrados antes. */
interface Campo {
  rotulo: string
  valor: string
}

export interface DadosPedidoPropostaPdf {
  numero: number
  estado: string
  origem: string
  tipoPedido: string
  criadoEm: Date
  clienteNome?: string | null
  clienteCpfCnpj?: string | null
  jaCliente?: boolean | null
  mercado?: string | null
  ufOrigem?: string | null
  cidade?: string | null
  tipoEntrega?: string | null
  entregaFracionadaDias?: string | null
  prazoPagamento?: string | null
  produtoNome?: string | null
  tipoEmbalagem?: string | null
  quantidade?: number | null
  tiragensTexto?: string | null
  cartao?: string | null
  gramatura?: string | null
  medidasTexto?: string | null
  cartaoFsc?: boolean | null
  corteInternoVerso?: boolean | null
  passtime?: boolean | null
  acabamentoManual?: boolean | null
  acabamentos?: string | null
  acabamentosSelecionados?: Array<{ nome: string; marcado: boolean; detalhe?: string | null }> | null
  matriz?: string | null
  quantidadePorVolume?: string | null
  variacoesArte?: string | null
  exportacao?: string | null
  dataValidade?: string | null
  exigeAmostra?: boolean | null
  discriminacao?: string | null
  observacoes?: string | null
}

const ESTADO_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  EM_ANALISE: 'Em análise',
  ENVIADO_ORCAMENTO: 'Enviado para orçamento',
  ORCADO: 'Orçado',
  PROPOSTA_ENVIADA: 'Proposta enviada',
  ACEITO: 'Aceito',
  PERDIDO: 'Perdido',
  CANCELADO: 'Cancelado',
}
const ORIGEM_LABEL: Record<string, string> = {
  REPRESENTANTE: 'Representante', VENDEDOR: 'Vendedor', INTERNA: 'Venda interna',
}
const TIPO_LABEL: Record<string, string> = {
  REPETICAO: 'Repetição', MOSTRUARIO: 'Mostruário', NOVO: 'Novo',
}
const ENTREGA_LABEL: Record<string, string> = { UNICA: 'Única', FRACIONADA: 'Fracionada' }
const EXPORT_LABEL: Record<string, string> = { COMUM: 'Comum', EXPORTACAO: 'Exportação' }

function sim(v?: boolean | null): string { return v ? 'Sim' : 'Não' }
function dataBr(d: Date): string { return new Date(d).toLocaleDateString('pt-BR') }

/** Converte logo (base64/dataURL/URL http) em Buffer. Best-effort → null. */
async function resolverLogoBuffer(logoUrl?: string | null): Promise<Buffer | null> {
  if (!logoUrl || typeof logoUrl !== 'string') return null
  const v = logoUrl.trim()
  try {
    if (v.startsWith('data:')) return Buffer.from(v.substring(v.indexOf(',') + 1), 'base64')
    if (v.startsWith('http://') || v.startsWith('https://')) {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 8000)
      const resp = await fetch(v, { signal: controller.signal })
      clearTimeout(t)
      if (!resp.ok) return null
      return Buffer.from(await resp.arrayBuffer())
    }
    // base64 puro.
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(v) && v.length > 100) return Buffer.from(v, 'base64')
  } catch { /* ignora — cai no nome em texto */ }
  return null
}

/**
 * Gera o PDF do Pedido/Proposta (RFQ). Resolve em um Buffer completo.
 */
export async function gerarPedidoPropostaPdf(
  p: DadosPedidoPropostaPdf,
  empresa: DadosEmpresaRfq,
): Promise<Buffer> {
  const logoBuffer = await resolverLogoBuffer(empresa.logoUrl)

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const left = doc.page.margins.left
      const right = doc.page.width - doc.page.margins.right
      const larguraUtil = right - left

      // ── Cabeçalho (logo + empresa) ──
      let topo = doc.y
      if (logoBuffer) {
        try { doc.image(logoBuffer, left, topo, { fit: [120, 48] }) } catch { /* ignora */ }
      }
      doc.fontSize(14).font('Helvetica-Bold')
        .text(empresa.razaoSocial || 'Empresa', left + (logoBuffer ? 132 : 0), topo, {
          width: larguraUtil - (logoBuffer ? 132 : 0),
        })
      const linhaEmp = [empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : null, empresa.telefone, empresa.email]
        .filter(Boolean).join('  ·  ')
      if (linhaEmp) doc.fontSize(8).font('Helvetica').fillColor('#555').text(linhaEmp, { width: larguraUtil - (logoBuffer ? 132 : 0) })
      doc.fillColor('#000')
      doc.moveDown(0.5)
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke()
      doc.moveDown(0.6)

      // ── Título ──
      doc.fontSize(16).font('Helvetica-Bold').text(`Pedido / Proposta nº ${p.numero}`, { align: 'left' })
      doc.fontSize(9).font('Helvetica').fillColor('#555')
        .text(`Status: ${ESTADO_LABEL[p.estado] || p.estado}   ·   Origem: ${ORIGEM_LABEL[p.origem] || p.origem}   ·   Tipo: ${TIPO_LABEL[p.tipoPedido] || p.tipoPedido}   ·   Emitido em ${dataBr(p.criadoEm)}`)
      doc.fillColor('#000').moveDown(0.8)

      // Helper: desenha uma seção (título + grade de campos rótulo:valor).
      const secao = (titulo: string, campos: Campo[]) => {
        const presentes = campos.filter((c) => c.valor && c.valor.trim() && c.valor !== '—')
        if (presentes.length === 0) return
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1c6b45').text(titulo)
        doc.fillColor('#000').moveDown(0.2)
        const colW = larguraUtil / 2
        let col = 0
        let yLinha = doc.y
        for (const c of presentes) {
          const x = left + col * colW
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#666').text(c.rotulo.toUpperCase(), x, yLinha, { width: colW - 10 })
          doc.fontSize(10).font('Helvetica').fillColor('#000').text(c.valor, x, doc.y, { width: colW - 10 })
          const fimY = doc.y
          if (col === 0) {
            col = 1
            doc.y = yLinha // volta p/ a 2ª coluna na mesma linha
          } else {
            col = 0
            yLinha = fimY + 6
            doc.y = yLinha
          }
        }
        if (col === 1) doc.moveDown(0.4) // fechou a linha pela metade
        doc.moveDown(0.5)
      }

      // ── Seções ──
      secao('Cliente', [
        { rotulo: 'Cliente', valor: p.clienteNome || '—' },
        { rotulo: 'CNPJ/CPF', valor: p.clienteCpfCnpj || '—' },
        { rotulo: 'Já é cliente', valor: sim(p.jaCliente) },
        { rotulo: 'Mercado', valor: p.mercado || '—' },
        { rotulo: 'UF', valor: p.ufOrigem || '—' },
        { rotulo: 'Cidade', valor: p.cidade || '—' },
      ])

      secao('Entrega e pagamento', [
        { rotulo: 'Entrega', valor: p.tipoEntrega ? (ENTREGA_LABEL[p.tipoEntrega] || p.tipoEntrega) : '—' },
        { rotulo: 'Intervalo (fracionada)', valor: p.entregaFracionadaDias || '—' },
        { rotulo: 'Prazo de pagamento', valor: p.prazoPagamento || '—' },
        { rotulo: 'Exportação', valor: p.exportacao ? (EXPORT_LABEL[p.exportacao] || p.exportacao) : '—' },
      ])

      secao('Produto e especificação', [
        { rotulo: 'Produto', valor: p.produtoNome || '—' },
        { rotulo: 'Tipo de embalagem', valor: p.tipoEmbalagem || '—' },
        { rotulo: 'Tiragens', valor: p.tiragensTexto || (p.quantidade != null ? String(p.quantidade) : '—') },
        { rotulo: 'Cartão', valor: p.cartao || '—' },
        { rotulo: 'Gramatura', valor: p.gramatura || '—' },
        { rotulo: 'Medidas (C x L x A mm)', valor: p.medidasTexto || '—' },
        { rotulo: 'Variações de arte / cores', valor: p.variacoesArte || '—' },
        { rotulo: 'Matriz', valor: p.matriz || '—' },
        { rotulo: 'Qtd. por volume', valor: p.quantidadePorVolume || '—' },
        { rotulo: 'Validade', valor: p.dataValidade || '—' },
        { rotulo: 'Cartão FSC', valor: sim(p.cartaoFsc) },
        { rotulo: 'Corte interno (verso)', valor: sim(p.corteInternoVerso) },
        { rotulo: 'Passtime (visor)', valor: sim(p.passtime) },
        { rotulo: 'Acabamento manual', valor: sim(p.acabamentoManual) },
        { rotulo: 'Exige amostra', valor: sim(p.exigeAmostra) },
      ])

      // ── Acabamentos marcados (checklist) ──
      const marcados = (p.acabamentosSelecionados || []).filter((a) => a.marcado)
      if (marcados.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1c6b45').text('Acabamentos selecionados')
        doc.fillColor('#000').moveDown(0.2)
        for (const a of marcados) {
          doc.fontSize(10).font('Helvetica')
            .text(`•  ${a.nome}${a.detalhe && a.detalhe.trim() ? `  —  ${a.detalhe.trim()}` : ''}`, { width: larguraUtil })
        }
        doc.moveDown(0.5)
      }

      // ── Textos longos ──
      const textoLongo = (titulo: string, valor?: string | null) => {
        if (!valor || !valor.trim()) return
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1c6b45').text(titulo)
        doc.fillColor('#000').moveDown(0.2)
        doc.fontSize(10).font('Helvetica').text(valor.trim(), { width: larguraUtil })
        doc.moveDown(0.5)
      }
      textoLongo('Acabamentos (texto livre)', p.acabamentos)
      textoLongo('Discriminação', p.discriminacao)
      textoLongo('Observações', p.observacoes)

      // ── Rodapé ──
      doc.moveDown(1)
      doc.fontSize(7).font('Helvetica').fillColor('#999')
        .text(`Documento gerado pelo Vizor ERP em ${new Date().toLocaleString('pt-BR')}. Pedido/Proposta nº ${p.numero}.`, left, doc.y, { width: larguraUtil, align: 'center' })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
