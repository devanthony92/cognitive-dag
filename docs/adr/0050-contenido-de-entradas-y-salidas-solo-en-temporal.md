---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Contenido de entradas y salidas solo en Temporal

## Contexto y problema

Las entradas y salidas de los nodos pueden contener datos de terceros. Guardarlas en PostgreSQL ampliaría la superficie de datos personales y obligaría a decidir su retención y su borrado.

## Opciones consideradas

- Guardar el contenido de cada paso en PostgreSQL.
- Guardar solo metadatos en PostgreSQL y leer el contenido del historial de Temporal mientras exista.

## Decisión

Decisión del autor (5C): PostgreSQL guarda estado, intentos, tiempos y un error resumido (500 caracteres como máximo), nunca contenido. `GET /runs/{runId}/steps/{nodeId}/io` lee el historial de Temporal, redacta las claves sensibles, recorta a 32 768 caracteres y responde `410 STEP_IO_EXPIRED` cuando la retención ya lo borró. Reejecutar toma la entrada del primer evento del historial y responde `410 RUN_INPUT_EXPIRED` si ya no existe. Los nodos de lógica corren dentro del workflow y no dejan contenido que mostrar.

## Consecuencias

- Bueno: el contenido desaparece con la retención de Temporal y la base de datos no acumula datos de los usuarios finales.
- Malo: pasada la retención, el contenido y la reejecución dejan de estar disponibles; la web lo explica.
- Malo: la lectura depende de que Temporal responda; sin él, el panel del nodo muestra un error y el resto de la pantalla sigue funcionando.

## Confirmación

`apps/api/test/integration/runs-io.test.ts`, `apps/api/test/integration/runs-control.test.ts` y `apps/web/test/runs-view.test.tsx`.

## Enlaces

[ADR-0004](0004-temporal-como-motor-de-ejecucion.md), `specs/004-execution-engine/research.md` (R3, R6).
