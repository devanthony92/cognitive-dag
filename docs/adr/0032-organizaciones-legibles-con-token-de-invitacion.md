---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Organizaciones legibles con un token de invitación válido (opción B)

## Contexto y problema

Quien aún no es miembro debe ver el nombre de la organización que lo invita antes de aceptar.

## Opciones consideradas

- B: la política `SELECT` de `organizations` añade que exista una invitación `pending` y no vencida cuyo `token_hash` coincide con `app.lookup_token_hash`.
- Guardar el nombre en la invitación: se desactualiza al renombrar la organización.

## Decisión

Opción B (decisión del autor, 2026-10-29), migración `0002_organizations_read_by_invitation.sql`. El endpoint de vista previa selecciona solo el nombre. Al renombrar una organización, la invitación pendiente muestra el nombre vigente.

## Consecuencias

- Bueno: El nombre siempre está al día.
- Bueno: Las políticas de escritura no cambian.
- Malo: Con un token válido la fila completa es legible (RLS es por fila); el control es que el endpoint solo devuelve el nombre.

## Confirmación

`invitations.test.ts` (vista previa) y `organizations.rename.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R8.
