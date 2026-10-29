---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Temporal (SDK TypeScript) como motor de ejecución (D3)

## Contexto y problema

Los workflows deben sobrevivir a caídas del proceso, reintentar con política, esperar aprobaciones
humanas y reanudar sin duplicar efectos. Construir ese motor es costoso y propenso a errores.

## Opciones consideradas

- Temporal con su SDK para TypeScript.
- Cola de trabajos (BullMQ sobre Valkey, pg-boss sobre PostgreSQL) con máquina de estados propia.
- Un orquestador de otro ecosistema (Airflow, Argo).

## Decisión

Temporal, con el SDK TypeScript. Estado durable, reintentos, timers y signals vienen del motor; el
código del workflow debe ser determinista y toda E/S ocurre en activities.

## Consecuencias

- Bueno: durabilidad y recuperación tras caídas demostrables (F0 incluye una prueba de caos con
  `SIGKILL` del worker: `apps/worker/test/integration/ping.chaos.test.ts`).
- Bueno: `workflowId` da idempotencia sin tabla propia (`apps/api/src/ping/ping.service.ts`).
- Malo: un servicio más que operar; en F0 se usa el servidor de desarrollo con SQLite y el
  despliegue de producción (F9) requiere configurarlo con PostgreSQL.
- Malo: el código de workflow tiene restricciones de determinismo y de versionado.

## Enlaces

- `docs/PLAN.md` §2 (D3) y §4 (Ejecución con Temporal). Constitución, principio II.
