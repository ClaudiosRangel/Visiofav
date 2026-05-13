import {
  ALL_CAMPOS,
  CampoFisico,
  FormatoEndereco,
  ValidacaoResultado,
} from './formato-endereco.types'

/**
 * Valida endereços na criação/edição conforme o formato configurado.
 *
 * Regras:
 * - Segmentos ativos (presentes no formato) devem estar preenchidos (não nulos, não vazios).
 * - Segmentos inativos (não presentes no formato) devem estar vazios ou nulos.
 */
export function validarEndereco(
  formato: FormatoEndereco,
  dados: Partial<Record<string, string | null>>
): ValidacaoResultado {
  const erros: Array<{ campo: string; mensagem: string }> = []

  // Determinar segmentos ativos (campos físicos presentes no formato)
  const camposAtivos = new Set<CampoFisico>(
    formato.segmentos.map((s) => s.campoFisico)
  )

  // Determinar segmentos inativos (todos os campos menos os ativos)
  const camposInativos = ALL_CAMPOS.filter((campo) => !camposAtivos.has(campo))

  // Verificar segmentos ativos: devem estar preenchidos
  const ativosVazios: string[] = []
  for (const campo of camposAtivos) {
    const valor = dados[campo]
    if (valor === null || valor === undefined || valor === '') {
      ativosVazios.push(campo)
    }
  }

  if (ativosVazios.length > 0) {
    erros.push({
      campo: ativosVazios.join(', '),
      mensagem: `Segmentos obrigatórios não preenchidos: ${ativosVazios.join(', ')}`,
    })
  }

  // Verificar segmentos inativos: devem estar vazios ou nulos
  const inativosPreenchidos: string[] = []
  for (const campo of camposInativos) {
    const valor = dados[campo]
    if (valor !== null && valor !== undefined && valor !== '') {
      inativosPreenchidos.push(campo)
    }
  }

  if (inativosPreenchidos.length > 0) {
    erros.push({
      campo: inativosPreenchidos.join(', '),
      mensagem: `Segmentos não pertencem ao formato: ${inativosPreenchidos.join(', ')}`,
    })
  }

  return {
    valido: erros.length === 0,
    erros,
  }
}
