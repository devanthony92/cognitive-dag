# Contrato: salud del worker

Servidor HTTP mínimo del worker, solo en `127.0.0.1:3001` (configurable con `WORKER_HEALTH_PORT`).

| Ruta | 200 | 503 |
|---|---|---|
| `GET /health/live` | el proceso responde | — |
| `GET /health/ready` | el worker de Temporal está en estado `RUNNING` | worker iniciando, detenido o sin conexión a Temporal |

Cuerpo: `HealthReport` (ver [data-model.md](../data-model.md)), p. ej.
`{ "status": "ok", "checks": { "temporal-worker": { "status": "up" } } }`.

Cualquier otra ruta responde 404 sin cuerpo.
