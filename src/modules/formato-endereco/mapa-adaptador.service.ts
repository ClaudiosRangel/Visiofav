/**
 * MapaAdaptadorService — Adapta a resposta do mapa do armazém
 * conforme o formato de endereço da zona.
 *
 * Determina o tipo de renderização e agrupa endereços para
 * visualização no mapa do armazém.
 */

import { FormatoEndereco, FormatoEnderecoSegmento } from './formato-endereco.types'

export interface MapaConfig {
  tipo: 'grade-4seg' | 'grade-3seg' | 'lista-2seg' | 'lista-1seg'
  agrupadorPrincipal?: string
  colunas?: string
  celulas?: string[]
  rotulos: Record<string, string>
}

export class MapaAdaptadorService {
  /**
   * Determina a configuração de renderização do mapa
   * baseado no número e tipo de segmentos do formato.
   *
   * - 4+ segmentos (Porta-palete): grade com Rua como agrupador, Prédio como colunas, Nível-Apto como células
   * - 3 segmentos (Blocado): grade com primeiro segmento como agrupador, demais como coordenadas
   * - 2 segmentos (Picking, Flow rack): lista agrupada pelo primeiro segmento, posições no segundo
   * - 1 segmento (Doca, Avaria): lista simples de posições
   */
  getMapaConfig(formato: FormatoEndereco): MapaConfig {
    const segmentos = [...formato.segmentos].sort((a, b) => a.ordem - b.ordem)
    const numSegmentos = segmentos.length

    const rotulos = this.gerarRotulos(segmentos)

    if (numSegmentos >= 4) {
      // Porta-palete: 3º segmento = agrupador (Rua), 4º = colunas (Prédio), restantes = células (Nível, Apto)
      const agrupador = segmentos[2].campoFisico
      const colunas = segmentos[3].campoFisico
      const celulas = segmentos.slice(4).map((s) => s.campoFisico)

      return {
        tipo: 'grade-4seg',
        agrupadorPrincipal: agrupador,
        colunas,
        celulas: celulas.length > 0 ? celulas : undefined,
        rotulos,
      }
    }

    if (numSegmentos === 3) {
      // Blocado: 1º segmento = agrupador, 2º e 3º = coordenadas da grade
      const agrupador = segmentos[0].campoFisico
      const colunas = segmentos[1].campoFisico
      const celulas = [segmentos[2].campoFisico]

      return {
        tipo: 'grade-3seg',
        agrupadorPrincipal: agrupador,
        colunas,
        celulas,
        rotulos,
      }
    }

    if (numSegmentos === 2) {
      // Picking, Flow rack: 1º segmento = agrupador, 2º = posições
      const agrupador = segmentos[0].campoFisico
      const colunas = segmentos[1].campoFisico

      return {
        tipo: 'lista-2seg',
        agrupadorPrincipal: agrupador,
        colunas,
        rotulos,
      }
    }

    // 1 segmento: Doca, Avaria — lista simples
    return {
      tipo: 'lista-1seg',
      rotulos,
    }
  }

  /**
   * Agrupa endereços conforme a configuração do mapa.
   *
   * Retorna estrutura agrupada adequada ao tipo de renderização:
   * - grade-4seg: { [agrupador]: { [coluna]: endereco[] } }
   * - grade-3seg: { [agrupador]: { [coluna]: endereco[] } }
   * - lista-2seg: { [agrupador]: endereco[] }
   * - lista-1seg: endereco[]
   */
  agruparEnderecos(
    enderecos: Record<string, any>[],
    config: MapaConfig,
    formato: FormatoEndereco,
  ): any {
    if (config.tipo === 'lista-1seg') {
      return enderecos
    }

    if (config.tipo === 'lista-2seg') {
      return this.agruparPorCampo(enderecos, config.agrupadorPrincipal!)
    }

    if (config.tipo === 'grade-3seg' || config.tipo === 'grade-4seg') {
      return this.agruparGrade(enderecos, config.agrupadorPrincipal!, config.colunas!)
    }

    return enderecos
  }

  /**
   * Gera rótulos a partir dos nomes dos segmentos do formato.
   * Mapeia o papel de cada segmento (agrupador, coluna, celula, posicao)
   * para o nome definido pelo usuário no formato.
   */
  private gerarRotulos(segmentos: FormatoEnderecoSegmento[]): Record<string, string> {
    const rotulos: Record<string, string> = {}

    for (const segmento of segmentos) {
      rotulos[segmento.campoFisico] = segmento.nome
    }

    return rotulos
  }

  /**
   * Agrupa endereços por um campo (nível 1).
   */
  private agruparPorCampo(
    enderecos: Record<string, any>[],
    campo: string,
  ): Record<string, Record<string, any>[]> {
    const grupos: Record<string, Record<string, any>[]> = {}

    for (const endereco of enderecos) {
      const chave = String(endereco[campo] ?? '')
      if (!grupos[chave]) {
        grupos[chave] = []
      }
      grupos[chave].push(endereco)
    }

    return grupos
  }

  /**
   * Agrupa endereços em grade (nível 2): agrupador → coluna → endereços.
   */
  private agruparGrade(
    enderecos: Record<string, any>[],
    agrupador: string,
    coluna: string,
  ): Record<string, Record<string, Record<string, any>[]>> {
    const grade: Record<string, Record<string, Record<string, any>[]>> = {}

    for (const endereco of enderecos) {
      const chaveGrupo = String(endereco[agrupador] ?? '')
      const chaveColuna = String(endereco[coluna] ?? '')

      if (!grade[chaveGrupo]) {
        grade[chaveGrupo] = {}
      }
      if (!grade[chaveGrupo][chaveColuna]) {
        grade[chaveGrupo][chaveColuna] = []
      }
      grade[chaveGrupo][chaveColuna].push(endereco)
    }

    return grade
  }
}
