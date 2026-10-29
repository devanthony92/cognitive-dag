---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# React, Vite y React Flow en el frontend (D9)

## Contexto y problema

La interfaz es una aplicación interna con un editor visual de grafos. No necesita renderizado en
servidor ni SEO.

## Opciones consideradas

- SPA con React, Vite y React Flow.
- Next.js u otro framework con SSR.
- Otra librería de grafos (Cytoscape, JointJS).

## Decisión

SPA con React 19 y Vite; React Flow para el editor de DAG a partir de F2. En F0 la web solo tiene
el panel de ping.

## Consecuencias

- Bueno: despliegue estático, sin servidor de renderizado; ecosistema amplio.
- Malo: sin SSR, lo cual no importa para este producto.
- La estrategia de actualización del estado en F0 está en [ADR-0014](0014-polling-en-f0.md).

## Enlaces

- `docs/PLAN.md` §2 (D9).
