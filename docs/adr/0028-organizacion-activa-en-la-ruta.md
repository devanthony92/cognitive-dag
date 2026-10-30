---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Organización activa en la ruta del API

## Contexto y problema

Toda petición a recursos de una organización debe indicar sobre cuál opera, y el sistema debe verificar la membresía en cada una (FR-017).

## Opciones consideradas

- En la ruta: `/api/v1/organizations/{organizationId}/...`.
- Header `X-Organization-Id`: invisible en logs de acceso y enlaces.

## Decisión

La organización va en la ruta. `OrganizationGuard` valida membresía y rol en cada petición y fija el contexto de RLS con la organización que aceptó. Un no miembro recibe el mismo 404 que una organización inexistente. El ping de F0 pasa a `/api/v1/organizations/{organizationId}/pings`.

## Consecuencias

- Bueno: Explícito, visible en logs y cacheable.
- Bueno: Cada pestaña opera sobre su organización.
- Malo: Cambio de contrato del ping de F0 (detrás del flag `identity-enabled`).

## Confirmación

`cross-tenant.test.ts` (SC-002), `organization.guard.test.ts`.

## Enlaces

- [ADR-0007](0007-multiusuario-y-multi-tenant.md).
- `specs/002-identity-tenancy/research.md` R7.
