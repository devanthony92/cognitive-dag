---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Borrado lógico filtrado en packages/db (opción A)

## Contexto y problema

Usuarios, organizaciones y membresías se borran de forma lógica con `deleted_at`. PostgreSQL aplica la política `SELECT` también a la fila nueva de un `UPDATE`, de modo que una política con `deleted_at IS NULL` impide marcar `deleted_at`.

## Opciones consideradas

- A: las políticas `SELECT` no comprueban `deleted_at`; el filtro vive en selectores `active` de `packages/db`, con regla de ESLint en `apps/api`.
- B: políticas con `deleted_at IS NULL` y funciones privilegiadas para borrar.

## Decisión

Opción A (decisión del autor, 2026-10-29).

## Consecuencias

- Bueno: Sin funciones privilegiadas.
- Bueno: El filtro es visible en un solo paquete.
- Malo: Una consulta que olvide `active.*` podría ver filas borradas de su propia organización; RLS sigue impidiendo ver otras.

## Confirmación

`packages/db/test/active.test.ts` y la regla de ESLint.

## Enlaces

- `specs/002-identity-tenancy/research.md` R3 y R8.
