# Specification Quality Checklist: Triggers y control humano (F7)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Decisiones del autor (2026-11-07): 4 nodos más credenciales, circuit breaker y bulkhead HTTP (1A);
  webhook con token secreto en la URL y sin HMAC, desviación de PLAN registrada (2B); anti-replay por
  ventana de tiempo e `X-Event-Id` como `workflowId` (3B); `202` inmediato con `runId` (4A); versión
  activa al disparar (5A); un Temporal Schedule por workflow, salto por solape y catch-up acotado (6B);
  aprueba cualquier owner o editor salvo el iniciador (7A); bandeja con contador más correo, comentario
  solo en Temporal (8B); anti-SSRF con DNS resuelto, conexión a la IP, 3 redirecciones y allowlist
  opcional (9C); credenciales con cifrado de sobre AES-256-GCM, solo cabeceras (10B); respuesta de 1 MB
  y clasificación de errores (11A); `Idempotency-Key`, circuit breaker por organización y host y cola
  `http` (12A); un flag `triggers-enabled` y compilador sin nodos nuevos (13C).
- Valores que propuse yo dentro de esas decisiones (a revisar por el autor): ventana de ±5 min,
  60 llamadas/min por trigger, cuerpo de 64 KiB, catch-up de 1 hora, tope de 10 programaciones por
  organización, circuit breaker de 5 fallos en 60 s con enfriamiento de 30 s y espera máxima de 120 s,
  hasta 20 destinatarios de correo, solo el owner administra credenciales y allowlist, política de
  reintentos de 3 intentos y 30 s, pausa de la aprobación fuera del límite de concurrencia.
- Desviaciones de `docs/PLAN.md` a registrar en ADR: token en lugar de HMAC (ADR-0072), Update en lugar
  de Signal y sin estado `waiting_approval` (ADR-0074).
- `data-model.md` aprobado por el autor el 2026-11-07; `tasks.md` puede generarse.
- Validación: 1 iteración, todos los ítems pasan.
