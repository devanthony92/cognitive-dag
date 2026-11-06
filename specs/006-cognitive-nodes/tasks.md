---

description: "Task list for F5 — Nodos cognitivos"
---

# Tasks: Nodos cognitivos (F5)

**Input**: `/specs/006-cognitive-nodes/` (spec, plan, research, data-model aprobado, contracts, quickstart)

**Tests**: incluidas; TDD obligatorio en `packages/llm`, `packages/dag-schema`, en el presupuesto y en
autorización. Cada prueba se escribe primero y DEBE fallar antes de implementar. Ninguna prueba de CI
llama a Gemini: usan `FakeProvider`.

**Feature flag**: `llm-nodes-enabled` (paleta y ejecución de nodos LLM, consumo por paso, ejecución y
día). Kill switch del worker: `LLM_ENABLED`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Flag `llm-nodes-enabled` en `packages/contracts/src/flags.ts`, catálogo del API y `.env.example` (`true`)
- [X] T002 [P] Paquete `packages/llm` (tsconfig, Vitest, exportación `@cognitive-dag/source`) y dependencia `@google/genai` con versión exacta de más de dos semanas, sin exclusiones de `minimumReleaseAge`
- [X] T003 [P] Variables del worker validadas al arrancar (nunca se registra su valor): `LLM_PROVIDER` (`fake`|`gemini`), `GEMINI_API_KEY` (obligatoria con `gemini`), `LLM_ENABLED`, `LLM_MODEL_CLASSIFY/EXTRACT/GENERATE`, `LLM_PRICES`, `LLM_MAX_TOKENS_PER_RUN`, `LLM_MAX_TOKENS_PER_ORG_DAY`, `LLM_MAX_INPUT_CHARS`, `TEMPORAL_LLM_TASK_QUEUE`, `LLM_MAX_CONCURRENT_ACTIVITIES`, `RATE_LIMIT_LLM_MODEL`; el API lee `LLM_MAX_TOKENS_PER_ORG_DAY`; ejemplos en `.env.example` con `LLM_PROVIDER=fake` y `GEMINI_API_KEY=` vacía

## Phase 2: Foundational

### Tests

- [X] T004 [P] `packages/dag-schema/test/runtime/errors.test.ts`: `invalid_output` y `budget_exhausted` son clases válidas y no reintentables
- [X] T005 [P] `packages/dag-schema/test/catalog/llm-nodes.test.ts`: `redactPii` opcional (default `false`), `retry` aceptado con defaults (3 intentos, 60 s, 2000 ms), DAGs de F2 sin esos campos siguen válidos; `confidence` en [0,1] en el `outputSchema` de clasificar
- [X] T006 [P] `packages/dag-schema/test/runtime/plan.test.ts` y `rerun.test.ts`: fases ejecutables por parámetro (`['F3']` y `['F3','F5']`); nodos `llm` exitosos reutilizables
- [X] T007 [P] `packages/llm/test/schema.test.ts`: `DagType` → JSON Schema compatible con structured output (enum cerrado, `additionalProperties: false`, `required`, nulos solo si el campo los admite) y validador Zod equivalente
- [X] T008 [P] `packages/llm/test/prompt.test.ts`: instrucciones en inglés por tipo, sin secretos; texto del usuario dentro de `<data-{nonce}>`; nonce y canary distintos en cada llamada; un texto con `</data-...>` falso no cierra el bloque; idioma de salida de generar
- [X] T009 [P] `packages/llm/test/guard.test.ts`: reparación hasta 2 con errores resumidos sin texto del usuario; tercera inválida → `LLM_INVALID_OUTPUT`; bloqueo → `LLM_CONTENT_BLOCKED` sin reparar; truncado por tokens → reparable; canary en la salida → `LLM_CANARY_LEAK`; generar no recorta: un texto que excede `maxLength` es salida inválida (reparable)
- [X] T010 [P] `packages/llm/test/redaction.test.ts`: correo, teléfono CO e internacional, tarjeta con Luhn (y no sin Luhn), cédula/NIT con palabra clave; marcadores numerados; texto sin PII intacto
- [X] T011 [P] `packages/llm/test/estimate-cost.test.ts`: estimación `ceil(chars/4) + maxOutputTokens`; `maxOutputTokens` por tipo (generar desde `maxLength`); costo en micro-USD con `LLM_PRICES`; modelo sin precio → costo 0 y aviso al arrancar
- [X] T012 [P] `packages/llm/test/errors.test.ts`: traducción de errores de Gemini (5xx/red → `LLM_PROVIDER_UNAVAILABLE`, 429 → `LLM_PROVIDER_RATE_LIMITED`, 400/401/403 → `LLM_PROVIDER_REJECTED`)
- [X] T013 [P] `packages/llm/test/injection/injection.test.ts` con `cases.json` (~30 casos): cada caso con su salida maliciosa del `FakeProvider` es rechazado o produce salida válida por esquema; 0 escapes (US4)
- [X] T014 [P] `packages/db/test/rls-llm.test.ts` como `app_runtime`: aislamiento de `llm_calls` y `llm_usage_daily`; sin `DELETE`; `llm_calls` inmutable y misma organización; `CHECK` de `outcome`/`error_code`, `repairs`, `node_type`; `error_class` ampliado; `llm_tokens_used` ajustable hacia abajo tras el final y nada más

