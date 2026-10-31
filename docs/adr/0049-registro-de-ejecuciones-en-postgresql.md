---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Registro de ejecuciones y pasos en PostgreSQL

## Contexto y problema

El historial de Temporal es la fuente de verdad de la ejecución, pero la web necesita listar ejecuciones y mostrar el estado de cada nodo con aislamiento por organización (FR-013), algo que Temporal no ofrece por tenant ni con RLS.

## Opciones consideradas

- Consultar solo a Temporal (listados por visibilidad y descripciones).
- Registrar ejecuciones y pasos en PostgreSQL, escritos por el worker, con RLS.

## Decisión

Dos tablas, `workflow_runs` y `workflow_run_steps`, con RLS forzado por `organization_id`, sin `DELETE` para `app_runtime` y con la ejecución terminal inmutable. La activity `recordRunEvent` las escribe como `app_runtime` dentro de `withContext`, con la clave de idempotencia `(run_id, node_id, transition)`: los reintentos no duplican ni hacen retroceder una fila. El workflow la invoca en cada cambio de estado, así que no hace E/S. El API crea la fila antes de iniciar el workflow y, si Temporal falla, la deja `failed` con `SERVICE_UNAVAILABLE`, nunca `running`.

## Consecuencias

- Bueno: listados, paginación y aislamiento por tenant con las mismas garantías que el resto de los datos.
- Bueno: lo que la web muestra por defecto no depende de Temporal.
- Malo: dos fuentes de estado que pueden diferir un instante; las escrituras idempotentes y el estado terminal inmutable lo contienen.

## Confirmación

`packages/db/test/rls-runs.test.ts` y `apps/api/test/integration/runs-start.test.ts`.

## Enlaces

[ADR-0024](0024-drizzle-como-orm.md), [ADR-0029](0029-rls-con-claves-de-contexto.md), `specs/004-execution-engine/data-model.md`.
