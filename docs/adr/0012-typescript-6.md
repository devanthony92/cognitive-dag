---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# TypeScript 6.0.3 en lugar de TypeScript 7

## Contexto y problema

TypeScript 7.0.2 (compilador nativo) ya está publicado, pero `typescript-eslint` 8.72 solo declara
soporte para `>=4.8.4 <6.1.0`: el compilador nativo aún no expone la API de JavaScript que usa el
lint con tipos. Es una desviación de "usar la versión vigente".

## Opciones consideradas

- TypeScript 7 sin `typescript-eslint` (se pierde el lint con tipos).
- TypeScript 7 para `typecheck` y TypeScript 6 para el lint (dos compiladores con resultados que
  pueden divergir).
- TypeScript 6.0.3 en todo el repositorio.

## Decisión

TypeScript 6.0.3, fijado de forma exacta en el `package.json` raíz. Renovate no propone versiones
`>=6.1` (regla en `.github/renovate.json`).

## Consecuencias

- Bueno: un solo compilador, lint con tipos funcionando y resultados coherentes.
- Malo: no se aprovecha la velocidad del compilador nativo todavía.
- Revisión: cuando `typescript-eslint` soporte TypeScript 7, se retira la regla de Renovate y se
  migra.

## Enlaces

- `specs/001-foundations-skeleton/research.md` (R1). Regla de Renovate "TypeScript 7 is blocked".
