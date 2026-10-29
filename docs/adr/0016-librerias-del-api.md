---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Librerías del API: nestjs-pino, nestjs-cls, nestjs-zod, terminus, OpenFeature, iovalkey y pg

## Contexto y problema

El principio VII exige registrar cada dependencia nueva. F0 incorpora siete librerías de
infraestructura al API; cada una resuelve un requisito concreto de la constitución.

## Opciones consideradas

Se evaluó, por requisito, construir el comportamiento a mano o usar una librería mantenida (ver la
columna "Alternativa descartada").

| Librería                                     | Requisito que cubre                                  | Alternativa descartada                                    |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `nestjs-pino` 5.3 (con `pino` 10)            | Logs JSON con redacción y correlación (principio VI) | Winston: más lento, redacción menos integrada             |
| `nestjs-cls` 7                               | Correlation-ID por petición con AsyncLocalStorage    | AsyncLocalStorage propio: más código                      |
| `nestjs-zod` 5.5                             | Validación en el borde con Zod (principio IV)        | `class-validator`: segunda fuente de verdad               |
| `@nestjs/terminus` 11.1                      | `/health/live` y `/health/ready`                     | Endpoints a mano: sin indicadores estándar                |
| `@openfeature/nestjs-sdk` 0.2 y `server-sdk` | Feature flags con OpenFeature (principio VIII)       | flagd, Unleash: servicios adicionales                     |
| `iovalkey` 0.4                               | Cliente de Valkey para el chequeo de readiness       | `ioredis`: el fork `iovalkey` es el mantenido para Valkey |
| `pg` 8.23                                    | Cliente de PostgreSQL para el chequeo de readiness   | Un ORM: la decisión es de F1 (O1)                         |

## Decisión

Adoptar las siete librerías, con versión exacta fijada (`save-exact=true` en `.npmrc`). La
validación de configuración usa Zod directamente (sin `@nestjs/config` con Joi) para no tener dos
librerías de validación. El worker usa `pino` directo con la misma configuración de redacción de
`packages/logger`.

## Consecuencias

- Bueno: cada control de la constitución tiene una implementación probada y pequeña.
- Malo: `nestjs-zod` y `@openfeature/nestjs-sdk` condicionan la versión de NestJS
  ([ADR-0013](0013-nestjs-11.md)).
- Malo: `iovalkey` y `pg` solo se usan para `PING` y `SELECT 1` en F0; se reevalúan en F1.

## Enlaces

- `specs/001-foundations-skeleton/research.md` (R3, R4, R6, R9, R10).
