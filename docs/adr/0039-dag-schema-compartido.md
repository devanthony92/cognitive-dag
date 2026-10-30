---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# `dag-schema` compartido entre navegador, API y worker

## Contexto y problema

El editor valida mientras se edita, el API valida antes de guardar y publicar, y el worker de F3 interpretará la misma definición. Si cada uno validara por su cuenta, el navegador podría aceptar lo que el servidor rechaza (o al revés) y las reglas se desviarían con el tiempo. FR-009 pide un solo comportamiento en ambos lados.

## Opciones consideradas

- Un paquete `packages/dag-schema` con Zod que exporta el esquema, el catálogo y `validateDefinition`, usado sin cambios por todos.
- Validación en el API y validación simplificada en el navegador.
- Validar solo en el servidor y mostrar sus errores en el editor.

## Decisión

Un paquete único, `@cognitive-dag/dag-schema`. Solo depende de `zod` y no usa APIs de Node, así que corre igual en el navegador y en Node. Devuelve errores con `code` estable, `message` en español y `location` (nodo, campo o conexión) en un orden determinista. Se desarrolla con TDD (constitución III) y se consume por la condición de export `@cognitive-dag/source`, sin compilar en desarrollo.

## Consecuencias

- Bueno: SC-002 se cumple por construcción: la misma función produce los mismos errores en ambos lados.
- Bueno: la validación en vivo no necesita red y responde en menos de 100 ms con 50 nodos (SC-003, `performance.test.ts`).
- Malo: el paquete no puede usar nada específico de Node ni de la base de datos; los límites por organización entran como parámetro.
- Malo: un cambio de regla es un cambio de contrato para web, API y worker a la vez.

## Confirmación

`packages/dag-schema/test/` (un caso por regla de R7) y `apps/api/test/integration/drafts.test.ts` (el servidor devuelve los mismos errores que el paquete).

## Enlaces

- `specs/003-dag-model-editor/research.md` R1 y R7.
