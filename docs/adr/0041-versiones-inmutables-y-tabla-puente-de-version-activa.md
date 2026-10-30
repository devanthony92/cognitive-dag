---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Versiones inmutables y tabla puente para la versión activa

## Contexto y problema

Las ejecuciones de F3 se ligarán a una versión exacta, así que una versión publicada no puede cambiar nunca (FR-015, SC-006). Pero hace falta marcar cuál es la activa y poder volver a una anterior. Guardar la versión activa en `workflows` (`active_version_id`) crea una referencia circular con `workflow_versions` y obliga a insertar en dos pasos con una clave que todavía no existe.

## Opciones consideradas

- A: columna `workflows.active_version_id` con FK a `workflow_versions`.
- B: columna `is_active` en cada versión.
- C: tabla puente `workflow_active_versions`, una fila por workflow, con FK compuesta `(version_id, workflow_id)` a `workflow_versions(id, workflow_id)`.

## Decisión

Opción C (aprobada por el autor). `workflow_versions` no tiene `UPDATE` ni `DELETE` para `app_runtime`: publicar inserta una versión y actualiza la fila puente; reactivar solo actualiza la fila puente; archivar el workflow deja `version_id` en `NULL` mediante un trigger. La FK compuesta impide activar una versión de otro workflow, y triggers verifican que `organization_id` coincida con el del workflow. Cada versión guarda `definition_hash` (SHA-256 de la definición canónica) para comprobar que no cambió.

## Consecuencias

- Bueno: la inmutabilidad la garantiza la base de datos, no solo el código (A08).
- Bueno: sin ciclo de referencias y como máximo una versión activa por construcción.
- Malo: una tabla y dos triggers más que mantener; leer la versión activa requiere un `JOIN`.

## Confirmación

`packages/db/test/rls-workflows.test.ts` y `active.test.ts` (sin `UPDATE` ni `DELETE`, FK compuesta, triggers) y `apps/api/test/integration/versions.test.ts` (v1, v2 inmutables; reactivar no crea versión).

## Enlaces

- `specs/003-dag-model-editor/data-model.md` y `research.md` R9 y R11.
