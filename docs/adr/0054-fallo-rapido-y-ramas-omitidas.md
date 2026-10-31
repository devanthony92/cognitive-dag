---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Fallo rápido y ramas omitidas

## Contexto y problema

Hay que definir qué pasa cuando un nodo falla con otras ramas en curso, y cómo se tratan las ramas que una condición no toma, sobre todo frente a un merge.

## Opciones consideradas

- Dejar terminar las ramas en curso y fallar al final.
- Fallar en el primer error y cancelar el resto.
- Tratar las ramas no tomadas como fallidas o ignorarlas sin registro.

## Decisión

Fallo rápido: el primer nodo que agota sus reintentos hace fallar la ejecución, cancela las ramas en curso con un `CancellationScope`, deja sin ejecutar los nodos pendientes y asocia el error al nodo. Una rama no tomada deja sus nodos como `skipped`, en cascada, sin contarlos como error. Un merge `all` espera solo a las ramas ejecutadas; un merge `any` continúa con la primera que llega. El plan se calcula con una función pura de `packages/dag-schema` (`planNext`). Una ejecución que supera su duración máxima (30 minutos por defecto) termina como `timed_out`.

## Consecuencias

- Bueno: el estado final es predecible y no se gasta trabajo después de un fallo.
- Malo: no hay finalización parcial; si hiciera falta, será una política nueva (F4).

## Confirmación

`packages/dag-schema/test/runtime/plan.test.ts` y `apps/worker/test/unit/execute-dag.workflow.test.ts`.

## Enlaces

`specs/004-execution-engine/spec.md` (US2), `specs/004-execution-engine/research.md` (R1, R2).
