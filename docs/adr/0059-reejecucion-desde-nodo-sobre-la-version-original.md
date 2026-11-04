---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Reejecución desde un nodo sobre la versión original

## Contexto y problema

Cuando una ejecución falla en un nodo avanzado de una cadena, reejecutarla entera repite trabajo que ya salió bien, y ese trabajo incluye efectos externos. Hace falta poder reejecutar desde un nodo reutilizando las salidas de los nodos previos exitosos. Esas salidas solo tienen sentido para la versión del DAG con la que se produjeron.

## Opciones consideradas

- Reejecutar siempre la ejecución completa.
- Reejecutar desde un nodo sobre la versión activa del workflow.
- Reejecutar desde un nodo sobre la versión de la original, reutilizando sus salidas desde el historial de Temporal.
- Guardar las salidas en PostgreSQL para reutilizarlas.

## Decisión

`POST .../runs/{runId}/rerun` acepta `fromNodeId` de forma opcional. Sin `fromNodeId`, la reejecución es la de F3. Con `fromNodeId`:

- La ejecución original debe estar terminada (`RUN_NOT_FINISHED` si no) y el nodo debe existir en su versión (`RERUN_NODE_INVALID` si no).
- Se usa la versión de la original, no la activa. Así las salidas reutilizadas pertenecen a la misma versión.
- Son reutilizables los nodos con efecto en estado `succeeded` que no son el nodo elegido ni descendientes suyos. El API lee sus salidas y la entrada del disparador del historial de Temporal, como hace `/io`. Si falta alguna, responde `RUN_INPUT_EXPIRED`.
- `executeDag` recibe `memoized: Record<nodeId, output>`. Esos nodos quedan como `reused` sin ejecutar ninguna activity. La lógica (condiciones y merge) se vuelve a evaluar, porque es pura y sus entradas son las mismas.

La nueva ejecución guarda `rerun_of` y `rerun_from_node_id`. Cada reejecución emite un evento de seguridad `run.rerun` con el nodo.

## Consecuencias

- Bueno: los efectos exitosos no se repiten al corregir un fallo posterior.
- Bueno: no se almacena contenido nuevo; las salidas siguen solo en Temporal ([ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md)).
- Malo: una ejecución cuyo historial ha caducado por la retención no se puede reejecutar desde un nodo; se informa con `RUN_INPUT_EXPIRED`.
- Malo: la reutilización depende de que el workflow sea determinista; un cambio de código que altere el historial rompería la reejecución, por eso las pruebas de replay forman parte de la decisión.
- Malo: cualquier miembro puede reejecutar, como en F3 ([ADR-0053](0053-cualquier-miembro-puede-ejecutar.md)); se revisa en F7.

## Confirmación

`apps/api/test/integration/runs-rerun-from-node.test.ts` (misma versión, nodos reutilizados sin intentos, `rerun_from_node_id`, códigos 422, 409 y 410, otra organización 404 y flag apagado 404), `packages/dag-schema/test/runtime/rerun.test.ts` (cálculo de reutilizables, disparador, nodo omitido y nodo inexistente) y la prueba de replay de la CI sobre historiales reales.

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (US5 y FR-015 a FR-018, SC-004).
- `specs/005-resilience/research.md` (R6).
- [ADR-0048](0048-interprete-unico-con-la-definicion-en-la-entrada.md) (la definición viaja en la entrada del workflow).
- [ADR-0053](0053-cualquier-miembro-puede-ejecutar.md) (quién puede reejecutar).
