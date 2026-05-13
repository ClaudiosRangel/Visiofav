import { describe, it, expect } from 'vitest'
import { MapaAdaptadorService, MapaConfig } from './mapa-adaptador.service'
import { FormatoEndereco } from './formato-endereco.types'

describe('MapaAdaptadorService', () => {
  const service = new MapaAdaptadorService()

  // Formato Porta-palete (6 segmentos)
  const formatoPortaPalete: FormatoEndereco = {
    id: '1',
    nome: 'Porta-palete',
    segmentos: [
      { nome: 'Depósito', campoFisico: 'codigoDeposito', ordem: 1, numerico: true },
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 2, numerico: true },
      { nome: 'Rua', campoFisico: 'codigoRua', ordem: 3, numerico: true },
      { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 4, numerico: true },
      { nome: 'Nível', campoFisico: 'codigoNivel', ordem: 5, numerico: true },
      { nome: 'Apto', campoFisico: 'codigoApto', ordem: 6, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato Blocado (3 segmentos)
  const formatoBlocado: FormatoEndereco = {
    id: '2',
    nome: 'Blocado',
    segmentos: [
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },
      { nome: 'Fileira', campoFisico: 'codigoRua', ordem: 2, numerico: true },
      { nome: 'Coluna', campoFisico: 'codigoPredio', ordem: 3, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato Picking de chão (2 segmentos)
  const formatoPicking: FormatoEndereco = {
    id: '3',
    nome: 'Picking de chão',
    segmentos: [
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },
      { nome: 'Posição', campoFisico: 'codigoRua', ordem: 2, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato Flow rack (2 segmentos)
  const formatoFlowRack: FormatoEndereco = {
    id: '4',
    nome: 'Flow rack',
    segmentos: [
      { nome: 'Corredor', campoFisico: 'codigoRua', ordem: 1, numerico: true },
      { nome: 'Posição', campoFisico: 'codigoPredio', ordem: 2, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato Doca (1 segmento)
  const formatoDoca: FormatoEndereco = {
    id: '5',
    nome: 'Doca',
    segmentos: [
      { nome: 'Código', campoFisico: 'codigoRua', ordem: 1, numerico: true, prefixo: 'DOCA' },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato Avaria (1 segmento)
  const formatoAvaria: FormatoEndereco = {
    id: '6',
    nome: 'Área de avaria',
    segmentos: [
      { nome: 'Código', campoFisico: 'codigoRua', ordem: 1, numerico: true, prefixo: 'AVARIA' },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  // Formato 4 segmentos (sem Depósito e Zona)
  const formato4Seg: FormatoEndereco = {
    id: '7',
    nome: 'Porta-palete simplificado',
    segmentos: [
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },
      { nome: 'Rua', campoFisico: 'codigoRua', ordem: 2, numerico: true },
      { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 3, numerico: true },
      { nome: 'Nível', campoFisico: 'codigoNivel', ordem: 4, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  describe('getMapaConfig', () => {
    describe('4+ segmentos (Porta-palete)', () => {
      it('retorna tipo grade-4seg para formato com 6 segmentos', () => {
        const config = service.getMapaConfig(formatoPortaPalete)
        expect(config.tipo).toBe('grade-4seg')
      })

      it('usa 3º segmento (Rua) como agrupador principal', () => {
        const config = service.getMapaConfig(formatoPortaPalete)
        expect(config.agrupadorPrincipal).toBe('codigoRua')
      })

      it('usa 4º segmento (Prédio) como colunas', () => {
        const config = service.getMapaConfig(formatoPortaPalete)
        expect(config.colunas).toBe('codigoPredio')
      })

      it('usa segmentos restantes (Nível, Apto) como células', () => {
        const config = service.getMapaConfig(formatoPortaPalete)
        expect(config.celulas).toEqual(['codigoNivel', 'codigoApto'])
      })

      it('retorna tipo grade-4seg para formato com exatamente 4 segmentos', () => {
        const config = service.getMapaConfig(formato4Seg)
        expect(config.tipo).toBe('grade-4seg')
        expect(config.agrupadorPrincipal).toBe('codigoPredio')
        expect(config.colunas).toBe('codigoNivel')
      })

      it('gera rótulos corretos para porta-palete', () => {
        const config = service.getMapaConfig(formatoPortaPalete)
        expect(config.rotulos).toEqual({
          codigoDeposito: 'Depósito',
          codigoZona: 'Zona',
          codigoRua: 'Rua',
          codigoPredio: 'Prédio',
          codigoNivel: 'Nível',
          codigoApto: 'Apto',
        })
      })
    })

    describe('3 segmentos (Blocado)', () => {
      it('retorna tipo grade-3seg para formato com 3 segmentos', () => {
        const config = service.getMapaConfig(formatoBlocado)
        expect(config.tipo).toBe('grade-3seg')
      })

      it('usa primeiro segmento como agrupador principal', () => {
        const config = service.getMapaConfig(formatoBlocado)
        expect(config.agrupadorPrincipal).toBe('codigoZona')
      })

      it('usa segundo segmento como colunas', () => {
        const config = service.getMapaConfig(formatoBlocado)
        expect(config.colunas).toBe('codigoRua')
      })

      it('usa terceiro segmento como células', () => {
        const config = service.getMapaConfig(formatoBlocado)
        expect(config.celulas).toEqual(['codigoPredio'])
      })

      it('gera rótulos corretos para blocado', () => {
        const config = service.getMapaConfig(formatoBlocado)
        expect(config.rotulos).toEqual({
          codigoZona: 'Zona',
          codigoRua: 'Fileira',
          codigoPredio: 'Coluna',
        })
      })
    })

    describe('2 segmentos (Picking, Flow rack)', () => {
      it('retorna tipo lista-2seg para formato com 2 segmentos', () => {
        const config = service.getMapaConfig(formatoPicking)
        expect(config.tipo).toBe('lista-2seg')
      })

      it('usa primeiro segmento como agrupador principal', () => {
        const config = service.getMapaConfig(formatoPicking)
        expect(config.agrupadorPrincipal).toBe('codigoZona')
      })

      it('usa segundo segmento como colunas (posições)', () => {
        const config = service.getMapaConfig(formatoPicking)
        expect(config.colunas).toBe('codigoRua')
      })

      it('não define células para lista-2seg', () => {
        const config = service.getMapaConfig(formatoPicking)
        expect(config.celulas).toBeUndefined()
      })

      it('gera rótulos corretos para picking', () => {
        const config = service.getMapaConfig(formatoPicking)
        expect(config.rotulos).toEqual({
          codigoZona: 'Zona',
          codigoRua: 'Posição',
        })
      })

      it('funciona para flow rack com segmentos diferentes', () => {
        const config = service.getMapaConfig(formatoFlowRack)
        expect(config.tipo).toBe('lista-2seg')
        expect(config.agrupadorPrincipal).toBe('codigoRua')
        expect(config.colunas).toBe('codigoPredio')
        expect(config.rotulos).toEqual({
          codigoRua: 'Corredor',
          codigoPredio: 'Posição',
        })
      })
    })

    describe('1 segmento (Doca, Avaria)', () => {
      it('retorna tipo lista-1seg para formato com 1 segmento', () => {
        const config = service.getMapaConfig(formatoDoca)
        expect(config.tipo).toBe('lista-1seg')
      })

      it('não define agrupador para lista-1seg', () => {
        const config = service.getMapaConfig(formatoDoca)
        expect(config.agrupadorPrincipal).toBeUndefined()
      })

      it('não define colunas para lista-1seg', () => {
        const config = service.getMapaConfig(formatoDoca)
        expect(config.colunas).toBeUndefined()
      })

      it('não define células para lista-1seg', () => {
        const config = service.getMapaConfig(formatoDoca)
        expect(config.celulas).toBeUndefined()
      })

      it('gera rótulos corretos para doca', () => {
        const config = service.getMapaConfig(formatoDoca)
        expect(config.rotulos).toEqual({
          codigoRua: 'Código',
        })
      })

      it('gera rótulos corretos para avaria', () => {
        const config = service.getMapaConfig(formatoAvaria)
        expect(config.rotulos).toEqual({
          codigoRua: 'Código',
        })
      })
    })

    describe('rótulos correspondem aos nomes dos segmentos', () => {
      it('todos os segmentos do formato aparecem nos rótulos', () => {
        const formatos = [
          formatoPortaPalete,
          formatoBlocado,
          formatoPicking,
          formatoFlowRack,
          formatoDoca,
          formatoAvaria,
        ]

        for (const formato of formatos) {
          const config = service.getMapaConfig(formato)
          for (const segmento of formato.segmentos) {
            expect(config.rotulos[segmento.campoFisico]).toBe(segmento.nome)
          }
        }
      })
    })
  })

  describe('agruparEnderecos', () => {
    const enderecosPortaPalete = [
      { codigoDeposito: '001', codigoZona: '001', codigoRua: '001', codigoPredio: '001', codigoNivel: '001', codigoApto: '001', enderecoCompleto: '001-001-001-001-001-001' },
      { codigoDeposito: '001', codigoZona: '001', codigoRua: '001', codigoPredio: '001', codigoNivel: '002', codigoApto: '001', enderecoCompleto: '001-001-001-001-002-001' },
      { codigoDeposito: '001', codigoZona: '001', codigoRua: '001', codigoPredio: '002', codigoNivel: '001', codigoApto: '001', enderecoCompleto: '001-001-001-002-001-001' },
      { codigoDeposito: '001', codigoZona: '001', codigoRua: '002', codigoPredio: '001', codigoNivel: '001', codigoApto: '001', enderecoCompleto: '001-001-002-001-001-001' },
    ]

    const enderecosPicking = [
      { codigoZona: '001', codigoRua: '001', enderecoCompleto: '001-001' },
      { codigoZona: '001', codigoRua: '002', enderecoCompleto: '001-002' },
      { codigoZona: '002', codigoRua: '001', enderecoCompleto: '002-001' },
    ]

    const enderecosDoca = [
      { codigoRua: 'DOCA001', enderecoCompleto: 'DOCA001' },
      { codigoRua: 'DOCA002', enderecoCompleto: 'DOCA002' },
      { codigoRua: 'DOCA003', enderecoCompleto: 'DOCA003' },
    ]

    const enderecosBlocado = [
      { codigoZona: '001', codigoRua: '001', codigoPredio: '001', enderecoCompleto: '001-001-001' },
      { codigoZona: '001', codigoRua: '001', codigoPredio: '002', enderecoCompleto: '001-001-002' },
      { codigoZona: '001', codigoRua: '002', codigoPredio: '001', enderecoCompleto: '001-002-001' },
      { codigoZona: '002', codigoRua: '001', codigoPredio: '001', enderecoCompleto: '002-001-001' },
    ]

    it('agrupa endereços em grade para porta-palete (4+ seg)', () => {
      const config = service.getMapaConfig(formatoPortaPalete)
      const resultado = service.agruparEnderecos(enderecosPortaPalete, config, formatoPortaPalete)

      // Agrupado por Rua (codigoRua) → Prédio (codigoPredio)
      expect(resultado['001']['001']).toHaveLength(2) // Rua 001, Prédio 001 → 2 endereços
      expect(resultado['001']['002']).toHaveLength(1) // Rua 001, Prédio 002 → 1 endereço
      expect(resultado['002']['001']).toHaveLength(1) // Rua 002, Prédio 001 → 1 endereço
    })

    it('agrupa endereços em grade para blocado (3 seg)', () => {
      const config = service.getMapaConfig(formatoBlocado)
      const resultado = service.agruparEnderecos(enderecosBlocado, config, formatoBlocado)

      // Agrupado por Zona (codigoZona) → Fileira (codigoRua)
      expect(resultado['001']['001']).toHaveLength(2) // Zona 001, Fileira 001 → 2 endereços
      expect(resultado['001']['002']).toHaveLength(1) // Zona 001, Fileira 002 → 1 endereço
      expect(resultado['002']['001']).toHaveLength(1) // Zona 002, Fileira 001 → 1 endereço
    })

    it('agrupa endereços por primeiro segmento para picking (2 seg)', () => {
      const config = service.getMapaConfig(formatoPicking)
      const resultado = service.agruparEnderecos(enderecosPicking, config, formatoPicking)

      // Agrupado por Zona (codigoZona)
      expect(resultado['001']).toHaveLength(2)
      expect(resultado['002']).toHaveLength(1)
    })

    it('retorna lista simples para doca (1 seg)', () => {
      const config = service.getMapaConfig(formatoDoca)
      const resultado = service.agruparEnderecos(enderecosDoca, config, formatoDoca)

      // Lista simples — retorna o array original
      expect(resultado).toEqual(enderecosDoca)
      expect(resultado).toHaveLength(3)
    })

    it('retorna array vazio quando não há endereços', () => {
      const config = service.getMapaConfig(formatoDoca)
      const resultado = service.agruparEnderecos([], config, formatoDoca)
      expect(resultado).toEqual([])
    })

    it('retorna objeto vazio quando não há endereços para lista-2seg', () => {
      const config = service.getMapaConfig(formatoPicking)
      const resultado = service.agruparEnderecos([], config, formatoPicking)
      expect(resultado).toEqual({})
    })
  })
})
