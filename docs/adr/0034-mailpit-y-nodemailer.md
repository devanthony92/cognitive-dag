---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Mailpit para el correo de desarrollo y nodemailer para el envío

## Contexto y problema

F1 envía correos de verificación, restablecimiento e invitación. En desarrollo no deben salir a internet (FR-030) y el proveedor real se elige en F9.

## Opciones consideradas

- Interfaz `Mailer` con implementación SMTP sobre `nodemailer` 10.2.1 y Mailpit `v1.32.0` en Compose.
- MailHog: sin mantenimiento.
- Un proveedor real desde ya: acopla F1 a una cuenta externa.

## Decisión

Mailpit (SMTP `127.0.0.1:1025`, UI `127.0.0.1:8025`) fijado por digest, y una interfaz `Mailer` reemplazable. El envío ocurre tras confirmar la transacción, con reintentos y backoff; los fallos se registran sin cambiar la respuesta al usuario. Las pruebas leen los correos por la API HTTP de Mailpit.

## Consecuencias

- Bueno: Los correos de desarrollo nunca salen de la máquina.
- Bueno: Cambiar de proveedor en F9 solo toca una implementación.
- Malo: Dependencia de `nodemailer` y una imagen más en Compose.

## Confirmación

`register.test.ts`, `verify-email.test.ts` (correos leídos desde Mailpit).

## Enlaces

- `specs/002-identity-tenancy/research.md` R11.
