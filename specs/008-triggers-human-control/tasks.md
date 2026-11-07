---

description: "Task list for F7 — Triggers y control humano"
---

# Tasks: Triggers y control humano (F7)

**Input**: `/specs/008-triggers-human-control/` (spec, plan, research, data-model aprobado, contracts,
quickstart)

**Tests**: incluidas; TDD obligatorio en `packages/connectors` (SSRF, cifrado, cliente guardado,
breaker puro) y en las reglas de autorización (decisor de aprobaciones, roles de credenciales y
allowlist). Cada prueba se escribe primero y DEBE fallar antes de implementar. Ninguna prueba de CI
llama a internet: usan un servidor local y un DNS falso.

**Feature flag**: `triggers-enabled` (endpoints, webhook público, UI y fase ejecutable `F7`). Kill
switches del worker: `TRIGGERS_ENABLED` y `HTTP_ENABLED`.

## Format: `[ID] [P?] [Story] Description`

Historias: US1 webhook, US2 token y replay, US3 programación, US4 aprobación, US5 `http.request`, US6
anti-SSRF, US7 breaker y bulkhead, US8 credenciales, US9 allowlist, US10 flag y aislamiento.

---

## Phase 1: Setup

- [ ] T001 Flag `triggers-enabled` en `packages/contracts/src/flags.ts`, catálogo del API (dueño `devanthony92`) y `.env.example` (`true`); abrir el issue de eliminación y enlazarlo en `flags.catalog.ts`
- [ ] T002 [P] Paquete `packages/connectors` (tsconfig, Vitest, exportación `@cognitive-dag/source`), sin dependencias nuevas
- [ ] T003 [P] Variables validadas al arrancar. Worker: `CREDENTIALS_MASTER_KEY` (32 bytes base64; obligatoria si `NODE_ENV=production`), `TRIGGERS_ENABLED`, `HTTP_ENABLED`, `TEMPORAL_HTTP_TASK_QUEUE`, `HTTP_MAX_CONCURRENT_ACTIVITIES`, `HTTP_CB_FAILURES`, `HTTP_CB_WINDOW_SECONDS`, `HTTP_CB_COOLDOWN_SECONDS`, `HTTP_CB_MAX_WAIT_SECONDS`, `SCHEDULE_CATCHUP_WINDOW_SECONDS`, `APPROVAL_EMAIL_MAX_RECIPIENTS`, `SMTP_*`, `HTTP_TEST_ALLOW_LOOPBACK` (el validador falla si está definida con `NODE_ENV=production`). API: `CREDENTIALS_MASTER_KEY`, `WEBHOOK_MAX_BODY_BYTES`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS`; ejemplos en `.env.example` (sin valores secretos)
- [ ] T004 [P] `scripts/credentials-gen-key.ts` y `pnpm credentials:gen-key` (imprime una llave aleatoria de 32 bytes en base64)

## Phase 2: Fundaciones (PR 1)

### Tests

- [ ] T005 [P] `packages/connectors/test/address.test.ts`: clasificación de IPv4 e IPv6 públicas y no públicas con todos los rangos de research R9 (incluye `169.254.169.254`, CGNAT, `::ffff:` mapeadas, NAT64, 6to4, Teredo, ULA, link-local, multicast); formas alternativas (decimal, octal, hexadecimal) normalizadas antes de decidir
- [ ] T006 [P] `packages/connectors/test/dns-lookup.test.ts`: `lookup` guardado con un DNS falso; si alguna dirección es no pública se rechaza todo; devuelve solo direcciones públicas; el nombre no se vuelve a resolver (rebinding: primera respuesta pública, segunda privada → se conecta a la primera)
- [ ] T007 [P] `packages/connectors/test/http-client.test.ts` contra un servidor local (con `HTTP_TEST_ALLOW_LOOPBACK`): solo https; sin proxy del entorno; respuesta cortada a 1 MiB leyendo el flujo (con `Content-Length` mentiroso y sin él); solo `application/json`, `+json` y `text/*`; cuerpo UTF-8 como texto; timeout de conexión y total
- [ ] T008 [P] `packages/connectors/test/redirect.test.ts`: máximo 3 saltos; solo https; cada salto revalidado (IP y allowlist); salto a otro origen descarta la cabecera de la credencial y `Idempotency-Key`; `303` y `301/302` de `POST` pasan a `GET`; `307/308` conservan método y cuerpo; salto a `169.254.169.254` bloqueado
- [ ] T009 [P] `packages/connectors/test/allowlist.test.ts`: coincidencia exacta y `*.dominio` (sin incluir el dominio base); rechazo de IP, esquema, puerto y ruta; lista vacía = sin restricción; lista no vacía = restringe host y saltos
- [ ] T010 [P] `packages/connectors/test/crypto.test.ts`: cifrado de sobre AES-256-GCM (DEK por credencial, IV aleatorio de 12 bytes, tag de 16); ida y vuelta; AAD `credential:<id>:<organization_id>` (un blob movido a otra fila o organización no descifra); llave maestra incorrecta falla; el secreto no aparece en el objeto serializado ni en los errores
- [ ] T011 [P] `packages/connectors/test/credential-headers.test.ts`: `bearer`, `api_key_header` y `basic` producen la cabecera correcta; nombres prohibidos rechazados (`Host`, `Content-Length`, `Content-Type`, `Transfer-Encoding`, `Connection`, `Cookie`, `Set-Cookie`, `Authorization`, `Idempotency-Key`, `Proxy-*`)
- [ ] T012 [P] `packages/connectors/test/circuit-breaker.test.ts`: máquina de estados pura con reloj inyectado: cerrado → abierto tras N fallos en la ventana → semiabierto tras el enfriamiento con una sola prueba → cerrado o abierto; 429, 4xx y bloqueos SSRF no cuentan
- [ ] T013 [P] `packages/connectors/test/ssrf-battery.test.ts` (SC-002): ≥ 25 destinos (loopback, privadas, link-local, metadata, CGNAT, IPv6, mapeadas, decimal/octal, hostnames que resuelven a lo interno, rebinding, redirecciones) con 0 conexiones abiertas a no públicas
- [ ] T014 [P] `packages/dag-schema/test/catalog/http-request-credential.test.ts`: `credentialId` opcional (uuid); sigue prohibido poner credenciales en cabeceras; `retry` por defecto del tipo (3 intentos, 30 s, 1 s) dentro de los límites de F4; validación de publicación `CREDENTIAL_NOT_FOUND` con un resolvedor inyectado
- [ ] T015 [P] `packages/dag-schema/test/catalog/schedule-timezone.test.ts`: zona IANA existente y cron de 5 campos; `Mars/Olympus` rechazada
- [ ] T016 [P] `packages/contracts/test/triggers.test.ts`: contratos de `webhooks`, `schedules`, `approvals`, `credentials` y `http-hosts` según `contracts/api.openapi.yaml`; `Run.triggeredBy` nulo y `Run.trigger`; `ExecuteDagInput` con `httpTaskQueue`, `triggerKind` y `scheduledAt`; `RunEvent` con `approval.requested` y `approval.resolved`
- [ ] T017 [P] `packages/compiler/test/catalog-f7.test.ts`: ningún tipo `executableFrom: 'F7'` llega al prompt con `triggers-enabled` encendido (US10)

### Implementation

- [ ] T018 `packages/connectors/src/{address,dns-lookup,allowlist,redirect,http-client,ssrf}.ts`: cliente sobre `node:https` con `lookup` guardado, sin dependencias nuevas
- [ ] T019 `packages/connectors/src/{crypto,credential-headers}.ts`
- [ ] T020 `packages/connectors/src/circuit-breaker.ts` (lógica pura; el almacenamiento en Valkey va en PR 2)
- [ ] T021 `dag-schema`: `credentialId` y política por defecto en `catalog/http-request.ts` y `catalog/retry.ts`; validación de zona IANA en `catalog/trigger-schedule.ts`; `validate/credentials.ts`
- [ ] T022 [P] `packages/contracts/src/{webhooks,schedules,approvals,credentials,http-hosts,runs}.ts` y códigos de error nuevos
- [ ] T023 [P] Enmienda PATCH de `.specify/memory/constitution.md` (TDD en `packages/connectors`)

## Phase 3: Datos y motor (PR 2)

### Tests

- [ ] T024 [P] `packages/db/test/rls-triggers.test.ts` como `app_runtime`: aislamiento de las cinco tablas; sin `DELETE` ni `TRUNCATE`; todos los `CHECK` de `data-model.md`; misma organización (triggers `*_same_organization`); `webhook_triggers` legible solo por su id con `app.lookup_webhook_trigger_id` y sin escritura; `workflow_schedules` legible por `app.reconciler` solo si no está sincronizada y sin escritura; inmutabilidad de `webhook_triggers`, `approvals`, `credentials` y `http_allowed_hosts`; `approvals_decider_check` (iniciador y rol); tope de 100 hosts; `workflow_runs_trigger_consistent`; filas de F3–F6 siguen válidas
- [ ] T025 [P] `packages/db/test/credentials-projection.test.ts`: la proyección de metadatos no incluye columnas `bytea`
- [ ] T026 [P] `packages/db/test/start-run.test.ts`: núcleo compartido (versión activa, límite de concurrencia, inserción) con `manual`, `webhook` y `schedule`; las ejecuciones con aprobación pendiente no cuentan para `RUN_LIMIT_REACHED`
- [ ] T027 [P] `apps/worker/test/workflows/execute-dag-triggers.test.ts` (`TestWorkflowEnvironment`, tiempo simulado): `trigger.webhook` y `trigger.schedule` producen su salida; `findUnsupportedNodes` con y sin la fase `F7`
- [ ] T028 [P] `apps/worker/test/workflows/execute-dag-approval.test.ts`: espera sin ocupar worker; Update `decideApproval` aprobado, rechazado (rama `rejected`, ejecución no falla), plazo (`timeout`), primera decisión gana, tardía → `accepted: false`, cancelación → `cancelled`; la duración máxima se amplía con los plazos; paso `running` con `waiting_reason = 'approval'`
- [ ] T029 [P] `apps/worker/test/workflows/fire-schedule.test.ts`: el lanzador resuelve la versión activa al disparar, inicia `executeDag` como child con `ParentClosePolicy.ABANDON` y espera su fin; sin versión activa termina sin ejecución; límite de concurrencia o `TRIGGERS_ENABLED=false` → salta y registra
- [ ] T030 [P] `apps/worker/test/schedules/reconciler.test.ts`: crea, actualiza y borra el Schedule de forma idempotente; reintenta `pending` y `failed`; borrar un Schedule inexistente no falla; `overlap = SKIP` y `catchupWindow` configurados; catch-up dentro de la ventana produce una ejecución y fuera se descarta con métrica
- [ ] T031 [P] `apps/worker/test/http/http-activity.test.ts` contra un servidor local: éxito `{status, body}`; 5xx y red transitorios; 429 con `Retry-After` (segundos y fecha) `rate_limited`; resto de 4xx permanente (incluido 408); `Idempotency-Key: runId:nodeId` idéntica en reintentos y solo en `POST`, `PUT`, `PATCH` y `DELETE`; registro en `node_effects`; `HTTP_DISABLED`; credencial archivada o de otra organización → `CREDENTIAL_UNAVAILABLE`; mensajes de error sin URL ni cuerpo
- [ ] T032 [P] `apps/worker/test/http/circuit-breaker-valkey.test.ts` (Valkey del Compose): script Lua atómico; 5 fallos en 60 s abre; no se llama al destino con el circuito abierto; una sola prueba en semiabierto con concurrencia; espera máxima de 120 s → `HTTP_CIRCUIT_OPEN`; aislamiento por organización y host; Valkey caído falla cerrado
- [ ] T033 [P] `apps/worker/test/http/bulkhead.test.ts`: la cola `http` saturada no frena las activities LLM ni las de `mock.service`
- [ ] T034 [P] `apps/worker/test/approvals/notify.test.ts`: correo a owners y editores elegibles (excluye al iniciador, máximo 20), sin el texto del mensaje; fallo de SMTP no afecta a la ejecución; `notified_count`
- [ ] T035 [P] `apps/worker/test/no-content.test.ts` (SC-003, SC-007): logs, eventos y filas sin cuerpo del webhook, respuesta HTTP, secreto, mensaje ni comentario
- [ ] T036 [P] Replay: historiales nuevos en `test/histories/` para `executeDag` con `human.approval` y para `fireSchedule`; los historiales de F3–F6 siguen reproduciéndose
- [ ] T037 [P] Caos (`chaos.yml`, SC-004): matar el worker con una aprobación pendiente y otra con un nodo HTTP en espera; al reiniciar continúan y la decisión funciona

### Implementation

- [ ] T038 Migraciones `0014_triggers_tables.sql` (enums, tablas, columnas, `CHECK`, índices) y `0015_triggers_rls_triggers_grants.sql` (RLS forzado, claves de búsqueda, triggers, privilegios sin `DELETE`); esquema Drizzle en `packages/db/src/schema/{webhook-triggers,workflow-schedules,approvals,credentials,http-allowed-hosts,workflow-runs,organization-limits}.ts`
- [ ] T039 `packages/db/src/runs/start-run.ts` (núcleo compartido) y proyección de metadatos de credenciales; conteo de concurrencia que excluye aprobaciones pendientes
- [ ] T040 `apps/worker/src/workflows/execute-dag.workflow.ts`: casos `trigger.webhook`, `trigger.schedule`, `human.approval` (Update `decideApproval`, `condition` con plazo) y `http.request` (proxy `httpFor` por cola y política); `patched` donde cambie el orden de comandos; duración máxima ampliada; `RunEvent` `approval.*`
- [ ] T041 `apps/worker/src/workflows/fire-schedule.workflow.ts` y `apps/worker/src/schedules/{activities,reconciler}.ts` (temporizador cada 60 s con `app.reconciler`)
- [ ] T042 `apps/worker/src/http/{activities,circuit-breaker,credentials}.ts`: cola `http` en el mismo proceso, breaker en Valkey con Lua, descifrado dentro de la activity, `node_effects`
- [ ] T043 `apps/worker/src/approvals/{activities,mail}.ts`: `notifyApprovers` en la cola principal con plantilla propia y `nodemailer`
- [ ] T044 `recordRunEvent`: altas y cierres de `approvals`, `waiting_reason` nuevos y evento en vivo; `workflow_runs` con origen del disparo
- [ ] T045 Registrar `fire-schedule`, colas y activities en `apps/worker/src/worker.ts` y `workflows/index.ts`

## Phase 4: API y web (PR 3)

### Tests

- [ ] T046 [P] `apps/api/test/webhook.e2e.test.ts` (US1, US2): `202` con `runId`; token alterado e inexistente → mismo `401`; token regenerado rechazado; marca de tiempo fuera de ±5 min y `X-Event-Id` ausente o inválido → `400`; duplicado → `200` con `duplicate: true` y una sola ejecución (también en carrera); `413`, `415`, `422`; `409 WEBHOOK_NOT_ACTIVE`; ejecuta la versión activa del momento; `429 WEBHOOK_RATE_LIMITED` por trigger y por IP con `Retry-After`; `RUN_LIMIT_REACHED`; Valkey caído → `503`; flag apagado → `404`
- [ ] T047 [P] `apps/api/test/webhook-token.e2e.test.ts`: generar y regenerar (201, `Cache-Control: no-store`, token solo ahí); estado sin token; viewer `403` al regenerar y `200` al leer; otra organización `404`
- [ ] T048 [P] `apps/api/test/webhook-redaction.test.ts` (SC-003): el token no aparece en logs, trazas, eventos de seguridad ni respuestas, con peticiones válidas e inválidas
- [ ] T049 [P] `apps/api/test/schedules.e2e.test.ts`: activar, cambiar y desactivar la versión sincroniza el Schedule; archivar lo borra; fallo de Temporal deja `pending` y la activación sigue; `SCHEDULE_LIMIT_REACHED`; zona o cron inválidos bloquean la publicación; `GET .../schedule`
- [ ] T050 [P] `apps/api/test/approvals.e2e.test.ts`: bandeja solo con lo decidible, contador, historial; decidir con y sin comentario; iniciador `403 APPROVAL_SELF_DECISION_FORBIDDEN`; viewer `403`; rol perdido `403`; doble decisión y tardía `409 APPROVAL_ALREADY_RESOLVED`; ejecución de webhook o schedule la decide cualquier owner o editor; detalle con mensaje desde Temporal y `410 APPROVAL_CONTENT_EXPIRED`; otra organización `404`
- [ ] T051 [P] `apps/api/test/credentials.e2e.test.ts`: solo el owner crea, rota y archiva; editor lista metadatos; viewer `403`; el secreto nunca en respuestas ni logs; nombre repetido `409`; cabecera prohibida `422`; sin llave maestra `503 CREDENTIALS_NOT_CONFIGURED`; publicar con credencial inexistente, archivada o de otra organización `422 CREDENTIAL_NOT_FOUND`
- [ ] T052 [P] `apps/api/test/http-hosts.e2e.test.ts`: solo el owner agrega y retira; entradas inválidas `422`; 101.ª `422`; duplicado `409`
- [ ] T053 [P] `apps/api/test/triggers-flag.e2e.test.ts`: flag apagado → `404 FEATURE_NOT_AVAILABLE` en todo F7; una versión con nodos F7 falla `UNSUPPORTED_NODES`; `executablePhases` incluye `F7` solo con el flag encendido
- [ ] T054 [P] Pruebas de componentes web: bandeja y contador (estados de carga, vacío y error), detalle y decisión con comentario, panel del webhook (token una sola vez, copiar, regenerar con confirmación), estado de la programación, administración de credenciales (el secreto no se vuelve a mostrar), lista de la allowlist, nodos F7 en el editor (con y sin flag), origen en la lista de ejecuciones

### Implementation

- [ ] T055 `apps/api/src/webhooks/` (controlador público sin sesión ni CSRF, rate limits en Valkey, token con SHA-256 y `timingSafeEqual`, ventana, `X-Event-Id`, arranque idempotente con `WorkflowIdReusePolicy.REJECT_DUPLICATE`) y `apps/api/src/logging/redact-hook-path.ts`
- [ ] T056 `apps/api/src/schedules/`: sincronización inicial al activar o desactivar versión (reutiliza el servicio de F2) y lectura del Schedule
- [ ] T057 `apps/api/src/approvals/`: bandeja, contador, detalle (lectura del historial como `run-content`) y decisión por Update
- [ ] T058 `apps/api/src/credentials/` y `apps/api/src/http-hosts/`; validación de referencias a credenciales en la publicación
- [ ] T059 `apps/api/src/runs/`: `executablePhases` con `F7`, `httpTaskQueue`, `maxDurationMs` y `workflowExecutionTimeout` ampliados con los plazos de aprobación, núcleo `startRun` compartido; `triggeredBy` nulo y `trigger` en los mapeadores
- [ ] T060 Eventos de seguridad con tipo estable (research R15) en los servicios nuevos
- [ ] T061 [US1] [US2] [US3] `apps/web/src/features/{webhooks,schedules}/`: configuración de nodos, panel del webhook, estado de la programación
- [ ] T062 [US4] `apps/web/src/features/approvals/` y ruta `orgs.$organizationId.approvals.tsx`: bandeja con contador en la barra superior (polling 30 s), detalle y decisión
- [ ] T063 [US5] [US8] [US9] `apps/web/src/features/{credentials,http-hosts}/` y selector de credencial en el nodo `http.request`
- [ ] T064 [US10] Nodos de F7 en la paleta del editor solo con `triggers-enabled`; origen "Webhook" o "Programación" en listas y detalle de ejecuciones

## Phase 5: Verificación y cierre (PR 4)

- [ ] T065 [P] Baterías de seguridad de cierre: reunir SSRF, token y replay, secretos fuera de logs y filas, y decisor de aprobaciones en `pnpm test:security` o la suite equivalente; registrar los resultados de SC-001 a SC-007
- [ ] T066 [P] ADRs 0072–0081 (research, "ADRs previstos") y actualización del ADR-0060 (circuit breaker, granularidad por servicio y bulkhead HTTP implementados)
- [ ] T067 [P] `docs/threat-model.md` (SSRF, token en la URL, credenciales, aprobaciones, circuit breaker; revisar las filas que decían `planned:F7` y los riesgos de ADR-0053 con nodos de efecto externo), `docs/PLAN.md` (F7 completada, criterio de aceptación "token inválido o regenerado", §5.4, §4 y §6.2 A08), `README.md`
- [ ] T068 Requisito para F9 anotado en `docs/PLAN.md` §9: Caddy debe redactar la ruta `/api/v1/hooks/*` en sus logs de acceso
- [ ] T069 Issue para eliminar `triggers-enabled`
- [ ] T070 Ejecutar los 31 escenarios de `quickstart.md` y registrar resultados en la PR
- [ ] T071 Checklist de Security Considerations en la PR

---

## Implementation Strategy

1. **PR 1 — Fundaciones** (Sonnet): T001–T023. `packages/connectors`, catálogo, contratos y enmienda
   de la constitution; sin migraciones, worker ni UI.
2. **PR 2 — Datos y motor** (Sonnet): T024–T045. Depende de PR 1.
3. **PR 3 — API y web** (Sonnet): T046–T064. Depende de PR 1 y PR 2 (migraciones y workflows).
4. **PR 4 — Cierre** (Haiku para docs, Sonnet para T065 y T070): T065–T071. Depende de PR 2 y PR 3.

Dentro de cada PR, las pruebas `[P]` se escriben primero y deben fallar antes de implementar.
