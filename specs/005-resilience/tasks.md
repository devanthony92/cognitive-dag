---

description: "Task list for F4 — Resiliencia"
---

# Tasks: Resiliencia (F4)

**Input**: `/specs/005-resilience/` (spec, plan, research, data-model aprobado, contracts, quickstart)

**Tests**: incluidas; TDD obligatorio en `packages/dag-schema` (taxonomía, políticas, reutilizables),
en el token bucket y en autorización. Cada prueba se escribe primero y DEBE fallar antes de
implementar.

**Feature flag**: `resilience-enabled` (solo lo visible: ajustes de reintento en el editor,
reejecutar desde un nodo y el listado de la organización).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Flag `resilience-enabled` en el catálogo y `.env.example`
- [X] T002 [P] Variables del worker `RATE_LIMIT_<NODE_TYPE>` (`capacity:N,refillPerSecond:M`), validadas al arrancar; ejemplo comentado en `.env.example`

## Phase 2: Foundational

### Tests

- [X] T003 [P] `packages/dag-schema/test/runtime/errors.test.ts`: clases, códigos y `classify` para cada fallo (transitorio, limitado con espera, tiempo, permanente, desconocido → transitorio)
- [X] T004 [P] `packages/dag-schema/test/catalog/retry-policy.test.ts`: `retry` aceptado solo en nodos con efecto, límites 1–10 / 1–120 s / 100–30000 ms con mensajes en español, valores por defecto por tipo, `mock.service` ampliado (`rate_limited` + `retryAfterMs`, `failFirstAttempts`)
- [X] T005 [P] `packages/dag-schema/test/runtime/rerun.test.ts`: nodos reutilizables (efecto, `succeeded`, no descendientes del elegido ni el elegido), desde un disparador, desde un nodo omitido, nodo inexistente
- [X] T006 [P] `packages/db/test/rls-effects.test.ts` como `app_runtime`: aislamiento de `node_effects`, sin `DELETE`, misma organización, clave = `run_id:node_id`, `committed` inmutable, `committed_at` coherente; `reused`, `error_class`, `waiting_reason` y `rerun_from_node_id` con sus `CHECK`

### Implementation

- [X] T007 `packages/dag-schema/src/runtime/errors.ts` y `rerun.ts` (puros); `retry` y valores por defecto en el catálogo; `mock.service` ampliado; validación en `validate.ts`
- [X] T008 Esquema Drizzle y migraciones (tabla, enum, columnas, índices, RLS, privilegios, triggers) exactamente como `data-model.md`
- [X] T009 Contratos Zod en `packages/contracts`: `StepStatus` con `reused`, `ErrorClass`, error con `class`, `waitingReason`, `rerunFromNodeId`, códigos nuevos

---

## Phase 3: User Stories 1–4 - Motor resiliente (P1)

### Tests

- [X] T010 [P] [US1] `apps/worker/test/unit/execute-dag.workflow.test.ts` (tiempo simulado): transitorio con backoff hasta el máximo; permanente sin reintentos; limitado respeta `nextRetryDelay`; tiempo reintentado; paso fallido con clase y código
- [X] T011 [P] [US2] Workflow: política efectiva por nodo (`retry` o por defecto) y `scheduleToCloseTimeout` total
- [X] T012 [P] [US3] `apps/worker/test/integration/rate-limiter.test.ts` (Valkey real): token bucket atómico, reposición, aislamiento por organización y tipo, Valkey caído → transitorio; las esperas no gastan `maxAttempts`; `waiting_reason` puesto y limpiado
- [X] T013 [P] [US4] `apps/worker/test/integration/effects.test.ts`: misma clave en reintentos; efecto `committed` no se repite; `started` se reintenta; destino simulado deduplica por clave

### Implementation

