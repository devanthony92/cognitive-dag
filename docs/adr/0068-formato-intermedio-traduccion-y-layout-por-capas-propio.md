---
status: accepted
date: 2026-11-06
decision-makers: autor
---

# Formato intermedio, traducción y layout por capas propio

## Contexto y problema

Pedir al modelo el `DagDefinition` completo le exige inventar posiciones, ids de arista y `schemaVersion`, lo que aumenta los errores sin aportar valor. Además hay que dar posiciones razonables al borrador sin añadir una dependencia.

## Opciones consideradas

- El modelo devuelve el `DagDefinition` completo.
- El modelo devuelve un formato intermedio mínimo; el código traduce y calcula el layout.
- Igual que la anterior, usando una biblioteca de layout (dagre, elkjs).

## Decisión

El modelo devuelve `{ title, nodes: [{ id, type, label, config }], edges: [{ from, fromHandle, to }] }`. El esquema JSON se deriva de Zod con un `config` por tipo (unión discriminada por `type`) y vive en `packages/compiler`. El código lo traduce a `DagDefinition` (`schemaVersion`, ids de arista deterministas `<from>-<fromHandle>-<to>`) y calcula posiciones con un layout por capas propio: orden topológico, capa igual a la distancia máxima desde el trigger y separación fija. Sin dependencia nueva, según el principio VII. El paquete es puro y se desarrolla con TDD.

## Consecuencias

- Bueno: menos superficie de error del modelo y salida determinista y fácil de probar.
- Bueno: la traducción y el layout se prueban sin red ni modelo.
- Malo: el layout simple no minimiza cruces de aristas en grafos grandes; la persona puede mover los nodos en el editor.
- Malo: el esquema intermedio debe mantenerse sincronizado con el catálogo (`contracts-sync.test.ts`).

## Confirmación

`intermediate.test.ts`, `translate-layout.test.ts` y `contracts-sync.test.ts` en `packages/compiler`.

## Enlaces

- [Research F6](../../specs/007-nl-compiler/research.md) (R6 y R7).
- [ADR-0002](0002-llm-como-compilador-de-dag.md).
