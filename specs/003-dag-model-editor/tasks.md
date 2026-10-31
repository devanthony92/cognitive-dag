---

description: "Task list for F2 — Modelo DAG y editor visual"
---

# Tasks: Modelo DAG y editor visual (F2)

**Input**: `/specs/003-dag-model-editor/` (spec, plan, research, data-model aprobado, contracts, quickstart)

**Tests**: incluidas. TDD obligatorio en `packages/dag-schema` y en autorización (constitution III):
cada prueba se escribe primero y DEBE fallar antes de implementar.

**Feature flag**: `dag-editor-enabled`; apagado, los endpoints de F2 responden 404
`FEATURE_NOT_AVAILABLE` y el editor no aparece.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Crear `packages/dag-schema` (ESM, Zod, condición de export `@cognitive-dag/source`, Vitest)
- [X] T002 [P] Agregar el flag `dag-editor-enabled` al catálogo y a `.env.example` _(hecho en el PR 2 de F2, junto con los endpoints de la API; la web lo usa desde el PR 3)_
- [X] T003 [P] Agregar `@xyflow/react` 12.12 y `@dagrejs/dagre` 3.1 a `apps/web` (versiones con más de un día) _(hecho en el PR 3 de F2: `@xyflow/react` 12.12.0 y `@dagrejs/dagre` 3.1.3; dagre se usa desde el PR 4)_

---

## Phase 2: Foundational — modelo del DAG (`packages/dag-schema`, TDD)

### Tests (primero, fallando)

- [X] T004 [P] `test/definition.test.ts`: forma de R2, ids `^[a-z][a-z0-9_]{0,39}$` únicos, objetos estrictos sin campos desconocidos, `schemaVersion` 1
- [X] T005 [P] `test/catalog.test.ts`: los 11 tipos con config por defecto válida, `handles`, `templatableFields`, `executableFrom`; salidas calculadas desde la configuración (`llm.extract`, `trigger.*`); `http.request` rechaza URL no https y cabeceras de autorización (FR-005)
- [X] T006 [P] `test/types.test.ts`: compatibilidad de R4 (`enum`→`string` sí, `string`→`enum` no, objetos y listas)
- [X] T007 [P] `test/references.test.ts`: rutas válidas, nodo inexistente, nodo no ancestro, campo inexistente, tipo incompatible
- [X] T008 [P] `test/templates.test.ts`: tokenización de `{{...}}`, marcadores mal formados, campos no plantillables literales, sin evaluación
- [X] T009 [P] `test/conditions.test.ts`: operaciones de R6, profundidad 5, máximo 20 operaciones, tipos de operandos
- [X] T010 [P] `test/validate.test.ts`: un caso por regla de R7 (disparador único, sin entradas al disparador, conexiones a handles existentes, ciclos con los nodos del ciclo, inalcanzables, límites); orden de errores determinista
- [X] T011 [P] `test/performance.test.ts`: validar 50 nodos y 100 conexiones en < 100 ms (SC-003)

### Implementation

- [X] T012 `src/definition.ts` y `src/types.ts`
- [X] T013 `src/catalog/` un archivo por tipo según R3
- [X] T014 `src/references.ts`, `src/templates.ts`, `src/conditions.ts`
- [X] T015 `src/validate.ts` y `src/limits.ts` (errores con `code`, `message` en español, `location`)

**Checkpoint**: `dag-schema` completo y en verde

---

## Phase 3: Persistencia y API

### Tests

- [X] T016 [P] `packages/db/test/rls-workflows.test.ts` como `app_runtime`: aislamiento de las 4 tablas; sin `UPDATE` ni `DELETE` en `workflow_versions`; sin escritura en `organization_limits`; FK compuesta impide activar una versión de otro workflow; triggers de misma organización y de desactivación al archivar
- [X] T017 [P] `apps/api/test/integration/workflows.test.ts`: crear, listar, renombrar, nombre repetido 409, archivar solo owner, viewer 403 al escribir, otra organización 404
- [X] T018 [P] `drafts.test.ts`: guardar con errores devuelve `validation`; sin `If-Match` 428; revisión vieja 409 `DRAFT_CONFLICT`; definición sobre el límite 413 `LIMIT_EXCEEDED`; campo desconocido 422
- [X] T019 [P] `versions.test.ts`: publicar crea v1, v2 correlativas e inmutables con `definition_hash`; publicar con errores 422 `DAG_INVALID` con `dagErrors`; publicaciones paralelas crean una sola versión; reactivar no crea versión; copiar versión al borrador

