# Implementation Plan: Nodos cognitivos (F5)

**Branch**: `006-cognitive-nodes` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

## Summary

Paquete `packages/llm` con proveedor intercambiable (Gemini real o proveedor de pruebas determinista),
structured output, reparación acotada, delimitador con nonce, canary y ocultación opcional de PII.
Activities `llm.classify`, `llm.extract` y `llm.generate` en una cola de tareas propia, con
presupuesto de tokens reservado en PostgreSQL por ejecución y por organización y día, rate limit
global por modelo y registro de cada llamada sin contenido. Taxonomía con `invalid_output` y
`budget_exhausted`. UI de consumo por paso, por ejecución y diario. Todo lo visible detrás de
`llm-nodes-enabled`. Decisiones en [research.md](./research.md); modelo en
[data-model.md](./data-model.md) (aprobado el 2026-11-05).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: las existentes (Temporal SDK 1.25, NestJS 11, Drizzle, iovalkey, React
Flow, Zod) más `@google/genai` (nueva, ADR)

**Storage**: 2 tablas nuevas (`llm_calls`, `llm_usage_daily`), 1 columna en `workflow_runs`, `CHECK`
de `error_class` ampliado en 2 tablas

**Testing**: Vitest; TDD en `packages/llm` y `dag-schema`; `TestWorkflowEnvironment` con
`FakeProvider`; RLS de las tablas nuevas; concurrencia de la reserva; set de inyección; prueba de que
los logs no llevan contenido; replay con un historial que incluye nodos LLM; componentes web; job
manual `llm-evals.yml` con Gemini

**Performance Goals**: reserva y ajuste < 10 ms por llamada; el bulkhead limita a 4 llamadas LLM
concurrentes por worker por defecto

**Constraints**: workflow determinista (nonce y canary en la activity); contenido solo en Temporal (5C
de F3); sin llamadas a Gemini en CI salvo el job manual

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | Salida LLM solo como dato validado; RLS en tablas nuevas; clave fuera del repo; sin contenido en logs | PASS |
| II. Resiliencia | Timeouts, reintentos y taxonomía ampliada; rate limit global; bulkhead | PASS |
| III. Pruebas | TDD en `packages/llm` (nuevo, se suma a la lista de la constitution por enmienda PATCH) y `dag-schema`; un test por control OWASP LLM | PASS |
| IV. Contratos | Esquemas de salida derivados de Zod/`DagType`; entorno validado al arrancar | PASS |
| V/VI | Códigos nuevos; `correlationId` en eventos y llamadas | PASS |
| VII | Dependencia nueva y desviaciones con ADR | PASS |
| VIII | `llm-nodes-enabled` + kill switch `LLM_ENABLED` | PASS |
| IX | Prompts en inglés; textos de usuario en español | PASS |

## Project Structure

```text
packages/llm/src/{provider,gemini,fake,prompt,guard,redaction,budget-estimate,cost}.ts
packages/llm/test/injection/cases.json
packages/dag-schema/src/runtime/errors.ts       # invalid_output, budget_exhausted
packages/dag-schema/src/runtime/{plan,rerun}.ts # fases ejecutables por parámetro; llm reutilizable
packages/dag-schema/src/catalog/llm-*.ts        # retryDefaults, redactPii
packages/contracts/src/{runs,flags,llm-usage}.ts
packages/db/src/schema/                         # llm_calls, llm_usage_daily, columna
packages/db/migrations/0010_*, 0011_*           # tablas/columnas; RLS, triggers, grants
apps/worker/src/llm/{activities,budget,worker}.ts
apps/worker/src/workflows/execute-dag.workflow.ts
apps/api/src/llm-usage/                         # consumo diario
apps/api/src/runs/                              # flag → fases ejecutables; uso por paso y ejecución
apps/web/src/features/runs/                     # consumo por paso y ejecución
apps/web/src/features/organizations/            # Consumo LLM de hoy
apps/web/src/features/workflows/                # redactPii y aviso de capa gratuita
scripts/eval/llm.ts                             # pnpm eval:llm
.github/workflows/llm-evals.yml                 # manual
```

## PRs previstas

1. Fundaciones: `packages/llm` completo con `FakeProvider` y `GeminiProvider`, set de inyección,
   taxonomía y catálogo en `dag-schema`, contratos.
2. Motor: migraciones, activities LLM, presupuesto, rate limit global, bulkhead, interruptor, replay.
3. Producto: flag en API, consumo por paso, ejecución y día (API y web), editor (`redactPii`, aviso).
4. Cierre: evals con Gemini (script y job manual), ADRs, threat model, PLAN, README, quickstart.

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Reserva y ajuste en dos transacciones | Cortar antes de llamar sin mantener una transacción abierta durante la llamada (4C) |
| Segundo `Worker` en el mismo proceso | Aislar la concurrencia LLM sin otro contenedor en la VM gratuita (7A) |
| Proveedor de pruebas con guiones | CI estable y gratis; el set de inyección se prueba contra salidas maliciosas conocidas (2A) |
