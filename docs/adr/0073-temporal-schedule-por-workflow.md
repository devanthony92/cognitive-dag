---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Temporal Schedule por workflow con lanzador y reconciliación

## Contexto y problema

El trigger `trigger.schedule` debe arrancar una ejecución con cron. La versión que se ejecuta se
decide al disparar (ADR-0075), los disparos no deben solaparse, una caída breve de Temporal no debe
perder la activación, y el cron debe validarse junto con su zona horaria.

## Opciones consideradas

- Un cron propio del worker que lee una tabla de próximos disparos.
- Un Temporal Schedule que arranca `executeDag` directamente con los argumentos de la versión.
- Un Temporal Schedule por workflow cuya acción es un lanzador (elegida).
- `pg_cron` o un planificador del sistema operativo.

## Decisión

Un Schedule por workflow, con id `sched-<workflowId>`. Se crea o actualiza al activar una versión
con `trigger.schedule`. Se borra al desactivar, al archivar el workflow o al activar una versión con
otro trigger. Su acción arranca el workflow `fireSchedule` con `organizationId`, `workflowId` y la
hora programada. Ese lanzador hace dos cosas:

1. Llama a la activity `startScheduledRun`, que carga la versión activa, comprueba el flag y el
   límite de ejecuciones, e inserta la fila de la ejecución.
2. Lanza `executeDag` como child workflow con id `run-<runId>` y `ParentClosePolicy.ABANDON`, y
   espera a que termine.

La política de solape es `SKIP`. Mientras el lanzador sigue abierto, los disparos siguientes se
saltan. El catch-up es de 1 hora (`SCHEDULE_CATCHUP_WINDOW_SECONDS`, 3600 por defecto).

La tabla `workflow_schedules` guarda el estado deseado (`scheduled` o `removed`) y el de
sincronización (`pending`, `synced`, `failed`). La API escribe la fila en la misma transacción que
la activación. Un reconciliador del worker, cada 60 s, aplica a Temporal las filas que no están
`synced`. Crear es idempotente (create o update) y borrar ignora "no existe".

Con `TRIGGERS_ENABLED=false` en el worker, el lanzador no arranca ejecuciones, pero los Schedules no
se borran. El tope de programaciones activas es `max_active_schedules` (10 por defecto, ADR-0045).
Al superarlo, la API responde 409 `SCHEDULE_LIMIT_REACHED`.

## Consecuencias

- Bueno: Temporal gestiona el cron, la zona horaria y el solape. La versión que se ejecuta sigue
  siendo la activa en el momento del disparo.
- Bueno: una activación no se pierde si Temporal falla justo después. El reconciliador la completa.
- Malo: el lanzador ocupa una ejecución de Temporal durante toda la ejecución programada. Su
  historial es mínimo, pero existe.
- Malo: entre la activación y la sincronización pueden pasar hasta 60 s sin disparos.
- Malo: no hay límite de frecuencia mínima del cron. El solape, el límite de concurrencia y el tope
  de programaciones acotan el coste. Diferido.
- Desviación: R6 preveía que la API intentara aplicar el Schedule a Temporal al instante. La
  implementación solo escribe la fila `pending`, y la aplicación queda en el reconciliador (PR #58).
- Desviación: R6 pedía una métrica de los disparos descartados fuera de la ventana. El worker no los
  observa, así que no hay métrica ni log propios. Solo queda la configuración del catch-up (PR #57).
- Desviación: el reconciliador no tiene tope de intentos. Reintenta cada 60 s las filas que no están
  `synced`. `sync_attempts` solo cuenta y se satura en 32767.

## Confirmación

`apps/worker/test/workflows/fire-schedule.test.ts`, `apps/worker/test/schedules/reconciler.test.ts`,
`apps/worker/test/schedules/start-scheduled-run.test.ts`,
`apps/api/test/integration/schedules.e2e.test.ts` y el historial de replay `f7-fire-schedule.json`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R5 y R6).
- [ADR-0045](0045-limites-gestionados-por-el-operador.md),
  [ADR-0052](0052-limite-de-ejecuciones-simultaneas-con-advisory-lock.md),
  [ADR-0075](0075-ejecuciones-disparadas-por-el-sistema.md).
