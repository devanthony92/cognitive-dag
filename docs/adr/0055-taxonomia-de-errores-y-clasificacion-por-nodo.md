---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Taxonomía de errores y clasificación por nodo

## Contexto y problema

Un nodo con efecto puede fallar por motivos que piden tratamientos distintos: un 5xx se reintenta, un 429 pide esperar lo indicado, un 400 no se reintenta nunca. Sin una clasificación común, el motor tendría que interpretar errores crudos de cada servicio y la persona no sabría por qué un paso falló.

## Opciones consideradas

- Que el motor interprete los errores crudos de cada servicio (HTTP, gRPC, excepciones de librería).
- Una clasificación por código HTTP, sin clases propias.
- Cuatro clases propias (transitorio, limitado, tiempo y permanente) que cada nodo traduce a su lenguaje.

## Decisión

Cuatro clases: `transient`, `rate_limited`, `timeout` y `permanent`. Viven en `packages/dag-schema/src/runtime/errors.ts` como funciones puras. Cada nodo con efecto traduce sus errores a estas clases antes de lanzarlos, y el motor solo sabe leer la clase: un error sin clase se trata como `transient`. Las clases se transportan como `ApplicationFailure` de Temporal: `permanent` lleva `nonRetryable: true`; `rate_limited` lleva `nextRetryDelay`; `timeout` la genera Temporal cuando vence `startToClose` y se reintenta como transitorio.

El paso fallido guarda `error_class`, además del código y de un mensaje resumido sin datos de la entrada. La ejecución fallida copia la clase del paso que la hizo fallar. La clase se guarda como `text` con `CHECK`, no como enum, para que F5 pueda añadir `invalid_output` y `budget_exhausted` sin reescribir el tipo.

Esta decisión cubre la taxonomía de F4. La salida inválida de un LLM y el presupuesto agotado llegan en F5.

## Consecuencias

- Bueno: el motor no depende de los formatos de error de cada servicio; añadir un conector es traducir sus errores.
- Bueno: la persona ve la clase y el motivo en el paso y en la cola de revisión.
- Malo: un conector que no traduce bien sus errores los clasifica como `transient` y se reintenta de más; las pruebas de cada nodo deben cubrir la traducción.

## Confirmación

`packages/dag-schema/test/runtime/errors.test.ts` (clasificación de cada fallo y clase desconocida como transitorio) y `apps/worker/test/unit/execute-dag.workflow.test.ts` (reintento, parada y paso fallido con clase y código).

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (US1, FR-001 a FR-004).
- `specs/005-resilience/research.md` (R1).
- [ADR-0054](0054-fallo-rapido-y-ramas-omitidas.md) (fallo rápido, que consume estas clases).
- [ADR-0056](0056-politicas-de-reintento-por-tipo-de-nodo.md) (políticas que actúan según la clase).
