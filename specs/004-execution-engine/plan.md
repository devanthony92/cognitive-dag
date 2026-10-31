# Implementation Plan: Motor de ejecución (F3)

**Branch**: `004-execution-engine` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

## Summary

Intérprete durable del DAG en Temporal (`executeDag`) que ejecuta la versión activa con paralelismo,
ramas omitidas, merge y fallo rápido; evaluación de condiciones y referencias en `packages/dag-schema`
(funciones puras); registro de ejecuciones y pasos en Postgres con RLS mediante una activity; vista en
vivo por SSE con Valkey pub/sub; control de inicio, cancelación y reejecución; límite de ejecuciones
simultáneas. Decisiones en [research.md](./research.md); modelo aprobado en
[data-model.md](./data-model.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: las existentes (Temporal SDK 1.25, NestJS 11, Drizzle, iovalkey, React Flow);
sin dependencias nuevas previstas

**Storage**: 2 tablas nuevas y 1 columna en `organization_limits`; Valkey pub/sub

**Testing**: Vitest; `TestWorkflowEnvironment` para el intérprete; replay de historiales; caos (matar
el worker); pruebas de RLS; pruebas de componentes de la vista en vivo

**Performance Goals**: eventos en vivo < 1 s (SC-002)

**Constraints**: workflow determinista (sin E/S, reloj ni azar); contenido de datos solo en Temporal

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | RLS en ejecuciones; SSE autorizado; nodos de fases futuras bloqueados | PASS |
| II. Resiliencia | Timeouts y reintentos por tipo de nodo; duración máxima; idempotencia en el registro; caos | PASS |
| III. Pruebas | TDD en el evaluador de condiciones y referencias (`dag-schema`) y en autorización | PASS |
| IV. Contratos | Entrada del workflow y eventos validados con Zod | PASS |
| V/VI | RFC 9457 con códigos nuevos; `correlationId` en la ejecución, pasos y eventos | PASS |
| VII | ADR por decisión del autor | PASS |
| VIII | `execution-enabled` | PASS |

## Project Structure

```text
packages/dag-schema/src/runtime/   # evaluador de condiciones, resolución de referencias, plan de ejecución (puros)
packages/db/src/schema/            # workflow_runs, workflow_run_steps, columna max_concurrent_runs
apps/worker/src/workflows/execute-dag.workflow.ts
apps/worker/src/activities/{record-run-event,mock-service}.ts
apps/api/src/runs/                 # inicio, listado, detalle, io, cancelación, reejecución, SSE
apps/web/src/features/runs/        # formulario de ejecución, lista, detalle en vivo
```

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Worker con acceso a Postgres | Registro de ejecuciones con RLS (3A) |
| Contenido solo en Temporal | Decisión del autor (5C) |
| Cualquier miembro ejecuta | Decisión del autor (6C), revisar en F7 |
