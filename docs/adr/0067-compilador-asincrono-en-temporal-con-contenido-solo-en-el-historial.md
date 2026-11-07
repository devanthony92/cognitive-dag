---
status: accepted
date: 2026-11-06
decision-makers: autor
---

# Compilador asíncrono en Temporal con contenido solo en el historial

## Contexto y problema

Compilar una intención tarda entre 10 y 30 segundos (llamada al modelo más reparaciones). Una petición HTTP larga es frágil, y la intención y el DAG generado pueden contener datos de la persona. Hay que decidir dónde se ejecuta y dónde vive el contenido.

## Opciones consideradas

- Llamada síncrona dentro de la petición del API.
- Workflow de Temporal con la activity en la cola LLM y contenido solo en el historial.
- Cola propia en PostgreSQL con un proceso aparte.

## Decisión

Workflow `compileIntent` con id `compile-<compilationId>` en la cola principal y una activity `compileIntentActivity` en la cola LLM (`TEMPORAL_LLM_TASK_QUEUE`), que hereda el bulkhead y el rate limit global por modelo de F5. La activity hace todo el ciclo (llamada, validación, reparaciones) en un intento; solo se reintenta ante errores `transient` o `rate_limited`. La intención entra como argumento y el resultado (DAG o último intento) sale como valor de retorno: el contenido vive solo en Temporal, como en F3 ([ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md)). PostgreSQL guarda en `compilations` solo metadatos (estado, modelo, tokens, reparaciones, `intent_chars`). La UI consulta el estado por polling y la API lee el resultado del historial; si Temporal ya lo purgó responde `COMPILER_RESULT_EXPIRED`.

## Consecuencias

- Bueno: el contenido no entra a tablas ni logs, y el compilador reutiliza bulkhead, rate limit y observabilidad de F5.
- Bueno: la petición HTTP responde 202 de inmediato.
- Malo: la vista previa depende de la retención del historial de Temporal; la UI ofrece recompilar.
- Malo: el polling añade latencia de hasta 5 s; SSE queda diferido. Tampoco hay cancelación de una compilación en curso; los límites acotan el costo.

## Confirmación

`compilations.test.ts` y `compilation-result.test.ts` en `apps/api/test/integration/`, y `compile-intent.workflow.test.ts` en `apps/worker/test/compiler/`.

## Enlaces

- [Research F6](../../specs/007-nl-compiler/research.md) (R2 y R3).
- [ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md), [ADR-0063](0063-bulkhead-con-cola-llm-en-el-mismo-proceso.md).
