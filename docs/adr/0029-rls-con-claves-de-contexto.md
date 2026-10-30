---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Row-Level Security con claves de contexto por transacción

## Contexto y problema

El aislamiento entre organizaciones debe sostenerse aunque la aplicación omita un filtro (SC-003, OWASP A01).

## Opciones consideradas

- `FORCE ROW LEVEL SECURITY` en todas las tablas y políticas que leen `current_setting('app.…', true)`, fijado con `set_config(..., true)` al abrir cada transacción.
- Funciones `SECURITY DEFINER` para las consultas previas a la autenticación: requieren un rol con `BYPASSRLS` o un dueño distinto.

## Decisión

Claves `app.user_id` y `app.organization_id` para las peticiones autenticadas, y claves específicas `app.lookup_email` y `app.lookup_token_hash` que solo el módulo de autenticación fija para las consultas previas (login, sesión, tokens de un solo uso, invitaciones). `withContext` de `packages/db` es el único camino de consulta del API.

## Consecuencias

- Bueno: Una segunda capa independiente de la aplicación.
- Bueno: Sin `SECURITY DEFINER` ni `BYPASSRLS`.
- Malo: `INSERT ... RETURNING` exige generar los ids antes y ponerlos en el contexto.
- Malo: Pruebas más delicadas: conectan como `app_runtime`.

## Confirmación

`packages/db/test/rls.test.ts`, `rls-defense.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R8.
- [ADR-0030](0030-dos-roles-de-postgresql.md).
