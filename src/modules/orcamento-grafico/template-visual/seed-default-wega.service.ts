/**
 * Seed_Default_Wega — cria os templates VISUAIS default da empresa reproduzindo
 * os modelos atuais da Carton Wega (estilo WEGA de proposta + um de orçamento).
 * Spec comercial-editor-visual-templates.
 *
 * Idempotente (Req 6.4): só cria se a empresa ainda NÃO tem template visual
 * daquele tipo. Marca default quando não há default do tipo (Req 6.3).
 * `empresaId` explícito em cada registro (Req 6.5). Coordenadas em pt.
 */
import { prisma } from '../../../lib/prisma'
import {
  type Elemento,
  type EstiloTexto,
  type LayoutDocumento,
  type TipoTemplate,
  paginaA4Padrao,
} from './layout-json.types'

let seqId = 0
function novoId(prefixo: string): string {
  seqId += 1
  return `${prefixo}-${seqId}`
}

function estilo(over: Partial<EstiloTexto>): EstiloTexto {
  return {
    fonte: over.fonte ?? 'Helvetica',
    tamanhoPt: over.tamanhoPt ?? 10,
    alinhamento: over.alinhamento ?? 'left',
    negrito: over.negrito ?? false,
    cor: over.cor ?? '#000000',
  }
}

/**
 * Layout inicial do estilo WEGA (proposta ao cliente). Reproduz o cabeçalho com
 * logo centralizado, nº da proposta, destinatário, saudação, dados do produto,
 * tabela de tiragens, condições e assinatura — espelhando o `renderWega` atual
 * (orcamento-grafico-proposta-pdf.service.ts), agora como elementos posicionáveis.
 */