### Implementation

- [X] T015 `dag-schema`: clases nuevas en `errors.ts`; `plan.ts` con fases ejecutables por parámetro; `rerun.ts` con `llm`; catálogo LLM con `retryDefaults` y `redactPii`
- [X] T016 `packages/llm`: `LlmProvider`, `FakeProvider` (guiones), `GeminiProvider`, prompt, guardián con reparación, redacción, estimación, costo, traducción de errores
- [X] T017 Esquema Drizzle y migraciones `0010_*` (tablas, columna, `CHECK`, índices) y `0011_*` (RLS, privilegios, triggers) exactamente como `data-model.md`
- [X] T018 Contratos Zod en `packages/contracts`: `ErrorClass` ampliado, `LlmUsage`, `LlmDailyUsage`, `llmUsage` en `RunDetail` y `RunStep`, códigos nuevos (research R15), `executablePhases` en la entrada de `executeDag`

---

## Phase 3: User Stories 1–3 - Motor LLM (P1)

### Tests

- [X] T019 [P] [US3] `apps/worker/test/integration/llm-budget.test.ts` (PostgreSQL real): reserva atómica por ejecución y por día; concurrencia (20 reservas en paralelo nunca superan el límite); ajuste real − estimado; otra organización no afectada; PostgreSQL caído → transitorio sin llamada; evento `llm.budget_exhausted`
- [X] T020 [P] [US1] `apps/worker/test/unit/llm-activities.test.ts` con `FakeProvider`: los tres nodos devuelven salidas válidas; fila de `llm_calls` sin contenido; reparaciones; entrada vacía y demasiado grande → permanentes sin llamada; `LLM_ENABLED=false` → `LLM_DISABLED` sin llamada; `redactPii` aplicado antes de enviar
- [X] T021 [P] [US2] Workflow (tiempo simulado): `invalid_output` y `budget_exhausted` no se reintentan y la ejecución falla con esa clase; 5xx y 429 siguen F4; activities LLM en `TEMPORAL_LLM_TASK_QUEUE`; nodos `reused` sin activity
- [X] T022 [P] [US3] Rate limit global por modelo (`rl:global:<modelo>`) además del de organización y tipo; pedido antes de reservar
- [X] T023 [P] [US5] Prueba de logs: una ejecución completa con texto marcado no deja ese texto en logs, eventos ni `llm_calls` (SC-004)

### Implementation

