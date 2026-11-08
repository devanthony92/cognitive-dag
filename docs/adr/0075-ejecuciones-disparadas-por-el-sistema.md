---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Ejecuciones disparadas por el sistema

## Contexto y problema

Hasta F7 toda ejecución la iniciaba una persona, y `workflow_runs.triggered_by` era siempre un
usuario. Un webhook o una programación no tienen persona detrás. Hay que representar el origen sin
inventar un usuario, decidir quién puede aprobar sin iniciador, y que las aprobaciones pendientes no
bloqueen el límite de ejecuciones de la organización.

## Opciones consideradas

- Un usuario "sistema" o de servicio como `triggered_by`.
- `triggered_by` nulo y una columna `trigger_kind` con el origen (elegida).
- Una tabla aparte para las ejecuciones del sistema.

## Decisión

`workflow_runs.triggered_by` admite `NULL`. Se añaden `trigger_kind` (`manual`, `webhook`,
`schedule`), `trigger_event_id` (solo webhook, 1 a 128 caracteres) y `scheduled_at` (solo
programación). Un `CHECK` de consistencia fija qué columnas van con cada origen (migración 0014).

La creación de la ejecución es el núcleo compartido `startRun`
(`packages/db/src/runs/start-run.ts`). Lo usan la API (manual y webhook), mediante `RunLauncher`, y
el worker (`startScheduledRun`). Incluye la versión activa, el límite de concurrencia bajo un
advisory lock y la inserción.

El conteo del límite excluye las ejecuciones con una aprobación `pending`. Sin esa exclusión, unas
pocas aprobaciones de un día bloquearían a toda la organización. Cancelar y reejecutar siguen siendo
acciones de personas con rol (ADR-0053). Reejecutar una ejecución de webhook o programación crea una
ejecución `manual` con `rerun_of`.

La deduplicación de webhooks combina una consulta bajo el advisory lock por `(workflow_id,
trigger_kind, trigger_event_id)` con la restricción `UNIQUE` de `temporal_workflow_id`, heredada de
F3 (migración 0006).

## Consecuencias

- Bueno: ningún registro atribuye a una persona una ejecución que no inició. La migración solo añade
  columnas y relaja una restricción, así que es de expansión.
- Bueno: manual, webhook y programación comparten un único camino de creación.
- Malo: `triggeredBy` nulo rompe a cualquier consumidor que asumiera una persona. La web muestra
  "Webhook" o "Programación" en su lugar.
- Malo: las ejecuciones en espera de aprobación no cuentan para el límite, aunque sí ocupan filas y
  recursos de Temporal mientras esperan.
- Desviación: en PR #57 la API seguía con el conteo inline de `runs.service.ts`. Se resolvió en PR
  #58 (`RunLauncher` y `startRun` compartidos), que lo alinea con lo previsto en R14.

## Confirmación

`packages/db/test/rls-triggers.test.ts` (CHECK y triggers de las tablas nuevas),
`packages/db/test/start-run.test.ts`, `apps/api/test/integration/webhook.e2e.test.ts` y
`apps/api/test/integration/schedules.e2e.test.ts`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R14 y R8).
- [ADR-0049](0049-registro-de-ejecuciones-en-postgresql.md),
  [ADR-0052](0052-limite-de-ejecuciones-simultaneas-con-advisory-lock.md),
  [ADR-0053](0053-cualquier-miembro-puede-ejecutar.md),
  [ADR-0073](0073-temporal-schedule-por-workflow.md),
  [ADR-0074](0074-aprobacion-humana-con-temporal-update.md).