export function layoutPropostaWega(): LayoutDocumento {
  seqId = 0
  const pagina = paginaA4Padrao()
  const left = pagina.margemEsquerdaPt
  const larguraUtil = pagina.larguraPt - pagina.margemEsquerdaPt - pagina.margemDireitaPt
  const els: Elemento[] = []
  const rotuloCol = 90 // largura da coluna de rótulos "Produto:", "Descrição:" etc.

  // Logo centralizado no topo.
  els.push({
    id: novoId('logo'), tipo: 'LOGO',
    xPt: (pagina.larguraPt - 150) / 2, yPt: 40, larguraPt: 150, alturaPt: 60,
  })

  // Cidade/data (esquerda) e Proposta nº (direita).
  els.push({
    id: novoId('txt'), tipo: 'CAMPO_DINAMICO', binding: '{{orcamento.criadoEm}}',
    xPt: left, yPt: 120, larguraPt: 300, alturaPt: 16, estilo: estilo({ tamanhoPt: 10 }),
  })
  els.push({
    id: novoId('lblprop'), tipo: 'TEXTO', textoEstatico: 'Proposta nº',
    xPt: left + larguraUtil - 200, yPt: 120, larguraPt: 110, alturaPt: 16,
    estilo: estilo({ tamanhoPt: 10, alinhamento: 'right', negrito: true }),
  })
  els.push({
    id: novoId('cd'), tipo: 'CAMPO_DINAMICO', binding: '{{orcamento.numero}}',
    xPt: left + larguraUtil - 85, yPt: 120, larguraPt: 85, alturaPt: 16,
    estilo: estilo({ tamanhoPt: 10, alinhamento: 'right', negrito: true }),
  })

  // Destinatário.
  els.push({
    id: novoId('txt'), tipo: 'TEXTO', textoEstatico: 'À',
    xPt: left, yPt: 150, larguraPt: larguraUtil, alturaPt: 14, estilo: estilo({}),
  })
  els.push({
    id: novoId('cli'), tipo: 'CAMPO_DINAMICO', binding: '{{cliente.nome}}',
    xPt: left, yPt: 164, larguraPt: larguraUtil, alturaPt: 16,
    estilo: estilo({ negrito: true, fonte: 'Helvetica-Bold' }),
  })

  // Saudação.
  els.push({
    id: novoId('txt'), tipo: 'TEXTO',
    textoEstatico: 'Prezado(s) senhor(es),\nConforme solicitado, encaminhamos abaixo nossa proposta:',
    xPt: left, yPt: 190, larguraPt: larguraUtil, alturaPt: 30, estilo: estilo({}),
  })

  // Bloco de dados do produto (rótulo em negrito + valor).
  const linhaCampo = (y: number, rotulo: string, binding: string) => {
    els.push({
      id: novoId('rot'), tipo: 'TEXTO', textoEstatico: rotulo,
      xPt: left, yPt: y, larguraPt: rotuloCol, alturaPt: 14, estilo: estilo({ negrito: true, fonte: 'Helvetica-Bold' }),
    })
    els.push({
      id: novoId('val'), tipo: 'CAMPO_DINAMICO', binding,
      xPt: left + rotuloCol, yPt: y, larguraPt: larguraUtil - rotuloCol, alturaPt: 14, estilo: estilo({}),
    })
  }
  linhaCampo(232, 'Produto:', '{{orcamento.descricao}}')
  linhaCampo(250, 'Cliente:', '{{cliente.nome}}')

  // Tabela de tiragens (Quantidade | Unitário | Total).
  els.push({
    id: novoId('tab'), tipo: 'TABELA',
    xPt: left, yPt: 285, larguraPt: larguraUtil, alturaPt: 90,
    estilo: estilo({ tamanhoPt: 10 }),
    tabela: {
      fonteDados: 'variacoes',
      colunas: [
        { titulo: 'Quantidade', binding: 'quantidade', larguraPt: 170, alinhamento: 'left' },
        { titulo: 'Unitário', binding: 'precoUnitario', larguraPt: 170, alinhamento: 'left' },
        { titulo: 'Total (R$)', binding: 'precoTotal', larguraPt: larguraUtil - 340, alinhamento: 'left' },
      ],
    },
  })

  // Condições (Cond. Pagto / Validade / Vendedor).
  linhaCampo(390, 'Cond. Pagto:', '{{orcamento.condicaoPagamento}}')
  linhaCampo(408, 'Vendedor:', '{{orcamento.vendedorNome}}')

  // Bloco IMPORTANTE (condições).
  els.push({
    id: novoId('cond'), tipo: 'BLOCO_CONDICOES',
    textoEstatico:
      'IMPORTANTE:\n' +
      '- A gráfica não se responsabiliza por impressões realizadas sem provas de cor.\n' +
      '- Este Orçamento está apoiado na informação fornecida pelo cliente.\n' +
      '- Reservamos o direito de entregar 10% a mais ou a menos da quantidade solicitada (normas A.B.T.G).\n' +
      '- Os processos de fabricação só terão início após confirmação do pedido e aprovação de arte.',
    xPt: left, yPt: 440, larguraPt: larguraUtil, alturaPt: 90, estilo: estilo({ tamanhoPt: 9 }),
  })

  // Assinatura do cliente.
  els.push({
    id: novoId('ass'), tipo: 'ASSINATURA', rotuloAssinatura: 'Assinatura do Cliente',
    xPt: left, yPt: 560, larguraPt: 300, alturaPt: 20, estilo: estilo({ tamanhoPt: 9 }),
  })

  return { versao: 1, pagina, elementos: els }
}

/**
 * Layout inicial de ORÇAMENTO (uso interno). Cabeçalho da empresa + nº + cliente
 * + tabela de itens com decomposição. Base editável para o calculista.
 */
