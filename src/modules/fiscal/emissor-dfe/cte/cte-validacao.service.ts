/**
 * Validação pré-transmissão do CT-e
 * Verifica todos os campos obrigatórios antes de enviar à SEFAZ,
 * evitando transmissões desnecessárias com dados incompletos.
 */

import type { DadosCTe, DadosParticipanteCTe, EnderecoCTe } from './cte-xml-builder'

export interface ResultadoValidacao {
  valido: boolean
  erros: string[]
}

/**
 * Valida todos os campos obrigatórios do CT-e antes da transmissão.
 * Retorna lista de erros encontrados — se vazia, o CT-e está apto a transmitir.
 */
export function validarCTeParaTransmissao(dados: DadosCTe): ResultadoValidacao {
  const erros: string[] = []

  // === Emitente ===
  if (!dados.emitente.cnpj || dados.emitente.cnpj.replace(/\D/g, '').length !== 14) {
    erros.push('Emitente: CNPJ inválido ou não informado')
  }
  if (!dados.emitente.ie || dados.emitente.ie.trim() === '') {
    erros.push('Emitente: Inscrição Estadual não informada')
  }
  if (!dados.emitente.razaoSocial || dados.emitente.razaoSocial.trim() === '') {
    erros.push('Emitente: Razão Social não informada')
  }
  validarEndereco('Emitente', dados.emitente.endereco, erros, true)

  // === Remetente ===
  validarParticipante('Remetente', dados.remetente, erros)

  // === Destinatário ===
  validarParticipante('Destinatário', dados.destinatario, erros)

  // === Expedidor (se informado) ===
  if (dados.expedidor) {
    validarParticipante('Expedidor', dados.expedidor, erros)
  }

  // === Recebedor (se informado) ===
  if (dados.recebedor) {
    validarParticipante('Recebedor', dados.recebedor, erros)
  }

  // === Tomador Outros (tpTom=4) ===
  if (dados.tpTom === 4 && dados.tomadorOutros) {
    validarParticipante('Tomador (Outros)', dados.tomadorOutros, erros)
  } else if (dados.tpTom === 4 && !dados.tomadorOutros) {
    erros.push('Tomador: tipo "Outros" selecionado mas dados do tomador não informados')
  }

  // === Dados gerais do CT-e ===
  if (!dados.cfop || !/^\d{4}$/.test(dados.cfop)) {
    erros.push('CFOP inválido (deve ter 4 dígitos)')
  }
  if (!dados.naturezaOp || dados.naturezaOp.trim() === '') {
    erros.push('Natureza da operação não informada')
  }
  if (!dados.modal || !/^0[1-6]$/.test(dados.modal)) {
    erros.push('Modal de transporte inválido')
  }

  // === Municípios (início/fim/envio) ===
  if (!dados.cMunIni || !/^\d{7}$/.test(dados.cMunIni)) {
    erros.push('Código IBGE do município de início não informado ou inválido (deve ter 7 dígitos)')
  }
  if (!dados.xMunIni || dados.xMunIni.trim() === '') {
    erros.push('Nome do município de início não informado')
  }
  if (!dados.ufIni || dados.ufIni.trim().length !== 2) {
    erros.push('UF de início não informada')
  }
  if (!dados.cMunFim || !/^\d{7}$/.test(dados.cMunFim)) {
    erros.push('Código IBGE do município de fim não informado ou inválido (deve ter 7 dígitos)')
  }
  if (!dados.xMunFim || dados.xMunFim.trim() === '') {
    erros.push('Nome do município de fim não informado')
  }
  if (!dados.ufFim || dados.ufFim.trim().length !== 2) {
    erros.push('UF de fim não informada')
  }
  // cMunEnv = município do emitente (validado junto com endereço)

  // === Valor da prestação ===
  if (!dados.vPrest || dados.vPrest.vTPrest <= 0) {
    erros.push('Valor total da prestação deve ser maior que zero')
  }
  if (!dados.vPrest || dados.vPrest.vRec <= 0) {
    erros.push('Valor a receber deve ser maior que zero')
  }

  // === Informações da carga (CT-e Normal) ===
  if (dados.infCTeNorm) {
    const carga = dados.infCTeNorm.infCarga
    if (!carga) {
      erros.push('Informações da carga não preenchidas')
    } else {
      if (carga.vCarga < 0) {
        erros.push('Valor da carga inválido')
      }
      if (!carga.proPred || carga.proPred.trim() === '') {
        erros.push('Produto predominante da carga não informado')
      }
      if (!carga.infQ || carga.infQ.length === 0) {
        erros.push('Pelo menos uma informação de quantidade da carga é obrigatória (peso, volume, etc.)')
      }
    }

    // === Documentos originários ===
    const doc = dados.infCTeNorm.infDoc
    if (!doc) {
      erros.push('Informações de documentos não preenchidas')
    } else {
      const temNFe = doc.infNFe && doc.infNFe.length > 0
      const temOutros = doc.infOutros && doc.infOutros.length > 0
      if (!temNFe && !temOutros) {
        erros.push('Pelo menos uma NF-e referenciada ou um documento "Outros" é obrigatório')
      }
      // Validar chaves das NF-e
      if (doc.infNFe) {
        for (let i = 0; i < doc.infNFe.length; i++) {
          const nfe = doc.infNFe[i]
          if (!nfe.chave || !/^\d{44}$/.test(nfe.chave)) {
            erros.push(`NF-e #${i + 1}: chave de acesso inválida (deve ter 44 dígitos numéricos)`)
          }
        }
      }
    }

    // === Modal rodoviário (quando modal=01) ===
    if (dados.modal === '01') {
      const modal = dados.infCTeNorm.infModal
      if (!modal || !modal.RNTRC || modal.RNTRC.trim() === '') {
        erros.push('RNTRC é obrigatório para modal rodoviário')
      } else if (!/^\d{8}$/.test(modal.RNTRC.trim())) {
        erros.push('RNTRC inválido (deve ter 8 dígitos)')
      }
    }
  } else {
    erros.push('Informações do CT-e Normal (infCTeNorm) não preenchidas')
  }

  return { valido: erros.length === 0, erros }
}

