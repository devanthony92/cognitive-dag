# Quickstart: validar F0

Guía de validación de punta a punta. Contratos: [contracts/](./contracts/). Modelo:
[data-model.md](./data-model.md).

## Prerrequisitos

- Node.js 24.22.1 (`.nvmrc`), pnpm vía corepack, Docker Desktop, git.

## Arranque

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait
pnpm dev
```

Esperado: web en http://localhost:5173, API en http://localhost:3000, UI de Temporal en
http://localhost:8233; `docker compose ps` muestra todos los servicios `healthy`.

## Escenarios

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | `curl -i localhost:3000/health/ready` y `curl -i localhost:3001/health/ready` | 200 con todas las dependencias `up` |
| 2 | US1 | Borrar `TEMPORAL_ADDRESS` de `.env` y arrancar el API | El proceso termina con código 1 y nombra la variable, sin mostrar valores |
| 3 | US2 | Pulsar "Ejecutar ping" en la web | En < 5 s: estado `completed`, resultado y `correlationId` visibles |
| 4 | US2 | Detener el worker, ejecutar ping, arrancar el worker | Estado `pending` y luego `completed`; un solo resultado |
| 5 | US2 | `curl -X POST localhost:3000/api/v1/pings -H "Idempotency-Key: <uuid>"` dos veces | Mismo `pingId` en ambas respuestas |
| 6 | US3 | `curl -i -X POST localhost:3000/api/v1/pings -H "X-Correlation-Id: not-a-uuid"` | Header `X-Correlation-Id` con un UUID nuevo |
| 7 | US3 | Repetir con un UUID válido y buscar `CorrelationId="<uuid>"` en la UI de Temporal y en los logs | El mismo ID en respuesta, logs de API y worker, y en la ejecución |
| 8 | US3 | `POST` con `{"message": ""}` | 422 `VALIDATION_FAILED` con `errors[]` |
| 9 | US3 | `POST` con un cuerpo mayor al límite | 413 `PAYLOAD_TOO_LARGE` |
| 10 | US3 | `GET /no-existe` | 404 `ROUTE_NOT_FOUND` con `correlationId` |
| 11 | US3 | `docker compose stop temporal` y ejecutar ping | 503 `SERVICE_UNAVAILABLE`; readiness 503 |
| 12 | US5 | `FEATURE_FLAGS='{"ping-enabled":false}'`, reiniciar el API | `POST` → 404 `FEATURE_NOT_AVAILABLE`; botón oculto en la web |
| 13 | US4 | `git commit -m "bad message"` | lefthook rechaza el commit |

## Pruebas automatizadas

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration
```

`test:integration` requiere el Compose en ejecución e incluye las pruebas de workflow, replay y caos.

## CI

Una PR de prueba por cada control (estilo, tipos, prueba fallida, dependencia vulnerable, secreto
de prueba) debe quedar bloqueada para merge.
