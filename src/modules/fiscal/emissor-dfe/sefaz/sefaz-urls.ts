/**
 * Resolução de URLs dos webservices SEFAZ por UF e ambiente
 * Mapeamento data-driven de UFs autorizadoras e SVRS/SVAN
 * Inclui URLs de contingência SVC-AN e SVC-RS
 */

import { AmbienteSefaz, ServicoSefaz, type ModalidadeContingencia } from './tipos'

// === Tipos internos ===

type Ambiente = 'producao' | 'homologacao'

interface UrlsPorServico {
  [ServicoSefaz.AUTORIZACAO]: string
  [ServicoSefaz.RETORNO_AUTORIZACAO]: string
  [ServicoSefaz.CONSULTA_PROTOCOLO]: string
  [ServicoSefaz.STATUS_SERVICO]: string
  [ServicoSefaz.INUTILIZACAO]: string
  [ServicoSefaz.RECEPCAO_EVENTO]: string
  [ServicoSefaz.CONSULTA_CADASTRO]?: string
  // CT-e (opcional — preenchido no mapa de URLs CT-e)
  [ServicoSefaz.CTE_AUTORIZACAO]?: string
  [ServicoSefaz.CTE_RET_AUTORIZACAO]?: string
  [ServicoSefaz.CTE_RECEPCAO_EVENTO]?: string
  // MDF-e (opcional — preenchido no mapa de URLs MDF-e)
  [ServicoSefaz.MDFE_RECEPCAO]?: string
  [ServicoSefaz.MDFE_RET_RECEPCAO]?: string
  [ServicoSefaz.MDFE_RECEPCAO_EVENTO]?: string
  [ServicoSefaz.MDFE_CONSULTA]?: string
  // Index signature para permitir acesso genérico por ServicoSefaz
  [key: string]: string | undefined
}

interface UrlsPorAmbiente {
  producao: UrlsPorServico
  homologacao: UrlsPorServico
}

// === UFs autorizadoras (possuem webservice próprio) ===

const UFS_AUTORIZADORAS = ['SP', 'MG', 'BA', 'PR', 'RS', 'MT', 'MS', 'GO', 'PE'] as const

/**
 * UFs que utilizam SVRS (Sefaz Virtual do Rio Grande do Sul)
 * Todas as UFs que não possuem webservice próprio
 */
const UFS_SVRS = [
  'AC', 'AL', 'AP', 'CE', 'DF', 'ES', 'MA', 'PA',
  'PB', 'PI', 'RJ', 'RN', 'RO', 'RR', 'SC', 'SE', 'TO',
] as const

/**
 * UFs que utilizam SVAN (Sefaz Virtual do Ambiente Nacional)
 * MA e PA também podem usar SVAN em alguns contextos
 */
const UFS_SVAN = ['MA', 'PA'] as const

// === URLs das UFs Autorizadoras ===

const URLS_SP: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
  },
}

const URLS_MG: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
  },
}

const URLS_BA: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefaz.ba.gov.br/webservices/CadConsultaCadastro4/CadConsultaCadastro4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://hnfe.sefaz.ba.gov.br/webservices/CadConsultaCadastro4/CadConsultaCadastro4.asmx',
  },
}

const URLS_PR: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4',
  },
}

const URLS_RS: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://cad.sefazrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://cad.sefazrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  },
}

const URLS_MT: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/CadConsultaCadastro4',
  },
}

const URLS_MS: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeConsulta4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefaz.ms.gov.br/ws/NfeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefaz.ms.gov.br/ws/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeConsulta4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/NfeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://homologacao.nfe.sefaz.ms.gov.br/ws/CadConsultaCadastro4',
  },
}

const URLS_GO: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefaz.go.gov.br/nfe/services/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://homologacao.sefaz.go.gov.br/nfe/services/CadConsultaCadastro4',
  },
}

const URLS_PE: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/CadConsultaCadastro4',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/CadConsultaCadastro4',
  },
}

// === SVRS (Sefaz Virtual do Rio Grande do Sul) ===

const URLS_SVRS: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [ServicoSefaz.CONSULTA_CADASTRO]: 'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  },
}

// === SVC-AN (Sefaz Virtual de Contingência - Ambiente Nacional) ===
// Usado por UFs que normalmente utilizam SVRS