- [X] T014 [US1] Traducción de errores de `mock.service` a la taxonomía; registro de `error_class` en paso y ejecución (`record-run-event`)
- [X] T015 [US2] Políticas por nodo en `execute-dag.workflow.ts` (un `proxyActivities` por política efectiva, con `patched()` para no romper historiales de F3)
- [X] T016 [US3] `apps/worker/src/resilience/rate-limiter.ts` (script Lua) y su uso en la activity con contador propio de intentos en heartbeat details
- [X] T017 [US4] `apps/worker/src/resilience/effects.ts` (protocolo de R4) y registro del destino simulado en Valkey

---

## Phase 4: User Story 5 - Reejecutar desde un nodo (P2)

- [ ] T018 [P] [US5] `apps/api/test/integration/runs-rerun-from-node.test.ts`: misma versión de la original, reutilizables `reused` sin intentos, lógica recalculada, `rerun_from_node_id`, 422 `RERUN_NODE_INVALID`, 409 `RUN_NOT_FINISHED`, 410 `RUN_INPUT_EXPIRED`, otra organización 404, flag apagado 404
- [ ] T019 [P] [US5] Workflow: `memoized` registra `reused` sin activity y entrega las salidas a los descendientes
- [ ] T020 [US5] API: `fromNodeId` en `rerunRun` (lectura de salidas del historial de Temporal), `memoized` en la entrada de `executeDag`, evento de seguridad `run.rerun` con el nodo
- [ ] T021 [US5] Web: acción "Reejecutar desde aquí" en el panel del nodo de una ejecución terminada; estado "Reutilizado" en grafo y panel; enlace a la original con el nodo

## Phase 5: User Story 6 - Ejecuciones de la organización (P2)

- [ ] T022 [P] [US6] Integración: `GET /organizations/{org}/runs` paginado, filtros `status` y `workflowId`, `workflowName` y `failedNodeId`, filtros inválidos 422, otra organización vacía, flag apagado 404
- [ ] T023 [US6] Endpoint del listado de la organización
- [ ] T024 [US6] Web: página "Ejecuciones" de la organización en la navegación, filtros por estado y workflow, clase del error en fallidas, acciones Reejecutar y Reejecutar desde el nodo fallido

## Phase 6: User Story 2 - Editor (P1, web)

- [ ] T025 [US2] Web: sección "Reintentos" en el panel de nodos con efecto (valores por defecto como marcador, errores por campo); oculta en lógica y disparadores; detrás del flag
- [ ] T026 [US1] Web: clase del error en el panel del paso y "Esperando por el límite" cuando `waitingReason = rate_limited`

## Phase 7: User Story 7 - Verificación (P2)

- [ ] T027 [P] [US7] `apps/worker/test/chaos/`: matar el worker (existente, ahora comprobando efectos), reiniciar Temporal, pausar Valkey, pausar PostgreSQL; `pnpm test:chaos`; job de CI separado y manual (`workflow_dispatch`) además de semanal
- [ ] T028 [P] [US7] Historiales reales en `apps/worker/test/replay/histories/` (F3 y F4: paralelismo, rama omitida, fallo, cancelación, rate limit, reutilizados) reproducidos en el job `integration`
- [ ] T029 [US7] `scripts/demo/recovery.ts` y `pnpm demo:recovery`

## Phase 8: Polish

- [ ] T030 [P] ADRs: taxonomía de errores, políticas por nodo, rate limit sin ocupar el worker, idempotencia de efectos, reejecución desde nodo sobre la versión original, decisiones diferidas (circuit breaker con 3C, granularidad, cuotas diarias, bulkheads)
- [ ] T031 [P] `docs/threat-model.md`, `docs/PLAN.md`, `README.md`
- [ ] T032 Issue para eliminar `resilience-enabled`
- [ ] T033 Ejecutar los 13 escenarios de `quickstart.md` y registrar resultados en la PR
- [ ] T034 Checklist de Security Considerations en la PR

---

## Implementation Strategy

1. **PR 1**: Setup + Foundational + motor (T001–T017). Modelo de datos y motor, sin API ni UI nuevas.
2. **PR 2**: Recuperación y revisión en API y web (T018–T026).
3. **PR 3**: Verificación y cierre (T027–T034).
