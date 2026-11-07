---

description: "Task list for F6 — Compilador de lenguaje natural a DAG"
---

# Tasks: Compilador de lenguaje natural a DAG (F6)

**Input**: `/specs/007-nl-compiler/` (spec, plan, research, data-model aprobado, contracts, quickstart)

**Tests**: incluidas; TDD obligatorio en `packages/compiler`, en el presupuesto del compilador y en
autorización. Cada prueba se escribe primero y DEBE fallar antes de implementar. Ninguna prueba de CI
llama a Gemini: usan `FakeProvider`.

**Feature flag**: `nl-compiler-enabled` (endpoints y UI del compilador). Kill switch del worker:
`LLM_ENABLED`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Flag `nl-compiler-enabled` en `packages/contracts/src/flags.ts`, catálogo del API (con issue de retiro) y `.env.example` (`true`)
- [X] T002 [P] Paquete `packages/compiler` (tsconfig, Vitest, exportación `@cognitive-dag/source`), sin dependencias nuevas
- [X] T003 [P] Variables validadas al arrancar: worker `LLM_MODEL_COMPILER` (default `gemini-3.5-flash-lite`), `LLM_MAX_TOKENS_PER_COMPILATION` (30000); API `COMPILER_MAX_PER_USER_HOUR` (10), `COMPILER_MAX_PER_ORG_DAY` (50); ejemplos en `.env.example`

## Phase 2: Foundational (PR 1)

### Tests

- [X] T004 [P] `packages/dag-schema/test/catalog/sensitive-fields.test.ts`: `sensitiveFields` opcional; `http.request` marca destino, cabeceras y cuerpo; los demás tipos sin campos sensibles
- [X] T005 [P] `packages/compiler/test/catalog.test.ts`: filtro por fases ejecutables (`['F3']`, `['F3','F5']`); descripción de cada tipo derivada de Zod (campos, requeridos, enums, handles); sin tipos F7
- [X] T006 [P] `packages/compiler/test/intermediate.test.ts`: esquema intermedio (`title`, `nodes[{id,type,label,config}]`, `edges[{from,fromHandle,to}]`) → JSON Schema compatible con structured output y Zod equivalente; `config` discriminado por `type` solo con los tipos permitidos
- [X] T007 [P] `packages/compiler/test/prompt.test.ts`: instrucciones en inglés sin secretos; catálogo incluido; intención dentro de `<data-{nonce}>`; canario por llamada; un cierre falso no escapa
- [X] T008 [P] `packages/compiler/test/translate.test.ts`: traducción a `DagDefinition` (`schemaVersion` 1, ids de arista `<from>-<fromHandle>-<to>`, etiquetas ≤ 100); resultado validado con `validateDraft` de `dag-schema`
- [X] T009 [P] `packages/compiler/test/layout.test.ts`: capas por distancia máxima desde el trigger; sin solapes; determinista; DAG con varias ramas y merge
- [X] T010 [P] `packages/compiler/test/sanitize.test.ts`: con un catálogo de pruebas, los campos sensibles rellenados se quitan y se listan en `omittedSensitiveFields`; la validación los reporta como requeridos
- [X] T011 [P] `packages/compiler/test/compile.test.ts` con `FakeProvider`: éxito directo; ciclo → 1 reparación → éxito; 3 inválidos que cumplen el esquema → `COMPILER_INVALID_DAG` con `fallback`; 3 que no cumplen → sin `fallback`; bloqueo → `LLM_CONTENT_BLOCKED` sin reparar; tipo fuera del catálogo → `UNKNOWN_TYPE` reparable; canario → inválido; el turno de reparación solo lleva códigos y rutas (nunca la intención ni etiquetas)
- [X] T012 [P] `packages/compiler/test/properties.test.ts`: evaluador de propiedades esperadas (tipos requeridos y prohibidos, rango de nodos, trigger único, alcanzabilidad, ramas de condición conectadas) y detector de escapes
- [X] T013 [P] `packages/contracts/test/compilations.test.ts`: `CreateCompilationRequest` (1–2000 tras recortar, estricto), `Compilation`, `CompilationResult` según `contracts/api.openapi.yaml`

### Implementation

- [X] T014 `dag-schema`: `sensitiveFields` en `catalog/shared.ts` y `http-request.ts`
- [X] T015 `packages/compiler/src/{catalog,intermediate,prompt,translate,layout,sanitize,compile,properties}.ts`; `compile` usa `guard` de `packages/llm` con `MAX_REPAIRS` y `check` semántico, y un `beforeCall` inyectable para el presupuesto
- [X] T016 [P] `packages/contracts/src/compilations.ts` y códigos `COMPILER_*`
- [X] T017 [P] Dataset `packages/compiler/evals/intents.json` (~30, español e inglés) e `injection.json` (~10), con respuestas grabadas en `evals/fake-responses/`
- [X] T018 `scripts/eval/compiler.ts` y `pnpm eval:compiler` (`fake` por defecto): tasa de éxito, reparaciones, escapes, tokens y costo; falla si hay escapes o si la tasa < 80 %; paso en CI con `fake`

