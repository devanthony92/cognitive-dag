---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Registrar las decisiones de arquitectura como ADR en formato MADR 4

## Contexto y problema

CognitiveDAG es un proyecto de portafolio: las decisiones técnicas son parte de lo que se quiere
demostrar y deben poder revisarse meses después, sin depender de la memoria del autor. La
constitución (principio VII) exige registrar toda dependencia nueva o desviación de
`docs/PLAN.md`.

## Opciones consideradas

- Solo `docs/PLAN.md` como documento vivo.
- Wiki o issues de GitHub.
- ADRs en el repositorio, un archivo por decisión, en formato MADR 4.

## Decisión

ADRs en `docs/adr/NNNN-titulo.md`, numerados de forma correlativa, siguiendo [la plantilla](template.md)
(MADR 4 en español). Un ADR aceptado no se reescribe: si la decisión cambia, se crea otro ADR y
el anterior pasa a `superseded by ADR-NNNN`. `docs/PLAN.md` enlaza los ADR en lugar de repetirlos.

## Consecuencias

- Bueno: el historial de decisiones viaja con el código, se revisa en la PR y queda versionado.
- Bueno: las desviaciones del plan quedan justificadas y enlazables desde el código (por ejemplo,
  `.github/renovate.json`).
- Malo: cada decisión relevante cuesta un archivo más que mantener.

## Enlaces

- Constitución, principio VII (`.specify/memory/constitution.md`).
