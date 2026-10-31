---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Bloqueo optimista del borrador con `If-Match`

## Contexto y problema

Dos personas pueden editar el mismo borrador; la segunda en guardar no debe pisar el trabajo de la primera en silencio (FR-016).

## Opciones consideradas

- Bloqueo pesimista (candado por borrador).
- Última escritura gana.
- Bloqueo optimista con número de revisión como ETag.

## Decisión

`PUT /workflows/{id}/draft` exige `If-Match` con la revisión del borrador (`428` si falta). La actualización es un único `UPDATE ... WHERE draft_revision = $esperada`; si no coincide, `409 DRAFT_CONFLICT`. El editor muestra un diálogo que ofrece recargar el borrador guardado, seguir editando o exportar los cambios propios antes de recargar.

## Consecuencias

- Bueno: sin candados que se queden colgados; el conflicto se resuelve en una sola sentencia atómica.
- Malo: quien pierde la carrera debe recargar y reaplicar sus cambios; no hay fusión automática.

## Confirmación

`apps/api/test/integration/drafts.test.ts` y `apps/web/test/workflow-conflict.test.tsx`.

## Enlaces

- `specs/003-dag-model-editor/research.md` R10.
