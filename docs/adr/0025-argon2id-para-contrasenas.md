---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Argon2id para el hash de contraseñas

## Contexto y problema

Las contraseñas deben almacenarse solo como hash resistente a fuerza bruta (OWASP A04, A07). Decisión abierta O2: autenticación propia o librería.

## Opciones consideradas

- `argon2` 0.45.1 con Argon2id y parámetros mínimos de OWASP (m = 19 MiB, t = 2, p = 1).
- `bcrypt`: límite de 72 bytes y menos resistente a GPU.
- Una librería de autenticación completa (Better Auth): menos control sobre sesiones y RLS.

## Decisión

Autenticación propia con Argon2id, parámetros revisables por configuración. Para que el tiempo de respuesta no revele si un email existe, el login calcula un hash contra un valor ficticio cuando el email no existe. Cierra la decisión abierta O2 (con sesiones opacas en lugar de refresh tokens, ver [ADR-0027](0027-sesiones-opacas-y-csrf.md)).

## Consecuencias

- Bueno: Estándar actual de OWASP.
- Bueno: `argon2` trae binarios precompilados para linux-arm64 y win32-x64 sin scripts de build.
- Malo: Cada hash cuesta memoria y CPU: el rate limit protege contra el agotamiento.

## Confirmación

`register.test.ts` (el hash empieza por `$argon2id$`), `timing.test.ts` (SC-004).

## Enlaces

- `specs/002-identity-tenancy/research.md` R4 y R12.
- [ADR-0026](0026-politica-de-contrasenas-8-25.md).