const URLS_SVC_AN: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://www.svc.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://www.svc.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://www.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://www.svc.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://www.svc.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://www.svc.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://hom.svc.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://hom.svc.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://hom.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://hom.svc.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://hom.svc.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://hom.svc.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
}

// === SVC-RS (Sefaz Virtual de Contingência - Rio Grande do Sul) ===
// Usado por UFs que possuem webservice próprio ou utilizam SVAN

const URLS_SVC_RS: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
}

// === Mapa de URLs por UF autorizadora ===

const MAPA_URLS_UF: Record<string, UrlsPorAmbiente> = {
  SP: URLS_SP,
  MG: URLS_MG,
  BA: URLS_BA,
  PR: URLS_PR,
  RS: URLS_RS,
  MT: URLS_MT,
  MS: URLS_MS,
  GO: URLS_GO,
  PE: URLS_PE,
}

/**
 * Determina se a UF é autorizadora própria
 */
export function isUfAutorizadora(uf: string): boolean {
  return UFS_AUTORIZADORAS.includes(uf as typeof UFS_AUTORIZADORAS[number])
}

/**
 * Determina se a UF utiliza SVAN
 */
export function isUfSvan(uf: string): boolean {
  return UFS_SVAN.includes(uf as typeof UFS_SVAN[number])
}

/**
 * Determina se a UF usa SVC-RS em contingência
 * UFs autorizadoras e SVAN usam SVC-RS
 */
function usaSvcRs(uf: string): boolean {
  return isUfAutorizadora(uf) || isUfSvan(uf)
}

/**
 * Converte o enum AmbienteSefaz para a chave do mapeamento
 */
function ambienteToKey(ambiente: AmbienteSefaz): Ambiente {
  return ambiente === AmbienteSefaz.PRODUCAO ? 'producao' : 'homologacao'
}

/**
 * Obtém as URLs do webservice para uma UF (sem contingência)
 */
function obterUrlsPorUf(uf: string): UrlsPorAmbiente {
  // UFs autorizadoras possuem webservice próprio
  if (MAPA_URLS_UF[uf]) {
    return MAPA_URLS_UF[uf]
  }
  // Demais UFs utilizam SVRS
  return URLS_SVRS
}

/**
 * Obtém as URLs de contingência baseado na UF
 */
function obterUrlsContingencia(uf: string, modalidade: ModalidadeContingencia): UrlsPorAmbiente | null {
  if (modalidade === 'SVC_AN') {
    return URLS_SVC_AN
  }
  if (modalidade === 'SVC_RS') {
    return URLS_SVC_RS
  }
  // FS_DA, EPEC e OFFLINE não usam webservice alternativo
  return null
}

/**
 * Resolve a URL do webservice SEFAZ para uma dada UF, serviço, ambiente e contingência.
 *
 * @param uf - Sigla da UF (ex: 'SP', 'RJ', 'AM')
 * @param servico - Serviço SEFAZ desejado (Autorização, Consulta, etc.)
 * @param ambiente - Ambiente de comunicação (Produção ou Homologação)
 * @param contingencia - Modalidade de contingência (opcional)
 * @returns URL do webservice
 * @throws Error se não for possível resolver a URL para os parâmetros
 */
export function obterUrlWebservice(
  uf: string,
  servico: ServicoSefaz,
  ambiente: AmbienteSefaz,
  contingencia?: ModalidadeContingencia,
): string {
  const ufNormalizada = uf.toUpperCase().trim()
  const chaveAmbiente = ambienteToKey(ambiente)

  // Se há contingência, usar URLs de contingência
  if (contingencia) {
    const urlsContingencia = obterUrlsContingencia(ufNormalizada, contingencia)
    if (!urlsContingencia) {
      throw new Error(
        `Modalidade de contingência '${contingencia}' não possui webservice alternativo. `
        + `Use SVC_AN ou SVC_RS para contingência via webservice.`,
      )
    }
    const url = urlsContingencia[chaveAmbiente][servico]
    if (!url) {
      throw new Error(
        `Serviço '${servico}' não disponível em contingência `
        + `'${contingencia}' no ambiente '${chaveAmbiente}'.`,
      )
    }
    return url
  }

  // Sem contingência: resolver URL pela UF
  const urlsPorAmbiente = obterUrlsPorUf(ufNormalizada)
  const url = urlsPorAmbiente[chaveAmbiente][servico]

  if (!url) {
    throw new Error(
      `Serviço '${servico}' não disponível para UF '${ufNormalizada}' `
      + `no ambiente '${chaveAmbiente}'.`,
    )
  }

  return url
}

