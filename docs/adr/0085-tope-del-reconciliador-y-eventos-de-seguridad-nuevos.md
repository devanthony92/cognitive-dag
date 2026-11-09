---
status: accepted
date: 2026-11-08
decision-makers: autor
---

# Tope de intentos del reconciliador, eventos de seguridad nuevos y desviaciones de F7

## Contexto y problema

La revisión de F7 (decisión 7A de F8: corregir solo lo barato) dejó desviaciones. Tres eventos que la
documentación citaba no existían (`approval.timed_out`, `circuit.closed`, `schedule.caught_up`). El
reconciliador de programaciones reintentaba sin fin una fila que Temporal rechazaba, cada 60 s, sin
avisar a nadie. Las pruebas de `apps/web` fallaban por tiempo cuando `turbo run test` ejecutaba todos
los paquetes a la vez (medición T002).

## Opciones consideradas

- Dejar las desviaciones como riesgo aceptado.
- Corregir las cuatro que son baratas y aceptar las tres que exigen un rediseño (elegida).

## Decisión

**Tope del reconciliador.** `MAX_SYNC_ATTEMPTS = 20` en `apps/worker/src/schedules/reconciler.ts`. El
reconciliador deja de leer las filas con `sync_attempts >= 20`. La fila sigue `failed` con
`last_error_code = SCHEDULE_SYNC_FAILED`, así que `GET .../schedule` la sigue mostrando como fallida.
Al llegar al tope emite `schedule.sync_failed` una sola vez (solo el intento que alcanza el 20
lo emite). A 60 s por pasada, el tope son unos 20 minutos de reintentos.

**Reinicio de intentos.** Un cambio de configuración (cron o zona horaria) o el desactivado ya ponían
`sync_attempts = 0` y `pending` en `SchedulesService`. Faltaba el caso de una versión activa nueva con
la misma programación: ahora la fila sigue a la versión y, si no estaba `synced`, vuelve a `pending`
con `sync_attempts = 0` y sin `last_error_code`. Sin cambio de esquema (`data-model.md`).

**Eventos de seguridad del worker.** Se escriben como logs con `event` estable (ADR-0038, tipo
`WorkerSecurityEvent` en `apps/worker/src/logging/security-events.ts`). Ninguno lleva contenido: ni
etiqueta del nodo, mensaje, cuerpo, cabecera, credencial ni cron.

| Evento                 | Cuándo                                                                                                                    | Campos                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `approval.timed_out`   | `recordRunEvent` cierra una solicitud pendiente como `timed_out`; una repetición o un evento tardío no lo vuelve a emitir | `organizationId`, `runId`, `nodeId`, `correlationId`                   |
| `circuit.closed`       | La prueba del semiabierto tiene éxito y el script de Valkey borra el circuito                                             | `organizationId`, `host`, `runId`, `nodeId`, `correlationId`           |
| `schedule.caught_up`   | `startScheduledRun` crea una ejecución con más de 60 s (`CAUGHT_UP_AFTER_MS`) de retraso sobre la hora programada         | `organizationId`, `workflowId`, `runId`, `lagSeconds`, `correlationId` |
| `schedule.sync_failed` | El intento número 20 consecutivo falla                                                                                    | `organizationId`, `workflowId`, `attempts`, `errorCode`                |

`circuit.opened` pasa a llevar también `organizationId`. `CircuitBreaker.success` devuelve
`{ closed }` para que solo la llamada que cerró el circuito lo anuncie.

**Pruebas web.** `apps/web/vite.config.ts` fija `maxWorkers: 2`, `testTimeout: 30000` y
`hookTimeout: 30000` (la configuración de Vitest de la web vive en `vite.config.ts`; no hay
`vitest.config.ts` aparte).

**Desviaciones aceptadas**, con dueño y revisión:

| Desviación                                                               | Razón                                                                                                                 | Dueño | Revisión                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| Ejecución `failed` si Temporal falla tras insertar la fila de un webhook | El emisor reintenta con otro `X-Event-Id`; arreglarlo exige una compensación transaccional con Temporal (#66)         | autor | Después de F9, con datos reales         |
| Disparos fuera de la ventana de catch-up sin métrica                     | Temporal los descarta y el worker no los observa (#67)                                                                | autor | F9, con las métricas de Temporal Server |
| Sin frecuencia mínima de la cron                                         | El tope de 10 programaciones activas por organización, `overlap = SKIP` y `max_concurrent_runs` acotan el coste (#68) | autor | F9                                      |

## Consecuencias

- Bueno: una programación que Temporal rechaza deja de consumir una consulta y una llamada por minuto
  para siempre, y el operador tiene un evento al que reaccionar.
- Bueno: los tres eventos que la documentación citaba existen y tienen prueba que falla si se quitan.
- Malo: tras 20 fallos la programación no se arregla sola; hace falta editarla, activar otra versión o
  corregir Temporal y reactivarla.
- Malo: `schedule.caught_up` mide el retraso al crear la ejecución, no al disparar Temporal; sirve para
  detectar un worker caído, no para medir la latencia exacta del disparo.

## Confirmación

`apps/worker/test/approvals/events.test.ts`, `apps/worker/test/http/circuit-breaker-valkey.test.ts`,
`apps/worker/test/schedules/start-scheduled-run.test.ts`, `apps/worker/test/schedules/reconciler.test.ts`
y `apps/api/test/integration/schedules.e2e.test.ts` (reinicio por versión activa nueva).

## Enlaces

- [ADR-0038](0038-eventos-de-seguridad-en-logs.md)
- [Research F8](../../specs/009-hardening/research.md) (R6).
