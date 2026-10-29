---

description: "Task list for F0 — Fundaciones y walking skeleton"
---

# Tasks: Fundaciones y walking skeleton (F0)

**Input**: Design documents from `/specs/001-foundations-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluidas. La spec define criterios de aceptación verificables y la constitution
(principio III) exige pruebas para flags on/off, replay de workflows y controles OWASP. Las pruebas
de cada historia se escriben primero y DEBEN fallar antes de implementar.

**Organization**: tareas agrupadas por historia de usuario para implementarlas y probarlas de
forma independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de la spec (US1–US6)

## Path Conventions

Monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/*`, `docs/`, raíz del repo.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicializar el monorepo y las herramientas de calidad locales

- [X] T001 Crear `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` y `.nvmrc` (`24.22.1`) en la raíz
- [X] T002 Crear `package.json` raíz (`packageManager` pnpm fijado, `engines.node` `24.22.1`, scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:integration`, `format`) y `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- [X] T003 [P] Crear `.npmrc` con `engine-strict=true` y `save-exact=true`
- [X] T004 [P] Crear `turbo.json` con pipelines `build`, `dev` (persistente, sin caché), `lint`, `typecheck`, `test`, `test:integration`
- [X] T005 [P] Crear `packages/config` con `tsconfig.base.json` (strict, TypeScript 6.0.3), presets de Vitest y `prettier.config.mjs`
- [X] T006 [P] Crear `eslint.config.mjs` raíz (ESLint 10 flat + `typescript-eslint` con type-checking, regla `no-eval` y `no-new-func` como error)
- [X] T007 [P] Crear `lefthook.yml` (pre-commit: lint y format de staged; commit-msg: commitlint) y `commitlint.config.mjs` con `@commitlint/config-conventional`
- [X] T008 [P] Crear `.env.example` con todas las variables de API, worker y web, `FEATURE_FLAGS='{"ping-enabled":true}'` y sin valores secretos reales
- [X] T009 Ejecutar `pnpm install` y verificar `pnpm lint`, `pnpm typecheck` y lefthook instalados

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contratos y piezas transversales que usan todas las historias

**⚠️ CRITICAL**: ninguna historia empieza hasta completar esta fase

### Tests (escribir primero)

- [X] T010 [P] Pruebas de esquemas en `packages/contracts/test/contracts.test.ts`: `ProblemDetails` exige `status`, `title`, `detail`, `code`, `correlationId` y rechaza `type`/`instance`; `message` "1–100 caracteres imprimibles"; `CorrelationId` acepta solo UUID "de ≤ 36 caracteres"
- [X] T011 [P] Pruebas de redacción en `packages/logger/test/redaction.test.ts`: `authorization`, `cookie`, `*.password`, `*.token`, `*.secret`, `*.apiKey`, `*.credentials` → `[REDACTED]`

### Implementation

- [X] T012 [P] Crear `packages/contracts/src/problem.ts` (esquema Zod `ProblemDetails` y enum de `code`: `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE`, `ROUTE_NOT_FOUND`, `PING_NOT_FOUND`, `FEATURE_NOT_AVAILABLE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`)
- [X] T013 [P] Crear `packages/contracts/src/correlation.ts` (esquema y función `resolveCorrelationId(input)` que valida o genera UUID v4)
- [X] T014 [P] Crear `packages/contracts/src/ping.ts` (`CreatePingRequest`, `PingExecution` con `status` enum `pending`, `running`, `completed`, `failed`, `timed_out`) según data-model.md
- [X] T015 [P] Crear `packages/contracts/src/health.ts` y `packages/contracts/src/flags.ts` (`HealthReport`, mapa de flags públicos)
- [X] T016 [P] Crear `packages/logger/src/index.ts` con la configuración pino compartida y rutas de redacción
- [X] T017 Crear `apps/api` (NestJS 11.2.8) con `src/main.ts` y `src/app.module.ts`; Helmet, CORS restringido a `WEB_ORIGIN` y límite de cuerpo configurable (`BODY_LIMIT`)
- [X] T018 Crear `apps/api/src/config/env.schema.ts`: validación Zod antes de crear la app; si falla, salir con código 1 listando solo nombres de variables
- [X] T019 Crear `apps/api/src/common/correlation/correlation.middleware.ts` con `nestjs-cls`: usa `resolveCorrelationId` y agrega el header `X-Correlation-Id` a toda respuesta
- [X] T020 Crear `apps/api/src/common/logging/logging.module.ts` con `nestjs-pino`, `packages/logger` y `correlationId` desde CLS
- [X] T021 Crear `apps/api/src/common/errors/problem-details.filter.ts` (`@Catch()` global) con el mapeo de research.md R6 y `ZodValidationPipe` global de `nestjs-zod`
- [X] T022 [P] Crear `apps/worker` con `src/main.ts`, `src/config/env.schema.ts` (misma regla de salida que T018) y `src/logging/logger.ts` (pino + `Runtime.install` con logger que delega en pino)
- [X] T023 [P] Crear `apps/web` (React 19.3 + Vite 8.3) con `src/main.tsx`, `QueryClientProvider` y `src/api/client.ts` que parsea respuestas con `packages/contracts`

**Checkpoint**: monorepo compila, API y worker arrancan con configuración válida

---

## Phase 3: User Story 1 - Entorno local en un comando (Priority: P1) 🎯 MVP

**Goal**: infraestructura en un comando, apps en otro, salud verificable

**Independent Test**: en un clon limpio, seguir el README y obtener todos los health checks en 200

### Tests for User Story 1

- [X] T024 [P] [US1] Prueba de configuración inválida en `apps/api/test/unit/env.schema.test.ts` y `apps/worker/test/unit/env.schema.test.ts`: falta `TEMPORAL_ADDRESS` → error con el nombre y sin el valor
- [X] T025 [P] [US1] Prueba de integración de readiness en `apps/api/test/integration/health.test.ts`: 200 con `postgres`, `valkey`, `temporal` en `up`
- [X] T026 [P] [US1] Prueba de integración en `apps/worker/test/integration/health.test.ts` según `contracts/worker-health.md`

### Implementation for User Story 1

- [X] T027 [US1] Crear `compose.yaml`: Postgres 18, Valkey 9 y `temporalio/temporal` 1.9.1 (`server start-dev --ip 0.0.0.0 --db-filename /data/temporal.db --search-attribute CorrelationId=Keyword`), imágenes por digest, `healthcheck`, volúmenes persistentes y puertos solo en `127.0.0.1`
- [X] T028 [US1] Crear `apps/api/src/health/health.module.ts` con `@nestjs/terminus`: `/health/live` y `/health/ready` (Postgres `SELECT 1` con `pg`, Valkey `PING` con `iovalkey`, Temporal `healthService.check`), respuesta `HealthReport` sin mensajes internos
- [X] T029 [P] [US1] Crear `apps/worker/src/health/server.ts` (`node:http`, `127.0.0.1:${WORKER_HEALTH_PORT}`) según `contracts/worker-health.md`
- [X] T030 [US1] Configurar `pnpm dev` (Turborepo) con recarga en caliente de API (watch), worker (watch) y web (Vite HMR)
- [X] T031 [US1] Escribir sección de arranque del `README.md` (inglés): prerrequisitos con versiones exactas, `pnpm install`, `cp .env.example .env`, `docker compose up -d --wait`, `pnpm dev`, puertos

**Checkpoint**: US1 verificable con quickstart escenarios 1 y 2

---

## Phase 4: User Story 2 - Recorrido de punta a punta (Priority: P1)

**Goal**: ping desde la web ejecutado como workflow durable, con estado visible

**Independent Test**: quickstart escenarios 3, 4 y 5

### Tests for User Story 2

- [X] T032 [P] [US2] Prueba de workflow en `apps/worker/test/unit/ping.workflow.test.ts` con `TestWorkflowEnvironment`: completa con `{ pong, workerId, attempts }`; reintenta hasta 3 intentos; `timed_out` al superar 10 min
- [X] T033 [P] [US2] Prueba de contrato en `apps/api/test/integration/pings.contract.test.ts`: `POST /api/v1/pings` → 202 con `Location`; `GET /api/v1/pings/{pingId}` → `PingExecution` válido; `pingId` con patrón `^ping-[0-9a-f-]{36}$`
- [X] T034 [P] [US2] Prueba de idempotencia en `apps/api/test/integration/pings.idempotency.test.ts`: misma `Idempotency-Key` → mismo `pingId`
- [X] T035 [P] [US2] Prueba de caos en `apps/worker/test/integration/ping.chaos.test.ts`: detener el worker durante el retardo de la activity, iniciar otro, un único resultado
- [X] T036 [P] [US2] Prueba de estado `pending` en `apps/api/test/integration/pings.pending.test.ts`: sin worker activo el estado es `pending`

### Implementation for User Story 2

- [X] T037 [P] [US2] Crear `apps/worker/src/activities/ping.activities.ts`: `pong(input)` con retardo configurable solo fuera de producción y log con `correlationId`
- [X] T038 [US2] Crear `apps/worker/src/workflows/ping.workflow.ts`: activity con `startToCloseTimeout` 5 s, reintentos inicial 1 s, coeficiente 2, máximo 3 intentos; sin E/S ni flags en el workflow
- [X] T039 [US2] Registrar workflow y activities en `apps/worker/src/main.ts` (task queue `TEMPORAL_TASK_QUEUE`)
- [X] T040 [US2] Crear `apps/api/src/temporal/temporal.module.ts` (cliente compartido, conexión perezosa; Temporal caído → `SERVICE_UNAVAILABLE`)
- [X] T041 [US2] Crear `apps/api/src/ping/ping.service.ts`: `workflowId = ping-<idempotencyKey>`, `WorkflowIdReusePolicy.REJECT_DUPLICATE`, `workflowExecutionTimeout` 10 min, search attribute `CorrelationId`; ante `WorkflowExecutionAlreadyStartedError` devolver la existente; estado derivado de `describe()` según research.md R8
- [X] T042 [US2] Crear `apps/api/src/ping/ping.controller.ts` según `contracts/api.openapi.yaml` (validación con DTOs de `packages/contracts`, `PING_NOT_FOUND` si no existe)
- [X] T043 [US2] Crear `apps/web/src/features/ping/PingPanel.tsx`: botón "Ejecutar ping", polling cada 1 s con TanStack Query hasta estado terminal, muestra estado, resultado y `correlationId`
- [X] T044 [US2] Guardar un historial del workflow en `apps/worker/test/histories/ping-completed.json` y crear prueba de replay en `apps/worker/test/unit/ping.replay.test.ts`

**Checkpoint**: walking skeleton funcional de punta a punta

---

## Phase 5: User Story 3 - Errores y trazabilidad consistentes (Priority: P2)

**Goal**: cada respuesta trazable y cada error en formato RFC 9457

**Independent Test**: quickstart escenarios 6 a 11

### Tests for User Story 3

- [ ] T045 [P] [US3] Pruebas de correlación en `apps/api/test/integration/correlation.test.ts`: sin header → UUID nuevo; UUID válido → reutilizado; no UUID, > 36 caracteres o con caracteres de control → reemplazado
- [ ] T046 [P] [US3] Pruebas del filtro en `apps/api/test/integration/problem-details.test.ts`: 422 con `errors[]`, 413, 404 `ROUTE_NOT_FOUND`, 503 con Temporal detenido, 500 sin stack trace ni nombres internos; todas con `correlationId` y `Content-Type: application/problem+json`
- [ ] T047 [P] [US3] Prueba de propagación en `apps/worker/test/integration/correlation.test.ts`: el `correlationId` del `POST` aparece en el search attribute de la ejecución y en los logs del worker

### Implementation for User Story 3

- [ ] T048 [US3] Completar en `problem-details.filter.ts` el registro del error completo en logs para 5xx con `correlationId` y `detail` genérico en la respuesta
- [ ] T049 [US3] Propagar `correlationId` en `apps/worker/src/logging/logger.ts` (child logger por activity desde la entrada)
- [ ] T050 [US3] Asegurar header `X-Correlation-Id` también en respuestas de error y de health en `correlation.middleware.ts`
- [ ] T051 [US3] Enviar `X-Correlation-Id` desde la web en `apps/web/src/api/client.ts` y mostrar `detail` de errores problem+json en la interfaz

**Checkpoint**: SC-004 y SC-005 verificables

---

## Phase 6: User Story 4 - Calidad automatizada en cada cambio (Priority: P2)

**Goal**: CI bloquea el merge ante cualquier fallo de calidad o seguridad

**Independent Test**: PRs de prueba que violan cada control quedan bloqueadas

### Implementation for User Story 4

- [X] T052 [P] [US4] Crear `apps/api/Dockerfile` y `apps/worker/Dockerfile`: multi-stage, `node:24.22.1-bookworm-slim@sha256:<digest>`, `pnpm deploy --prod`, `USER node`, `NODE_ENV=production`
- [X] T053 [P] [US4] Crear `.github/renovate.json`: `minimumReleaseAge` 3 días, `pinDigests`, agrupación por ecosistema
- [X] T054 [P] [US4] Crear `.gitleaks.toml` con la configuración por defecto y allowlist solo para `.env.example`
- [X] T055 [US4] Crear `.github/workflows/ci.yml`: acciones fijadas por SHA, `permissions: contents: read`; jobs `quality` (format, lint, typecheck, unit), `security` (`pnpm audit --audit-level high`, gitleaks), `integration` y `images` en matriz `ubuntu-24.04` / `ubuntu-24.04-arm` (`docker compose up --wait`, integración, replay, caos; `docker buildx build` sin push)
- [X] T056 [US4] Subir la rama, abrir la PR de F0 y verificar que los cuatro jobs pasan en ambas arquitecturas y que CI dura < 15 min
- [X] T057 [US4] Configurar protección de `main` en GitHub: PR obligatoria y checks `quality`, `security`, `integration`, `images` requeridos (requiere confirmación del autor)
- [ ] T058 [US4] Verificar cada control con una PR de prueba descartable (estilo, tipos, prueba fallida, dependencia vulnerable, secreto de prueba) y registrar la evidencia en `specs/001-foundations-skeleton/checklists/ci-evidence.md`

**Checkpoint**: SC-006 y SC-007 verificados

---

## Phase 7: User Story 5 - Funcionalidad controlada por feature flags (Priority: P3)

**Goal**: el ping se activa o desactiva por configuración

**Independent Test**: quickstart escenario 12

### Tests for User Story 5

- [X] T059 [P] [US5] Pruebas en `apps/api/test/integration/flags.test.ts`: flag `false` → `POST` 404 `FEATURE_NOT_AVAILABLE`; flag `true` → 202; `FEATURE_FLAGS` inválido o flag ausente → valor `false`; `/api/v1/features` solo expone flags públicos
- [X] T060 [P] [US5] Prueba en `apps/web/test/PingPanel.test.tsx`: con `ping-enabled` `false` el botón no se muestra

### Implementation for User Story 5

- [X] T061 [US5] Crear `apps/api/src/flags/flags.module.ts` con `@openfeature/nestjs-sdk` e `InMemoryProvider` cargado desde `FEATURE_FLAGS` (validado con Zod); default seguro `false`
- [X] T062 [US5] Crear `apps/api/src/flags/features.controller.ts` (`GET /api/v1/features`) y proteger `POST /api/v1/pings` con el flag `ping-enabled` antes de iniciar el workflow
- [X] T063 [US5] Consultar `/api/v1/features` en `apps/web/src/features/ping/PingPanel.tsx` y ocultar la acción si el flag está desactivado
- [X] T064 [US5] Crear el issue de eliminación del flag `ping-enabled` en GitHub y registrar dueño y URL en `apps/api/src/flags/flags.catalog.ts`

**Checkpoint**: principio VIII operativo

---

## Phase 8: User Story 6 - Decisiones y amenazas documentadas (Priority: P3)

**Goal**: evidencia de diseño revisable en el repositorio

**Independent Test**: cada decisión D1–D10 tiene ADR y cada componente tiene amenazas STRIDE

### Implementation for User Story 6

- [ ] T065 [P] [US6] Crear `docs/adr/template.md` (MADR 4) y `docs/adr/0001-record-architecture-decisions.md`
- [ ] T066 [P] [US6] Crear ADRs 0002–0011 en `docs/adr/` para D1–D10 de `docs/PLAN.md` §2
- [ ] T067 [P] [US6] Crear ADRs 0012 (TypeScript 6), 0013 (NestJS 11), 0014 (polling en F0), 0015 (pruebas con Compose compartido), 0016 (librerías del API) y 0017 (tooling de calidad y CI) en `docs/adr/`
- [ ] T068 [P] [US6] Crear `docs/threat-model.md`: diagrama de flujo de datos con límites de confianza y tabla STRIDE por componente y flujo, con estado `mitigated`, `accepted` o `planned:<fase>`
- [ ] T069 [US6] Completar `README.md` (inglés): descripción, arquitectura, enlaces a `docs/PLAN.md`, constitution, ADRs y modelo de amenazas

**Checkpoint**: SC-008 verificado

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T070 [P] Actualizar `docs/PLAN.md` con las decisiones de F0 (TypeScript 6, NestJS 11, versiones fijadas) y marcar O3 (Valkey) como cerrada
- [ ] T071 [P] Crear issue de seguimiento para migrar a NestJS 12 cuando `nestjs-zod` y `@openfeature/nestjs-sdk` lo soporten
- [ ] T072 Verificar que no queden `TODO` sin issue asociado (`git grep -n TODO`)
- [ ] T073 Ejecutar todos los escenarios de `quickstart.md` y registrar resultados en la PR
- [ ] T074 Revisar la tabla "Security Considerations" de la spec contra la implementación y marcar el checklist de seguridad en la PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → historias.
- **US1 (3)** bloquea US2, US3 y US5 (necesitan la infraestructura local).
- **US2 (4)** bloquea US3 (T047 usa el ping). US5 (7) se implementa junto con US2 y se integra en
  la misma PR, para que el ping nunca llegue a `main` sin flag.
- **US4 (6)** puede empezar tras Foundational; T056–T058 requieren US1 y US2 para que CI tenga qué probar.
- **US6 (8)** es independiente; puede avanzar en paralelo desde el inicio.
- **Polish (9)** al final.

### Within Each User Story

- Pruebas primero y fallando → implementación → checkpoint.
- Contratos (`packages/contracts`) antes de controladores y web.

### Parallel Opportunities

- Setup: T003–T008.
- Foundational: T010–T016, luego T022–T023 en paralelo con T017–T021.
- US2: pruebas T032–T036 en paralelo; T037 en paralelo con T040.
- US6 completa en paralelo con cualquier otra fase.

## Parallel Example: User Story 2

```bash
Task: "Prueba de workflow en apps/worker/test/unit/ping.workflow.test.ts"
Task: "Prueba de contrato en apps/api/test/integration/pings.contract.test.ts"
Task: "Prueba de idempotencia en apps/api/test/integration/pings.idempotency.test.ts"
Task: "Prueba de caos en apps/worker/test/integration/ping.chaos.test.ts"
```

## Implementation Strategy

### MVP First

1. Setup + Foundational.
2. US1 → validar escenarios 1–2.
3. US2 → validar escenarios 3–5. **MVP**: walking skeleton funcional.

### Incremental Delivery (trunk-based)

Cada bloque se integra a `main` por PR con CI en verde:

1. PR 1: Setup + Foundational + US1 + US4 (T052–T057). La primera PR ya pasa por el CI completo
   y deja `main` protegida.
2. PR 2: US2 + US5. El ping entra a `main` ya detrás del flag `ping-enabled`, como exige el
   principio VIII, porque la spec aún no está completa.
3. PR 3: US3 + T058.
4. PR 4: US6 + Polish.

US6 puede avanzar en paralelo y entrar en cualquier PR.

## Notes

- Commits con Conventional Commits; un commit por tarea o grupo lógico.
- No se crean `packages/dag-schema`, `llm`, `connectors` ni `resilience` en F0.
