---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# TypeScript en todo el stack (D2)

## Contexto y problema

El sistema tiene web, API y worker que comparten estructuras de datos (DAG, contratos de error,
ping). Mantener esquemas en lenguajes distintos duplica la validación y abre divergencias.

## Opciones consideradas

- TypeScript en web, API y worker.
- TypeScript en la web y otro lenguaje (Go, Python, Java) en el backend.

## Decisión

TypeScript en todo el stack, con Zod como fuente única de verdad de los contratos (los tipos se
derivan del esquema). Los contratos viven en `packages/contracts`.

## Consecuencias

- Bueno: un solo esquema valida en la web, el API y el worker; el SDK de Temporal para TypeScript
  permite compartir tipos con los workflows.
- Bueno: menos cambio de contexto para una persona que desarrolla sola.
- Malo: Node.js rinde menos en CPU que alternativas compiladas; no es relevante para un
  orquestador limitado por E/S.
- La versión concreta del compilador se decide en [ADR-0012](0012-typescript-6.md).

## Enlaces

- `docs/PLAN.md` §2 (D2). Constitución, principio IV.
