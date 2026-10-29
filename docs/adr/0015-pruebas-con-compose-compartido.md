---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Pruebas de integración contra el Compose compartido

## Contexto y problema

Las pruebas de integración, workflow, replay y caos necesitan Postgres, Valkey y Temporal. El plan
original (`docs/PLAN.md` §8) mencionaba Testcontainers.

## Opciones consideradas

- Testcontainers: contenedores nuevos por corrida, mayor aislamiento, arranque más lento.
- Los servicios del `compose.yaml` que ya usa el desarrollador y el job de CI.

## Decisión

Las pruebas de integración usan el Compose compartido. El aislamiento se logra por corrida con
task queue y prefijo de `workflowId` únicos (`test-<runId>-*`) y prefijo de claves en Valkey. El
script `test:integration` corre con `--concurrency=1` en Turborepo. El CI levanta los servicios con
`docker compose up -d --wait` en amd64 y arm64.

## Consecuencias

- Bueno: arranque rápido y un único entorno que reproducir; idéntico a lo que usa el desarrollador.
- Malo: aislamiento más débil que contenedores efímeros; una prueba que no limpie puede dejar
  residuos en el servidor de desarrollo.
- Malo: las pruebas requieren que el Compose esté levantado; el README lo indica.

## Enlaces

- `specs/001-foundations-skeleton/research.md` (R12). `.github/workflows/ci.yml` (job
  `integration`).
