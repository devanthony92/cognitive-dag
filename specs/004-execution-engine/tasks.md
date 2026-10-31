---

description: "Task list for F3 — Motor de ejecución"
---

# Tasks: Motor de ejecución (F3)

**Input**: `/specs/004-execution-engine/` (spec, plan, research, data-model aprobado, contracts, quickstart)

**Tests**: incluidas; TDD obligatorio en `packages/dag-schema` (evaluador) y en autorización. Cada
prueba se escribe primero y DEBE fallar antes de implementar.

**Feature flag**: `execution-enabled`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [ ] T001 Flag `execution-enabled` en el catálogo y `.env.example`
- [ ] T002 [P] Variables del worker para Postgres (`DATABASE_URL` como `app_runtime`) y Valkey, validadas al arrancar

## Phase 2: Foundational

### Tests

- [ ] T003 [P] `packages/dag-schema/test/runtime/conditions.test.ts`: evaluación de cada operación del AST con tipos; sin evaluación de código
- [ ] T004 [P] `packages/dag-schema/test/runtime/references.test.ts`: resolución de rutas y plantillas contra salidas de nodos
- [ ] T005 [P] `packages/dag-schema/test/runtime/plan.test.ts`: nodos listos, ramas omitidas, merge `all`/`any`, nodos de fases futuras detectados (`unsupported_nodes`)
- [ ] T006 [P] `packages/db/test/rls-runs.test.ts` como `app_runtime`: aislamiento de ambas tablas, sin `DELETE`, triggers de misma organización, ejecución terminal inmutable, FK compuesta de versión, `max_concurrent_runs` con default 5

### Implementation

- [ ] T007 `packages/dag-schema/src/runtime/` (evaluador, resolución y plan de ejecución, puros)
- [ ] T008 Esquema Drizzle y migraciones (tablas, columna, RLS, privilegios, triggers) exactamente como `data-model.md`

---

## Phase 3: User Story 2 - Motor (P1)

- [ ] T009 [P] [US2] `apps/worker/test/unit/execute-dag.workflow.test.ts` (`TestWorkflowEnvironment`): paralelismo, condición con rama omitida, merge `all` y `any`, fallo rápido con cancelación, duración máxima, referencias resueltas
- [ ] T010 [P] [US2] Prueba de replay con historiales guardados del intérprete
- [ ] T011 [P] [US2] Prueba de caos: matar el worker durante un `mock.service` y verificar que no se repiten pasos completados
- [ ] T012 [US2] `execute-dag.workflow.ts` según R1 y R2
- [ ] T013 [US2] Activities `mock-service.ts` y `record-run-event.ts` (Postgres con `withContext`, idempotente, publica en Valkey `run:<runId>`)

## Phase 4: User Story 1 - Ejecutar (P1)

- [ ] T014 [P] [US1] `apps/api/test/integration/runs-start.test.ts`: versión activa, entrada inválida 422, workflow no ejecutable 409 con motivo, archivado, Temporal caído 503 sin ejecución `running`, cualquier rol puede ejecutar, otra organización 404
- [ ] T015 [US1] `apps/api/src/runs/`: inicio (R6), listado paginado y detalle con pasos y definición
- [ ] T016 [US1] Web: botón Ejecutar (deshabilitado con motivo si hay nodos no soportados) y formulario generado desde los campos del disparador manual

## Phase 5: User Story 3 - Vista en vivo (P1)

- [ ] T017 [P] [US3] Integración: SSE con snapshot, eventos por paso, `Last-Event-ID`, latido, cierre al terminar, 404 para otra organización
- [ ] T018 [P] [US3] Integración: `GET .../steps/{nodeId}/io` desde Temporal; 410 cuando ya no existe
- [ ] T019 [US3] Endpoint SSE con Valkey pub/sub y endpoint de entrada/salida
- [ ] T020 [US3] Web: lista de ejecuciones y detalle con el grafo de la versión, estados por nodo en vivo (`EventSource` con respaldo a polling) y panel de detalle de nodo

## Phase 6: User Story 4 - Cancelar y reejecutar (P2)

- [ ] T021 [P] [US4] Integración: cancelar en curso (nodos cancelados), cancelar terminada 409, reejecutar enlaza `rerun_of`, entrada vencida 410
- [ ] T022 [US4] Endpoints de cancelación y reejecución, botones en la web y eventos de seguridad (`run.started`, `run.cancelled`, `run.rerun`)

## Phase 7: User Story 5 - Límite (P2)

- [ ] T023 [P] [US5] Integración: límite 1 rechaza la segunda con 429; inicios simultáneos nunca superan el límite (SC-005)
- [ ] T024 [US5] Control con `pg_advisory_xact_lock`; `pnpm ops:set-limits --max-concurrent-runs`; límite visible en ajustes

## Phase 8: Polish

- [ ] T025 [P] ADRs: intérprete único con definición en la entrada, registro de ejecuciones en Postgres, contenido solo en Temporal, SSE con Valkey pub/sub, cualquier miembro ejecuta (a revisar en F7), fallo rápido y ramas omitidas, límite de ejecuciones
- [ ] T026 [P] `docs/threat-model.md`, `docs/PLAN.md`, `README.md`
- [ ] T027 Issue para eliminar `execution-enabled`
- [ ] T028 Ejecutar los 12 escenarios de `quickstart.md` y registrar resultados en la PR
- [ ] T029 Checklist de Security Considerations en la PR

---

## Implementation Strategy (todo detrás de `execution-enabled`)

1. **PR 1**: Setup + Foundational + US2 (T001–T013). Motor y modelo de datos, sin API ni UI.
2. **PR 2**: US1 + US3 + US4 + US5 en el API (T014, T015, T017–T019, T021–T024 sin web).
3. **PR 3**: Web (T016, T020, partes web de T022 y T024) + Polish (T025–T029).
