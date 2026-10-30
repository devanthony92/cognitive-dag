---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# rate-limiter-flexible sobre Valkey con espera progresiva

## Contexto y problema

El login, el registro, el reenvío y el restablecimiento necesitan límites por cuenta e IP (FR-012, FR-013) y deben fallar cerrado.

## Opciones consideradas

- `rate-limiter-flexible` 11.2.3 sobre `iovalkey`.
- Contadores propios con scripts Lua: más código y más riesgo.
- `@nestjs/throttler`: sin espera progresiva por cuenta.

## Decisión

rate-limiter-flexible. Login: contadores por cuenta (`SHA-256` del email) y por IP; desde el 5.º fallo en 15 minutos la espera se duplica de 1 s a 15 min. Los demás flujos usan límites fijos por IP y por email. Si Valkey no responde, 503.

## Consecuencias

- Bueno: Librería madura con almacenamiento en Valkey.
- Bueno: Base para el rate limit de F4.
- Malo: Dependencia nueva.
- Malo: Un reinicio de Valkey borra los contadores.

## Confirmación

`rate-limit.test.ts`, `progressive.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R10.
