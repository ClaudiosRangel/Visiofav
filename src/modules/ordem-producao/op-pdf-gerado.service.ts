/**
 * Serviço de Geração de Ordem de Produção em PDF (layout profissional).
 *
 * Gera um PDF formatado da OP nativa do Vizor (não o PDF importado do GPrint),
 * incluindo cabeçalho da empresa, dados da OP, cliente/produto, materiais,
 * etapas do roteiro, variações, programação de entrega e área de apontamento.
 *
 * Usa pdfkit (mesma lib do DACTE). Layout retrato A4.
 */

import PDFDocument from 'pdfkit'
import { prisma } from '../../lib/prisma'

// ─── Helpers de formatação ──────────────────────────────────────────────────

function formatData(date: Date | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR')
}

function formatNum(valor: unknown): string {
  const n = Number(valor ?? 0)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function formatMinutos(min: unknown): string {
  const m = Number(min ?? 0)
  if (m <= 0) return '—'
  const h = Math.floor(m / 60)
  const resto = Math.round(m % 60)
  if (h > 0) return `${h}h${resto > 0 ? ` ${resto}min` : ''}`
  return `${resto}min`
}

/** Extrai tags [Chave] das observações (padrão do módulo PCP) */
export function extrairTag(obs: string | null, tag: string): string | null {
  if (!obs) return null
  const m = obs.match(new RegExp(`\\[${tag}\\]\\s*(.+?)(?:\\n|$)`))
  return m ? m[1].trim() : null
}

/**
 * Tags que já são exibidas em OUTRAS seções do relatório (cabeçalho/atributos)
 * e, portanto, NÃO devem se repetir na seção "OBSERVAÇÕES".
 */
const TAGS_EM_OUTRAS_SECOES = ['Cliente', 'Produto', 'Formato', 'Cores', 'Matriz', 'TipoOp', 'Tiragem', 'Acond']

/**
 * Monta as linhas da seção "OBSERVAÇÕES" para consulta visual (paridade com o
 * PDF do Calcgraf). Inclui:
 *  - cada `[Bobina] ...` (com estoque/encomendado) como uma linha legível;
 *  - qualquer linha de texto livre que não seja uma tag já exibida em outra
 *    seção (cabeçalho/atributos).
 * Retorna [] quando não há nada a exibir.
 */
export function extrairObservacoesParaExibicao(obs: string | null): string[] {
  if (!obs) return []
  const linhas: string[] = []
  for (const bruta of obs.split('\n')) {
    const linha = bruta.trim()
    if (!linha) continue
    const tagMatch = linha.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (tagMatch) {
      const chave = tagMatch[1].trim()
      if (chave === 'Bobina') {
        linhas.push(`Bobina: ${tagMatch[2].trim()}`)
      } else if (!TAGS_EM_OUTRAS_SECOES.includes(chave)) {
        // Tag desconhecida/aditiva — mostra como "Chave: valor" para não perder.
        linhas.push(`${chave}: ${tagMatch[2].trim()}`)
      }
      // tags já exibidas em outras seções: ignoradas aqui (não duplicar).
    } else {
      // Texto livre (observação geral/produção).
      linhas.push(linha)
    }
  }
  return linhas
}

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  PLANEJADA: 'Planejada',
  PROGRAMADA: 'Programada',
  LIBERADA: 'Liberada',
  EM_PRODUCAO: 'Em Produção',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
}

const PRIORIDADE_LABEL: Record<string, string> = {
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
  URGENTE: 'URGENTE',
}

// ─── Cores do tema ──────────────────────────────────────────────────────────

const COR_PRIMARIA = '#2b7a4b' // verde Vizor
const COR_ESCURA = '#1a1a1a'
const COR_CINZA = '#666666'
const COR_CINZA_CLARO = '#e8e8e8'
const COR_LINHA = '#cccccc'

// ─── Função principal ───────────────────────────────────────────────────────

