---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# NestJS como framework del API (D4)

## Contexto y problema

El API necesitará autenticación, autorización por rol, validación, interceptores y filtros de
errores. Un framework con módulos e inyección de dependencias facilita aplicar esos controles de
forma uniforme.

## Opciones consideradas

- NestJS.
- Express o Fastify con módulos propios.
- Un framework ligero (Hono).

## Decisión

NestJS: módulos, inyección de dependencias, guards, interceptors y filtros de excepciones para
colocar los controles de seguridad en un lugar central (por ejemplo, el `ProblemDetailsFilter`
global).

## Consecuencias

- Bueno: estructura conocida y soporte directo para guards (F1) y filtros (F0).
- Malo: más abstracción y dependencia de decoradores; requiere `emitDecoratorMetadata`, por lo que
  el API se compila con SWC.
- La versión mayor concreta se decide en [ADR-0013](0013-nestjs-11.md).

## Enlaces

- `docs/PLAN.md` §2 (D4).