export function layoutOrcamentoPadrao(): LayoutDocumento {
  seqId = 0
  const pagina = paginaA4Padrao()
  const left = pagina.margemEsquerdaPt
  const larguraUtil = pagina.larguraPt - pagina.margemEsquerdaPt - pagina.margemDireitaPt
  const els: Elemento[] = []

  els.push({
    id: novoId('logo'), tipo: 'LOGO', xPt: left, yPt: 40, larguraPt: 120, alturaPt: 48,
  })
  els.push({
    id: novoId('emp'), tipo: 'CAMPO_DINAMICO', binding: '{{empresa.razaoSocial}}',
    xPt: left + 132, yPt: 44, larguraPt: larguraUtil - 132, alturaPt: 18,
    estilo: estilo({ tamanhoPt: 14, negrito: true, fonte: 'Helvetica-Bold' }),
  })
  els.push({
    id: novoId('tit'), tipo: 'CAMPO_DINAMICO', binding: '{{orcamento.numero}}',
    xPt: left, yPt: 100, larguraPt: larguraUtil, alturaPt: 18,
    estilo: estilo({ tamanhoPt: 13, negrito: true, fonte: 'Helvetica-Bold' }),
  })
  els.push({
    id: novoId('cli'), tipo: 'CAMPO_DINAMICO', binding: '{{cliente.nome}}',
    xPt: left, yPt: 124, larguraPt: larguraUtil, alturaPt: 16, estilo: estilo({}),
  })
  els.push({
    id: novoId('div'), tipo: 'LINHA', xPt: left, yPt: 146, larguraPt: larguraUtil, alturaPt: 0,
    estilo: estilo({ cor: '#cccccc' }),
  })
  els.push({
    id: novoId('tab'), tipo: 'TABELA',
    xPt: left, yPt: 160, larguraPt: larguraUtil, alturaPt: 120, estilo: estilo({ tamanhoPt: 9 }),
    tabela: {
      fonteDados: 'itens',
      colunas: [
        { titulo: 'Descrição', binding: 'descricao', larguraPt: larguraUtil - 230, alinhamento: 'left' },
        { titulo: 'Qtd', binding: 'quantidade', larguraPt: 70, alinhamento: 'right' },
        { titulo: 'Unitário', binding: 'precoUnitario', larguraPt: 80, alinhamento: 'right' },
        { titulo: 'Total', binding: 'precoTotal', larguraPt: 80, alinhamento: 'right' },
      ],
    },
  })

  return { versao: 1, pagina, elementos: els }
}

export interface ResultadoSeed {
  criados: number
  ignorados: number
}

/**
 * Semeia (idempotente) os templates visuais default da empresa: 1 PROPOSTA (WEGA)
 * e 1 ORCAMENTO. Só cria o que falta; marca default quando o tipo ainda não tem.
 */
export async function seedTemplatesVisuaisWega(empresaId: string): Promise<ResultadoSeed> {
  let criados = 0
  let ignorados = 0

  const defs: Array<{ tipo: TipoTemplate; nome: string; layout: LayoutDocumento }> = [
    { tipo: 'PROPOSTA', nome: 'Proposta Carton Wega (visual)', layout: layoutPropostaWega() },
    { tipo: 'ORCAMENTO', nome: 'Orçamento interno (visual)', layout: layoutOrcamentoPadrao() },
  ]

  for (const def of defs) {
    // Idempotência: já existe template VISUAL desse tipo para a empresa?
    const existente = await prisma.templateProposta.findFirst({
      where: { empresaId, tipo: def.tipo, layoutJson: { not: null } } as never,
      select: { id: true, layoutJson: true } as never,
    })
    if (existente) {
      // Conserta templates semeados VAZIOS em versões anteriores: se o layout
      // não tem elementos, regrava com o layout rico atual. Templates já
      // editados (com elementos) são preservados — não sobrescreve trabalho.
      const layoutAtual = (existente as { layoutJson?: { elementos?: unknown[] } }).layoutJson
      const vazio = !layoutAtual || !Array.isArray(layoutAtual.elementos) || layoutAtual.elementos.length === 0
      if (vazio) {
        await prisma.templateProposta.update({
          where: { id: (existente as { id: string }).id },
          data: { layoutJson: def.layout as never } as never,
        })
        criados += 1
      } else {
        ignorados += 1
      }
      continue
    }
    // Há algum default (visual) desse tipo? Se não, este nasce default.
    const temDefault = await prisma.templateProposta.findFirst({
      where: { empresaId, tipo: def.tipo, isDefault: true, layoutJson: { not: null } } as never,
      select: { id: true },
    })
    await prisma.templateProposta.create({
      data: {
        empresaId,
        nome: def.nome,
        tipo: def.tipo,
        isDefault: !temDefault,
        config: {},
        layoutJson: def.layout as never,
      } as never,
    })
    criados += 1
  }

  return { criados, ignorados }
}
