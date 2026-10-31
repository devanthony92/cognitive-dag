---
status: accepted
date: 2026-10-31
decision-makers: autor
---

# Límite de ejecuciones simultáneas con advisory lock

## Contexto y problema

Cada organización tiene un máximo de ejecuciones en curso (5 por defecto) que nunca debe superarse, ni siquiera con inicios simultáneos (SC-005). Contar y luego insertar sin coordinación deja una ventana de carrera.

## Opciones consideradas

- Contar y rechazar sin bloqueo.
- Un contador en Valkey.
- Una transacción con `pg_advisory_xact_lock` por organización que cuenta e inserta.

## Decisión

Al iniciar, el API abre una transacción, toma `pg_advisory_xact_lock(hash(organization_id))`, cuenta las ejecuciones `queued` o `running` de la organización y, si alcanzó `organization_limits.max_concurrent_runs`, responde `429 RUN_LIMIT_REACHED` con `retryAfterSeconds`. El límite solo lo cambia el operador con `pnpm ops:set-limits --max-concurrent-runs` ([ADR-0045](0045-limites-gestionados-por-el-operador.md)) y se muestra en solo lectura en los ajustes de la organización.

## Consecuencias

- Bueno: contar e insertar es atómico por organización sin infraestructura nueva; el bloqueo se libera con la transacción.
- Malo: los inicios de una misma organización se serializan un instante; el costo es despreciable frente al inicio en Temporal.

## Confirmación

`apps/api/test/integration/runs-limit.test.ts` (inicios simultáneos con límite 1) y `apps/web/test/organization-limits.test.tsx`.

## Enlaces

[ADR-0042](0042-politica-de-operador-para-organization-limits.md), [ADR-0045](0045-limites-gestionados-por-el-operador.md), `specs/004-execution-engine/research.md` (R5).
