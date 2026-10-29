---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Plazo de 5 s y reintentos gRPC acotados en las llamadas del API a Temporal

## Contexto y problema

La constitución (principio II) exige timeout, política de reintentos y clasificación de errores en
toda llamada externa. Con una conexión perezosa y Temporal inaccesible, las llamadas se bloqueaban
sin límite. Además, la política de reintentos por defecto del SDK (10 intentos de hasta 5 s)
dejaba temporizadores vivos después de vencido el plazo o de cerrada la conexión, que fallaban
sobre un canal muerto.

## Opciones consideradas

- Política por defecto del SDK, sin plazo.
- Plazo por llamada, con la política por defecto de reintentos.
- Plazo por llamada y un presupuesto corto de reintentos dentro del plazo.

## Decisión

- Cada llamada del API a Temporal usa `connection.withDeadline` con un plazo de 5 s
  (`TEMPORAL_CALL_DEADLINE_MS` en `apps/api/src/ping/ping.service.ts`).
- La conexión (`apps/api/src/temporal/temporal.module.ts`) usa `makeGrpcRetryInterceptor` con
  `maxAttempts: 4`, de modo que todos los reintentos caben dentro del plazo.
- Un plazo vencido o un servicio no disponible se traduce a 503 `SERVICE_UNAVAILABLE`, nunca a 500.
- La conexión es perezosa (`Connection.lazy`): el API arranca sin Temporal y `/health/ready`
  informa el estado.

## Consecuencias

- Bueno: una caída de Temporal produce un 503 en unos 5 s como máximo y sin temporizadores
  huérfanos.
- Malo: dos constantes que mantener coherentes (plazo y reintentos); si crecen los reintentos, hay
  que revisar el plazo.

## Confirmación

`apps/api/test/integration/problem-details.test.ts` (503 `SERVICE_UNAVAILABLE` sin filtrar la
dirección) y `health.test.ts` (readiness 503) lo cubren. Ver también el escenario 11 de `specs/001-foundations-skeleton/quickstart.md`.

## Enlaces

- Commits `1e187cb` y `b9ec803`.
