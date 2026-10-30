---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Dos roles de PostgreSQL: app_migrator y app_runtime

## Contexto y problema

La cuenta con la que corre el API no debe poder saltarse RLS ni modificar el esquema (FR-020).

## Opciones consideradas

- `app_migrator` (dueño, ejecuta migraciones) y `app_runtime` (`LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, sin `DELETE` ni `TRUNCATE`).
- Un solo rol dueño de las tablas: `FORCE ROW LEVEL SECURITY` lo cubre, pero puede cambiar el esquema.

## Decisión

Dos roles. El script `infra/postgres/init/01-roles.sql` los crea en Compose. El API usa `DATABASE_URL` (runtime); las migraciones usan `DATABASE_MIGRATOR_URL`.

## Consecuencias

- Bueno: Un defecto del API no puede alterar el esquema ni saltar RLS.
- Bueno: Sin `DELETE`: el borrado lógico lo garantiza la base de datos.
- Malo: Dos cadenas de conexión que mantener.
- Malo: Contraseñas de desarrollo en el script de inicialización (solo local).

## Confirmación

`packages/db/test/rls.test.ts` (privilegios de `app_runtime`).

## Enlaces

- `specs/002-identity-tenancy/research.md` R9.
