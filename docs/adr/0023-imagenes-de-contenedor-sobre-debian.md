---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Imágenes de contenedor sobre Debian (glibc), builds amd64 y arm64

## Contexto y problema

El worker de Temporal usa `@temporalio/core-bridge`, un binario de Rust que solo existe para glibc
(`aarch64-unknown-linux-gnu` y `x86_64-unknown-linux-gnu`); no hay build para musl. El destino de
producción es Oracle Ampere A1 (arm64) y el desarrollo es amd64.

## Opciones consideradas

- Alpine: imágenes pequeñas, pero el worker no carga en musl.
- `node:<lts>-bookworm-slim` para api y worker.
- Imágenes distroless.

## Decisión

`node:24.22.1-bookworm-slim` fijada por digest en los Dockerfiles de `api` y `worker`, en builds
multi-stage con `pnpm deploy --prod`, `USER node` y `NODE_ENV=production`. El CI construye ambas
imágenes para `linux/amd64` y `linux/arm64` en runners nativos y no las publica.

## Consecuencias

- Bueno: el mismo binario funciona en desarrollo y en producción; el build arm64 es nativo, sin
  QEMU.
- Malo: imágenes más grandes que Alpine.
- `pnpm install` corre siempre dentro del Dockerfile; nunca se copia `node_modules` desde Windows.

## Enlaces

- `docs/PLAN.md` §9.1. `apps/api/Dockerfile`, `apps/worker/Dockerfile`.
- Constitución, "Restricciones técnicas".
