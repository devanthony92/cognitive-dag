---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# React Flow y dagre para el editor visual

## Contexto y problema

El editor necesita lienzo con nodos y conexiones, y un orden automático por capas, con 50 nodos y 100 conexiones fluidos (SC-004). Cada dependencia nueva exige un ADR (constitución VII).

## Opciones consideradas

- `@xyflow/react` (React Flow) para el lienzo; `@dagrejs/dagre` o `elkjs` para el orden.
- Dibujar con SVG propio.

## Decisión

`@xyflow/react` 12.12.0 para lienzo, nodos y handles del catálogo, y `@dagrejs/dagre` 3.1.3 para «Ordenar»: capas de izquierda a derecha, solo cambian posiciones. Se eligió dagre sobre `elkjs` por ser más liviano. Se construyen los nodos de React Flow con caché para que mover uno no reconstruya los otros 49. Versiones con más de un día de publicadas, como exige pnpm.

## Consecuencias

- Bueno: lienzo probado y accesible por teclado; el orden automático es determinista.
- Malo: dagre no resuelve todos los cruces de aristas de forma óptima.
- Malo: jsdom no tiene layout; las pruebas usan polyfills (`apps/web/test/flow-polyfills.ts`).

## Confirmación

`apps/web/test/layout-export.test.ts` y `workflow-editor-performance.test.tsx`.

## Enlaces

- `specs/003-dag-model-editor/research.md` R8.
