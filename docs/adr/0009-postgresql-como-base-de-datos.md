---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# PostgreSQL como base de datos de la aplicación (D8)

## Contexto y problema

Se necesita una base relacional con aislamiento por tenant y transacciones.

## Opciones consideradas

- PostgreSQL.
- MySQL o SQLite.
- Una base documental (MongoDB).

## Decisión

PostgreSQL 18 (imagen fijada por digest en `compose.yaml`). Permite Row-Level Security para
reforzar el aislamiento por tenant. En F0 solo se levanta y se verifica su conectividad en
`/health/ready`; el esquema y el ORM (decisión abierta O1) llegan en F1.

## Consecuencias

- Bueno: RLS nativo y experiencia previa del autor.
- Malo: otro servicio con estado que respaldar en producción.
- El puerto de host en desarrollo se decide en [ADR-0021](0021-postgresql-en-puerto-5433.md).

## Enlaces

- `docs/PLAN.md` §2 (D8) y §3 (O1).
