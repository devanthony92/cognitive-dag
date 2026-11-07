---
status: accepted
date: 2026-11-06
decision-makers: autor
---

# `llm_calls` con dos dueños y presupuesto compartido del compilador

## Contexto y problema

`llm_calls` (F5) registra cada llamada al modelo con ejecución y nodo. Las llamadas del compilador no pertenecen a una ejecución, pero deben contar para el presupuesto diario de la organización y para el panel "Consumo LLM de hoy".

## Opciones consideradas

- Tabla nueva para las llamadas del compilador.
- Generalizar `llm_calls` para que tenga uno de dos dueños.

## Decisión

`llm_calls.run_id` y `node_id` pasan a ser opcionales y se añade `compilation_id`. Un `CHECK` exige exactamente un dueño: ejecución con nodo, o compilación sin nodo. `node_type` admite `compiler`. La reserva ocurre antes de cada llamada contra `llm_usage_daily` (mismo mecanismo de [ADR-0062](0062-presupuesto-de-tokens-con-reserva-en-postgresql.md)) y contra un tope por compilación, `LLM_MAX_TOKENS_PER_COMPILATION` (30000 por defecto), acumulado en `compilations.llm_tokens_used`. La migración es compatible hacia atrás (expand/contract) y la RLS forzada se mantiene.

## Consecuencias

- Bueno: un solo lugar de consumo; el panel diario suma todo sin cambios.
- Bueno: el Denial of Wallet queda acotado por compilación, por persona (10 por hora), por organización (50 por día) y por día en tokens.
- Malo: `llm_calls` pierde la garantía de `NOT NULL` en dos columnas; la compensa el `CHECK`.

## Confirmación

`packages/db/test/rls-compilations.test.ts` (RLS y `CHECK` de las migraciones 0012 y 0013) y `apps/worker/test/compiler/compile-intent.workflow.test.ts`.

## Enlaces

- [Research F6](../../specs/007-nl-compiler/research.md) (R4 y R13).
- [ADR-0062](0062-presupuesto-de-tokens-con-reserva-en-postgresql.md).
