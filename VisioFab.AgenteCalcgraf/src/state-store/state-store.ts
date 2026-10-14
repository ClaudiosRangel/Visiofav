/**
 * Estado local da última sincronização (Tarefa 10 / Requisito 2.5).
 *
 * Persiste, por OP, o último hash enviado com sucesso ao Vizor e quando foi
 * enviado: `{ numero, hash, ultimoEnvioEm }`. É isso que torna a sincronização
 * INCREMENTAL — o `change-detector` compara o hash atual de cada OP com o hash
 * salvo aqui para classificar NOVA/ALTERADA/INALTERADA, e o scheduler
 * (Tarefa 11) só chama `registrarEnvio` DEPOIS do 2xx da API (nunca marca
 * enviado sem sucesso).
 *
 * Armazenamento: arquivo JSON em `%APPDATA%/VisioFabAgenteCalcgraf/state.json`,
 * reusando `obterDiretorioConfig()` do módulo `config` (mesmo diretório da
 * configuração do agente). NÃO há segredo no estado (só número da OP e hash de
 * conteúdo), portanto NÃO é cifrado — ao contrário dos segredos do `config.ts`.
 *
 * Sem dependência de Electron/Prisma: só `fs`/`path`. Testável como Node puro.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { obterDiretorioConfig } from '../config/config'

/** Registro de estado de UMA OP já sincronizada. */
export interface RegistroEstadoOp {
  /** Número da OP no Calcgraf (OpHeader.Numero) — chave de identidade. */
  numero: number
  /** Último hash de conteúdo enviado com sucesso ao Vizor. */
  hash: string
  /** Quando o envio bem-sucedido ocorreu (ISO string). */
  ultimoEnvioEm: string
}

/** Formato do arquivo `state.json` persistido. */
interface ArquivoEstado {
  /** Versão do formato do arquivo (permite migração futura). */
  versao: number
  /** Registros por número de OP. */
  ops: Record<string, RegistroEstadoOp>
}

const ARQUIVO_ESTADO = 'state.json'
const VERSAO_ATUAL = 1

/**
 * Estado local da sincronização.
 *
 * Uso típico:
 *   const estado = new EstadoLocal()   // carrega do disco no construtor
 *   const hash = estado.obterHash(3138) // consumido pelo change-detector
 *   // ... após 2xx da API:
 *   estado.registrarEnvio(3138, hashNovo) // marca enviado + persiste
 *
 * O construtor já carrega o arquivo (se existir). `registrarEnvio`/`remover`
 * persistem imediatamente (gravação atômica via arquivo temporário + rename),
 * mas também há `salvar()`/`carregar()` explícitos quando se quiser controlar o
 * momento da escrita (ex.: gravar uma vez ao fim de um lote).
 */
export class EstadoLocal {
  private ops: Map<number, RegistroEstadoOp> = new Map()
  private readonly caminhoArquivo: string

  /**
   * @param caminhoArquivo caminho do `state.json`. Default: dentro do diretório
   *   de config do agente (`%APPDATA%/VisioFabAgenteCalcgraf/state.json`).
   *   Parametrizável para testes.
   */
  constructor(caminhoArquivo?: string) {
    this.caminhoArquivo =
      caminhoArquivo ?? path.join(obterDiretorioConfig(), ARQUIVO_ESTADO)
    this.carregar()
  }

  /** Caminho absoluto do arquivo de estado em uso. */
  obterCaminhoArquivo(): string {
    return this.caminhoArquivo
  }

  /**
   * Hash salvo da última sincronização bem-sucedida de uma OP, ou `null` se a
   * OP nunca foi enviada. Consumido pelo `change-detector`.
   */
  obterHash(numero: number): string | null {
    const reg = this.ops.get(numero)
    return reg ? reg.hash : null
  }

  /** Registro completo de uma OP (hash + data), ou `null` se ausente. */
  obterRegistro(numero: number): RegistroEstadoOp | null {
    return this.ops.get(numero) ?? null
  }

  /** Todos os registros conhecidos (cópia; não expõe o Map interno). */
  listar(): RegistroEstadoOp[] {
    return [...this.ops.values()]
  }

  /**
   * Marca uma OP como enviada com sucesso: grava `{ numero, hash,
   * ultimoEnvioEm }` e persiste no disco. DEVE ser chamado só após o 2xx da API
   * (Tarefa 11) — nunca marcar enviado sem sucesso (Requisito 8.2).
   *
   * @param data data do envio (default: agora). Parametrizável para testes.
   */
  registrarEnvio(numero: number, hash: string, data: Date = new Date()): void {
    this.ops.set(numero, {
      numero,
      hash,
      ultimoEnvioEm: data.toISOString(),
    })
    this.salvar()
  }

  /** Remove o registro de uma OP (ex.: OP excluída na origem). Persiste. */
  remover(numero: number): void {
    if (this.ops.delete(numero)) {
      this.salvar()
    }
  }

  /** Esquece todo o estado (próxima sincronização reenviará tudo). Persiste. */
  limpar(): void {
    this.ops.clear()
    this.salvar()
  }

  /**
   * (Re)carrega o estado do disco, substituindo o estado em memória. Chamado no
   * construtor; exposto para recarga explícita. Arquivo ausente/corrompido →
   * estado vazio (não quebra o agente).
   */
  carregar(): void {
    this.ops = new Map()
    try {
      if (!fs.existsSync(this.caminhoArquivo)) return
      const bruto = fs.readFileSync(this.caminhoArquivo, 'utf8')
      const parsed = JSON.parse(bruto) as Partial<ArquivoEstado>
      const ops = parsed?.ops
      if (ops && typeof ops === 'object') {
        for (const chave of Object.keys(ops)) {
          const reg = ops[chave]
          if (
            reg &&
            typeof reg.numero === 'number' &&
            typeof reg.hash === 'string' &&
            typeof reg.ultimoEnvioEm === 'string'
          ) {
            this.ops.set(reg.numero, {
              numero: reg.numero,
              hash: reg.hash,
              ultimoEnvioEm: reg.ultimoEnvioEm,
            })
          }
        }
      }
    } catch (erro) {
      console.warn(
        '[state-store] falha ao ler/parsear state.json, iniciando com estado vazio:',
        erro,
      )
      this.ops = new Map()
    }
  }

  /**
   * Persiste o estado atual no disco. Gravação atômica: escreve num arquivo
   * temporário e renomeia por cima, evitando corromper o `state.json` se o
   * processo morrer no meio da escrita.
   */
  salvar(): void {
    this.garantirDiretorio()

    const arquivo: ArquivoEstado = {
      versao: VERSAO_ATUAL,
      ops: {},
    }
    for (const reg of this.ops.values()) {
      arquivo.ops[String(reg.numero)] = reg
    }

    const temporario = `${this.caminhoArquivo}.tmp`
    fs.writeFileSync(temporario, JSON.stringify(arquivo, null, 2), {
      encoding: 'utf8',
    })
    fs.renameSync(temporario, this.caminhoArquivo)
  }

  /** Garante que o diretório do arquivo de estado exista. */
  private garantirDiretorio(): void {
    const dir = path.dirname(this.caminhoArquivo)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}
