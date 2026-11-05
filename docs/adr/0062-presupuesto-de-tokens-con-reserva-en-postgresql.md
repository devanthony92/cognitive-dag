---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Presupuesto de tokens con reserva atómica en PostgreSQL

## Contexto y problema

Una llamada a un modelo cuesta tokens y el costo puede dispararse (LLM06, Denial of Wallet). Hace falta un tope por ejecución y por organización y día que ninguna ejecución concurrente pueda superar, sin depender de que el proveedor avise.

## Opciones consideradas

- Contar tokens después de cada llamada y cortar cuando se pasa el límite.
- Contadores en Valkey con expiración diaria.
- Reservar en PostgreSQL, antes de llamar, la entrada estimada más el máximo de salida, y ajustar al terminar.

## Decisión

Reserva atómica en PostgreSQL (decisiones 4C y 5A). Antes de cada llamada, en una transacción: `UPDATE workflow_runs SET llm_tokens_used = llm_tokens_used + $e WHERE id = $run AND llm_tokens_used + $e <= $límiteRun` y un `INSERT ... ON CONFLICT DO UPDATE ... WHERE tokens_used + $e <= $límiteDía` sobre `llm_usage_daily`. Si alguna no devuelve fila, falla con `budget_exhausted` sin llamar. El estimado es `ceil(caracteres / 4) + maxOutputTokens`. Tras la llamada, otra transacción ajusta ambos contadores con `real - estimado` y guarda la fila de `llm_calls` con el costo estimado a partir de `LLM_PRICES`. El costo se registra pero no corta. Los límites son por entorno (`LLM_MAX_TOKENS_PER_RUN`, `LLM_MAX_TOKENS_PER_ORG_DAY`, `LLM_MAX_INPUT_CHARS`). Agotar un presupuesto registra el evento de seguridad `llm.budget_exhausted`.

## Consecuencias

- Bueno: ninguna ejecución ni organización supera su tope aunque haya llamadas en paralelo; falla cerrada si cae la base entre la reserva y el ajuste.
- Bueno: las tablas nuevas llevan RLS forzado y se auditan con las mismas pruebas que el resto.
- Malo: la fila diaria por organización es caliente; se acepta a esta escala.
- Malo: el estimado de entrada (`chars / 4`) es burdo; el ajuste posterior corrige el contador, pero una reserva alta puede rechazar una llamada que habría cabido.

## Confirmación

`apps/worker/test/integration/llm-budget.test.ts` (reserva, ajuste, concurrencia y fallo cerrado) y las pruebas de estimación y costo de `packages/llm`.

## Enlaces

- [Research F5](../../specs/006-cognitive-nodes/research.md) (R4).
- [ADR-0060](0060-decisiones-diferidas-de-resiliencia.md) (cuotas diarias, que este ADR cierra para tokens).
