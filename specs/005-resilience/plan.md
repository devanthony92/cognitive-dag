# Implementation Plan: Resiliencia (F4)

**Branch**: `005-resilience` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

## Summary

Taxonomía de errores aplicada por el motor; políticas de reintento y tiempo por tipo de nodo con
ajustes acotados por nodo en la definición del DAG; token bucket en Valkey que reprograma la activity
sin ocupar el worker; idempotencia de efectos con clave `runId:nodeId` y tabla `node_effects`;
`mock.service` con fallos limitados y deterministas; reejecución desde un nodo con salidas memorizadas
leídas de Temporal; listado de ejecuciones de la organización con filtros; caos ampliado, replay de
historiales reales y demo de recuperación. Decisiones en [research.md](./research.md); modelo en
[data-model.md](./data-model.md) (aprobado el 2026-10-31).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: las existentes (Temporal SDK 1.25, NestJS 11, Drizzle, iovalkey, React
Flow); sin dependencias nuevas previstas

**Storage**: 1 tabla nueva, 1 valor de enum, 3 columnas, 2 índices; Valkey para el token bucket y el
registro del destino simulado

**Testing**: Vitest; `TestWorkflowEnvironment` con tiempo simulado para políticas y esperas; replay de
historiales guardados; batería de caos con Docker (`pnpm test:chaos`); pruebas de RLS de
`node_effects`; pruebas de componentes de la web

**Performance Goals**: el token bucket añade < 5 ms por efecto (un script Lua)

**Constraints**: workflow determinista; contenido solo en Temporal (5C); reejecución desde un nodo
solo sobre la versión original

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | RLS en `node_effects`; rate limit por organización; membresía en los endpoints nuevos | PASS |
| II. Resiliencia | Es el objetivo de la fase: taxonomía, políticas, idempotencia, caos y replay | PASS |
| III. Pruebas | TDD en taxonomía, políticas, token bucket y cálculo de reutilizables (`dag-schema`) | PASS |
| IV. Contratos | `retry`, `mock.service` y eventos validados con Zod | PASS |
| V/VI | Códigos RFC 9457 nuevos; `correlationId` en efectos vía la ejecución | PASS |
| VII | ADRs: taxonomía, rate limit sin ocupar el worker, idempotencia, reejecución desde nodo, diferidos | PASS |
| VIII | `resilience-enabled` para lo visible | PASS |

## Project Structure

```text
packages/dag-schema/src/runtime/errors.ts       # taxonomía y clasificación (puro)
packages/dag-schema/src/runtime/rerun.ts        # cálculo de nodos reutilizables (puro)
packages/dag-schema/src/catalog/                # `retry` y valores por defecto; mock.service ampliado
packages/db/src/schema/                         # node_effects, columnas y enum
packages/db/migrations/0008_*, 0009_*           # tablas/columnas y RLS, triggers, grants
apps/worker/src/resilience/{rate-limiter,effects}.ts
apps/worker/src/activities/mock-service.ts
apps/worker/src/workflows/execute-dag.workflow.ts
apps/worker/test/replay/histories/              # historiales reales
apps/worker/test/chaos/                         # batería de caos
apps/api/src/runs/                              # rerun desde nodo, listado de la organización
apps/web/src/features/runs/                     # página de la organización, reejecutar desde nodo
apps/web/src/features/workflows/                # ajustes de reintento en el panel del nodo
scripts/demo/recovery.ts                        # pnpm demo:recovery
```

## PRs previstas

1. Motor: taxonomía, políticas, rate limit, idempotencia, `mock.service` ampliado, migraciones.
2. Recuperación: reejecución desde nodo y listado de la organización (API y web), ajustes de
   reintento en el editor.
3. Verificación y cierre: caos ampliado, replay, demo, ADRs, docs, quickstart.

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Contador propio de intentos en la activity | Que las esperas por rate limit no gasten los intentos del nodo (4B) |
| Destino simulado con registro en Valkey | Demostrar "efecto una sola vez" de extremo a extremo (7A) |
| Reejecución sobre la versión original | Las salidas reutilizadas solo son válidas para esa versión (9A) |
