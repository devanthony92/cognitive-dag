# Research: Resiliencia (F4)

**Fecha**: 2026-10-31 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: 1C (rate limit ahora, circuit breaker después), 2 diferida (granularidad por
servicio), 3C (para el circuit breaker futuro), 4B, 5B, 6B, 7A, 8C (cuotas diarias después), 9A, 10C,
11A, 12B (bulkheads después).

## R1. Taxonomía de errores

| Clase | Origen típico | `ApplicationFailure` | Tratamiento |
|---|---|---|---|
| `transient` | 5xx, reset, Valkey o PostgreSQL caídos | reintentable | backoff exponencial ×2 con jitter |
| `rate_limited` | token bucket sin capacidad, 429 con `Retry-After` | reintentable con `nextRetryDelay` | espera lo indicado |
| `timeout` | `startToClose` vencido | (lo genera Temporal) | reintentable como transitorio |
| `permanent` | 4xx, configuración inválida | `nonRetryable: true` | falla sin reintento |

- Un módulo `packages/dag-schema/src/runtime/errors.ts` define clases, códigos y la función
  `classify(failure)` que usa el workflow para registrar el paso. Los nodos con efecto lanzan solo
  errores de la taxonomía (FR-003).
- El paso guarda `error_class` además de `error_code` (ver data-model). La ejecución fallida copia la
  clase del paso que la hizo fallar.

## R2. Políticas por nodo (5B)

- Campo opcional `retry` en los nodos cuyo catálogo declara `category` con efecto (`mock` hoy; `llm` y
  `http` después): `{ maxAttempts: 1–10, timeoutSeconds: 1–120, initialIntervalMs: 100–30000 }`.
  Vive en la definición del DAG (JSON de la versión): no cambia tablas.
- El catálogo declara los valores por defecto por tipo (`mock.service`: 3 intentos, 30 s, 1 s).
- El workflow crea un `proxyActivities` por política efectiva. `scheduleToCloseTimeout` (FR-007) =
  `maxAttempts × timeoutSeconds + 5 min` de margen para esperas por rate limit.
- `validate.ts` rechaza valores fuera de rango con mensajes en español en el campo.

## R3. Rate limit (1C, 4B)

- Token bucket en Valkey con un script Lua atómico: clave `rl:<organizationId>:<nodeType>`, campos
  `tokens` y `updatedAt`; reposición continua; TTL para limpiar claves inactivas.
- La activity pide 1 token antes del efecto. Sin token, lanza `rate_limited` con
  `nextRetryDelay = tiempo hasta el próximo token` (sin dormir dentro de la activity).
- Configuración por variable de entorno del worker por tipo de nodo, p. ej.
  `RATE_LIMIT_MOCK_SERVICE=capacity:10,refillPerSecond:5`. Sin variable, sin límite.
- Valkey caído: error `transient` (FR del caso 4 de US3); nunca se ejecuta el efecto sin token.
- Las esperas por rate limit no deben gastar los intentos del nodo. La activity corre con
  `maximumAttempts` ilimitado en Temporal y aplica `maxAttempts` ella misma: cuenta solo los fallos
  que no son `rate_limited`, con el contador en los heartbeat details (que pasan de un intento al
  siguiente). Al superar `maxAttempts` lanza el último error como no reintentable. El tope total lo da
  `scheduleToCloseTimeout`.
- Estado visible: antes de lanzar `rate_limited`, la activity marca el paso con
  `waiting_reason = 'rate_limited'` y publica el evento; lo limpia al obtener el token (columna nueva,
  ver data-model).

## R4. Idempotencia (7A)

- Tabla `node_effects` (ver data-model). Clave `runId:nodeId` (FR-011).
- Protocolo en la activity:
  1. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` con estado `started`.
  2. Si ya estaba `committed`: devuelve el resultado sin repetir el efecto.
  3. Ejecuta el efecto enviando la clave al destino (el servicio simulado la registra).
  4. `UPDATE` a `committed`.
- Una caída entre 3 y 4 repite el efecto en el siguiente intento; el destino debe deduplicar con la
  clave. El servicio simulado deduplica con su propio registro en Valkey (`mock:effect:<key>`), lo
  que permite demostrar "una sola vez" de extremo a extremo.
- La salida de un efecto confirmado no se guarda (5C de F3): `mock.service` devuelve `{ ok: true }`
  siempre, así que no hace falta. Conectores reales de F7 la obtienen del destino con la clave.

## R5. Inyección de fallos (6B)

`mock.service` amplía su configuración:

| Campo | Valores | Nuevo |
|---|---|---|
| `failureKind` | `transient`, `permanent`, `timeout`, `rate_limited` | `rate_limited` |
| `retryAfterMs` | 0–60000 (solo con `rate_limited`) | sí |
| `failFirstAttempts` | 0–10: falla esos intentos y luego funciona, sin azar | sí |

`failureRate` sigue para fallos probabilísticos. `failFirstAttempts` tiene prioridad si es > 0.

## R6. Reejecución desde un nodo (9A)

- `POST .../runs/{runId}/rerun` acepta `{ fromNodeId?: string }`. Sin `fromNodeId`, igual que F3.
- Con `fromNodeId`:
  - La ejecución original debe estar terminada; el nodo debe existir en su versión
    (`RERUN_NODE_INVALID`).
  - Se usa la **versión de la original**, no la activa (las salidas reutilizadas pertenecen a ella).
  - Reutilizables = nodos con efecto en `succeeded` que no son descendientes del nodo elegido ni el
    nodo mismo. El API lee sus salidas del historial de Temporal (como `/io`) y la entrada del
    disparador; si falta alguna, `RUN_INPUT_EXPIRED`.
  - `executeDag` recibe `memoized: Record<nodeId, output>`; esos nodos se registran como `reused`
    sin activity. Condiciones y merge se recalculan (FR-017): son puras y sus entradas son las mismas.
- La nueva ejecución guarda `rerun_of` y `rerun_from_node_id`.

## R7. Página de ejecuciones de la organización (10C)

- `GET /organizations/{org}/runs?status=&workflowId=&cursor=&limit=`; incluye nombre del workflow y,
  en fallidas, el nodo y la clase del error del paso que falló.
- Índice nuevo `(organization_id, created_at DESC)` y otro parcial para `status = 'failed'`.

## R8. Caos, replay y demo (11A)

- Batería de caos (Vitest + Docker): matar el worker (ya existe), reiniciar el contenedor de Temporal,
  pausar Valkey (`docker pause`) y PostgreSQL unos segundos. Corre en un job de CI aparte, no en cada
  PR (es lenta), y localmente con `pnpm test:chaos`.
- Replay: historiales reales exportados a `apps/worker/test/replay/histories/*.json` (sin contenido
  sensible: datos de prueba), reproducidos con `Worker.runReplayHistories` en el job `integration`.
- `pnpm demo:recovery`: crea un workflow de demostración, lo ejecuta, mata el worker a mitad, lo
  reinicia y muestra que termina sin repetir efectos.

## R9. Flag

`resilience-enabled` (default `false`, `true` en `.env.example`): solo UI y endpoints nuevos
(reejecutar desde un nodo, listado de la organización). Taxonomía, políticas, rate limit e
idempotencia no van detrás del flag: son mejoras internas del motor.
