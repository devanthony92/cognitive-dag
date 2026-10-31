---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# AST de condiciones y plantillas sin evaluación de código

## Contexto y problema

Los nodos necesitan condiciones y texto con datos de nodos anteriores. La constitución prohíbe `eval`, `new Function` y cualquier evaluación dinámica (A05). Cierra la decisión abierta O4 de `docs/PLAN.md`.

## Opciones consideradas

- JSONLogic u otro motor de expresiones.
- Motor de plantillas (Handlebars, Mustache) y expresiones en texto.
- AST propio, pequeño y tipado en Zod; tokenizador propio para plantillas.

## Decisión

Las condiciones son un AST discriminado con un conjunto cerrado de operaciones (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`, `and`, `or`, `not`), profundidad máxima 5 y 20 operaciones, con operandos referencia o literal tipado. Las plantillas usan marcadores `{{nodes.<id>.output.<ruta>}}` solo en los campos `templatableFields`, separados por un escáner propio; el contenido del marcador solo se valida como referencia. En campos no plantillables el texto es literal. La medición de profundidad es iterativa para que una entrada hostil no agote la pila.

## Consecuencias

- Bueno: nada de la definición se interpreta como código; el evaluador de F3 será una función pura sobre el árbol.
- Bueno: el editor genera el AST con un constructor visual y comprueba tipos con el mismo sistema de tipos.
- Malo: menos expresivo que un lenguaje de expresiones; ampliar operaciones exige cambiar el esquema.

## Confirmación

`packages/dag-schema/test/conditions.test.ts` y `templates.test.ts`; `apps/web/test/workflow-references.test.tsx`.

## Enlaces

- `specs/003-dag-model-editor/research.md` R5 y R6.
