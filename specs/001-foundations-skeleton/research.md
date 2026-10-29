# Research: Fundaciones y walking skeleton (F0)

**Fecha**: 2026-10-28 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Versiones consultadas en npm y Docker Hub el 2026-10-28. Cada decisión que agrega una dependencia
se registra además como ADR (principio VII).

## R1. Versión de TypeScript

- **Decision**: TypeScript 6.0.3.
- **Rationale**: TypeScript 7.0.2 (compilador nativo) aún no expone la API de JavaScript que usa
  `typescript-eslint` 8.72, cuyo rango soportado es `>=4.8.4 <6.1.0`.
- **Alternatives considered**: TS 7 sin `typescript-eslint` (se pierde el lint con tipos); TS 7 para
  typecheck + TS 6 para lint (dos compiladores, resultados divergentes).
- **Revisión**: cuando `typescript-eslint` soporte TS 7 (Renovate lo detectará).

## R2. Versión de NestJS

- **Decision**: NestJS 11.2.8 (`@nestjs/terminus` 11.1.1, `@nestjs/swagger` 11.4.7).
- **Rationale**: decisión del autor. Compatibilidad completa con `nestjs-zod` 5.5 y
  `@openfeature/nestjs-sdk` 0.2.7, que aún no soportan Nest 12.
- **Alternatives considered**: Nest 12.3 con pipe Zod y módulo de flags propios.
- **Consecuencia**: deuda de migración a Nest 12 cuando ambas librerías lo soporten; se registra
  un issue de seguimiento.

## R3. Correlation-ID

- **Decision**: `nestjs-cls` 7 (AsyncLocalStorage) con un middleware que lee `X-Correlation-Id`,
  lo valida como UUID (cualquier versión, máx. 36 caracteres) y si no es válido genera un UUID v4.
- **Propagación**:
  - Respuesta: header `X-Correlation-Id` en toda respuesta y campo `correlationId` en problem+json.
  - Logs del API: `nestjs-pino` toma el ID del contexto CLS (`customProps`).
  - Temporal: el ID viaja en la entrada del workflow y como search attribute `CorrelationId`
    (Keyword), registrado en el servidor de desarrollo con `--search-attribute`.
  - Worker: las activities reciben el ID en su entrada; el logger del worker lo agrega a cada línea.
- **Alternatives considered**: AsyncLocalStorage propio (más código, mismo resultado); OpenTelemetry
  `traceparent` como único ID (se agrega en fases posteriores como complemento, no como sustituto).

## R4. Logs estructurados y redacción

- **Decision**: `nestjs-pino` 5.3 en el API y `pino` directo en el worker, con la misma
  configuración de redacción compartida en `packages/logger`.
- **Redacción**: rutas `req.headers.authorization`, `req.headers.cookie`, `*.password`,
  `*.token`, `*.secret`, `*.apiKey`, `*.credentials` → `[REDACTED]`.
- **Worker**: el `Runtime` de Temporal se instala con un logger que delega en pino, para que los
  logs del SDK también sean JSON.
- **Alternatives considered**: Winston (más lento, redacción menos integrada).

## R5. Validación de configuración

- **Decision**: esquema Zod 4.6 por aplicación, evaluado antes de crear la app. Si falla, el
  proceso termina con código 1 y lista solo los nombres de variables inválidas.
- **Alternatives considered**: Joi de `@nestjs/config` (segunda librería de validación, contra el
  principio IV).

## R6. Errores RFC 9457

- **Decision**: `ProblemDetailsFilter` global (`@Catch()`) como único constructor de errores, con
  validación de entrada vía `nestjs-zod` (`ZodValidationPipe`).
- **Mapeo**:

| Origen | status | code |
|---|---|---|
| `ZodValidationException` | 422 | `VALIDATION_FAILED` (con `errors[]`) |
| Cuerpo mayor al límite | 413 | `PAYLOAD_TOO_LARGE` |
| Ruta inexistente | 404 | `ROUTE_NOT_FOUND` |
| Ping inexistente | 404 | `PING_NOT_FOUND` |
| Flag desactivado | 404 | `FEATURE_NOT_AVAILABLE` |
| Temporal no disponible | 503 | `SERVICE_UNAVAILABLE` |
| Cualquier otra excepción | 500 | `INTERNAL_ERROR` |

- `title` = frase HTTP estándar; `detail` en español; sin `type` ni `instance`.
- Los 5xx registran el error completo en logs con el `correlationId` y devuelven un `detail`
  genérico.
- **Alternatives considered**: librerías de problem details para Nest (abandonadas o con `type`
  obligatorio).

## R7. Idempotencia del ping

- **Decision**: header `Idempotency-Key` (UUID, opcional). `workflowId = ping-<idempotencyKey>`;
  si no se envía, se genera un UUID. Se usa `WorkflowIdReusePolicy.REJECT_DUPLICATE`; ante
  `WorkflowExecutionAlreadyStartedError` el API devuelve la ejecución existente.
- **Rationale**: Temporal garantiza unicidad por `workflowId`; no hace falta almacenamiento propio.
- **Alternatives considered**: tabla de idempotencia en Postgres (innecesaria en F0).

## R8. Workflow de ping y estados

