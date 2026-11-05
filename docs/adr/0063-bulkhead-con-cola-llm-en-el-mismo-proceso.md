---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Bulkhead con cola de tareas LLM en el mismo proceso

## Contexto y problema

Las llamadas a un modelo son lentas y limitadas por cuota. Si comparten cola con los nodos de F3, una racha de nodos LLM puede dejar sin worker a los demás nodos. ADR-0060 dejó los bulkheads para F5.

## Opciones consideradas

- Una sola task queue para todo.
- Un proceso worker separado para las activities LLM.
- Una task queue propia atendida por un segundo `Worker` dentro del mismo proceso.

## Decisión

Task queue `TEMPORAL_LLM_TASK_QUEUE` (default `cognitive-dag-llm`) atendida por un segundo `Worker` en el mismo proceso, con `LLM_MAX_CONCURRENT_ACTIVITIES` (default 4) de concurrencia (decisión 7A). El workflow no puede leer el entorno: el API le pasa el nombre de la cola en `llmTaskQueue` de la entrada, al iniciar y al reejecutar, y el workflow crea el proxy de las activities LLM con ese `taskQueue`. Sin ese campo usa el default de `@cognitive-dag/contracts`. No hace falta `patched()`: ningún historial existente contiene activities LLM; el replay de F4 se amplió con un historial que sí las tiene.

## Consecuencias

- Bueno: la saturación del modelo no ocupa los slots de los demás nodos; sin un proceso nuevo que desplegar.
- Bueno: la concurrencia hacia el proveedor se limita en un solo punto.
- Malo: ambos workers comparten CPU y memoria; si hiciera falta aislarlos del todo, se separa el proceso sin cambiar el contrato.
- Malo: el API y el worker deben coincidir en el nombre de la cola; ambos usan el mismo default y el API lo envía en cada ejecución (`runs-llm-queue.test.ts`).

## Confirmación

`apps/worker/test/replay/replay.test.ts`, `execute-dag-llm.workflow.test.ts` y `apps/api/test/integration/runs-llm-queue.test.ts`.

## Enlaces

- [Research F5](../../specs/006-cognitive-nodes/research.md) (R6).
- [ADR-0060](0060-decisiones-diferidas-de-resiliencia.md) (bulkheads, cerrados para LLM).
