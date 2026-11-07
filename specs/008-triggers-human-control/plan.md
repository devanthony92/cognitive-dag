# Implementation Plan: Triggers y control humano (F7)

**Branch**: `008-triggers-human-control` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

## Summary

Cuatro nodos pasan a ejecutables: `trigger.webhook` (token secreto en la URL, anti-replay por id de
evento y ventana, `202` inmediato), `trigger.schedule` (un Temporal Schedule por workflow con lanzador,
salto por solape, catch-up de 1 hora y reconciliación), `human.approval` (pausa durable con Temporal
Update, bandeja con contador y correo) y `http.request` (anti-SSRF con resolución validada y conexión a
la IP, credenciales con cifrado de sobre, respuesta acotada, circuit breaker por organización y host,
cola `http`). Paquete nuevo `packages/connectors` (puro, TDD). Cinco tablas nuevas, RLS forzado y
`app_runtime` sin `DELETE`. Todo detrás de `triggers-enabled`; el compilador de F6 no ofrece los nodos
nuevos. Decisiones en [research.md](./research.md); modelo en [data-model.md](./data-model.md)
(**pendiente de aprobación del autor**).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24

**Primary Dependencies**: las existentes (Temporal SDK 1.25, NestJS 11, Drizzle, iovalkey, nodemailer,
React Flow, TanStack Router, Zod). Sin dependencias nuevas: `node:https`, `node:dns`, `node:crypto`
cubren el cliente HTTP guardado y el cifrado; el layout de la bandeja usa shadcn/ui ya instalado.

**Storage**: 5 tablas nuevas (`webhook_triggers`, `workflow_schedules`, `approvals`, `credentials`,
`http_allowed_hosts`), 2 enums, 3 columnas nuevas y 1 `NOT NULL` menos en `workflow_runs`, 1 `CHECK`
ampliado en `workflow_run_steps`, 1 columna en `organization_limits`; claves de Valkey para el webhook
y el circuit breaker

**Testing**: Vitest; TDD en `packages/connectors` (SSRF, cifrado, cliente guardado, breaker puro);
`TestWorkflowEnvironment` con tiempo simulado para `executeDag` con `human.approval` y para
`fireSchedule`; pruebas de replay de los historiales nuevos; RLS de las cinco tablas; baterías de
seguridad (token y replay del webhook, SSRF con servidor local y DNS falso, secretos fuera de logs y
filas); prueba de caos (matar el worker con una aprobación pendiente); componentes web; flag
encendido y apagado

**Performance Goals**: `202` del webhook < 500 ms (p95 local); contador de la bandeja con polling de
30 s; el catch-up no genera más de una ejecución por disparo acumulado

**Constraints**: workflow determinista (reloj de `sleep`/`condition`, sin lectura de flags ni de
entorno en el workflow); contenido solo en Temporal; el token y los secretos nunca en logs ni filas;
conexiones salientes solo a IP públicas validadas; fail-closed ante Valkey caído

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | Token con hash y tiempo constante; anti-SSRF con IP validada; credenciales cifradas; autorización en la API y la base; RLS forzado; el flag no es control de seguridad; salidas del LLM siguen sin decidir acciones (el webhook entra como dato delimitado a los nodos LLM) | PASS |
| II. Resiliencia | Timeout, reintentos y taxonomía en `http.request`; `Idempotency-Key` `runId:nodeId`; circuit breaker y bulkhead (cierra ADR-0060); workflow determinista (Update, `condition` con plazo, lanzador de Schedules) | PASS |
| III. Pruebas | `packages/connectors` se suma a la lista de TDD por enmienda PATCH de la constitution; un test por control OWASP; pruebas de replay; flag encendido y apagado | PASS |
| IV. Contratos | Contratos Zod en `packages/contracts`; `credentialId` en el esquema del nodo; entrada del webhook validada contra `bodySchema`; entorno validado al arrancar | PASS |
| V. Errores | Códigos `WEBHOOK_*`, `APPROVAL_*`, `CREDENTIAL_*`, `SCHEDULE_*`, `HTTP_*`, `SSRF_*`; problem+json en las rutas autenticadas; el webhook público usa el mismo formato | PASS |
| VI. Correlation-ID | El webhook acepta `X-Correlation-Id` válido o genera uno; el lanzador genera uno por disparo; heredan la ejecución, el Update y la llamada saliente | PASS |
| VII. Desviaciones | Token en vez de HMAC (ADR-0072), Update en vez de Signal y sin estado `waiting_approval` (ADR-0074), `triggered_by` nulo (ADR-0075) | PASS (con ADR) |
| VIII. Flags | `triggers-enabled` apagado por defecto en producción; kill switches `TRIGGERS_ENABLED` y `HTTP_ENABLED`; migraciones expand/contract | PASS |
| IX. Idioma | Mensajes en español; códigos, identificadores y prompts en inglés | PASS |