- **Decision**: `pingWorkflow(input)` ejecuta la activity `pong(input)`.
  - Activity: `startToCloseTimeout` 5 s; reintentos: inicial 1 s, coeficiente 2, máx. 3 intentos.
  - Workflow: `workflowExecutionTimeout` 10 min (permite que el worker vuelva tras una caída).
  - Para pruebas, la activity acepta un retardo configurable (solo fuera de producción).
- **Estado expuesto**, derivado de `describe()` de Temporal:
  `pending` (RUNNING sin tareas de workflow completadas, worker ausente) → `running` →
  `completed` | `failed` | `timed_out`.
- **Alternatives considered**: queries de workflow (requieren worker activo, no sirven para
  `pending`).

## R9. Feature flags

- **Decision**: `@openfeature/nestjs-sdk` 0.2.7 + `@openfeature/server-sdk` 1.23 con
  `InMemoryProvider`, cargado desde la variable `FEATURE_FLAGS` (JSON validado con Zod).
- **Flag de F0**: `ping-enabled` (boolean, default `false`; `true` en `.env.example` local).
- **Web**: `GET /api/v1/features` expone solo los flags marcados como públicos.
- **Workflows**: el flag se evalúa en el API antes de iniciar el workflow (principio II).
- **Alternatives considered**: flagd (servicio extra), Unleash/GrowthBook (infraestructura pesada).

## R10. Health checks

- **Decision**: `@nestjs/terminus` en el API: `/health/live` (proceso) y `/health/ready`
  (Postgres `SELECT 1` vía `pg` 8.23, Valkey `PING` vía `iovalkey` 0.4, Temporal
  `healthService.check`). El worker expone un servidor HTTP mínimo (`node:http`) con
  `/health/live` y `/health/ready` (worker en estado `RUNNING`).
- **Alternatives considered**: solo verificar el worker desde la UI de Temporal (no automatizable).

## R11. Entorno local (opción B híbrida)

- **Decision**: `compose.yaml` con Postgres 18 (bookworm), Valkey 9 y `temporalio/temporal` 1.9.1
  (`server start-dev`, SQLite en volumen, UI en `:8233`). Todas las imágenes fijadas por digest y
  con `healthcheck`. Aplicaciones en el host con `pnpm dev` (Turborepo, recarga en caliente).
- Puertos: web 5173, API 3000, salud del worker 3001, Temporal 7233, UI 8233, Postgres 5432,
  Valkey 6379. Los servicios de infraestructura solo escuchan en `127.0.0.1`.

## R12. Pruebas

- **Decision**: Vitest 5 en todos los paquetes.
  - Unitarias: sin dependencias externas.
  - Workflow: `@temporalio/testing` 1.25 (`TestWorkflowEnvironment`) y replay de historiales
    guardados en `apps/worker/test/histories/`.
  - Integración: contra el **Compose compartido** (decisión del autor). Aislamiento por corrida:
    task queue y prefijo de `workflowId` únicos (`test-<runId>-*`), prefijo de claves en Valkey.
  - Caos: prueba que detiene el worker durante el retardo de la activity, inicia otro y verifica
    un único resultado.
- **Alternatives considered**: Testcontainers (mayor aislamiento, más lento).

## R13. Web

- **Decision**: React 19.3 + Vite 8.3 + TanStack Query 5.105. Polling del estado del ping cada
  1 s mientras no sea terminal; se detiene en estado terminal.
- **Alternatives considered**: SSE (planificado para F3).

## R14. Calidad local

- **Decision**: Turborepo 2.11, ESLint 10 (flat config) + `typescript-eslint` 8.72, Prettier,
  lefthook 2.2 (pre-commit: lint y format de archivos staged; commit-msg: commitlint 21 con
  `@commitlint/config-conventional`).
- `.gitattributes` con `* text=auto eol=lf` para evitar scripts con CRLF.

## R15. CI (GitHub Actions)

- **Decision**: workflow `ci.yml` en PR y push a `main`, acciones fijadas por SHA, permisos
  mínimos (`contents: read`).
  - `quality`: format check, lint, typecheck, pruebas unitarias.
  - `security`: `pnpm audit --audit-level high` y gitleaks.
  - `integration` (matriz `ubuntu-24.04` / `ubuntu-24.04-arm`): `docker compose up --wait`,
    pruebas de integración, workflow, replay y caos.
  - `images` (misma matriz): `docker buildx build` de api y worker, sin `push`.
- Protección de `main`: PR obligatoria y los cuatro jobs como checks requeridos.
- **Renovate**: `minimumReleaseAge` de 3 días, digests fijados, agrupación por ecosistema.

## R16. Imágenes de contenedor

- **Decision**: Dockerfiles multi-stage para `api` y `worker` sobre
  `node:24.22.1-bookworm-slim@sha256:<digest>`; `pnpm deploy --prod` para aislar dependencias;
  `USER node`; `NODE_ENV=production`; señal de terminación con `--init` en Compose.
- La web se compila a estáticos; su imagen de servidor pertenece a F9.

## R17. Documentación

- **Decision**: ADRs en MADR 4 en `docs/adr/NNNN-titulo.md`:
  0001 registrar decisiones; 0002–0011 decisiones D1–D10 del plan; 0012 TypeScript 6;
  0013 NestJS 11; 0014 polling en F0; 0015 pruebas con Compose compartido; 0016 librerías del API;
  0017 tooling de calidad y CI.
- Modelo de amenazas en `docs/threat-model.md`: diagrama de flujo de datos con límites de
  confianza y tabla STRIDE por elemento.
