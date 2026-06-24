# SSE Events — Módulo Pátio

Documentação dos eventos Server-Sent Events (SSE) emitidos pelo backend para consumo do frontend em tempo real.

## Endpoint de Conexão

```
GET /api/patio/sse
```

- **Autenticação**: Token JWT obrigatório (header `Authorization: Bearer <token>`)
- **Escopo**: Eventos são filtrados por `empresaId` do usuário autenticado
- **Headers de resposta**: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- **Keepalive**: O servidor envia `: keepalive\n\n` a cada 30 segundos para detectar conexões inativas

---

## Eventos

### 1. `chamada-doca`

Emitido quando um veículo é chamado para uma doca. O frontend deve exibir uma **notificação/toast** em destaque.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `veiculoId` | `string (uuid)` | ID do veículo chamado |
| `placa` | `string` | Placa do veículo (ex: `ABC1234` ou `ABC1D23`) |
| `docaId` | `string (uuid)` | ID da doca de destino |
| `docaDescricao` | `string` | Nome/descrição da doca (ex: "Doca 03") |

**Origem no backend**: `chamada-doca.service.ts` → método `emitirChamada()` (após commit da transação)

**Comportamento esperado no frontend**:
- Exibir notificação/toast: **"Veículo [placa] chamado para doca [docaDescricao]"**
- Atualizar status do veículo no painel de fila para "CHAMADO"
- Opcionalmente reproduzir alerta sonoro

**Exemplo de payload SSE**:
```
event: chamada-doca
data: {"veiculoId":"a1b2c3d4-...","placa":"ABC1D23","docaId":"e5f6g7h8-...","docaDescricao":"Doca 03"}
```

---

### 2. `doca-liberada`

Emitido quando um veículo é liberado de uma doca (conferência concluída e veículo saiu). O frontend deve atualizar o status da doca para disponível.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `docaId` | `string (uuid)` | ID da doca que foi liberada |
| `veiculoId` | `string (uuid)` | ID do veículo que foi liberado |

**Origem no backend**: `patio.service.ts` → método `liberarVeiculo()` (após commit da transação)

**Comportamento esperado no frontend**:
- Atualizar visualização da doca para "disponível" (cor verde / ícone de livre)
- Remover veículo da lista de "Docas Ocupadas"
- Mover veículo para histórico / lista de liberados
- Recalcular métrica de "docas disponíveis" no painel

**Exemplo de payload SSE**:
```
event: doca-liberada
data: {"docaId":"e5f6g7h8-...","veiculoId":"a1b2c3d4-..."}
```

---

### 3. `alerta-permanencia`

Emitido periodicamente pelo `PatioWorker` quando um veículo excede o tempo limite de permanência configurado em `ConfigPatio.limitePermMinutos`. O frontend deve aplicar **destaque visual de alerta** (vermelho/warning) no card do veículo no painel.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `veiculoId` | `string (uuid)` | ID do veículo com permanência excessiva |
| `placa` | `string` | Placa do veículo |
| `docaId` | `string (uuid)` | ID da doca onde o veículo está |
| `minutosDecorridos` | `number` | Minutos totais desde a chegada na doca |

**Origem no backend**: `patio.worker.ts` → ciclo periódico de verificação de permanência

**Comportamento esperado no frontend**:
- Destacar o card do veículo com estilo **vermelho/warning** no painel de docas ocupadas
- Exibir badge ou indicador com o tempo decorrido: "⚠️ [minutosDecorridos] min na doca"
- O alerta pode ser re-emitido a cada ciclo do worker enquanto o veículo continuar excedendo o limite
- Opcionalmente mostrar notificação toast para o coordenador

**Exemplo de payload SSE**:
```
event: alerta-permanencia
data: {"veiculoId":"a1b2c3d4-...","placa":"XYZ9876","docaId":"e5f6g7h8-...","minutosDecorridos":45}
```

---

### 4. `chamada-expirada`

Emitido quando uma chamada de doca expira (veículo não compareceu dentro do tempo configurado). O frontend deve exibir aviso de expiração.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `chamadaId` | `string (uuid)` | ID da chamada que expirou |
| `veiculoId` | `string (uuid)` | ID do veículo que não atendeu |

**Origem no backend**: A ser emitido pelo `PatioWorker` ou `ChamadaDocaService` quando `chamadaDocaEm + limitePermMinutos < agora` e ChamadaDoca.status ainda é CHAMADO.

> ⚠️ **Nota**: Este evento está definido no tipo `SseEventType` mas sua emissão automática ainda não está implementada. O coordenador pode manualmente cancelar chamadas expiradas via `PATCH /api/patio/chamada-doca/:id/cancelar`.

**Comportamento esperado no frontend**:
- Exibir notificação: "Chamada expirada — veículo não compareceu"
- Atualizar status visual do veículo de "CHAMADO" para indicar expiração
- Habilitar botões de ação: "Re-chamar" ou "Cancelar chamada"

**Exemplo de payload SSE**:
```
event: chamada-expirada
data: {"chamadaId":"x9y8z7w6-...","veiculoId":"a1b2c3d4-..."}
```

---

## Integração com Painel Operacional

O endpoint `GET /api/painel-operacional?cdId=<uuid>` fornece o estado inicial da tela. Os eventos SSE acima atualizam o painel em tempo real sem necessidade de polling:

| Evento SSE | Efeito no Painel |
|------------|------------------|
| `chamada-doca` | Toast de notificação + atualizar status veículo na fila |
| `doca-liberada` | Mover doca para "disponível", habilitar nova sugestão |
| `alerta-permanencia` | Destacar card do veículo em vermelho/warning |
| `chamada-expirada` | Mostrar aviso de expiração + habilitar ações |

### Fluxo de Uso Recomendado

1. Frontend conecta em `GET /api/patio/sse` ao carregar o painel
2. Frontend busca estado inicial via `GET /api/painel-operacional?cdId=...`
3. Eventos SSE atualizam o estado local em tempo real
4. Em caso de reconexão, re-buscar estado via endpoint REST para sincronizar

---

## Notas Técnicas

- Eventos SSE são emitidos **após o commit** da transação no banco — nunca dentro da transação
- Se o write SSE falhar (cliente desconectado), a conexão é removida silenciosamente sem afetar a operação
- Formato SSE padrão: `event: <tipo>\ndata: <json>\n\n`
- O SseService é singleton (`src/modules/patio/sse.service.ts`) e gerencia conexões por `empresaId`
