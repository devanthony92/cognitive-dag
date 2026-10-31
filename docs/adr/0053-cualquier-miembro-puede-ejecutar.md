---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Cualquier miembro puede ejecutar, cancelar y reejecutar

## Contexto y problema

En F2 el rol viewer solo lee. Ejecutar un workflow con nodos simulados no tiene efectos externos, pero desde F7 habrá nodos que llamen a servicios de terceros.

## Opciones consideradas

- Ejecutar solo owner y editor.
- Ejecutar cualquier miembro, a revisar en F7.

## Decisión

Decisión del autor (FR-016): cualquier miembro (owner, editor o viewer) ejecuta, ve, cancela y reejecuta. La autorización por organización se aplica siempre; el flag no la sustituye. Se acepta porque en F3 los únicos nodos ejecutables son el disparador manual, la condición, el merge y el servicio simulado, sin efectos externos. Se revisa en F7.

## Consecuencias

- Bueno: quien solo observa puede probar un workflow sin pedir un rol de edición.
- Malo: cuando lleguen los efectos externos, este permiso sería demasiado amplio; queda registrado como riesgo aceptado en el [modelo de amenazas](../threat-model.md).

## Confirmación

`apps/api/test/integration/runs-start.test.ts` (cualquier rol ejecuta; otra organización recibe 404) y `apps/web/test/runs-start.test.tsx`.

## Enlaces

`specs/004-execution-engine/spec.md` (FR-016).