OWASP tocado: A01/SSRF (anti-SSRF y allowlist), A02 (llave maestra por entorno), A04 (cifrado de
sobre), A05 (cron validada, cuerpo validado), A08 (reemplaza HMAC: ver ADR-0072), A09 (eventos de
seguridad), A10 (fail-closed); LLM01 (contenido del webhook delimitado), LLM03 (aprobación humana y
credenciales de mínimo privilegio), LLM06 (rate limit y tope de cuerpo).

## Project Structure

```text
packages/connectors/src/{ssrf,address,dns-lookup,http-client,redirect,allowlist,
                         crypto,credential-headers,circuit-breaker}.ts   # puro, TDD
packages/dag-schema/src/catalog/{http-request,retry}.ts                  # credentialId, política HTTP
packages/dag-schema/src/validate/credentials.ts                          # referencias a credenciales
packages/contracts/src/{webhooks,schedules,approvals,credentials,http-hosts,flags,runs}.ts
packages/db/src/schema/{webhook-triggers,workflow-schedules,approvals,credentials,
                        http-allowed-hosts,workflow-runs,organization-limits}.ts
packages/db/src/runs/start-run.ts                                         # núcleo compartido API/worker
packages/db/migrations/0014_*, 0015_*                                     # tablas; RLS, triggers, grants
apps/worker/src/workflows/{execute-dag,fire-schedule}.workflow.ts         # human.approval, triggers, http
apps/worker/src/http/{activities,circuit-breaker,credentials}.ts          # cola http
apps/worker/src/schedules/{activities,reconciler}.ts
apps/worker/src/approvals/{activities,mail}.ts
apps/worker/src/config/env.schema.ts                                      # variables nuevas
apps/api/src/{webhooks,schedules,approvals,credentials,http-hosts}/       # endpoints y servicios
apps/api/src/flags/flags.catalog.ts                                       # triggers-enabled
apps/api/src/logging/redact-hook-path.ts                                  # redacción del token
apps/web/src/features/{approvals,webhooks,credentials,http-hosts,schedules}/
apps/web/src/routes/orgs.$organizationId.approvals.tsx
scripts/{credentials-gen-key.ts}                                          # genera la llave maestra
test/histories/                                                           # replay de F7
```

## PRs previstas

1. **Fundaciones** (Sonnet): `packages/connectors` completo con TDD (rangos de direcciones, DNS
   guardado, cliente con redirecciones, cifrado de sobre, breaker puro), `credentialId` y la política
   de `http.request` en el catálogo, contratos, enmienda PATCH de la constitution y baterías de SSRF y
   cifrado.
2. **Datos y motor** (Sonnet): migraciones 0014–0015, `startRun` compartido, `executeDag` con
   `trigger.webhook`/`trigger.schedule`/`human.approval`/`http.request`, cola `http`, circuit
   breaker en Valkey, `fireSchedule` y reconciliador, notificación por correo, flag y kill switches,
   pruebas de workflow, replay y caos.
3. **API y web** (Sonnet): webhook público con redacción del token y límites, endpoints de token,
   programaciones, aprobaciones (bandeja y contador), credenciales y allowlist; UI de los cuatro nodos,
   bandeja, administración de credenciales y de la allowlist, origen en la lista de ejecuciones.
4. **Cierre** (Haiku): baterías de seguridad de cierre, ADRs 0072–0081, actualización del ADR-0060,
   modelo de amenazas, PLAN (criterio de aceptación de F7 y estado de §5.4), README, quickstart.

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Lanzador `fireSchedule` entre el Schedule y `executeDag` | La versión a ejecutar se decide al disparar y `SKIP` necesita una ejecución abierta que mirar |
| Reconciliador con tabla `workflow_schedules` | Una activación no puede perder su Schedule si Temporal falla justo después |
| Temporal Update en lugar de Signal | Permite responder 409 a la segunda decisión y a la tardía con certeza |
| Dos claves de búsqueda de RLS (`lookup_webhook_trigger_id`, `reconciler`) | El webhook público y el reconciliador no conocen la organización; solo leen, nunca escriben |
| `packages/connectors` nuevo | Aísla el código de mayor riesgo (SSRF y cifrado) con TDD, fuera de las apps |
| Cliente HTTP propio sobre `node:https` | Permite validar la IP en el `lookup` sin dependencias nuevas (sin `undici`) |
| Aprobaciones pendientes fuera del límite de concurrencia | Si no, unas pocas esperas largas bloquearían la organización |
