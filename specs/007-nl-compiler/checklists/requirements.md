# Specification Quality Checklist: Compilador de lenguaje natural a DAG (F6)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-06
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

- Decisiones del autor (2026-11-06): crear y regenerar borrador, sin edición incremental (1B);
  compilación asíncrona en Temporal (2B); metadatos sin contenido en `compilations` (3B); presupuesto
  en `llm_calls` generalizada (4A); Flash-Lite por variable `LLM_MODEL_COMPILER` (5B); formato
  intermedio con layout propio (6B); máx. 2 reparaciones (7A); vista previa y aplicar (8B); último
  intento abrible como borrador (9B); catálogo filtrado por fase y flags (10B); ~30 intenciones con
  propiedades más inyección, umbral 80 % (11B); campos sensibles saneados (12B); 2000 caracteres,
  10 por hora por persona, 50 por día por organización, owner y editor (13B, mitad de límites).
- Validación: 1 iteración, todos los ítems pasan.