/**
 * Determina a modalidade de contingência recomendada para uma UF.
 * - UFs autorizadoras e SVAN → SVC-RS
 * - UFs via SVRS → SVC-AN
 */
export function obterContingenciaRecomendada(uf: string): 'SVC_AN' | 'SVC_RS' {
  const ufNormalizada = uf.toUpperCase().trim()
  return usaSvcRs(ufNormalizada) ? 'SVC_RS' : 'SVC_AN'
}

/**
 * Lista todas as UFs autorizadoras
 */
export function listarUfsAutorizadoras(): readonly string[] {
  return UFS_AUTORIZADORAS
}

/**
 * Lista todas as UFs que utilizam SVRS
 */
export function listarUfsSvrs(): readonly string[] {
  return UFS_SVRS
}

// === URLs MDF-e (SVRS é autorizador nacional do MDF-e) ===

const URLS_MDFE: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRetRecepcao/MDFeRetRecepcao.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
    [ServicoSefaz.MDFE_RECEPCAO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.MDFE_RET_RECEPCAO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRetRecepcao/MDFeRetRecepcao.asmx',
    [ServicoSefaz.MDFE_RECEPCAO_EVENTO]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
    [ServicoSefaz.MDFE_CONSULTA]: 'https://mdfe.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRetRecepcao/MDFeRetRecepcao.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
    [ServicoSefaz.MDFE_RECEPCAO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcao/MDFeRecepcao.asmx',
    [ServicoSefaz.MDFE_RET_RECEPCAO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRetRecepcao/MDFeRetRecepcao.asmx',
    [ServicoSefaz.MDFE_RECEPCAO_EVENTO]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
    [ServicoSefaz.MDFE_CONSULTA]: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
  },
}

/**
 * Resolve URL de webservice MDF-e.
 * O MDF-e utiliza o SVRS como autorizador nacional para todas as UFs.
 */
export function obterUrlWebserviceMDFe(
  servico: ServicoSefaz,
  ambiente: AmbienteSefaz,
): string {
  const chaveAmbiente = ambienteToKey(ambiente)
  const url = URLS_MDFE[chaveAmbiente][servico]

  if (!url) {
    throw new Error(
      `Serviço '${servico}' não disponível para MDF-e no ambiente '${chaveAmbiente}'.`,
    )
  }

  return url
}

// === URLs CT-e (SVRS é autorizador nacional do CT-e) ===

const URLS_CTE: UrlsPorAmbiente = {
  producao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://cte.svrs.rs.gov.br/ws/CTeRetRecepcao/CTeRetRecepcao.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://cte.svrs.rs.gov.br/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.CTE_AUTORIZACAO]: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.CTE_RET_AUTORIZACAO]: 'https://cte.svrs.rs.gov.br/ws/CTeRetRecepcao/CTeRetRecepcao.asmx',
    [ServicoSefaz.CTE_RECEPCAO_EVENTO]: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
  },
  homologacao: {
    [ServicoSefaz.AUTORIZACAO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.RETORNO_AUTORIZACAO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRetRecepcao/CTeRetRecepcao.asmx',
    [ServicoSefaz.CONSULTA_PROTOCOLO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx',
    [ServicoSefaz.STATUS_SERVICO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx',
    [ServicoSefaz.RECEPCAO_EVENTO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
    [ServicoSefaz.INUTILIZACAO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.CTE_AUTORIZACAO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSinc/CTeRecepcaoSinc.asmx',
    [ServicoSefaz.CTE_RET_AUTORIZACAO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRetRecepcao/CTeRetRecepcao.asmx',
    [ServicoSefaz.CTE_RECEPCAO_EVENTO]: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
  },
}

/**
 * Resolve URL de webservice CT-e.
 * O CT-e utiliza o SVRS como autorizador nacional para todas as UFs.
 */
export function obterUrlWebserviceCTe(
  servico: ServicoSefaz,
  ambiente: AmbienteSefaz,
): string {
  const chaveAmbiente = ambienteToKey(ambiente)
  const url = URLS_CTE[chaveAmbiente][servico]

  if (!url) {
    throw new Error(
      `Serviço '${servico}' não disponível para CT-e no ambiente '${chaveAmbiente}'.`,
    )
  }

  return url
}
