---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Eventos de seguridad como logs estructurados

## Contexto y problema

OWASP A09 exige registrar las acciones de seguridad. La consulta por owners desde la aplicación queda fuera de F1.

## Opciones consideradas

- Un `SecurityEventLogger` único que emite logs estructurados con un campo `event` estable.
- Una tabla de auditoría por organización: se difiere (decisión del autor).

## Decisión

Los eventos de FR-026 (más `org.renamed`) se emiten como logs con `event`, `outcome`, `userId`, `organizationId`, `ip` y `correlationId`. El tipo de evento no admite campos libres, así que no se pueden adjuntar contraseñas, tokens ni ids de sesión.

## Consecuencias

- Bueno: Evidencia mínima de A09 sin tabla nueva.
- Bueno: Filtrable por nombre estable.
- Malo: Sin consulta en la aplicación ni retención garantizada hasta que exista la tabla (F9 decide la retención).

## Confirmación

`apps/api/test/integration/security-events.test.ts` (SC-007) y `security-event.logger.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R15.
