---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Efectos idempotentes con clave `runId:nodeId`

## Contexto y problema

Un reintento, una recuperación tras la caída del worker o una reejecución pueden volver a ejecutar un efecto ya realizado: un cargo duplicado o un mensaje enviado dos veces. Temporal garantiza que la activity se ejecute al menos una vez, no exactamente una vez. Hace falta una clave que identifique el efecto de forma estable y un registro que indique si ya se confirmó.

## Opciones consideradas

- Confiar en que cada conector sea idempotente por sí mismo.
- Una clave aleatoria generada en cada intento.
- Una clave `runId:nodeId` estable en todos los reintentos, con un registro de efectos en PostgreSQL.
- Registrar el contenido del efecto para comparar antes de repetirlo.

## Decisión

Cada efecto lleva la clave `runId:nodeId`, la misma en todos sus reintentos. Se registra en la tabla `node_effects` (organización, ejecución, nodo, clave única, estado `started` o `committed`, intentos, `started_at` y `committed_at`), sin contenido de entrada ni de salida. El protocolo de la activity, en `apps/worker/src/resilience/effects.ts`:

1. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` con estado `started`.
2. Si el registro ya está `committed`, devuelve el resultado sin repetir el efecto.
3. Ejecuta el efecto enviando la clave al destino.
4. Pasa el registro a `committed`.

Una caída entre los pasos 3 y 4 repite el efecto en el siguiente intento con la misma clave; el destino debe deduplicar por clave. El destino simulado `mock.service` guarda la clave en Valkey (`mock:effect:<key>`, 7 días), lo que permite demostrar de extremo a extremo que el efecto ocurre una sola vez. Un efecto `committed` es inmutable por trigger, y `app_runtime` no tiene `DELETE`. La tabla tiene RLS forzada por organización.

`mock.service` devuelve siempre `{ ok: true }`, así que no guarda la salida del efecto. Los conectores reales de F7 obtendrán la salida del destino con la clave, en vez de guardarla.

## Consecuencias

- Bueno: un reintento o una recuperación no repite un efecto confirmado.
- Bueno: la clave es estable y verificable; la prueba de caos puede comprobar "una sola vez" en el destino.
- Malo: entre el paso 3 y el 4 puede haber un efecto repetido si el destino no deduplica; por eso el destino es parte del contrato del conector.
- Malo: una ejecución cancelada puede dejar un efecto `started` que nunca se confirma. Queda así, sin confirmarse, y se documenta como límite conocido.

## Confirmación

`apps/worker/test/integration/effects.test.ts` (misma clave en reintentos, efecto `committed` que no se repite, `started` que se reintenta y destino que deduplica), `packages/db/test/rls-effects.test.ts` (aislamiento, sin `DELETE`, clave igual a `run_id:node_id` y `committed` inmutable) y la prueba de caos con `SIGKILL` del worker.

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (US4, FR-011 y FR-012, SC-003).
- `specs/005-resilience/research.md` (R4) y `specs/005-resilience/data-model.md` (tabla `node_effects`).
- [ADR-0029](0029-rls-con-claves-de-contexto.md) (RLS con claves de contexto).
- [ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md) (sin contenido fuera de Temporal).
