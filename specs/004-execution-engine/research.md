# Research: Motor de ejecución (F3)

**Fecha**: 2026-10-30 · **Spec**: [spec.md](./spec.md)

## R1. Intérprete (2A-A1)

- Workflow único `executeDag(input)`, con `input = { organizationId, workflowId, versionId,
  versionNumber, definition, triggerInput, correlationId, runId }`. La definición viaja completa (≤ 256
  KB) y es inmutable.
- Planificación por "listos": un nodo se ejecuta cuando todos sus predecesores terminaron (o fueron
  omitidos); los listos se lanzan con `Promise.all` (paralelismo, FR-005).
- La lógica pura (`logic.condition`, `logic.merge`, resolución de referencias) corre dentro del
  workflow usando `packages/dag-schema` (sin E/S, determinista). Los nodos con efecto (`mock.service`)
  son activities.
- Fallo rápido (8b-A): el primer fallo cancela el `CancellationScope` de las ramas en curso.
- Duración máxima de la ejecución: `workflowExecutionTimeout` configurable (30 min por defecto).
- Versionado del intérprete con `patched()` y pruebas de replay en CI.

## R2. Políticas por tipo de nodo

| Tipo | Dónde corre | Timeout | Reintentos |
|---|---|---|---|
| `trigger.manual` | workflow (entrega la entrada) | — | — |
| `logic.condition`, `logic.merge` | workflow | — | — |
| `mock.service` | activity | `startToClose` 30 s | inicial 1 s, ×2, máx. 3 |

Taxonomía mínima de errores (F4 la amplía): transitorio → reintento; permanente → falla sin reintento.

## R3. Registro de ejecuciones y pasos (3A, 5C)

- Una activity `recordRunEvent` escribe en Postgres como `app_runtime` con contexto de organización
  (`withContext`) y publica el evento en Valkey. El workflow la invoca en cada cambio de estado
  (determinismo: nada de E/S en el workflow).
- Idempotencia de la escritura: clave `(run_id, node_id, transition)`; reintentos de la activity no
  duplican.
- El contenido de entradas y salidas NO se guarda en Postgres (5C); el detalle del API lo lee del
  historial de Temporal mientras exista.

## R4. Vista en vivo (4A)

- `GET .../runs/{runId}/events` (SSE). El API se suscribe al canal Valkey `run:<runId>` tras verificar
  membresía; primero envía un snapshot desde Postgres y luego los eventos. `Last-Event-ID` para
  reanudar; latido cada 15 s.
- La web usa `EventSource` con respaldo a polling si falla.

## R5. Límite de ejecuciones (9A)

- Columna nueva `max_concurrent_runs` en `organization_limits` (default 5; ver data-model).
- Al iniciar: transacción con `pg_advisory_xact_lock(hash(organization_id))`, conteo de ejecuciones en
  `queued`/`running` y rechazo 429 `RUN_LIMIT_REACHED` si se alcanzó.

## R6. Inicio, cancelación y reejecución

- `workflowId` de Temporal = `run-<runId>`; el `runId` (UUID v7) se genera en el API, se inserta la fila
  y se arranca el workflow en la misma operación (si Temporal falla, la fila queda `failed` con
  `SERVICE_UNAVAILABLE`, nunca `running`).
- Cancelar = `handle.cancel()`; reejecutar = leer `triggerInput` del historial de Temporal
  (`fetchHistory`, primer evento) e iniciar una ejecución nueva con `rerun_of`.

## R7. Flag

`execution-enabled` (default `false`, `true` en `.env.example`).
