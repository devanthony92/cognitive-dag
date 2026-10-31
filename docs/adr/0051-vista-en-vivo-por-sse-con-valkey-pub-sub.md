---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Vista en vivo por SSE con Valkey pub/sub

## Contexto y problema

La web debe ver los cambios de estado en menos de un segundo (SC-002) y recuperarse sola si la conexión se corta (FR-014). El worker y el API son procesos distintos y puede haber varias instancias del API.

## Opciones consideradas

- Polling periódico a un endpoint.
- WebSockets.
- Server-Sent Events con Valkey pub/sub entre el worker y el API.

## Decisión

El worker publica en el canal `run:<runId>` de Valkey cada transición que registra. `GET /runs/{runId}/events` verifica sesión y membresía (404 ante otra organización), se suscribe al canal, envía un `snapshot` leído de PostgreSQL y después un evento por cambio. Cada evento trae el estado completo tras el cambio, así que repetirlo es inofensivo y `Last-Event-ID` se atiende con un snapshot nuevo al reconectar. Latido cada 15 s y cierre al llegar al estado terminal. La web usa `EventSource` y, si la conexión falla, vuelve a consultar la ejecución cada pocos segundos hasta que el navegador reconecta. Para las ejecuciones sustituye al polling de [ADR-0014](0014-polling-en-f0.md).

## Consecuencias

- Bueno: SSE es unidireccional, pasa por proxies HTTP y el navegador reconecta solo; varias instancias del API comparten el canal.
- Bueno: Valkey no persiste nada, así que no hay un segundo almacén que proteger.
- Malo: si Valkey cae, la vista en vivo se degrada a consultas periódicas; el estado en PostgreSQL sigue siendo correcto.

## Confirmación

`apps/api/test/integration/runs-events.test.ts` y `apps/web/test/runs-view.test.tsx` (flujo en vivo y respaldo a polling).

## Enlaces

[ADR-0014](0014-polling-en-f0.md), `specs/004-execution-engine/research.md` (R3, R4).
