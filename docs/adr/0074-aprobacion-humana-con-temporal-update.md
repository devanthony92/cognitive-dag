---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Aprobación humana con Temporal Update, bandeja y correo

## Contexto y problema

El nodo `human.approval` pausa una ejecución hasta que una persona decide, o hasta que vence el
plazo. La pausa puede durar días y no debe ocupar un worker. La decisión debe ser única y
determinista, debe poder responder 409 a una segunda decisión, y quien inicia la ejecución no puede
aprobarla (7A). El contenido del mensaje no puede salir de Temporal (ADR-0050).

## Opciones consideradas

- Temporal Signal, como pedía el plan (§4), con lectura del estado aparte para responder.
- Temporal Update con validador, que devuelve el resultado a quien llama (elegida).
- Estado de espera en PostgreSQL y reanudación desde la API sin Temporal.
- Un estado `waiting_approval` en `workflow_runs` (PLAN §5.5).

## Decisión

Dentro de `executeDag`, `human.approval` registra el evento `approval.requested`. La activity
`recordRunEvent` crea la fila en `approvals`. Después lanza `notifyApprovers` y espera con
`condition(() => decision !== undefined, timeoutMs)`. Mientras espera, el paso queda `running` con
`waiting_reason = 'approval'`.

La API envía el Update `decideApproval` con `{ nodeId, decision, decidedBy, comment? }`. Tiene un
validador que rechaza nodos inexistentes o ya resueltos. El handler devuelve `{ accepted: true }` o
`{ accepted: false, reason }` y no lanza por casos de negocio. Si la ejecución ya cerró, la API
responde 409 `APPROVAL_ALREADY_RESOLVED`.

Autorización: decide un owner o editor vigente. Quien inició la ejecución recibe 403
`APPROVAL_SELF_DECISION_FORBIDDEN`. En una ejecución de webhook o programación no hay iniciador, y
decide cualquier owner o editor. La base repite la regla con un trigger (`approvals_decider_check`).
Decidir requiere sesión y CSRF, y el correo solo enlaza: no decide.

Al vencer el plazo, la salida del nodo es `timeout` y se registra `approval.resolved` con `outcome =
timed_out`. El mensaje resuelto viaja en el campo `message` de la entrada de `notifyApprovers`, que
la activity ignora, para que solo quede en el historial de Temporal. El comentario (500 caracteres
como máximo) queda en el historial del Update. El correo no lleva el mensaje; sí lleva un enlace a
`/orgs/<orgId>/approvals?approval=<id>`. La bandeja usa polling de 30 s.

## Consecuencias

- Bueno: la espera no ocupa ningún worker y sobrevive a un reinicio (SC-004, prueba de caos).
- Bueno: la decisión es determinista. La primera decisión dentro del workflow gana, y la API
  responde con certeza.
- Malo: depende de la disponibilidad de Temporal para aceptar el Update.
- Malo: si la ejecución se cancela mientras espera, la solicitud queda `cancelled`.
- Malo: el plazo máximo de la espera (hasta 30 días) amplía la duración máxima de la ejecución.
- Desviación: PLAN §4 pedía signals. Se usa Update porque un Signal no devuelve resultado.
- Desviación: no se añadió `waiting_approval` a `workflow_runs`. La UI deriva "Esperando aprobación"
  del paso con `waiting_reason`. Así no hace falta un valor nuevo de enum (PR #56 y #57).
- Desviación: R15 hablaba de `approval.timed_out`. No existe como evento aparte; el vencimiento se
  registra como `approval.resolved` con `outcome = timed_out`.
- Diferido: aprobación por rol o grupo, varios aprobadores, delegación, recordatorios y SSE.

## Confirmación

`apps/worker/test/workflows/execute-dag-approval.test.ts`,
`apps/worker/test/approvals/record-approval-events.test.ts`,
`apps/worker/test/approvals/notify.test.ts`, `apps/api/test/integration/approvals.e2e.test.ts`, la
prueba de caos `triggers.chaos.test.ts` y el historial de replay `f7-execute-dag-approval.json`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R7 y R8).
- [ADR-0034](0034-mailpit-y-nodemailer.md), [ADR-0038](0038-eventos-de-seguridad-en-logs.md),
  [ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md),
  [ADR-0053](0053-cualquier-miembro-puede-ejecutar.md),
  [ADR-0075](0075-ejecuciones-disparadas-por-el-sistema.md).
