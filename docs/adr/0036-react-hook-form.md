---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# React Hook Form con los esquemas Zod compartidos

## Contexto y problema

Los formularios de F1 deben validar con las mismas reglas que el API (principio IV de la constitución).

## Opciones consideradas

- React Hook Form 7.91 con `@hookform/resolvers` 6.0.2 y los esquemas de `packages/contracts`.
- Validación a mano por formulario: reglas duplicadas.

## Decisión

React Hook Form con `zodResolver`. Las reglas que solo existen en la interfaz (la confirmación de contraseña) se agregan como refinamientos Zod en el formulario y no viajan al API.

## Consecuencias

- Bueno: Una sola fuente de verdad para las reglas.
- Bueno: Mensajes en español definidos en el contrato.
- Malo: Dos dependencias nuevas en la web.

## Confirmación

`apps/web/test/register.test.tsx`, `passwords.test.tsx`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R13.
