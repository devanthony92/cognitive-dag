---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Tooling de calidad y CI

## Contexto y problema

La constitución exige que un PR solo se fusione con lint, tipos, pruebas, auditoría de
dependencias y escaneo de secretos en verde. Hace falta una herramienta por control y que cada
control demuestre que bloquea.

## Opciones consideradas

- Monorepo con pnpm workspaces y Turborepo, ESLint (flat config) con `typescript-eslint`,
  Prettier, lefthook y commitlint, CI en GitHub Actions.
- Nx, Husky y lint-staged, otro CI.

## Decisión

- pnpm 12.16.1 (vía Corepack) y Turborepo 2.11 para el monorepo y su caché de tareas.
- ESLint 10, `typescript-eslint` 8.72 y Prettier 3.9 para estilo y tipos.
- lefthook: `pre-commit` (lint y formato de archivos staged) y `commit-msg` (commitlint con
  Conventional Commits).
- GitHub Actions (`.github/workflows/ci.yml`), acciones fijadas por SHA y permisos mínimos
  (`contents: read`). Jobs: `quality`, `security` (`pnpm audit --audit-level high` y gitleaks),
  `integration` y `images`, estos dos en amd64 y arm64. Son seis checks requeridos en la protección
  de `main`.
- Renovate con `minimumReleaseAge` de 3 días, digests fijados y agrupación por ecosistema.

## Consecuencias

- Bueno: cada control está verificado con un PR de prueba que quedó bloqueado
  (`specs/001-foundations-skeleton/checklists/ci-evidence.md`).
- Malo: el job `security` con gitleaks recorre todo el historial; ramas remotas con secretos de
  prueba lo ponen en rojo en otras PR hasta borrarlas.
- Malo: `pnpm audit` depende del servicio de avisos de npm.

## Enlaces

- `specs/001-foundations-skeleton/research.md` (R14, R15).
