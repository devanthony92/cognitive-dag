# Data Model: Fundaciones y walking skeleton (F0)

F0 no tiene esquema en la base de datos de la aplicación. Las entidades viven en Temporal, en la
configuración o en los contratos del API. Los esquemas Zod correspondientes viven en
`packages/contracts`.

## PingExecution

Ejecución del workflow de ping. Fuente de verdad: Temporal.

| Campo | Tipo | Reglas |
|---|---|---|
| `pingId` | string | `ping-<uuid>`; igual al `workflowId` |
| `correlationId` | UUID | heredado de la solicitud que la creó |
| `idempotencyKey` | UUID | del header `Idempotency-Key` o generado |
| `message` | string opcional | 1–100 caracteres imprimibles |
| `status` | enum | `pending`, `running`, `completed`, `failed`, `timed_out` |
| `result` | objeto opcional | `{ pong: string, workerId: string, attempts: number }`, solo si `completed` |
| `startedAt` | fecha ISO 8601 | |
| `finishedAt` | fecha ISO 8601 opcional | solo en estados terminales |

### Transiciones

```
pending ──(worker toma la tarea)──► running ──► completed
   │                                   ├──────► failed      (reintentos agotados)
   └───────────(timeout global)────────┴──────► timed_out   (10 min)
```

- `pending` → `running` es reversible a nivel de Temporal (un worker puede caer), pero el estado
  expuesto nunca retrocede una vez que hubo progreso.
- Los estados terminales son definitivos.

## CorrelationId

| Campo | Tipo | Reglas |
|---|---|---|
| valor | UUID | entrante aceptado solo si es UUID válido de ≤ 36 caracteres; si no, se genera v4 |

Aparece en: header `X-Correlation-Id`, problem+json, logs (`correlationId`), entrada del workflow,
search attribute `CorrelationId` (Keyword).

## ProblemDetails (RFC 9457)

| Campo | Tipo | Reglas |
|---|---|---|
| `status` | entero | código HTTP |
| `title` | string | frase HTTP estándar |
| `detail` | string | español, sin datos internos |
| `code` | string | `UPPER_SNAKE_CASE`, estable, en inglés |
| `correlationId` | UUID | siempre presente |
| `errors` | lista opcional | solo en 422: `{ field: string, message: string }` |

## FeatureFlag

| Campo | Tipo | Reglas |
|---|---|---|
| `key` | string | kebab-case, p. ej. `ping-enabled` |
| `defaultValue` | boolean | valor seguro (`false`) si no se puede evaluar |
| `public` | boolean | si se expone a la web en `/api/v1/features` |
| `owner` | string | responsable |
| `removalIssue` | URL | issue para eliminar el flag |

Flags de F0: `ping-enabled` (público, default `false`).

## HealthReport

| Campo | Tipo | Reglas |
|---|---|---|
| `status` | enum | `ok`, `error` |
| `checks` | mapa | por dependencia: `{ status: up | down }`, sin mensajes internos |

## Threat (documento, no persistido)

Componente o flujo · categoría STRIDE · descripción · mitigación · estado
(`mitigated`, `accepted`, `planned:<fase>`).
