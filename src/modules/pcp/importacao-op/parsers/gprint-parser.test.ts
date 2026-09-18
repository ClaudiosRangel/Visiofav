import { describe, it, expect } from 'vitest'
import { parseGprintPdf } from './gprint-parser'

/**
 * Monta um texto sintético no mesmo formato reconstruído por
 * `pdf-extractor.service.ts` (linhas com múltiplos espaços entre colunas),
 * reproduzindo o trecho relevante de um PDF de OP GPrint real.
 */
function textoBaseComAcabamentos(secaoAcabamentos: string): string {
  return `
CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.452 R
GPrint - Sistema Calcgraf   09/01/2026   10:07   1ª via
Cliente:   FRESCATTO   Cód. Cliente:   776
Produto:   Cartuchos
Descrição:   CINTA LOMBO SALMÃO 500G ALFRESCO
Quantidade:   25.000
Impressão   Fixo   Variável
Offset Plana KBA Rapida 75 6cores   02:35   01:05
${secaoAcabamentos}
Materiais   Qtde.
Stora Enzo Bobina 290  337,34  KG
`.trim()
}

describe('parseGprintPdf — seção de Acabamentos', () => {
  it('extrai TODAS as etapas mesmo quando uma linha intermediária contém "obs." minúscula no meio da frase (bug real: OP-2452)', () => {
    // Reprodução literal do trecho problemático: a 3ª etapa ("Cortadeira
    // (Grande)") tem detalhe "Segue obs. de impressão" — a palavra "obs."
    // minúscula, sem dois-pontos, no meio do texto. Antes da correção, o
    // delimitador de fim de seção (`/Obs\./i` sem exigir ":") confundia essa
    // ocorrência com o marcador real de observações do documento e cortava
    // a seção ali, descartando Destacar/Guilhotina/Laminação maior/menor.
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem lateral  01:30  01:33',
      'Bobst S (Corte e Vi Normal Repetição  / Matriz: 1938B  00:30  01:00',
      'Cortadeira (Grande)  / Segue obs. de impressão  00:15  00:30',
      'Destacar  00:00  00:16',
      'Guilhotina maior  / Segue obs. de impressão  00:00  00:41',
      'Laminação maior / Plastificadora maior  / Laminação fosco frente  00:00  03:26',
      'Laminação menor / Plastificadora menor  / Laminação verso brilho  00:00  03:26',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    // 1 etapa de impressão + 7 etapas de acabamento = 8 no total
    expect(dados.etapas).toHaveLength(8)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('AFT70 (Coladeira) Lateral Simples')
    expect(descricoes).toContain('Bobst S (Corte e Vi Normal Repetição')
    expect(descricoes).toContain('Cortadeira (Grande)')
    expect(descricoes).toContain('Destacar')
    expect(descricoes).toContain('Guilhotina maior')
    expect(descricoes).toContain('Laminação maior')
    expect(descricoes).toContain('Laminação menor')
  })

  it('ainda respeita "Obs.:" (com dois-pontos) como delimitador real de fim de seção', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem lateral  01:30  01:33',
      'Obs.:   Colagem: caixa 022 com 1.500 unidades',
      'Guilhotina maior  00:00  00:41', // não deveria ser capturada — vem depois do delimitador real
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('AFT70 (Coladeira) Lateral Simples')
    expect(descricoes).not.toContain('Guilhotina maior')
  })

  it('extrai o tipo de colagem (texto após "/") nas etapas de COLAGEM', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem Lateral  01:30  03:14',
      'Cortadeira (Grande)  / 12.500 folhas 54,0 x 97,0 cm  00:15  03:56',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const colagem = dados.etapas.find((e) => e.tipo === 'COLAGEM')
    expect(colagem).toBeDefined()
    // Texto exato do PDF preservado
    expect(colagem?.tipoColagem).toBe('Colagem Lateral')

    // Etapas que não são de colagem não recebem tipoColagem
    const cortadeira = dados.etapas.find((e) => e.tipo === 'CORTADEIRA')
    expect(cortadeira?.tipoColagem).toBeNull()
  })

  it('extrai "Fundo Automático" como tipo de colagem', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Fundo Automático  / Fundo Automático  01:00  02:00',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const colagem = dados.etapas.find((e) => e.tipo === 'COLAGEM')
    expect(colagem?.tipoColagem).toBe('Fundo Automático')
  })

  it('não perde etapas quando não há nenhuma menção a "obs." nas linhas de acabamento', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'Destacar  00:00  00:16',
      'Guilhotina maior  00:00  00:41',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('Destacar')
    expect(descricoes).toContain('Guilhotina maior')
  })
})

describe('parseGprintPdf — descrição do produto (multi-linha)', () => {
  it('captura descrição de uma única linha (comportamento anterior preservado)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.965 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA   Cód. Cliente:   776',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHO DIGEVITA   Cód. Acabado:   4691',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   90.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe('CARTUCHO DIGEVITA')
  })

  it('concatena descrição que quebra em duas linhas (bug real: OP-2963 "SOLUÇÃO ORAL 50ML" na 2ª linha)', () => {
    // A 1ª linha traz descrição + "Cód. Acabado: 4694"; a 2ª linha ("SOLUÇÃO
    // ORAL 50ML") é continuação da descrição; a 3ª ("4688") é um código
    // acabado empilhado (não faz parte da descrição).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.963 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA   Cód. Cliente:   776',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS BROMOPRIDA / CLORIDRATO DE AMBROXOL 7,5ML  Cód. Acabado:   4694',
      'SOLUÇÃO ORAL 50ML',
      '4688',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   200.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe(
      'CARTUCHOS BROMOPRIDA / CLORIDRATO DE AMBROXOL 7,5ML SOLUÇÃO ORAL 50ML',
    )
  })

  it('concatena descrição de três linhas com múltiplos códigos acabados (imagem do cliente: NATIVITA Cartuchos)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.079 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS CLORIDRATO DE AMBROXOL INFANTIL /  Cód. Acabado:   1031707',
      'CARBOCISTEINA ADULTO / CARBOCISTEINA INFANTIL',
      '4471',
      '4472',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   200.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe(
      'CARTUCHOS CLORIDRATO DE AMBROXOL INFANTIL / CARBOCISTEINA ADULTO / CARBOCISTEINA INFANTIL',
    )
    // os 3 códigos acabados continuam sendo capturados
    expect(dados.cabecalho.codigosAcabados).toEqual(['1031707', '4471', '4472'])
  })

  it('para a descrição ao encontrar um novo rótulo de seção (não engole Formato/Quantidade)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.997 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   COMPACTOR',
      'Produto:   Cartuchos',
      'Descrição:   CAIXA KIT ESF. C1 VASCO   Cód. Acabado:   4735',
      'Formato Final:   76 x 76x146 mm',
      'Quantidade:   16.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe('CAIXA KIT ESF. C1 VASCO')
  })
})