- [X] T024 [US1] `apps/worker/src/llm/activities.ts` (`llmClassify`, `llmExtract`, `llmGenerate`): rate limit, reserva, llamada, guardián, ajuste y registro; errores de la taxonomía
- [X] T025 [US3] `apps/worker/src/llm/budget.ts` (reserva y ajuste de research R4) y evento de seguridad
- [X] T026 [US1] `execute-dag.workflow.ts`: proxy LLM con `taskQueue` propio y política por nodo; `executablePhases` desde la entrada; segundo `Worker` en `worker.ts` con `LLM_MAX_CONCURRENT_ACTIVITIES`
- [X] T027 [P] Historial real con nodos LLM agregado al replay de `apps/worker/test/replay/histories/`

---

## Phase 4: User Stories 1, 3, 5, 6 - API y web (P1/P2)

- [X] T028 [P] [US6] `apps/api/test/integration/llm-flag.test.ts`: flag apagado → nodos LLM no ejecutables (409 `WORKFLOW_NOT_RUNNABLE`), consumo 404, `llmUsage` null; encendido → ejecutables con `executablePhases: ['F3','F5']`
- [X] T029 [P] [US3] `apps/api/test/integration/llm-usage.test.ts`: `GET /organizations/{org}/llm-usage/today` (día UTC, límite, costo), otra organización 404, sin consumo → ceros; `llmUsage` por paso y ejecución sumado de `llm_calls`
- [X] T030 [US3] API: módulo `llm-usage`, `llmUsage` en el detalle de la ejecución, fases ejecutables según el flag al iniciar y reejecutar
- [X] T031 [US1] Web: en el panel del paso LLM, modelo, tokens, costo estimado, reparaciones y "Confianza estimada"; total de la ejecución en la cabecera; clases nuevas con texto en español ("Salida inválida", "Presupuesto agotado")
- [X] T032 [US3] Web: tarjeta "Consumo LLM de hoy" en la página de la organización (usados/límite, barra, costo), con carga, vacío ("Sin consumo hoy") y error; 800 px
- [X] T033 [US5] Web: en el panel de los nodos LLM, interruptor "Ocultar datos personales" y aviso "No envíes datos reales: el proveedor puede usar el contenido"; paleta con nodos LLM ejecutables con el flag
- [X] T034 [P] Pruebas de componentes web de T031–T033 con el flag encendido y apagado

---

## Phase 5: Verificación y cierre

- [X] T035 [P] [US4] `scripts/eval/llm.ts` y `pnpm eval:llm` con Gemini: set de inyección y salidas válidas de los tres nodos; reporta escapes, tokens y costo; falla si hay escapes
- [X] T036 [P] `.github/workflows/llm-evals.yml` solo `workflow_dispatch`, con el secret `GEMINI_API_KEY`
- [X] T037 [P] ADRs (research, "ADRs previstos"), enmienda PATCH de la constitution (TDD en `packages/llm`), actualización de ADR-0060
- [X] T038 [P] `docs/threat-model.md` (filas LLM a `mitigated`, riesgo de capa gratuita aceptado), `docs/PLAN.md` (O6 cerrada, F5 completada, §5.4), `README.md`
- [X] T039 Issue para eliminar `llm-nodes-enabled`
- [X] T040 Ejecutar los 13 escenarios de `quickstart.md` y registrar resultados en la PR
- [X] T041 Checklist de Security Considerations en la PR

---

## Implementation Strategy

1. **PR 1 — Fundaciones** (Sonnet): T001–T018. Paquete `llm`, `dag-schema`, migraciones y contratos;
   sin activities ni UI.
2. **PR 2 — Motor** (Sonnet): T019–T027. Depende de PR 1.
3. **PR 3 — API y web** (Sonnet): T028–T034. Depende de PR 1; puede ir en paralelo con PR 2 si no
   toca el worker (archivos distintos).
4. **PR 4 — Cierre** (Haiku para docs, Sonnet para T035): T035–T041. Depende de PR 2 y PR 3.
