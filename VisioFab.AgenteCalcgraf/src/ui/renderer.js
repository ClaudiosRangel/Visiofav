// @ts-check
/**
 * Renderer da tela do Agente Calcgraf (Tarefa 12) — JS PURO (sem build).
 *
 * Roda no contexto isolado do renderer (contextIsolation=true,
 * nodeIntegration=false). NÃO tem acesso a Node/filesystem — só fala com o
 * processo principal através de `window.agenteApi`, exposto pelo preload
 * (src/preload.ts) via contextBridge. Os canais IPC reais ficam escondidos
 * atrás dessa API tipada.
 *
 * Responsabilidades:
 *  - Carregar a config e preencher o formulário.
 *  - Salvar a config (os valores em claro vão para o main, que persiste cifrado).
 *  - Botão "Sincronizar agora" → chama agenteApi.sincronizarAgora() e mostra o
 *    painel de resultado (novas/alteradas/enviadas/pendentes/erros).
 *  - Assinar os eventos de resumo do segundo plano (onResumo) e atualizar o
 *    painel + o log em tempo real.
 *  - Renderizar o log (histórico de ciclos).
 */

/** Atalho para document.getElementById com narrow básico. */
function $(id) {
  return document.getElementById(id)
}

/** API segura exposta pelo preload. */
const api = /** @type {any} */ (window).agenteApi

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Preenche o formulário com a config atual. */
async function carregarConfig() {
  try {
    const cfg = await api.lerConfig()
    // Só sobrescreve o default do HTML quando há valor salvo (não vazio) — assim
    // os defaults sugeridos (connection string / URL / API key da Carton Wega)
    // aparecem na 1ª abertura, e a config que o usuário salvar prevalece depois.
    if (cfg.connectionStringSqlServer) $('connectionString').value = cfg.connectionStringSqlServer
    if (cfg.urlApiVizor) $('urlApiVizor').value = cfg.urlApiVizor
    if (cfg.apiKeyAgente) $('apiKeyAgente').value = cfg.apiKeyAgente
    if (cfg.intervaloSyncMinutos) $('intervaloSyncMinutos').value = String(cfg.intervaloSyncMinutos)
  } catch (e) {
    definirStatus('statusConfig', 'erro', 'Falha ao carregar configuração.')
  }
}

/** Salva o formulário de config. */
async function salvarConfig() {
  const btn = $('btnSalvar')
  btn.disabled = true
  definirStatus('statusConfig', '', 'Salvando…')
  try {
    const intervalo = parseInt($('intervaloSyncMinutos').value, 10)
    await api.salvarConfig({
      connectionStringSqlServer: $('connectionString').value.trim(),
      urlApiVizor: $('urlApiVizor').value.trim(),
      apiKeyAgente: $('apiKeyAgente').value.trim(),
      intervaloSyncMinutos: Number.isFinite(intervalo) && intervalo > 0 ? intervalo : 15,
    })
    definirStatus('statusConfig', 'ok', 'Configuração salva.')
  } catch (e) {
    definirStatus('statusConfig', 'erro', 'Falha ao salvar: ' + mensagemErro(e))
  } finally {
    btn.disabled = false
  }
}

// ---------------------------------------------------------------------------
// Sincronização + painel de resultado
// ---------------------------------------------------------------------------

/** Dispara a sincronização sob demanda. */
async function sincronizarAgora() {
  const btn = $('btnSincronizar')
  btn.disabled = true
  definirStatus('statusSync', '', 'Sincronizando…')
  try {
    const resumo = await api.sincronizarAgora()
    aplicarResumo(resumo)
    const temErro = resumo.erros > 0
    definirStatus(
      'statusSync',
      temErro ? 'erro' : 'ok',
      temErro ? 'Concluído com erros.' : 'Sincronização concluída.',
    )
  } catch (e) {
    definirStatus('statusSync', 'erro', 'Falha: ' + mensagemErro(e))
  } finally {
    btn.disabled = false
  }
}

