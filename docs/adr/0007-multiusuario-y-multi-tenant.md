---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Plataforma multiusuario y multi-tenant (D6)

## Contexto y problema

Un objetivo del portafolio es demostrar aislamiento de datos real. Un sistema monousuario lo
esquivaría.

## Opciones consideradas

- Monousuario.
- Multiusuario con una organización por instalación.
- Multi-tenant: varios tenants en la misma base, con roles por tenant.

## Decisión

Multi-tenant real: `tenant_id` en toda consulta, guards de aplicación y Row-Level Security en
PostgreSQL como segunda capa (constitución, principio I). Se implementa en F1; F0 no tiene
autenticación ni tenants.

## Consecuencias

- Bueno: demuestra OWASP A01 con pruebas de acceso cruzado entre tenants.
- Malo: complejidad en cada consulta, en las pruebas y en el modelo de datos desde F1.
- Mientras F1 no exista, el sistema solo se ejecuta en local y no se despliega públicamente.

## Enlaces

- `docs/PLAN.md` §2 (D6) y §6.2 (A01).
