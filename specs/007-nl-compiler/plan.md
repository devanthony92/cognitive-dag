# Implementation Plan: Compilador de lenguaje natural a DAG (F6)

**Branch**: `007-nl-compiler` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

## Summary

Paquete puro `packages/compiler` (catálogo filtrado con campos sensibles, prompt, formato intermedio
con structured output, traducción a `DagDefinition`, layout por capas, saneo y propiedades de evals),
apoyado en el `guard` de `packages/llm` para la reparación (máx. 2). Workflow de Temporal
`compileIntent` con su activity en la cola LLM de F5, presupuesto en `llm_calls` generalizada y
`llm_usage_daily`, y metadatos sin contenido en `compilations`. API asíncrona con polling, límites
por persona y por organización. UI "Describir workflow" con vista previa de solo lectura y aplicar por
los endpoints de F2. `pnpm eval:compiler` con dataset de propiedades e inyección. Todo detrás de
`nl-compiler-enabled`. Decisiones en [research.md](./research.md); modelo en
[data-model.md](./data-model.md) (aprobado el 2026-11-06).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24

**Primary Dependencies**: las existentes (Temporal SDK 1.25, NestJS 11, Drizzle, iovalkey, React
Flow, Zod, `@google/genai`). Sin dependencias nuevas (layout propio, sin dagre).

**Storage**: 1 tabla nueva (`compilations`); `llm_calls` con 1 columna nueva, 2 columnas opcionales y
`CHECK` ampliados

**Testing**: Vitest; TDD en `packages/compiler`; `TestWorkflowEnvironment` con `FakeProvider` para
`compileIntent`; RLS de `compilations` y del `llm_calls` ampliado; prueba de que una compilación no
crea versiones ni ejecuciones; prueba de que logs y filas no llevan intención ni DAG; componentes web;
`pnpm eval:compiler` con `fake` en CI y job manual con Gemini

**Performance Goals**: compilación típica < 30 s con Flash-Lite; polling de 1 s a 5 s

**Constraints**: contenido solo en Temporal; workflow determinista (nonce y canario en la activity);
sin llamadas a Gemini en CI salvo el job manual; capa gratuita solo con datos de prueba

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | Catálogo cerrado; campos sensibles saneados; salida solo como dato validado; RLS; nada se ejecuta sin publicar | PASS |
| II. Resiliencia | Taxonomía de F4 en la activity; rate limit global y bulkhead de F5; tope por compilación | PASS |
| III. Pruebas | TDD en `packages/compiler` (se suma a la lista de la constitution por enmienda PATCH); un test por control | PASS |
| IV. Contratos | Esquema intermedio derivado de Zod; contratos en `packages/contracts`; entorno validado | PASS |
| V/VI | Códigos `COMPILER_*`; `correlationId` en la compilación y sus llamadas | PASS |
| VII | Desviaciones y decisiones con ADR | PASS |
| VIII | `nl-compiler-enabled` + kill switch `LLM_ENABLED` | PASS |
| IX | Prompts en inglés; textos de usuario en español | PASS |

## Project Structure

```text
packages/compiler/src/{catalog,prompt,intermediate,translate,layout,sanitize,compile,properties}.ts
packages/compiler/evals/{intents,injection}.json      # dataset con propiedades esperadas
packages/compiler/evals/fake-responses/               # respuestas grabadas para CI
packages/dag-schema/src/catalog/{shared,http-request}.ts  # sensitiveFields
packages/contracts/src/{compilations,flags}.ts
packages/db/src/schema/{compilations,llm-calls}.ts
packages/db/migrations/0012_*, 0013_*                 # tabla y columnas; RLS, triggers, grants
apps/worker/src/compiler/{activities,budget}.ts
apps/worker/src/workflows/compile-intent.workflow.ts
apps/api/src/compilations/                            # endpoints, límites, lectura del historial
apps/api/src/flags/flags.catalog.ts                   # nl-compiler-enabled
apps/web/src/features/compiler/                       # intención, estado, vista previa, aplicar
apps/web/src/routes/orgs.$organizationId.workflows.new.tsx
scripts/eval/compiler.ts                              # pnpm eval:compiler
.github/workflows/compiler-evals.yml                  # manual
```

## PRs previstas

1. **Fundaciones** (Sonnet): `packages/compiler` completo con TDD, `sensitiveFields` en el catálogo,
   contratos, dataset de evals con respuestas grabadas y `pnpm eval:compiler` con `fake` en CI.
2. **Motor** (Sonnet): migraciones 0012–0013, `compileIntent` y su activity, presupuesto y tope por
   compilación, interruptor, pruebas de workflow y de "nada se ejecuta".
3. **Producto** (Sonnet): flag en API, endpoints, límites, lectura del resultado desde Temporal, UI
   "Describir workflow", vista previa, aplicar, último intento, compilaciones recientes.
4. **Cierre** (Haiku): eval con Gemini (local y job manual), ADRs, threat model, PLAN, README,
   quickstart.

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| `llm_calls` con dos dueños posibles | Un solo libro contable y un solo presupuesto diario (4A) |
| Resultado leído del historial de Temporal | Sin guardar intención ni DAG en PostgreSQL (3B) |
| Aplicar desde el cliente con endpoints de F2 | Reutiliza autorización y control de revisión sin endpoint nuevo |