export async function gerarOpPdf(opId: string, empresaId: string): Promise<Buffer> {
  // Buscar OP com todos os relacionamentos (select explícito, sem pdfData)
  const op = await prisma.ordemProducao.findFirst({
    where: { id: opId, empresaId },
    select: {
      id: true,
      numero: true,
      status: true,
      prioridade: true,
      quantidade: true,
      unidadeMedida: true,
      quantidadeProduzida: true,
      dataEmissao: true,
      dataEntregaPrevista: true,
      referenciaExterna: true,
      origemImportacao: true,
      observacoes: true,
      produtoId: true,
      clienteId: true,
      itens: {
        select: {
          descricaoProduto: true,
          quantidade: true,
          unidadeMedida: true,
          tipoMaterial: true,
        },
      },
      etapas: {
        select: {
          sequencia: true,
          descricao: true,
          tempoSetupMinutos: true,
          tempoOperacaoCalculado: true,
          status: true,
          centroProducao: { select: { descricao: true } },
        },
        orderBy: { sequencia: 'asc' },
      },
      variacoes: {
        select: { descricao: true, quantidade: true, cor: true },
        orderBy: { sequencia: 'asc' },
      },
      // Planos/componentes (TAMPA/CAIXA/BOLSA ou FRENTE/VERSO) — usados pelas OPs
      // sincronizadas do Calcgraf e pelas de PDF multi-plano/retiração.
      planos: {
        select: { nome: true, tipo: true, cores: true, formato: true, tiragem: true },
        orderBy: { sequencia: 'asc' },
      },
      programacoesEntrega: {
        select: { dataEntrega: true, quantidade: true, status: true },
        orderBy: { dataEntrega: 'asc' },
      },
    },
  })

  if (!op) {
    throw { statusCode: 404, message: 'Ordem de produção não encontrada' }
  }

  // Buscar dados da empresa
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      razaoSocial: true, nomeFantasia: true, cnpj: true,
      logradouro: true, numero: true, bairro: true, cidade: true, uf: true,
      telefone: true, email: true,
    },
  })

  // Resolver nome do cliente (tag tem prioridade sobre relacionamento)
  let clienteNome = extrairTag(op.observacoes, 'Cliente')
  if (!clienteNome && op.clienteId) {
    const cliente = await prisma.cliente.findUnique({
      where: { id: op.clienteId },
      select: { razaoSocial: true, nomeFantasia: true },
    })
    clienteNome = cliente?.nomeFantasia || cliente?.razaoSocial || null
  }

  // Resolver nome do produto
  let produtoNome = extrairTag(op.observacoes, 'Produto')
  if (!produtoNome && op.produtoId) {
    const produto = await prisma.produto.findUnique({
      where: { id: op.produtoId },
      select: { codigo: true, nome: true },
    })
    produtoNome = produto ? `${produto.codigo} - ${produto.nome}` : null
  }

  // Extrair tags gráficas extras
  const formato = extrairTag(op.observacoes, 'Formato')
  const cores = extrairTag(op.observacoes, 'Cores')
  const matriz = extrairTag(op.observacoes, 'Matriz')
  const tipoOp = extrairTag(op.observacoes, 'TipoOp')
  const acondicionamento = extrairTag(op.observacoes, 'Acond')

  // Linhas de observação para a seção "OBSERVAÇÕES" do relatório: as bobinas
  // ([Bobina] ... em estoque/encomendado) e qualquer linha de texto livre que
  // NÃO seja uma tag já exibida em outras seções do cabeçalho. Preserva a
  // consulta visual de TODAS as observações (paridade com o PDF do Calcgraf).
  const linhasObs = extrairObservacoesParaExibicao(op.observacoes)

  // ─── Montar PDF ─────────────────────────────────────────────────────────

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
  const chunks: Buffer[] = []

  // Registrar a Promise de conclusão ANTES de qualquer escrita/doc.end()
  const pdfPronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const pageWidth = doc.page.width - 80 // margens
  const left = 40
  let y = 40

  // ═══ CABEÇALHO ═══
  doc.rect(left, y, pageWidth, 60).fill(COR_PRIMARIA)
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
  doc.text(empresa?.nomeFantasia || empresa?.razaoSocial || 'Empresa', left + 15, y + 12)
  doc.fontSize(9).font('Helvetica')
  const endereco = [
    empresa?.logradouro && `${empresa.logradouro}${empresa.numero ? ', ' + empresa.numero : ''}`,
    empresa?.bairro,
    empresa?.cidade && `${empresa.cidade}/${empresa.uf || ''}`,
  ].filter(Boolean).join(' — ')
  doc.text(endereco || '', left + 15, y + 34)
  doc.text([empresa?.telefone, empresa?.email].filter(Boolean).join(' | ') || '', left + 15, y + 46)

  // Número da OP (destaque à direita)
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
  doc.text(`OP Nº ${op.numero}`, left + pageWidth - 180, y + 14, { width: 165, align: 'right' })
  doc.fontSize(9).font('Helvetica')
  doc.text(`Status: ${STATUS_LABEL[op.status] || op.status}`, left + pageWidth - 180, y + 40, { width: 165, align: 'right' })

  y += 72

  // ═══ TÍTULO DO DOCUMENTO ═══
  doc.fillColor(COR_ESCURA).fontSize(13).font('Helvetica-Bold')
  doc.text('ORDEM DE PRODUÇÃO', left, y, { width: pageWidth, align: 'center' })
  y += 22

  // ═══ DADOS GERAIS (grid 2 colunas) ═══
  const boxDados = (label: string, valor: string, x: number, largura: number, yy: number) => {
    doc.fillColor(COR_CINZA).fontSize(7).font('Helvetica')
    doc.text(label.toUpperCase(), x, yy)
    doc.fillColor(COR_ESCURA).fontSize(10).font('Helvetica-Bold')
    doc.text(valor || '—', x, yy + 9, { width: largura, ellipsis: true })
  }

  const colW = pageWidth / 2
  boxDados('Cliente', clienteNome || '—', left, colW - 10, y)
  boxDados('Produto', produtoNome || '—', left + colW, colW - 10, y)
  y += 30
  boxDados('Quantidade', `${formatNum(op.quantidade)} ${op.unidadeMedida}`, left, colW - 10, y)
  boxDados('Prioridade', PRIORIDADE_LABEL[op.prioridade] || op.prioridade, left + colW, colW - 10, y)
  y += 30
  boxDados('Data de Emissão', formatData(op.dataEmissao), left, colW - 10, y)
  boxDados('Entrega Prevista', formatData(op.dataEntregaPrevista), left + colW, colW - 10, y)
  y += 30

  // Linha de atributos gráficos (se houver)
  if (formato || cores || matriz || tipoOp) {
    const attrW = pageWidth / 4
    boxDados('Formato', formato || '—', left, attrW - 5, y)
    boxDados('Cores', cores || '—', left + attrW, attrW - 5, y)
    boxDados('Matriz/Faca', matriz || '—', left + attrW * 2, attrW - 5, y)
    boxDados('Tipo OP', tipoOp || '—', left + attrW * 3, attrW - 5, y)
    y += 30
  }

  if (op.referenciaExterna || acondicionamento) {
    boxDados('Referência Externa', op.referenciaExterna || '—', left, colW - 10, y)
    if (acondicionamento) boxDados('Acondicionamento', acondicionamento, left + colW, colW - 10, y)
    y += 30
  }

  // ─── Helper de seção com tabela ──────────────────────────────────────────
  const desenharTitulo = (titulo: string, yy: number): number => {
    doc.rect(left, yy, pageWidth, 18).fill(COR_PRIMARIA)
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
    doc.text(titulo, left + 8, yy + 5)
    return yy + 22
  }

  const checarQuebra = (alturaNecessaria: number): void => {
    if (y + alturaNecessaria > doc.page.height - 60) {
      doc.addPage()
      y = 40
    }
  }

  // ═══ MATERIAIS ═══
  if (op.itens.length > 0) {
    checarQuebra(60)
    y = desenharTitulo('MATERIAIS', y)
    // Cabeçalho da tabela
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica-Bold')
    doc.text('Material', left + 5, y, { width: pageWidth * 0.5 })
    doc.text('Tipo', left + pageWidth * 0.52, y, { width: pageWidth * 0.22 })
    doc.text('Qtd', left + pageWidth * 0.75, y, { width: pageWidth * 0.15, align: 'right' })
    doc.text('Un', left + pageWidth * 0.9, y, { width: pageWidth * 0.1, align: 'right' })
    y += 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COR_LINHA).stroke()
    y += 3
    for (const item of op.itens) {
      checarQuebra(16)
      doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
      doc.text(item.descricaoProduto, left + 5, y, { width: pageWidth * 0.5, ellipsis: true })
      doc.text(item.tipoMaterial || '—', left + pageWidth * 0.52, y, { width: pageWidth * 0.22 })
      doc.text(formatNum(item.quantidade), left + pageWidth * 0.75, y, { width: pageWidth * 0.15, align: 'right' })
      doc.text(item.unidadeMedida, left + pageWidth * 0.9, y, { width: pageWidth * 0.1, align: 'right' })
      y += 14
    }
    y += 8
  }

  // ═══ ETAPAS / ROTEIRO ═══
  if (op.etapas.length > 0) {
    checarQuebra(60)
    y = desenharTitulo('ROTEIRO DE PRODUÇÃO', y)
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica-Bold')
    doc.text('#', left + 5, y, { width: 20 })
    doc.text('Etapa', left + 28, y, { width: pageWidth * 0.35 })
    doc.text('Centro/Máquina', left + pageWidth * 0.4, y, { width: pageWidth * 0.28 })
    doc.text('Setup', left + pageWidth * 0.68, y, { width: pageWidth * 0.14, align: 'right' })
    doc.text('Operação', left + pageWidth * 0.82, y, { width: pageWidth * 0.18, align: 'right' })
    y += 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COR_LINHA).stroke()
    y += 3
    for (const etapa of op.etapas) {
      checarQuebra(16)
      doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
      doc.text(String(etapa.sequencia), left + 5, y, { width: 20 })
      doc.text(etapa.descricao, left + 28, y, { width: pageWidth * 0.35, ellipsis: true })
      doc.text(etapa.centroProducao?.descricao || '—', left + pageWidth * 0.4, y, { width: pageWidth * 0.28, ellipsis: true })
      doc.text(formatMinutos(etapa.tempoSetupMinutos), left + pageWidth * 0.68, y, { width: pageWidth * 0.14, align: 'right' })
      doc.text(formatMinutos(etapa.tempoOperacaoCalculado), left + pageWidth * 0.82, y, { width: pageWidth * 0.18, align: 'right' })
      y += 14
    }
    y += 8
  }

  // ═══ PLANOS / COMPONENTES ═══ (TAMPA/CAIXA/BOLSA ou FRENTE/VERSO)
  if (op.planos.length > 0) {
    checarQuebra(50)
    y = desenharTitulo('PLANOS / COMPONENTES', y)
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica-Bold')
    doc.text('Plano', left + 5, y, { width: pageWidth * 0.34 })
    doc.text('Tipo', left + pageWidth * 0.34, y, { width: pageWidth * 0.16 })
    doc.text('Formato', left + pageWidth * 0.5, y, { width: pageWidth * 0.2 })
    doc.text('Cores', left + pageWidth * 0.7, y, { width: pageWidth * 0.15 })
    doc.text('Tiragem', left + pageWidth * 0.85, y, { width: pageWidth * 0.15, align: 'right' })
    y += 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COR_LINHA).stroke()
    y += 3
    for (const p of op.planos) {
      checarQuebra(16)
      // Nome exibido padroniza "VERSO" (nunca "COSTA").
      const nomeExib = (p.nome || '').replace(/\(COSTA\)/gi, '(VERSO)')
      const tipoExib = p.tipo === 'FACE' ? 'Face' : 'Componente'
      doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
      doc.text(nomeExib, left + 5, y, { width: pageWidth * 0.34, ellipsis: true })
      doc.text(tipoExib, left + pageWidth * 0.34, y, { width: pageWidth * 0.16 })
      doc.text(p.formato || '—', left + pageWidth * 0.5, y, { width: pageWidth * 0.2, ellipsis: true })
      doc.text(p.cores || '—', left + pageWidth * 0.7, y, { width: pageWidth * 0.15 })
      doc.text(p.tiragem != null ? formatNum(p.tiragem) : '—', left + pageWidth * 0.85, y, { width: pageWidth * 0.15, align: 'right' })
      y += 14
    }
    y += 8
  }

  // ═══ VARIAÇÕES ═══ (legado — só exibe quando não há planos)
  if (op.planos.length === 0 && op.variacoes.length > 0) {
    checarQuebra(50)
    y = desenharTitulo('VARIAÇÕES', y)
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica-Bold')
    doc.text('Descrição', left + 5, y, { width: pageWidth * 0.55 })
    doc.text('Cor', left + pageWidth * 0.6, y, { width: pageWidth * 0.25 })
    doc.text('Qtd', left + pageWidth * 0.85, y, { width: pageWidth * 0.15, align: 'right' })
    y += 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COR_LINHA).stroke()
    y += 3
    for (const v of op.variacoes) {
      checarQuebra(16)
      doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
      doc.text(v.descricao, left + 5, y, { width: pageWidth * 0.55, ellipsis: true })
      doc.text(v.cor || '—', left + pageWidth * 0.6, y, { width: pageWidth * 0.25 })
      doc.text(formatNum(v.quantidade), left + pageWidth * 0.85, y, { width: pageWidth * 0.15, align: 'right' })
      y += 14
    }
    y += 8
  }

  // ═══ PROGRAMAÇÃO DE ENTREGA ═══
  if (op.programacoesEntrega.length > 0) {
    checarQuebra(50)
    y = desenharTitulo('PROGRAMAÇÃO DE ENTREGA', y)
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica-Bold')
    doc.text('Data', left + 5, y, { width: pageWidth * 0.4 })
    doc.text('Quantidade', left + pageWidth * 0.4, y, { width: pageWidth * 0.3, align: 'right' })
    doc.text('Status', left + pageWidth * 0.7, y, { width: pageWidth * 0.3, align: 'right' })
    y += 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COR_LINHA).stroke()
    y += 3
    for (const p of op.programacoesEntrega) {
      checarQuebra(16)
      doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
      doc.text(formatData(p.dataEntrega), left + 5, y, { width: pageWidth * 0.4 })
      doc.text(formatNum(p.quantidade), left + pageWidth * 0.4, y, { width: pageWidth * 0.3, align: 'right' })
      doc.text(p.status, left + pageWidth * 0.7, y, { width: pageWidth * 0.3, align: 'right' })
      y += 14
    }
    y += 8
  }

  // ═══ OBSERVAÇÕES (consulta visual — paridade com o PDF do Calcgraf) ═══
  if (linhasObs.length > 0) {
    checarQuebra(40)
    y = desenharTitulo('OBSERVAÇÕES', y)
    doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
    for (const linha of linhasObs) {
      // Altura aproximada do texto para quebra de página (linhas longas quebram).
      const alturaTexto = doc.heightOfString(`• ${linha}`, { width: pageWidth - 10 })
      checarQuebra(alturaTexto + 4)
      doc.text(`• ${linha}`, left + 5, y, { width: pageWidth - 10 })
      y += alturaTexto + 2
    }
    y += 8
  }

  // ═══ ÁREA DE APONTAMENTO (chão de fábrica) ═══
  checarQuebra(90)
  y = desenharTitulo('APONTAMENTO DE PRODUÇÃO', y)
  doc.fillColor(COR_ESCURA).fontSize(8).font('Helvetica')
  const linhaApont = (label: string, yy: number) => {
    doc.text(label, left + 5, yy)
    doc.moveTo(left + 120, yy + 9).lineTo(left + pageWidth - 5, yy + 9).strokeColor(COR_LINHA).stroke()
  }
  linhaApont('Operador:', y); y += 20
  linhaApont('Data início:', y)
  doc.text('Data fim:', left + pageWidth * 0.5, y)
  doc.moveTo(left + pageWidth * 0.5 + 60, y + 9).lineTo(left + pageWidth - 5, y + 9).strokeColor(COR_LINHA).stroke()
  y += 20
  linhaApont('Qtd. produzida:', y)
  doc.text('Qtd. perda:', left + pageWidth * 0.5, y)
  doc.moveTo(left + pageWidth * 0.5 + 60, y + 9).lineTo(left + pageWidth - 5, y + 9).strokeColor(COR_LINHA).stroke()
  y += 20
  doc.text('Observações:', left + 5, y); y += 14
  doc.rect(left + 5, y, pageWidth - 10, 30).strokeColor(COR_LINHA).stroke()
  y += 40

  // ═══ RODAPÉ (todas as páginas) ═══
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    const rodapeY = doc.page.height - 40
    doc.fillColor(COR_CINZA).fontSize(7).font('Helvetica')
    doc.text(
      `Gerado pelo Vizor ERP em ${new Date().toLocaleString('pt-BR')}`,
      left, rodapeY, { width: pageWidth * 0.6 },
    )
    doc.text(
      `Página ${i + 1} de ${range.count}`,
      left + pageWidth * 0.6, rodapeY, { width: pageWidth * 0.4, align: 'right' },
    )
  }

  doc.end()

  // Aguardar finalização e retornar buffer
  return pdfPronto
}
