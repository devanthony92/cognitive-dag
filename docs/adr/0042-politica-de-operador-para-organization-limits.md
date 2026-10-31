---
status: accepted
date: 2026-10-30
decision-makers: autor
---

# Política de operador para `organization_limits` (opción B)

## Contexto y problema

Los límites por organización los fija solo el operador de la plataforma; ningún miembro, tampoco el owner, puede cambiarlos desde la app (FR-021). Con RLS forzado, el dueño de la tabla (`app_migrator`) también queda sujeto a las políticas, así que sin una política propia el script del operador no podría escribir.

## Opciones consideradas

- A: `app_runtime` escribe la tabla y el API restringe quién puede hacerlo.
- B: `app_runtime` solo tiene `SELECT`; una política `organization_limits_operator` (`FOR ALL TO app_migrator`) permite escribir al script del operador.
- C: sin tabla; límites en variables de entorno.

## Decisión

Opción B. La base de datos garantiza que la aplicación no puede escribir límites: aunque el API tuviera un fallo de autorización, `app_runtime` no tiene `INSERT`, `UPDATE` ni `DELETE` sobre la tabla. La lectura sigue aislada por `organization_id`.

## Consecuencias

- Bueno: el control no depende del código de la aplicación (A01, A06).
- Bueno: no hay endpoint de escritura que proteger.
- Malo: cambiar límites exige acceso al rol `app_migrator`; es lo buscado.

## Confirmación

`packages/db/test/rls-workflows.test.ts` (sin escritura para `app_runtime`) y `apps/api/test/integration/limits.test.ts`.

## Enlaces

- `specs/003-dag-model-editor/data-model.md` (RLS y privilegios), ADR-0045.
