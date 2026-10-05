import PDFDocument from 'pdfkit'

/**
 * Gera o PDF da 1ª via da Requisição de Corte de Cartão (formulário FO-002/PCP).
 * Spec: pcp-planos-frente-costa-rc (Fase A). Layout fiel ao formulário físico
 * da Carton Wega (cabeçalho de qualidade, Nº NN/AAAA, selo "1ª VIA", campos
 * em pares rótulo/valor, bloco de instruções de refile em destaque).
 */

export interface RequisicaoCorteDados {
  numero: string
  dataSolicitacao: Date
  dataCorte: Date | null
  requisitante: string
  fabricanteCartao: string
  fornecedor: string | null
  larguraBobinaCm: any | null
  gramaturaG: any | null
  tamanhoCorteCm: any | null
  formatoCorte: string | null
  qtdFolhasCortadeira: number | null
  textoGuilhotina: string | null
  qtdFolhasGuilhotina: number | null
  nomeProduto: string
  nomeServico: string
  pesoKg: any | null
  instrucoesRefile: string | null
}

export interface EmpresaRcDados {
  razaoSocial: string
  nomeFantasia: string | null
  logo: string | null
}

function fmtData(d: Date | null): string {
  if (!d) return ''
  const dt = new Date(d)
  const dia = String(dt.getDate()).padStart(2, '0')
  const mes = String(dt.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${dt.getFullYear()}`
}

function fmtNum(v: any, sufixo = ''): string {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return String(v)
  const s = n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return sufixo ? `${s} ${sufixo}` : s
}

export async function gerarPdfRequisicaoCorte(
  rc: RequisicaoCorteDados,
  empresa: EmpresaRcDados | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: 'A4', margin: 40 })
      const chunks: Buffer[] = []
      pdf.on('data', (c) => chunks.push(c))
      pdf.on('end', () => resolve(Buffer.concat(chunks)))
      pdf.on('error', reject)

      const left = 40
      const right = 555
      const larguraTotal = right - left

      // ---- Cabeçalho do Sistema de Gestão da Qualidade (3 colunas) ----------
      const topo = 40
      const alturaCab = 46
      // caixa externa
      pdf.rect(left, topo, larguraTotal, alturaCab).stroke()
      // divisórias verticais: logo | título | metadados
      const colLogoW = 110
      const colMetaW = 120
      const xTitulo = left + colLogoW
      const xMeta = right - colMetaW
      pdf.moveTo(xTitulo, topo).lineTo(xTitulo, topo + alturaCab).stroke()
      pdf.moveTo(xMeta, topo).lineTo(xMeta, topo + alturaCab).stroke()

      // logo / nome da empresa
      const nomeEmpresa = empresa?.nomeFantasia || empresa?.razaoSocial || 'CARTON WEGA'
      pdf.fontSize(11).font('Helvetica-Bold')
      pdf.text(nomeEmpresa, left + 6, topo + 16, { width: colLogoW - 12, align: 'center' })

      // título central (2 linhas)
      pdf.fontSize(9).font('Helvetica-Bold')
      pdf.text('FORMULÁRIO DO SISTEMA DE GESTÃO DA QUALIDADE', xTitulo + 6, topo + 8, {
        width: xMeta - xTitulo - 12,
        align: 'center',
      })
      pdf.fontSize(10)
      pdf.text('REQUISIÇÃO DE CORTE DE CARTÃO', xTitulo + 6, topo + 26, {
        width: xMeta - xTitulo - 12,
        align: 'center',
      })

      // metadados (código / versão / elaborador)
      pdf.fontSize(7).font('Helvetica')
      pdf.text('Codificação: FO-002/PCP', xMeta + 6, topo + 8, { width: colMetaW - 12 })
      pdf.text('Versão: 01', xMeta + 6, topo + 22, { width: colMetaW - 12 })
      pdf.text('Elaborador(a): PCP', xMeta + 6, topo + 32, { width: colMetaW - 12 })

      // ---- Número + selo "1ª VIA" --------------------------------------------
      let y = topo + alturaCab + 16
      pdf.fontSize(14).font('Helvetica-Bold')
      pdf.text(`Nº ${rc.numero}`, left, y, { width: larguraTotal, align: 'right' })

      // selo 1ª VIA (circular estilizado como texto em caixa)
      pdf.fontSize(11).font('Helvetica-Bold')
      pdf.save()
      pdf.rect(right - 90, y + 20, 90, 26).lineWidth(1.5).stroke()
      pdf.fillColor('#1a7f37').text('1ª VIA', right - 90, y + 27, { width: 90, align: 'center' })
      pdf.restore()
      pdf.fillColor('black')

      // ---- Campos em pares rótulo/valor --------------------------------------
      y += 8
      const linha = (rotulo: string, valor: string, negritoValor = false) => {
        pdf.fontSize(10).font('Helvetica-Bold').fillColor('black')
        pdf.text(rotulo, left, y, { continued: false })
        const rotuloW = 190
        pdf.font(negritoValor ? 'Helvetica-Bold' : 'Helvetica')
        pdf.text(valor || '—', left + rotuloW, y, { width: larguraTotal - rotuloW })
        y += 20
      }

      linha('DT SOLICITAÇÃO CORTE:', fmtData(rc.dataSolicitacao))
      linha('DATA DO CORTE:', fmtData(rc.dataCorte))
      linha('REQUISITANTE:', rc.requisitante, true)
      y += 4
      linha('FABRICANTE/CARTÃO:', rc.fabricanteCartao, true)
      linha('FORNECEDOR:', rc.fornecedor || '')
      linha('LARGURA BOBINA:', fmtNum(rc.larguraBobinaCm, 'CM'), true)
      linha('GRAMATURA:', fmtNum(rc.gramaturaG, 'G'), true)
      linha('TAMANHO DO CORTE:', fmtNum(rc.tamanhoCorteCm, 'CM'), true)
      y += 4
      linha('FORMATO CORTE:', rc.formatoCorte || '')
      linha(
        'QUANTIDADE FOLHAS (CORTADEIRA):',
        rc.qtdFolhasCortadeira != null ? `${fmtNum(rc.qtdFolhasCortadeira)} folhas` : '',
      )
      linha('GUILHOTINA:', rc.textoGuilhotina || '')
      linha(
        'QUANTIDADE FOLHAS (GUILHOTINA):',
        rc.qtdFolhasGuilhotina != null ? `${fmtNum(rc.qtdFolhasGuilhotina)} folhas` : '',
      )
      y += 6
      linha('NOME DO PRODUTO:', rc.nomeProduto)
      linha('NOME DO SERVIÇO:', rc.nomeServico)

      // ---- Peso em destaque --------------------------------------------------
      if (rc.pesoKg != null) {
        y += 8
        pdf.fontSize(12).font('Helvetica-Bold')
        pdf.text(`${fmtNum(rc.pesoKg)} KG`, left, y, { width: larguraTotal, align: 'center' })
        y += 24
      }

      // ---- Instruções de refile (bloco em destaque) --------------------------
      if (rc.instrucoesRefile) {
        y += 6
        pdf.fontSize(13).font('Helvetica-Bold')
        pdf.text(rc.instrucoesRefile, left, y, { width: larguraTotal, align: 'center' })
      }

      // ---- Rodapé ------------------------------------------------------------
      pdf.fontSize(7).font('Helvetica').fillColor('#555')
      pdf.text('Anexo 2 - Procedimento PO-001-PCP', left, 790, {
        width: larguraTotal,
        align: 'center',
      })

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}
