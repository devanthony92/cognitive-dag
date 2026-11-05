---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Decisiones diferidas de resiliencia

## Contexto y problema

La taxonomía, las políticas, el rate limit y la idempotencia de F4 no requieren un circuit breaker, granularidad por servicio, cuotas diarias ni bulkheads. Sin conectores reales no hay servicios que proteger de forma distinta ni cargas que medir. Hace falta registrar qué se deja para después, con qué criterio, y que la decisión sobre cada una no se tome por accidente.

## Opciones consideradas

- Implementar ahora el circuit breaker, la granularidad por servicio, las cuotas y los bulkheads.
- Implementarlos sin conectores reales, con datos simulados.
- Diferirlos a las fases con conectores reales (F5 y F7), registrando el criterio de cada uno.

## Decisión

Quedan diferidas las cuatro piezas siguientes. El rate limit de F4 usa como clave la organización y el tipo de nodo.

- **Circuit breaker** (decisión 3C): cuando se implemente, al abrirse, el nodo esperará hasta un máximo configurable y después fallará. No se abandona la ejecución al primer error. Llega con los conectores reales de F5 y F7, que son quienes tienen un servicio externo que puede caer.
- **Granularidad por servicio**: el rate limit y el circuit breaker de F4 son por organización y tipo de nodo. Si un tipo cubre varios servicios, la granularidad por servicio se decide junto con el circuit breaker.
- **Cuotas diarias** (decisión 8C): llegan en F5 junto con el presupuesto de tokens del LLM, que es la cuota que más importa.
- **Bulkheads** (decisión 12B): colas de tareas separadas por tipo de nodo llegan en F5, cuando existan nodos LLM y HTTP con cargas distintas.

El estado de cada una se revisa al cerrar F5 y F7, y se registra en `docs/PLAN.md` §5.4.

## Actualización al cerrar F5 (2026-11-05)

- **Cuotas diarias**: implementada solo la de tokens LLM por organización y día ([ADR-0062](0062-presupuesto-de-tokens-con-reserva-en-postgresql.md)). Siguen diferidas las cuotas de ejecuciones por día y de ejecuciones concurrentes por encima del límite que ya existe desde F3.
- **Bulkheads**: implementado el de LLM con una task queue propia en el mismo proceso ([ADR-0063](0063-bulkhead-con-cola-llm-en-el-mismo-proceso.md)). Las colas de HTTP y de conectores llegan con F7.
- **Circuit breaker**: sigue diferido a F7, con `http.request`. En F5 el rate limit global por modelo y el presupuesto acotan la presión sobre Gemini, pero no cortan el tráfico ante una caída sostenida.
- **Granularidad por servicio**: sigue diferida junto con el circuit breaker.

## Consecuencias

- Bueno: F4 se cierra con lo que puede verificarse con el servicio simulado y sin inventar cargas.
- Bueno: cada diferimiento tiene dueño de fase y criterio, así que no se pierde.
- Malo: entre F4 y F5 un servicio externo que falle de forma sostenida reintenta sin cortar el tráfico; el tiempo total máximo por nodo lo limita, pero no evita la presión sobre el servicio.
- Malo: la granularidad por organización y tipo puede resultar corta si varios servicios comparten un tipo; el riesgo se acepta hasta F7.

## Confirmación

`docs/threat-model.md` (sección 3.4) registra el riesgo aceptado de presión sostenida sobre servicios externos hasta F5 y F7, y el apartado de diferidos de `docs/PLAN.md` §5.4 enlaza esta decisión.

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (Assumptions y Key decisions de `research.md`).
- `specs/005-resilience/research.md` (decisiones del autor 1C, 2, 3C, 8C y 12B).
- [ADR-0057](0057-rate-limit-con-token-bucket-sin-ocupar-el-worker.md) (rate limit que queda en vigor).
- [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md) (taxonomía sobre la que se apoyará el circuit breaker).