/** Preenche o painel de contadores + a lista de erros a partir de um ResumoSync. */
function aplicarResumo(resumo) {
  $('cNovas').textContent = String(resumo.novas ?? 0)
  $('cAlteradas').textContent = String(resumo.alteradas ?? 0)
  $('cEnviadas').textContent = String(resumo.enviadas ?? 0)
  $('cPendentes').textContent = String(resumo.pendentes ?? 0)
  $('cErros').textContent = String(resumo.erros ?? 0)

  const lista = $('errosLista')
  const msgs = Array.isArray(resumo.mensagensErro) ? resumo.mensagensErro : []
  lista.textContent = msgs.length > 0 ? msgs.join('\n') : ''
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/** Renderiza o log completo (lista de entradas, mais recentes primeiro). */
function renderizarLog(entradas) {
  const el = $('log')
  if (!entradas || entradas.length === 0) {
    el.innerHTML = '<div class="vazio">Nenhum ciclo registrado ainda.</div>'
    return
  }
  el.innerHTML = ''
  for (const entrada of entradas) {
    el.appendChild(montarItemLog(entrada))
  }
}

/** Monta um item de log a partir de uma EntradaLog. */
function montarItemLog(entrada) {
  const div = document.createElement('div')
  div.className = 'log-item'

  const quando = document.createElement('span')
  quando.className = 'quando'
  quando.textContent = formatarHora(entrada.em)

  const msg = document.createElement('span')
  msg.className = 'msg'
  const tag = document.createElement('span')
  tag.className = 'tag ' + (entrada.origem === 'manual' ? 'manual' : 'segundo-plano')
  tag.textContent = entrada.origem === 'manual' ? 'Manual' : 'Automático'
  msg.appendChild(tag)
  msg.appendChild(document.createTextNode(resumirTexto(entrada.resumo)))

  div.appendChild(msg)
  div.appendChild(quando)
  return div
}

/** Texto curto de um resumo para a linha de log. */
function resumirTexto(r) {
  const partes = [
    `${r.novas ?? 0} nova(s)`,
    `${r.alteradas ?? 0} alterada(s)`,
    `${r.enviadas ?? 0} enviada(s)`,
    `${r.pendentes ?? 0} pendente(s)`,
    `${r.erros ?? 0} erro(s)`,
  ]
  return partes.join(' · ')
}

/** Carrega o log persistido do main. */
async function carregarLog() {
  try {
    const entradas = await api.lerLog()
    renderizarLog(entradas)
  } catch (e) {
    // silencioso — log é informativo
  }
}

/** Carrega e exibe a versão/fase do agente no cabeçalho (prova visual da versão). */
async function carregarVersao() {
  try {
    const info = await api.lerVersao()
    const badge = $('versaoBadge')
    if (badge) badge.textContent = 'v' + (info.versao || '?')
    const fase = $('faseInfo')
    if (fase) fase.textContent = info.trazRoteiro ? '✓ ' + info.fase : info.fase
  } catch (e) {
    // silencioso
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function definirStatus(id, classe, texto) {
  const el = $(id)
  el.className = 'status' + (classe ? ' ' + classe : '')
  el.textContent = texto
}

function mensagemErro(e) {
  if (!e) return 'erro desconhecido'
  if (typeof e === 'string') return e
  if (e && e.message) return e.message
  return String(e)
}

function formatarHora(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR')
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  if (!api) {
    document.body.innerHTML =
      '<p style="color:#dc2626;padding:24px">Erro: window.agenteApi indisponível (preload não carregado).</p>'
    return
  }

  $('btnSalvar').addEventListener('click', salvarConfig)
  $('btnSincronizar').addEventListener('click', sincronizarAgora)

  // Eventos de resumo do segundo plano: atualizam painel + log em tempo real.
  api.onResumo((entrada) => {
    aplicarResumo(entrada.resumo)
    carregarLog()
  })

  carregarVersao()
  carregarConfig()
  carregarLog()
})
