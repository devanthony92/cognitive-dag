---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Catálogo completo de 11 tipos de nodo desde F2

## Contexto y problema

F2 no ejecuta workflows, pero el modelo, el compilador de F6 y el intérprete de F3 comparten el catálogo. Si F2 definiera solo los nodos que ya se ejecutan, cada fase posterior cambiaría el esquema de las definiciones guardadas y tocaría versiones ya publicadas.

## Opciones consideradas

- Definir ahora los 11 tipos del plan, con configuración y salida tipadas, e indicar en cada uno la fase en que se vuelve ejecutable.
- Definir solo los tipos de F3 y añadir el resto en su fase.

## Decisión

El catálogo contiene los 11 tipos (`trigger.manual`, `trigger.webhook`, `trigger.schedule`, `llm.classify`, `llm.extract`, `llm.generate`, `logic.condition`, `logic.merge`, `human.approval`, `http.request`, `mock.service`). Cada entrada declara `configSchema`, `outputSchema(config)`, `handles`, `templatableFields` y `executableFrom` (`F3`, `F5` o `F7`); la paleta del editor muestra esa fase. Las salidas se calculan desde la configuración (`llm.extract`, `trigger.*`), lo que permite validar referencias entre nodos.

## Consecuencias

- Bueno: las definiciones guardadas en F2 siguen siendo válidas cuando los nodos pasen a ejecutarse; las versiones publicadas no necesitan migración.
- Bueno: el usuario ve desde ya qué falta por ejecutarse.
- Malo: hay nodos que se pueden configurar y publicar pero aún no se ejecutan; es una limitación visible, no un riesgo.
- Malo: `http.request` se valida solo en forma (https, sin credenciales, host fijo). La protección anti-SSRF llega con F7.

## Confirmación

`packages/dag-schema/test/catalog.test.ts` (los 11 tipos, configuración por defecto válida, FR-005) y `apps/web/test/workflow-editor.test.tsx` (la paleta indica la fase).

## Enlaces

- `specs/003-dag-model-editor/research.md` R3.
- FR-001, FR-002 y FR-005.