## Phase 3: Motor (PR 2)

### Tests

- [X] T019 [P] `packages/db/test/rls-compilations.test.ts` como `app_runtime`: aislamiento de `compilations`; sin `DELETE`; `CHECK` de modo, error, final y fallback; inmutable al terminar y columnas fijas; misma organización del workflow; `llm_calls` con dueño compilación (`node_type = 'compiler'`, sin ejecución ni nodo) y `CHECK` de dueño único; filas de F5 siguen válidas
- [X] T020 [P] `apps/worker/test/compiler/compile-intent.workflow.test.ts` (`TestWorkflowEnvironment` + `FakeProvider`): estados `running → succeeded|failed`; métricas en la fila; resultado y `fallback` como valor de retorno; reintento solo en errores transitorios o limitados
- [X] T021 [P] `apps/worker/test/compiler/budget.test.ts`: reserva por llamada en `llm_usage_daily` y tope `LLM_MAX_TOKENS_PER_COMPILATION`; agotado → `LLM_DAILY_BUDGET_EXHAUSTED` o `COMPILER_BUDGET_EXHAUSTED` sin llamar; una fila de `llm_calls` por llamada; ajuste tras la respuesta
- [X] T022 [P] `apps/worker/test/compiler/no-execution.test.ts`: una compilación no crea versiones, no activa ni inicia ejecuciones (SC-003)
- [X] T023 [P] `apps/worker/test/compiler/no-content.test.ts`: logs y filas sin intención ni DAG (SC-005)

### Implementation

- [X] T024 Migraciones `0012_compilations_llm_calls_owner.sql` (tabla, columnas, `CHECK`, índices) y `0013_compilations_rls_triggers_grants.sql`; esquema Drizzle en `packages/db/src/schema/{compilations,llm-calls}.ts`
- [X] T025 `apps/worker/src/workflows/compile-intent.workflow.ts` y `apps/worker/src/compiler/{activities,budget}.ts` en la cola LLM; `LLM_ENABLED=false` → `LLM_DISABLED` sin llamada; nonce y canario en la activity

## Phase 4: API y web (PR 3)

### Tests

- [X] T026 [P] `apps/api/test/compilations.e2e.test.ts`: 202 y fila `queued`; modo `regenerate` guarda `draftRevision`; 400 intención vacía o > 2000; 403 viewer; 404 otra organización y flag apagado; 429 por persona con `Retry-After` y por organización por día; catálogo pasado al workflow según `llm-nodes-enabled`
- [X] T027 [P] `apps/api/test/compilation-result.e2e.test.ts`: resultado desde el historial; 409 `COMPILER_NOT_FINISHED` y `COMPILER_NO_RESULT`; 410 `COMPILER_RESULT_EXPIRED`
- [X] T028 [P] Pruebas de componentes web: formulario de intención (contador, límite), estados, vista previa de solo lectura, crear (POST + PUT draft), reemplazar con confirmación y conflicto de revisión, abrir el último intento, campos sensibles omitidos, compilaciones recientes; estados de carga, vacío y error

### Implementation

- [X] T029 `apps/api/src/compilations/` (controller, service, límites con Valkey y conteo diario, lectura del resultado desde Temporal) y flag en `flags.catalog.ts`
- [X] T030 [US1] [US2] `apps/web/src/features/compiler/` y ruta `orgs.$organizationId.workflows.new.tsx`; entrada "Describir workflow" en la lista y "Regenerar borrador" en el editor; métricas de la compilación; aviso de capa gratuita

## Phase 5: Verificación y cierre (PR 4)

- [X] T031 [P] [US7] `pnpm eval:compiler` con Gemini (local) y job manual `.github/workflows/compiler-evals.yml` (`workflow_dispatch`, secret `GEMINI_API_KEY`); registrar tasa, reparaciones, tokens y costo
- [X] T032 [P] ADRs 0067–0071 (research, "ADRs previstos") y enmienda PATCH de la constitution (TDD en `packages/compiler`)
- [X] T033 [P] `docs/threat-model.md` (compilador: LLM01, LLM03, LLM06), `docs/PLAN.md` (F6 completada, O6 cerrada del todo, métrica de éxito del compilador), `README.md`
- [X] T034 Issue para eliminar `nl-compiler-enabled`
- [X] T035 Ejecutar los 12 escenarios de `quickstart.md` y registrar resultados en la PR
- [X] T036 Checklist de Security Considerations en la PR

---

## Implementation Strategy

1. **PR 1 — Fundaciones** (Sonnet): T001–T018. `packages/compiler`, catálogo, contratos, dataset y
   `eval:compiler` con `fake`; sin migraciones, worker ni UI.
2. **PR 2 — Motor** (Sonnet): T019–T025. Depende de PR 1.
3. **PR 3 — API y web** (Sonnet): T026–T030. Depende de PR 1 y PR 2 (migraciones y workflow).
4. **PR 4 — Cierre** (Haiku para docs, Sonnet para T031): T031–T036. Depende de PR 2 y PR 3.
