---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Polling del estado del ping en F0 (SSE queda para F3)

## Contexto y problema

La web debe mostrar el estado de un ping que se resuelve en el worker. Las opciones empujan
complejidad distinta al API y a la web, y F0 solo necesita demostrar el recorrido de punta a
punta.

## Opciones consideradas

- Polling con TanStack Query.
- Server-Sent Events desde el API.
- WebSocket.

## Decisión

Polling del estado cada 1 s mientras el estado no sea terminal (`GET /api/v1/pings/:id`); se
detiene en `completed`, `failed` o `timed_out`. SSE se introduce en F3, cuando exista la tabla de
eventos de ejecución y la vista en vivo.

## Consecuencias

- Bueno: sin conexiones largas ni infraestructura adicional; fácil de probar.
- Malo: una petición por segundo por ping activo; aceptable en local y con un solo usuario.
- Reemplazable sin cambiar el contrato del recurso `ping`.

## Enlaces

- `specs/001-foundations-skeleton/research.md` (R13). `apps/web/src/features/ping/PingPanel.tsx`.
