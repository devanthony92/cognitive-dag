---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Límites de tamaño gestionados por el operador

## Contexto y problema

Los DAG necesitan límites de tamaño que protejan a la plataforma y acoten el costo futuro del compilador, ajustables por organización pero nunca por sus miembros.

## Opciones consideradas

- Límites fijos para todos.
- Límites editables por el owner de cada organización.
- Valores por defecto de la plataforma y ajuste por organización hecho solo por el operador con un script.

## Decisión

Por defecto 50 nodos, 100 conexiones y 256 KB. Máximos absolutos 500, 1000 y 1 MB, que el servidor puede bajar con `DAG_MAX_NODES_CEILING`, `DAG_MAX_EDGES_CEILING` y `DAG_MAX_DEFINITION_BYTES_CEILING`. El operador cambia los de una organización con `pnpm ops:set-limits <organizationId> ...`, que se conecta como `app_migrator`, valida contra los máximos y registra operador, organización y valores anterior y nuevo. `GET /limits` los muestra a cualquier miembro y la app los presenta en solo lectura. No existe endpoint de escritura.

## Consecuencias

- Bueno: el límite no puede subirse desde la aplicación (ADR-0042).
- Malo: cambiarlo requiere intervención manual del operador hasta que existan planes de uso.

## Confirmación

`scripts/test/unit/set-limits.test.ts`, `apps/api/test/integration/limits.test.ts` y `apps/web/test/organization-limits.test.tsx`.

## Enlaces

- `specs/003-dag-model-editor/research.md` R12.
