import { describe, it, expect } from 'vitest'
import {
  obterUrlWebservice,
  obterContingenciaRecomendada,
  isUfAutorizadora,
  isUfSvan,
  listarUfsAutorizadoras,
  listarUfsSvrs,
} from './sefaz-urls'
import { AmbienteSefaz, ServicoSefaz } from './tipos'

describe('sefaz-urls', () => {
  describe('obterUrlWebservice', () => {
    describe('UFs autorizadoras - Produção', () => {
      it('retorna URL de SP para autorização em produção', () => {
        const url = obterUrlWebservice('SP', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toBe('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx')
      })

      it('retorna URL de MG para status em produção', () => {
        const url = obterUrlWebservice('MG', ServicoSefaz.STATUS_SERVICO, AmbienteSefaz.PRODUCAO)
        expect(url).toBe('https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4')
      })

      it('retorna URL de BA para consulta protocolo em produção', () => {
        const url = obterUrlWebservice('BA', ServicoSefaz.CONSULTA_PROTOCOLO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefaz.ba.gov.br')
      })

      it('retorna URL de PR para recepção evento em produção', () => {
        const url = obterUrlWebservice('PR', ServicoSefaz.RECEPCAO_EVENTO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefa.pr.gov.br')
      })

      it('retorna URL de RS para inutilização em produção', () => {
        const url = obterUrlWebservice('RS', ServicoSefaz.INUTILIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefazrs.rs.gov.br')
      })

      it('retorna URL de MT para autorização em produção', () => {
        const url = obterUrlWebservice('MT', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefaz.mt.gov.br')
      })

      it('retorna URL de MS para autorização em produção', () => {
        const url = obterUrlWebservice('MS', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefaz.ms.gov.br')
      })

      it('retorna URL de GO para autorização em produção', () => {
        const url = obterUrlWebservice('GO', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefaz.go.gov.br')
      })

      it('retorna URL de PE para autorização em produção', () => {
        const url = obterUrlWebservice('PE', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.sefaz.pe.gov.br')
      })
    })

    describe('UFs autorizadoras - Homologação', () => {
      it('retorna URL de SP para autorização em homologação', () => {
        const url = obterUrlWebservice('SP', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO)
        expect(url).toContain('homologacao.nfe.fazenda.sp.gov.br')
      })

      it('retorna URL de MG para autorização em homologação', () => {
        const url = obterUrlWebservice('MG', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO)
        expect(url).toContain('hnfe.fazenda.mg.gov.br')
      })

      it('retorna URL de PR para autorização em homologação', () => {
        const url = obterUrlWebservice('PR', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO)
        expect(url).toContain('homologacao.nfe.sefa.pr.gov.br')
      })
    })

    describe('UFs via SVRS', () => {
      it('retorna URL SVRS para RJ em produção', () => {
        const url = obterUrlWebservice('RJ', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.svrs.rs.gov.br')
      })

      it('retorna URL SVRS para SC em produção', () => {
        const url = obterUrlWebservice('SC', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.svrs.rs.gov.br')
      })

      it('retorna URL SVRS para CE em homologação', () => {
        const url = obterUrlWebservice('CE', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO)
        expect(url).toContain('nfe-homologacao.svrs.rs.gov.br')
      })

      it('retorna URL SVRS para AM em produção', () => {
        const url = obterUrlWebservice('AM', ServicoSefaz.STATUS_SERVICO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.svrs.rs.gov.br')
      })

      it('retorna URL SVRS para DF em produção', () => {
        const url = obterUrlWebservice('DF', ServicoSefaz.CONSULTA_PROTOCOLO, AmbienteSefaz.PRODUCAO)
        expect(url).toContain('nfe.svrs.rs.gov.br')
      })
    })

    describe('Contingência SVC-AN', () => {
      it('retorna URL SVC-AN para RJ (usa SVRS normalmente)', () => {
        const url = obterUrlWebservice('RJ', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO, 'SVC_AN')
        expect(url).toContain('www.svc.fazenda.gov.br')
      })

      it('retorna URL SVC-AN em homologação', () => {
        const url = obterUrlWebservice('SC', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO, 'SVC_AN')
        expect(url).toContain('hom.svc.fazenda.gov.br')
      })
    })

    describe('Contingência SVC-RS', () => {
      it('retorna URL SVC-RS para SP (autorizadora)', () => {
        const url = obterUrlWebservice('SP', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO, 'SVC_RS')
        expect(url).toContain('nfe.svrs.rs.gov.br')
      })

      it('retorna URL SVC-RS para MG em homologação', () => {
        const url = obterUrlWebservice('MG', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.HOMOLOGACAO, 'SVC_RS')
        expect(url).toContain('nfe-homologacao.svrs.rs.gov.br')
      })
    })

    describe('Contingência inválida', () => {
      it('lança erro para contingência FS_DA (sem webservice)', () => {
        expect(() =>
          obterUrlWebservice('SP', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO, 'FS_DA'),
        ).toThrow(/não possui webservice alternativo/)
      })

      it('lança erro para contingência OFFLINE', () => {
        expect(() =>
          obterUrlWebservice('SP', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO, 'OFFLINE'),
        ).toThrow(/não possui webservice alternativo/)
      })
    })

    describe('Normalização de UF', () => {
      it('aceita UF em minúsculo', () => {
        const url = obterUrlWebservice('sp', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toBe('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx')
      })

      it('aceita UF com espaços', () => {
        const url = obterUrlWebservice(' SP ', ServicoSefaz.AUTORIZACAO, AmbienteSefaz.PRODUCAO)
        expect(url).toBe('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx')
      })
    })

    describe('Todos os serviços disponíveis para UF autorizadora', () => {
      const servicosPrincipais = [
        ServicoSefaz.AUTORIZACAO,
        ServicoSefaz.RETORNO_AUTORIZACAO,
        ServicoSefaz.CONSULTA_PROTOCOLO,
        ServicoSefaz.STATUS_SERVICO,
        ServicoSefaz.INUTILIZACAO,
        ServicoSefaz.RECEPCAO_EVENTO,
      ]

      servicosPrincipais.forEach((servico) => {
        it(`SP produção tem URL para ${servico}`, () => {
          const url = obterUrlWebservice('SP', servico, AmbienteSefaz.PRODUCAO)
          expect(url).toBeTruthy()
          expect(url.startsWith('https://')).toBe(true)
        })
      })
    })
  })

  describe('obterContingenciaRecomendada', () => {
    it('recomenda SVC-RS para UFs autorizadoras', () => {
      expect(obterContingenciaRecomendada('SP')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('MG')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('BA')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('PR')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('RS')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('MT')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('MS')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('GO')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('PE')).toBe('SVC_RS')
    })

    it('recomenda SVC-RS para UFs SVAN (MA, PA)', () => {
      expect(obterContingenciaRecomendada('MA')).toBe('SVC_RS')
      expect(obterContingenciaRecomendada('PA')).toBe('SVC_RS')
    })

    it('recomenda SVC-AN para UFs via SVRS', () => {
      expect(obterContingenciaRecomendada('RJ')).toBe('SVC_AN')
      expect(obterContingenciaRecomendada('SC')).toBe('SVC_AN')
      expect(obterContingenciaRecomendada('CE')).toBe('SVC_AN')
      expect(obterContingenciaRecomendada('DF')).toBe('SVC_AN')
    })
  })

  describe('isUfAutorizadora', () => {
    it('retorna true para UFs autorizadoras', () => {
      expect(isUfAutorizadora('SP')).toBe(true)
      expect(isUfAutorizadora('MG')).toBe(true)
      expect(isUfAutorizadora('PE')).toBe(true)
    })

    it('retorna false para UFs não-autorizadoras', () => {
      expect(isUfAutorizadora('RJ')).toBe(false)
      expect(isUfAutorizadora('SC')).toBe(false)
      expect(isUfAutorizadora('AM')).toBe(false)
    })
  })

  describe('isUfSvan', () => {
    it('retorna true para MA e PA', () => {
      expect(isUfSvan('MA')).toBe(true)
      expect(isUfSvan('PA')).toBe(true)
    })

    it('retorna false para demais UFs', () => {
      expect(isUfSvan('SP')).toBe(false)
      expect(isUfSvan('RJ')).toBe(false)
    })
  })

  describe('listarUfsAutorizadoras', () => {
    it('lista 9 UFs autorizadoras', () => {
      const ufs = listarUfsAutorizadoras()
      expect(ufs).toHaveLength(9)
      expect(ufs).toContain('SP')
      expect(ufs).toContain('MG')
      expect(ufs).toContain('BA')
      expect(ufs).toContain('PR')
      expect(ufs).toContain('RS')
      expect(ufs).toContain('MT')
      expect(ufs).toContain('MS')
      expect(ufs).toContain('GO')
      expect(ufs).toContain('PE')
    })
  })

  describe('listarUfsSvrs', () => {
    it('lista UFs que utilizam SVRS', () => {
      const ufs = listarUfsSvrs()
      expect(ufs.length).toBeGreaterThan(0)
      expect(ufs).toContain('RJ')
      expect(ufs).toContain('SC')
      expect(ufs).toContain('CE')
      expect(ufs).not.toContain('SP')
      expect(ufs).not.toContain('MG')
    })
  })
})
