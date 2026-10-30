---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Sesiones opacas en cookie con token CSRF sincronizador

## Contexto y problema

F1 necesita autenticar peticiones de la SPA con revocación inmediata y sin exponer credenciales a JavaScript (OWASP A07).

## Opciones consideradas

- Token opaco de 32 bytes en cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`); solo se guarda `SHA-256` en PostgreSQL; la inactividad vive en Valkey.
- JWT con refresh tokens rotados: revocación más compleja.
- Protección CSRF solo con `SameSite` o double-submit cookie sin firma.

## Decisión

Sesión opaca con PostgreSQL como fuente de verdad de revocación y vida absoluta (12 h) y Valkey para la inactividad (2 h, renovada en cada petición). Si la clave falta en Valkey, la sesión se trata como expirada y las fallas de PostgreSQL o Valkey responden 503 (falla cerrado). CSRF con token sincronizador por sesión en `X-CSRF-Token`, comparado en tiempo constante, más verificación de `Origin`.

## Consecuencias

- Bueno: Revocación inmediata (SC-005).
- Bueno: Sin tokens legibles por JavaScript.
- Malo: Reiniciar Valkey cierra todas las sesiones (aceptado).
- Malo: Cada petición consulta dos almacenes.

## Confirmación

`session.service.test.ts`, `login.test.ts`, `logout.test.ts`, `csrf.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R5 y R6.
