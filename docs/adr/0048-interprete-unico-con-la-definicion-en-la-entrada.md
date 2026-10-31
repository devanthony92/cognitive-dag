---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Intérprete único con la definición en la entrada

## Contexto y problema

Ejecutar un DAG en Temporal exige decidir cómo el workflow conoce la forma del grafo. Las versiones son inmutables ([ADR-0041](0041-versiones-inmutables-y-tabla-puente-de-version-activa.md)) y cada ejecución debe usar exactamente la versión con la que empezó (FR-003), aunque se publique otra mientras corre.

## Opciones consideradas

- Generar un workflow de Temporal por DAG (código distinto por definición).
- Un workflow intérprete que lee la definición de la base de datos al empezar.
- Un workflow intérprete único, `executeDag`, que recibe la definición completa en su entrada.

## Decisión

Un solo workflow, `executeDag`, recibe `{ organizationId, workflowId, versionId, versionNumber, definition, triggerInput, correlationId, runId }`. La definición (256 KB como máximo) viaja completa y queda en el historial de Temporal: el replay no depende de ninguna lectura externa y el workflow no hace E/S. Planifica por nodos listos con `Promise.all` (paralelismo, FR-005). `trigger.manual`, `logic.condition` y `logic.merge` se resuelven dentro del workflow con `packages/dag-schema` (puro y determinista); solo `mock.service` es una activity. Los cambios del intérprete se protegen con `patched()` y pruebas de replay.

## Consecuencias

- Bueno: la ejecución es reproducible y no cambia si se publica otra versión; el workflow no lee la base de datos.
- Bueno: una sola implementación que probar con una batería de DAGs de referencia.
- Malo: la definición se copia en cada historial y cuenta contra su tamaño; el límite de 256 KB lo acota.
- Malo: cada cambio del intérprete debe ser compatible con los historiales ya guardados.

## Confirmación

`apps/worker/test/unit/execute-dag.workflow.test.ts` y `apps/worker/test/unit/execute-dag.replay.test.ts` (replay con historiales guardados).

## Enlaces

[ADR-0004](0004-temporal-como-motor-de-ejecucion.md), [ADR-0041](0041-versiones-inmutables-y-tabla-puente-de-version-activa.md), `specs/004-execution-engine/research.md` (R1).
