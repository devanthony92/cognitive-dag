---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Drizzle ORM para el acceso a datos

## Contexto y problema

F1 introduce las primeras tablas. El acceso a datos debe permitir fijar el contexto de Row-Level Security (RLS) dentro de cada transacción y mantener las migraciones versionadas (decisión abierta O1 de `docs/PLAN.md`).

## Opciones consideradas

- Drizzle ORM 0.45.4 + drizzle-kit 0.31.11 sobre el driver `pg` ya presente.
- Prisma: RLS solo con extensiones y transacciones envolventes.
- Kysely: sin migraciones integradas.

## Decisión

Drizzle. Da SQL explícito y tipado, migraciones generadas desde el esquema (con migraciones SQL manuales para RLS, triggers y privilegios) y control directo de la transacción para `set_config`. Cierra la decisión abierta O1.

## Consecuencias

- Bueno: El esquema es la fuente de verdad de los tipos.
- Bueno: La transacción con contexto de RLS es explícita (`packages/db/src/tenant.ts`).
- Malo: Ecosistema más pequeño que Prisma.
- Malo: Drizzle no modela RLS: las políticas viven en migraciones SQL escritas a mano.

## Confirmación

`pnpm db:migrate` en CI; pruebas de `packages/db`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R1.
- [ADR-0016](0016-librerias-del-api.md).