### Implementation

- [X] T020 Esquema Drizzle de las 4 tablas exactamente como `data-model.md` y migración `0003`
- [X] T021 Migración manual `0004`: RLS, privilegios, triggers y FK compuesta
- [X] T022 `apps/api/src/workflows/`: endpoints del contrato, guard de rol (owner/editor escriben, viewer lee, owner archiva), publicación en transacción con `FOR UPDATE` (R11), ETag e `If-Match` (R10)
- [X] T023 `GET /limits` y `scripts/ops/set-limits.ts` (`pnpm ops:set-limits`, conecta como `app_migrator`, valida contra máximos absolutos, registra el cambio)
- [X] T024 Eventos de seguridad: `workflow.created`, `workflow.published`, `workflow.version_activated`, `workflow.archived`

---

## Phase 4: User Story 1 - Editor básico (P1) 🎯 MVP

- [X] T025 [P] [US1] Pruebas de componentes: paleta, lienzo, conexión, panel por tipo, Guardar, aviso al salir, viewer en solo lectura
- [X] T026 [US1] Lista de workflows y creación (`/orgs/$organizationId/workflows`)
- [X] T027 [US1] Editor con React Flow: paleta con los 11 tipos (indicando "se ejecuta desde F3/F5/F7"), nodos y conexiones con handles del catálogo
- [X] T028 [US1] Panel lateral con formulario generado desde `configSchema` (React Hook Form)
- [X] T029 [US1] Guardar con `If-Match`, último guardado visible, confirmación al salir con cambios

## Phase 5: User Story 2 - Validación en vivo (P1)

- [X] T030 [P] [US2] Pruebas: errores marcados en nodos, conexiones y campos; lista de problemas; Publicar deshabilitado con errores
- [X] T031 [US2] Validación en vivo con debounce de 200 ms usando `dag-schema`

## Phase 6: User Story 3 - Versiones (P1)

- [X] T032 [P] [US3] Pruebas: publicar con nota, historial, activar, copiar al borrador con confirmación
- [X] T033 [US3] Botón Publicar con nota opcional e historial de versiones con activar y copiar al borrador

## Phase 7: User Story 4 - Referencias, plantillas y condiciones (P2)

- [X] T034 [P] [US4] Pruebas: selector solo ofrece campos de ancestros compatibles; marcadores en plantillas; constructor de condiciones produce AST válido
- [X] T035 [US4] Selector de referencias, editor de plantillas y constructor visual de condiciones
- [X] T036 [US4] Renombrar el id de un nodo reescribe sus referencias; borrar un nodo deja las referencias marcadas como inválidas

## Phase 8: User Story 5 - Concurrencia (P2)

- [X] T037 [US5] Aviso de conflicto 409 con opción de recargar el borrador (prueba de componente incluida)

## Phase 9: User Stories 6 y 7 - Herramientas y límites (P3)

- [X] T038 [P] [US6] Ordenar con dagre y Exportar JSON (prueba: el JSON exportado valida con el esquema)
- [X] T039 [P] [US7] Límites vigentes visibles en los ajustes de la organización
- [X] T040 [US6] Prueba de rendimiento del editor con 50 nodos y 100 conexiones (SC-004)

## Phase 10: Polish

- [X] T041 [P] ADRs: `dag-schema` compartido, catálogo completo, versiones inmutables con tabla puente de versión activa, AST de condiciones y plantillas, bloqueo optimista, límites por organización con operador, React Flow y dagre
- [X] T042 [P] Actualizar `docs/threat-model.md`, `docs/PLAN.md` (O4 cerrada) y `README.md`
- [X] T043 Issue de eliminación del flag `dag-editor-enabled`
- [X] T044 Ejecutar los 14 escenarios de `quickstart.md` y registrar resultados en la PR
- [X] T045 Checklist de "Security Considerations" de la spec en la PR

---

## Implementation Strategy (todo detrás de `dag-editor-enabled`)

1. **PR 1**: Setup + Foundational (T001–T015). El modelo completo, sin UI ni base de datos.
2. **PR 2**: Persistencia y API (T016–T024). **El esquema debe coincidir exactamente con el
   `data-model.md` aprobado**; cualquier cambio requiere aprobación del autor.
3. **PR 3**: US1 + US2 + US3 (T025–T033). Editor, validación en vivo y versiones.
4. **PR 4**: US4–US7 + Polish (T034–T045).
