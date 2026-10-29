# Implementation Plan: Fundaciones y walking skeleton (F0)

**Branch**: `001-foundations-skeleton` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-foundations-skeleton/spec.md`

## Summary

Monorepo TypeScript con tres aplicaciones (web, API, worker) y paquetes compartidos, conectadas
por un walking skeleton: la web solicita un ping, el API lo inicia como workflow de Temporal y el
worker lo ejecuta; la web consulta el estado por polling. Se implementa desde el inicio la
infraestructura transversal de la constitution: errores RFC 9457 centralizados, Correlation-ID
de punta a punta, logs pino con redacción, validación de configuración con Zod, health checks,
feature flags OpenFeature, CI con gates de calidad y build multi-arch, ADRs y modelo de amenazas.
Decisiones detalladas en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: NestJS 11.2.8, Temporal TypeScript SDK 1.25.0, Zod 4.6, nestjs-zod 5.5,
nestjs-pino 5.3, nestjs-cls 7, @nestjs/terminus 11.1, OpenFeature (server-sdk 1.23, nestjs-sdk 0.2.7),
React 19.3, Vite 8.3, TanStack Query 5.105

**Storage**: PostgreSQL 18 y Valkey 9 (solo conectividad en F0); estado del ping en Temporal

**Testing**: Vitest 5, @temporalio/testing 1.25, pruebas de integración contra Compose compartido

**Target Platform**: Linux contenedores amd64 y arm64 (producción: Oracle Ampere A1); desarrollo en
Windows, Linux y macOS

**Project Type**: aplicación web (SPA + API + worker) en monorepo pnpm + Turborepo

**Performance Goals**: ping visible en la web en < 5 s (SC-002); CI completo en < 15 min (SC-007)

**Constraints**: imágenes sobre glibc (no Alpine), bases fijadas por digest, usuario sin privilegios;
servicios locales solo en `127.0.0.1`; sin publicación de imágenes ni despliegue en F0

**Scale/Scope**: un desarrollador; 3 apps, 3 paquetes, 4 endpoints de API, 1 workflow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento en F0 | Estado |
|---|---|---|
| I. Seguridad por defecto | Tabla OWASP en la spec; fallo cerrado en config y flags; sin `eval`; gitleaks; Helmet y CORS; A01/A07 diferidos a F1 con el sistema solo local | PASS |
| II. Resiliencia explícita | Timeouts y reintentos explícitos en activity y workflow; idempotencia por `workflowId`; flag evaluado fuera del workflow | PASS |
| III. Pruebas | Paquetes con TDD obligatorio aún no existen; pruebas de flags on/off, replay y caos incluidas | PASS |
| IV. Contratos tipados | Zod en `packages/contracts` para API y web; config validada al arrancar | PASS |
| V. Errores RFC 9457 | `ProblemDetailsFilter` global, sin `type`/`instance` | PASS |
| VI. Correlation-ID | CLS en API, header y cuerpo de error, entrada y search attribute en Temporal, logs del worker | PASS |
| VII. Simplicidad | Solo lo que pide la spec; ADRs 0012–0017 para dependencias y desviaciones | PASS |
| VIII. Feature flags | `ping-enabled` con default `false`; dueño e issue de eliminación | PASS |
| IX. Idioma | Docs y `detail` en español; código, README y commits en inglés | PASS |
| Restricciones técnicas | Node 24 fijado; Debian bookworm-slim; multi-arch | PASS |
| Flujo de desarrollo | Rama por spec, Conventional Commits, CI como gate | PASS |

**Re-check post-diseño**: PASS. Ninguna decisión de Phase 1 introduce violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundations-skeleton/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.openapi.yaml
│   └── worker-health.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
.github/
├── workflows/ci.yml
└── renovate.json
apps/
├── api/
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/            # esquema Zod de env
│   │   ├── common/
│   │   │   ├── errors/        # ProblemDetailsFilter, excepciones de dominio
│   │   │   ├── correlation/   # middleware CLS
│   │   │   └── logging/       # nestjs-pino
│   │   ├── flags/             # OpenFeature + /api/v1/features
│   │   ├── health/            # terminus
│   │   ├── temporal/          # cliente Temporal
│   │   └── ping/              # controller + service
│   ├── test/{unit,integration}/
│   └── Dockerfile
├── worker/
│   ├── src/
│   │   ├── main.ts
│   │   ├── config/
│   │   ├── workflows/ping.workflow.ts
│   │   ├── activities/ping.activities.ts
│   │   ├── health/server.ts
│   │   └── logging/
│   ├── test/{unit,integration,histories}/
│   └── Dockerfile
└── web/
    ├── src/
    │   ├── main.tsx
    │   ├── api/               # cliente HTTP tipado con packages/contracts
    │   └── features/ping/
    └── test/
packages/
├── contracts/                 # Zod: ping, problem details, health, flags
├── logger/                    # config pino y redacción compartida
└── config/                    # tsconfig base, ESLint, Prettier
docs/
├── PLAN.md
├── adr/0001…0017-*.md
└── threat-model.md
compose.yaml                   # Postgres, Valkey, Temporal dev
.env.example  .nvmrc  .gitattributes  .editorconfig  .npmrc
lefthook.yml  commitlint.config.mjs  eslint.config.mjs  turbo.json
pnpm-workspace.yaml  package.json  tsconfig.base.json  README.md
```

**Structure Decision**: monorepo pnpm workspaces + Turborepo con `apps/` (desplegables) y
`packages/` (librerías internas). `packages/dag-schema`, `llm`, `connectors` y `resilience` del
plan general no se crean hasta las fases que los requieren (principio VII).

## Complexity Tracking

Sin violaciones de la constitution. Desviaciones de `docs/PLAN.md` registradas como ADR:

| Desviación | ADR | Motivo |
|---|---|---|
| NestJS 11 en lugar de la versión vigente (12) | 0013 | Compatibilidad de `nestjs-zod` y `@openfeature/nestjs-sdk` |
| TypeScript 6 en lugar de 7 | 0012 | `typescript-eslint` no soporta TS 7 |
| Pruebas de integración contra Compose compartido | 0015 | Decisión del autor; aislamiento por prefijos y task queues únicos |