// === Helpers ===

function validarParticipante(label: string, part: DadosParticipanteCTe, erros: string[]): void {
  const cnpj = part.cnpj?.replace(/\D/g, '') || ''
  const cpf = part.cpf?.replace(/\D/g, '') || ''

  if (cnpj.length !== 14 && cpf.length !== 11) {
    erros.push(`${label}: CNPJ (14 dígitos) ou CPF (11 dígitos) obrigatório`)
  }
  if (!part.razaoSocial || part.razaoSocial.trim() === '') {
    erros.push(`${label}: Razão Social não informada`)
  }
  validarEndereco(label, part.endereco, erros, false)
}

function validarEndereco(label: string, end: EnderecoCTe, erros: string[], exigeCep: boolean): void {
  if (!end) {
    erros.push(`${label}: endereço não informado`)
    return
  }
  if (!end.logradouro || end.logradouro.trim() === '') {
    erros.push(`${label}: logradouro não informado`)
  }
  if (!end.numero || end.numero.trim() === '') {
    erros.push(`${label}: número do endereço não informado`)
  }
  if (!end.bairro || end.bairro.trim() === '') {
    erros.push(`${label}: bairro não informado`)
  }
  if (!end.codigoMunicipio || !/^\d{7}$/.test(end.codigoMunicipio)) {
    erros.push(`${label}: código IBGE do município não informado ou inválido (deve ter 7 dígitos)`)
  }
  if (!end.municipio || end.municipio.trim() === '') {
    erros.push(`${label}: nome do município não informado`)
  }
  if (!end.uf || end.uf.trim().length !== 2) {
    erros.push(`${label}: UF não informada`)
  }
  if (exigeCep && (!end.cep || end.cep.replace(/\D/g, '').length !== 8)) {
    erros.push(`${label}: CEP não informado ou inválido (deve ter 8 dígitos)`)
  }
}
