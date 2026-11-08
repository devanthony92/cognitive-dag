---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Circuit breaker por organización y host en Valkey, con cola propia para HTTP

## Contexto y problema

ADR-0060 dejó diferidos el circuit breaker, la granularidad por servicio y el bulkhead, hasta que
hubiera conectores reales. Con `http.request`, un host caído recibe reintentos de todas las
ejecuciones, y cada llamada ocupa un slot del worker y tiempo de espera. Hay que cortar el tráfico
hacia un host que falla, sin que un host caído afecte a otras organizaciones ni a los demás nodos.

## Opciones consideradas

- Un breaker por tipo de nodo, como el rate limit de F4. No distingue entre hosts.
- Un breaker por organización y host, en Valkey, con scripts Lua atómicos (elegida).
- Un breaker en PostgreSQL. Es más lento y añade carga a la base en cada llamada.
- Un breaker en memoria de cada worker. Varios workers no compartirían el estado.
- Un límite de tasa por host. Se difiere: es otro control, distinto del breaker.

## Decisión

Claves en Valkey: `cb:<org>:<host>` (hash con `state` y `openedAt`), `cb:<org>:<host>:f` (conjunto
ordenado con las marcas de los fallos en la ventana) y `cb:<org>:<host>:probe` (lock `SET NX` de la
única prueba del estado semiabierto). Los scripts Lua leen el reloj de Valkey. Las reglas son las
del módulo puro de `packages/connectors` (`circuit-breaker.ts`):

- **Cerrado**: 5 fallos transitorios en 60 s abren el circuito (`HTTP_CB_FAILURES` y
  `HTTP_CB_WINDOW_SECONDS`).
- **Abierto**: rechaza sin llamar durante 30 s (`HTTP_CB_COOLDOWN_SECONDS`).
- **Semiabierto**: deja pasar una sola petición. Si tiene éxito, cierra el circuito. Si falla, lo
  abre otra vez. El lock caduca tras un cooldown.

Cuentan como fallo los 5xx, los errores de red y los timeouts. No cuentan los 429, los 4xx ni los
bloqueos del guardia (SSRF, allowlist, redirecciones). Con el circuito abierto, la activity lanza un
error transitorio con `nextRetryDelay` igual al tiempo que queda. Ese tiempo no gasta intentos, y el
paso queda con `waiting_reason = 'circuit_open'`. Si pasan más de `HTTP_CB_MAX_WAIT_SECONDS` (120 s)
desde que se programó la activity, falla `HTTP_CIRCUIT_OPEN` como transitorio. Si Valkey no
responde, el nodo espera y no llama al destino (fail-closed, `HTTP_CIRCUIT_UNAVAILABLE`). Las claves
caducan tras una hora sin uso.

Bulkhead: la cola `cognitive-dag-http` (`TEMPORAL_HTTP_TASK_QUEUE`) tiene su worker en el mismo
proceso, con concurrencia propia (`HTTP_MAX_CONCURRENT_ACTIVITIES`, 20 por defecto), como la cola
LLM (ADR-0063). `executeDag` recibe `httpTaskQueue`. Las notificaciones de aprobación y el lanzador
de Schedules quedan en la cola principal.

**Actualización de ADR-0060**: el circuit breaker, la granularidad por servicio (organización y
host) y el bulkhead HTTP quedan implementados en F7. El rate limit de F4 sigue siendo por
organización y tipo de nodo. El límite de tasa por host sigue diferido.

## Consecuencias

- Bueno: un host caído deja de recibir tráfico tras 5 fallos en 60 s, y las llamadas siguientes no
  llegan al destino (criterio SC-006).
- Bueno: el estado es compartido entre workers, y un fallo de una organización no afecta a otra.
- Bueno: el circuito abierto no ocupa slots del worker mientras espera.
- Malo: el estado es por organización y host, así que el breaker no protege al host de la carga de
  todas las organizaciones a la vez. Ese es el límite de tasa por host, aún diferido.
- Malo: un nodo puede esperar hasta 120 s y luego fallar, lo que alarga la ejecución.
- Malo: si el worker muere con el lock de la prueba, el lock caduca tras un cooldown. Durante ese
  tiempo no hay prueba.
- Desviación: el módulo puro de `packages/connectors` es la referencia. Los scripts Lua la replican
  y se prueban por separado (`circuit-breaker-valkey.test.ts`).
- Desviación: la política de R12 para `circuit.closed` no tiene evento propio. Solo se registran
  `circuit.opened` y `circuit.waiting`.

## Confirmación

`packages/connectors/test/circuit-breaker.test.ts`,
`apps/worker/test/http/circuit-breaker-valkey.test.ts`, `apps/worker/test/http/bulkhead.test.ts`,
que cubren el comportamiento de SC-006.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R12).
- [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md),
  [ADR-0057](0057-rate-limit-con-token-bucket-sin-ocupar-el-worker.md),
  [ADR-0060](0060-decisiones-diferidas-de-resiliencia.md),
  [ADR-0063](0063-bulkhead-con-cola-llm-en-el-mismo-proceso.md),
  [ADR-0078](0078-http-request-limites-clasificacion-e-idempotencia.md).
