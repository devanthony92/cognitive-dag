---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Editores de listas y mensajes de esquema en español

## Contexto y problema

El panel del nodo se genera desde `configSchema`. Dejar listas y mapas como JSON libre sería hostil, y los mensajes crudos de Zod están en inglés y hablan de rutas internas.

## Opciones consideradas

- Mostrar JSON para todo lo que no sea escalar.
- Editores por filas para cada forma de lista y mensajes humanos en español derivados del error de Zod.

## Decisión

El formulario elige el control por la forma del esquema: listas de texto, listas de campos tipados (nombre y tipo, con valores de enum), mapas de texto (cabeceras HTTP) con filas que se agregan, quitan y reordenan; plantillas y condiciones tienen su propio editor. `dag-schema` traduce los errores de Zod con un mapa de errores (`messages.ts`) que usa el nombre del campo del catálogo y marca el ítem concreto, nunca la ruta interna. Ya no queda ningún campo como JSON libre.

## Consecuencias

- Bueno: ningún campo exige conocer el JSON; los errores se leen sobre el campo afectado.
- Malo: un tipo de campo nuevo en el catálogo puede requerir un editor nuevo; hay una prueba que lo detecta.

## Confirmación

`apps/web/test/config-fields.test.ts` y `packages/dag-schema/test/messages.test.ts`.

## Enlaces

- `specs/003-dag-model-editor/research.md` R8.
