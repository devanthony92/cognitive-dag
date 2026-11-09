# CognitiveDAG

AI workflow orchestrator: automations described in natural language are compiled into typed DAGs
and executed as durable, fault-tolerant workflows on [Temporal](https://temporal.io).

The LLM acts as a **compiler** (natural language → DAG) and as a bounded function inside specific
nodes. It never decides at run time which action to take outside the published graph, and nothing
runs without an explicit publish by a user. See [ADR-0002](docs/adr/0002-llm-como-compilador-de-dag.md).

> Documentation language: code, commits and this README are in English; specs, ADRs, the threat
> model and the technical plan are in Spanish (see the
> [constitution](.specify/memory/constitution.md), principle IX).

## Status

**F0 — foundations and walking skeleton, F1 — identity and multi-tenancy, F2 — DAG model and visual editor, F3 — execution engine, F4 — resilience, F5 — cognitive nodes, F6 — natural language compiler and F7 — triggers and human control: complete.** F8 (hardening) removed the eight product flags: every feature is on, the flag catalog is empty and `GET /api/v1/features` answers `{}` ([ADR-0084](docs/adr/0084-eliminacion-de-los-flags-de-producto.md)). The worker keeps three kill switches: `LLM_ENABLED`, `HTTP_ENABLED` and `TRIGGERS_ENABLED`.

| Area                 | What F0 delivers                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Monorepo and tooling | pnpm workspaces, Turborepo, ESLint, Prettier, lefthook, commitlint                                               |
| Contracts            | Shared Zod schemas; RFC 9457 errors; `X-Correlation-Id` end to end (API, Temporal search attribute, worker logs) |
| API                  | NestJS 11: health checks, config validation, structured logs with redaction, feature flags (OpenFeature)         |
| Workflow             | Ping workflow with idempotency (`Idempotency-Key`), call deadlines, replay tests and hard-crash chaos tests      |
| Web                  | React 19 + Vite panel that runs a ping and shows its status                                                      |
| Infrastructure       | Docker Compose: PostgreSQL, Valkey, Temporal dev server; multi-arch (amd64, arm64) container images              |
| CI                   | GitHub Actions: quality, security (audit + gitleaks), integration and images on amd64 and arm64                  |
| Documentation        | 23 architecture decision records and a [threat model](docs/threat-model.md)                                      |

F1 adds:

| Area          | What F1 delivers                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts      | Registration (with a personal organization you can name), email verification, password reset and change (8–25 characters, [ADR-0026](docs/adr/0026-politica-de-contrasenas-8-25.md)) |
| Sessions      | Opaque `__Host-session` cookie, CSRF token, progressive rate limiting, fail-closed when Valkey or PostgreSQL are down                                                                |
| Multi-tenancy | Organizations, roles (owner, editor, viewer), invitations, renaming; guard per request plus forced Row-Level Security                                                                |
| Data          | Drizzle schema and migrations, two PostgreSQL roles (`app_migrator`, `app_runtime`), soft delete                                                                                     |
| Email         | Mailpit in Compose for development (http://localhost:8025)                                                                                                                           |
| Observability | Security events as structured logs (`event`, `outcome`, `userId`, `organizationId`, `ip`, `correlationId`)                                                                           |
| Documentation | 47 architecture decision records; threat model v1.2 with the F1 rows mitigated                                                                                                       |

F3 adds:

| Area          | What F3 delivers                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine        | One durable Temporal workflow, `executeDag`, runs the active version: parallel branches, conditions, merge `all`/`any`, skipped branches and fail-fast cancellation |
| Nodes         | `trigger.manual`, `logic.condition`, `logic.merge` and `mock.service` (latency and failures on demand); versions with later-phase nodes cannot run                  |
| Records       | `workflow_runs` and `workflow_run_steps` in PostgreSQL with forced RLS; input and output content stays in Temporal and expires with its retention                   |
| Live view     | Server-Sent Events fed by Valkey pub/sub, with polling as a fallback in the web app                                                                                 |
| Control       | Cancel, rerun with the same input, and a per-organization limit of concurrent runs (5 by default)                                                                   |
| Documentation | 54 architecture decision records; threat model v1.3 with the F3 rows                                                                                                |

F4 adds:

| Area          | What F4 delivers                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failures      | Four error classes (transient, rate limited, timeout, permanent) classified by each node and shown on the failed step                                   |
| Policies      | Retry and timeout defaults per node type, with bounded per-node overrides in the DAG definition (1–10 attempts, 1–120 s, 0.1–30 s initial wait)         |
| Rate limit    | Token bucket in Valkey per organization and node type; waiting nodes are rescheduled and do not hold the worker                                         |
| Effects       | Idempotency key `runId:nodeId` on every effect, recorded in `node_effects` with forced RLS; a committed effect is never repeated                        |
| Recovery      | Rerun from a node on the original version, reusing the outputs of earlier successful nodes; the organization's runs page filters by status and workflow |
| Verification  | Chaos battery (`pnpm test:chaos`) and replay of recorded histories in CI; recovery demo (`pnpm demo:recovery`)                                          |
| Documentation | 60 architecture decision records; threat model v1.4 with the F4 rows                                                                                    |

F5 adds:

| Area          | What F5 delivers                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nodes         | `llm.classify`, `llm.extract` and `llm.generate`; the output is data validated by schema, never an action                                            |
| Provider      | `packages/llm` with a swappable provider: a deterministic fake (default, used by CI) and Gemini through the official SDK                             |
| Safety        | Data delimited with a per-call nonce, canary, closed output schema, bounded repair, optional PII redaction per node, no content in logs              |
| Consumption   | Token budget per run and per organization and day, reserved atomically in PostgreSQL; global rate limit per model; own task queue for LLM activities |
| Visibility    | Model, tokens, estimated cost and repairs per step; total per run; "Consumo LLM de hoy" for the organization                                         |
| Verification  | Injection set run in CI against the fake provider; `pnpm eval:llm` against Gemini (manual, workflow `llm-evals.yml`)                                 |
| Documentation | 66 architecture decision records; threat model v1.5 with the F5 rows; constitution 1.0.1 (TDD in `packages/llm`)                                     |

F6 adds:

| Area          | What F6 delivers                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler      | `packages/compiler`: closed node catalog, prompt, intermediate format, translation to `DagDefinition` and a layered layout; the output is only a draft   |
| Execution     | `compileIntent` workflow with the activity on the LLM queue; the content lives only in the Temporal history, PostgreSQL keeps metadata                   |
| Safety        | Filtered catalog, sensitive fields stripped, nonce and canary, bounded repair, intent limit, per-person and per-organization limits, shared token budget |
| Web           | "Describir workflow" (create) and "Regenerar borrador" (replace the draft with a revision check), read-only preview, metrics and free tier notice        |
| Verification  | `pnpm eval:compiler`: 30 intents and 10 injection cases; recorded answers in CI, Gemini by hand (workflow `compiler-evals.yml`)                          |
| Documentation | 71 architecture decision records; threat model v1.6 with the F6 rows; constitution 1.0.2 (TDD in `packages/compiler`)                                    |

F7 adds:

| Area          | What F7 delivers                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Triggers      | `trigger.webhook` (`POST /api/v1/hooks/{triggerId}/{token}`, token shown once, `202` with `runId`, duplicates answered with the original run) and `trigger.schedule` (one Temporal Schedule per workflow, overlaps skipped, 1-hour catch-up)               |
| Human control | `human.approval` pauses the run without holding a worker; an inbox with a counter; owners and editors decide, except the person who started the run; `approved`, `rejected` or `timeout` branches; email without the message                               |
| HTTP          | `http.request` over https only, with anti-SSRF (validated DNS, connection to the validated IP, revalidated redirects), 1 MiB limit, `Idempotency-Key`, circuit breaker per organization and host, and its own task queue                                   |
| Credentials   | Connector credentials (bearer, API key header, basic) encrypted with AES-256-GCM envelope encryption; never returned after creation; optional per-organization allowlist of destinations                                                                   |
| Documentation | 83 architecture decision records ([ADR-0072](docs/adr/0072-webhook-con-token-en-la-url-sin-hmac.md) to [ADR-0083](docs/adr/0083-compilador-con-los-nodos-de-f7.md)); threat model v1.7 with the F7 rows; constitution 1.0.3 (TDD in `packages/connectors`) |

**Next: F8 — hardening.** Until F9 the system runs locally only and is not deployed
publicly. Phases are listed in
[docs/PLAN.md](docs/PLAN.md) §10.

## Architecture

```text
                 ┌──────────────┐
  Browser ─────► │  apps/web    │  React + Vite
                 └──────┬───────┘
                        │ HTTP (REST)
                 ┌──────▼───────┐ start / describe ┌──────────────┐
                 │  apps/api    │ ───────────────► │  Temporal    │
                 │  NestJS      │                  │  (dev server)│
                 └───┬───────┬──┘                  └──────▲───────┘
                     │       │                            │ task queue
              ┌──────▼──┐ ┌──▼─────┐               ┌──────┴───────┐
              │ Postgres│ │ Valkey │               │ apps/worker  │
              └─────────┘ └────────┘               │ workflows +  │
                                                   │ activities   │
                                                   └──────────────┘
```

| Path                 | Role                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `apps/web`           | React + Vite single-page app                                                         |
| `apps/api`           | NestJS HTTP API (RFC 9457 errors, correlation IDs, health checks)                    |
| `apps/worker`        | Temporal worker (workflows and activities)                                           |
| `packages/db`        | Drizzle schema, migrations, tenant context (`withContext`) and soft-delete selectors |
| `packages/contracts` | Zod schemas shared by every app (single source of truth for contracts)               |
| `packages/logger`    | Structured pino logging with redaction of sensitive fields                           |
| `packages/config`    | Shared TypeScript and Prettier configuration                                         |

The API stores identity data in PostgreSQL (Row-Level Security, migrations in `packages/db`) and
keeps sessions and rate-limit counters in Valkey.

## Documentation

| Document                                                               | Content                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                                           | Technical plan: decisions, architecture, resilience, security, phases (es) |
| [Constitution](.specify/memory/constitution.md)                        | Non-negotiable principles every spec, plan and PR must meet (es)           |
| [docs/adr/](docs/adr/)                                                 | Architecture decision records, one per decision (es)                       |
| [docs/threat-model.md](docs/threat-model.md)                           | Data-flow diagram, trust boundaries and STRIDE analysis (es)               |
| [specs/001-foundations-skeleton/](specs/001-foundations-skeleton/)     | F0 spec, plan, research, tasks and quickstart (es)                         |
| [specs/002-identity-tenancy/](specs/002-identity-tenancy/)             | F1 spec, plan, research, data model, contracts, tasks and quickstart (es)  |
| [specs/005-resilience/](specs/005-resilience/)                         | F4 spec, plan, research, data model, tasks and quickstart (es)             |
| [specs/006-cognitive-nodes/](specs/006-cognitive-nodes/)               | F5 spec, plan, research, data model, contracts, tasks and quickstart (es)  |
| [specs/007-nl-compiler/](specs/007-nl-compiler/)                       | F6 spec, plan, research, data model, contracts, tasks and quickstart (es)  |
| [specs/008-triggers-human-control/](specs/008-triggers-human-control/) | F7 spec, plan, research, data model, contracts, tasks and quickstart (es)  |

The project follows Spec-Driven Development with [GitHub Spec Kit](https://github.com/github/spec-kit).

## Prerequisites

| Tool           | Version                                       |
| -------------- | --------------------------------------------- |
| Node.js        | 24.22.1 (see `.nvmrc`)                        |
| pnpm           | 12.16.1 via Corepack (`corepack enable pnpm`) |
| Docker Desktop | 29 or later, with Docker Compose              |
| git            | any recent version                            |

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait
pnpm db:migrate   # applies the schema as app_migrator
pnpm dev
```

| Service           | URL                                |
| ----------------- | ---------------------------------- |
| Web               | http://localhost:5173              |
| API               | http://localhost:3000              |
| API readiness     | http://localhost:3000/health/ready |
| Worker readiness  | http://localhost:3001/health/ready |
| Temporal UI       | http://localhost:8233              |
| Mailpit (email)   | http://localhost:8025              |
| PostgreSQL (host) | `127.0.0.1:5433`                   |
| Valkey (host)     | `127.0.0.1:6379`                   |

Infrastructure ports listen on `127.0.0.1` only. If a port is already taken, change
`POSTGRES_HOST_PORT` or `VALKEY_HOST_PORT` in `.env` (and the matching URL). PostgreSQL uses 5433 on
the host so it does not clash with a local installation
([ADR-0021](docs/adr/0021-postgresql-en-puerto-5433.md)).

Sign in, open an organization and press **Ejecutar ping** on its home page: the status moves from `pending`/`running` to
`completed` and shows the result and the correlation ID. To follow that ID, search
`CorrelationId="<id>"` in the Temporal UI and in the API and worker logs.

The web app starts at `/login`. Register,
open the verification link in Mailpit and sign in; from the header you can switch organization,
change your password (**Contraseña**) and manage the organization's **Miembros**: owners invite by
email (the invitation link arrives in Mailpit), change roles and remove people. **Olvidé mi
contraseña** on the login screen mails a reset link. Registration lets you name your personal
organization and every password field has a show/hide button; owners rename an organization from
**Ajustes de la organización** on its home page.

### Workflows API (F2)

Under `/api/v1/organizations/{organizationId}/workflows` the API stores workflows with a draft,
immutable numbered versions and one active version
([contract](specs/003-dag-model-editor/contracts/api.openapi.yaml)). Owners and editors write,
viewers read and only owners archive. Saving a draft needs the `If-Match` revision (`428` without
it, `409 DRAFT_CONFLICT` if it is stale) and stores drafts with validation errors; publishing
validates with `@cognitive-dag/dag-schema` and answers `422 DAG_INVALID` with `dagErrors`. Each
version stores `definition_hash`, the SHA-256 of the definition in canonical JSON (RFC 8785 style:
sorted keys, no whitespace, ECMAScript numbers), see `apps/api/src/workflows/canonical-json.ts`.

`GET /organizations/{id}/limits` shows the limits in force (50 nodes, 100 connections and 256 KB by
default). No endpoint writes them: the platform operator sets them per organization, connected as
`app_migrator`, and every change is logged with operator, organization and old/new values:

```bash
pnpm ops:set-limits <organizationId> --max-nodes 80 --max-edges 160 --max-definition-bytes 524288 --operator ana
```

The ceilings are 500 nodes, 1000 connections and 1 MB; `DAG_MAX_NODES_CEILING`,
`DAG_MAX_EDGES_CEILING` and `DAG_MAX_DEFINITION_BYTES_CEILING` can lower them for the whole server.

### Visual editor (F2)

Open an organization and choose **Workflows**. Owners and
editors create a workflow, drag nodes from the palette, connect them and configure each one in the
side panel; viewers get a read-only canvas.

- **References and templates:** text fields that accept templates have an **Insertar referencia**
  list with the fields of earlier nodes; markers show as chips and are validated live.
- **Conditions:** `logic.condition` has a visual builder (comparisons, Y / O / NO, up to 5 levels and
  20 operations) that stores a typed tree, never code.
- **Node ids:** changing the **Identificador** of a node rewrites every reference to it.
- **Save and publish:** **Guardar** keeps the draft (errors allowed); **Publicar** creates an
  immutable version and activates it. The **Versiones** tab activates, copies or exports a version.
- **Tools:** **Ordenar** lays the graph out in layers; **Exportar JSON** downloads the definition.
- **Conflicts:** if someone saved the draft first, a dialog offers to reload it.
- **Limits:** the home page of an organization shows the limits in force, read-only.

### Runs (F3)

The editor header shows **Ejecutar** and
**Ejecuciones**. **Ejecutar** runs the active version and asks for the fields the manual trigger
declares (a generated form, validated before it is sent); it is disabled, with the reason next to
it, when the workflow has no active version or the version has nodes that are not executable yet
(none today: the API sends the phases F3, F5 and F7). Only owners and editors can run, cancel and rerun; for a viewer the buttons are disabled with the reason
([ADR-0082](docs/adr/0082-solo-owner-y-editor-ejecutan.md), which replaces ADR-0053).

- **List:** the runs of a workflow, newest first, with state, version, who started it, start and duration.
- **Detail:** the graph of the version that ran, read-only, with the state of every node updating live
  over `GET .../runs/{runId}/events` (falls back to polling if the stream drops). The side panel shows
  attempts, duration, error and, while Temporal keeps it, the input and output of the node.
- **Cancel / rerun:** **Cancelar** appears while a run is in progress; **Reejecutar** starts a new run
  with the same input on the current active version, linked to the original.
- **Limit:** each organization may have 5 runs in progress; the home page shows the limit, read-only.
  The operator changes it with:

```bash
pnpm ops:set-limits <organizationId> --max-concurrent-runs 10 --operator ana
```

The contract is in [specs/004-execution-engine](specs/004-execution-engine/contracts/api.openapi.yaml).

### Resilience (F4)

The editor shows a **Reintentos** section for
nodes with effects, the run detail offers **Reejecutar desde aquí**, and the organization has an
**Ejecuciones** page that filters by status and workflow and shows the error class of failed runs.
Rate limits are set by the platform in the worker environment, one variable per node type, for example:

```bash
RATE_LIMIT_MOCK_SERVICE=capacity:10,refillPerSecond:5
```

The decisions are in [ADR-0055](docs/adr/0055-taxonomia-de-errores-y-clasificacion-por-nodo.md) to
[ADR-0060](docs/adr/0060-decisiones-diferidas-de-resiliencia.md).

## Cognitive nodes (F5)

The editor offers the three LLM nodes, runs can
execute them, and the run detail shows tokens and estimated cost. The worker uses the deterministic
`LLM_PROVIDER=fake` by default. To use Gemini put `LLM_PROVIDER=gemini` and your key in your local
`.env` (never commit it). The free tier may use what is sent: **use test data only** until F9.

Budgets, models, prices and the queue of the LLM activities are set by the platform in the worker
environment (see `.env.example`). Setting `LLM_ENABLED=false` makes every LLM node fail without calling
the provider.

`pnpm eval:llm` runs the prompt injection set and valid inputs against the real model and exits 1 if
anything escapes. It needs `GEMINI_API_KEY` and spends free tier quota, so it is manual (also available
as the `LLM evals` workflow, started by hand).

```bash
pnpm eval:llm
```

The decisions are in [ADR-0061](docs/adr/0061-paquete-llm-con-proveedor-intercambiable.md) to
[ADR-0066](docs/adr/0066-modelos-por-tipo-de-nodo-y-capa-gratuita-de-gemini.md).

## Natural language compiler (F6)

The workflows page offers "Describir workflow":
describe an automation in up to 2000 characters and the compiler returns a **draft** DAG shown in a
read-only preview. You can create a workflow with it or, from the editor, replace the current draft
("Regenerar borrador"). Nothing runs until a person publishes the workflow. Owners and editors can
compile; limits are 10 compilations per person per hour and 50 per organization per day, and the
model (`LLM_MODEL_COMPILER`) and token cap per compilation are set in the environment (see
`.env.example`). The free tier of Gemini may use what is sent: **test data only** until F9.

`pnpm eval:compiler` compiles the intent dataset and the injection set. By default it replays recorded
answers (deterministic, the same as in CI); with `--provider gemini` it calls the real model, needs
`GEMINI_API_KEY` and spends free tier quota (also available as the `Compiler evals` workflow, started
by hand). It exits 1 under 80 % success or on any escape.

```bash
pnpm eval:compiler
pnpm eval:compiler -- --provider gemini
```

The decisions are in [ADR-0067](docs/adr/0067-compilador-asincrono-en-temporal-con-contenido-solo-en-el-historial.md) to
[ADR-0071](docs/adr/0071-dataset-de-evals-del-compilador-umbral-y-modelo-elegido.md).

## Triggers, human control and HTTP (F7)

The editor offers `trigger.webhook`,
`trigger.schedule`, `human.approval` and `http.request`, the webhook panel shows the URL, the
workflow page shows the schedule status, the header shows the approvals inbox with its counter, and
the **Connections** page manages credentials and allowed hosts. A worker that does not support a phase
refuses the versions that contain its nodes with `UNSUPPORTED_NODES`.

- **Webhook:** owners and editors generate the token from the webhook panel; the URL with the token
  is shown once. Callers send `POST /api/v1/hooks/{triggerId}/{token}` with `X-Event-Id`,
  `X-Event-Timestamp` (ISO 8601 UTC, within 5 minutes of the server clock) and a JSON body of at most
  64 KiB. The API answers `202` with the `runId`; a repeated `X-Event-Id` answers `200` with
  `duplicate: true`. Regenerating the token invalidates the previous one at once. The token travels in
  the path and there is no HMAC signature: this is an accepted risk
  ([ADR-0072](docs/adr/0072-webhook-con-token-en-la-url-sin-hmac.md)). TLS and log redaction at the proxy are required before deployment (F9).
- **Schedule:** `trigger.schedule` takes a cron expression and an IANA time zone. Activating the
  version creates the Temporal Schedule `sched-<workflowId>`; overlapping firings are skipped and
  firings missed for less than an hour run once.
- **Approvals:** `human.approval` pauses the run without holding a worker and emails the owners and
  editors who can decide, without the message. Anyone with the owner or editor role decides, except
  the person who started the run. The first decision wins; the run continues on `approved`,
  `rejected` or `timeout`. The message and comment live only in the Temporal history.
- **HTTP:** `http.request` accepts only https, resolves DNS once, connects to the validated address,
  blocks private, loopback, link-local, carrier-grade NAT and metadata ranges (IPv4 and IPv6), and
  revalidates every redirect (at most 3). It reads at most 1 MiB of JSON or text. Owners can restrict
  destinations with an allowlist of hosts or `*.domain` entries. A circuit breaker per organization
  and host, and a task queue of its own (`cognitive-dag-http`), keep failing services from affecting
  the rest of the platform.
- **Credentials:** owners create, rotate and archive connector credentials (bearer, API key header or
  basic). Values are encrypted with AES-256-GCM envelope encryption under `CREDENTIALS_MASTER_KEY`,
  are never returned, and are referenced by id from `http.request`. Generate the key with
  `pnpm credentials:gen-key` and keep it in your local `.env`.

The worker has two kill switches: `TRIGGERS_ENABLED` (schedule firings) and `HTTP_ENABLED` (HTTP
activities). `HTTP_TEST_ALLOW_LOOPBACK` exists for tests only; the worker refuses to start with it in
production.

```bash
pnpm credentials:gen-key
```

The decisions are in [ADR-0072](docs/adr/0072-webhook-con-token-en-la-url-sin-hmac.md) to [ADR-0081](docs/adr/0081-dataset-y-baterias-de-seguridad-de-f7.md). F8 adds [ADR-0082](docs/adr/0082-solo-owner-y-editor-ejecutan.md), [ADR-0083](docs/adr/0083-compilador-con-los-nodos-de-f7.md) and [ADR-0085](docs/adr/0085-tope-del-reconciliador-y-eventos-de-seguridad-nuevos.md).

## Recovery demo

`pnpm demo:recovery` starts a demonstration workflow, kills the worker in the middle of the run,
restarts it and shows that the run finishes without repeating effects. It needs the Compose services
running (`docker compose up -d --wait`).

```bash
pnpm demo:recovery
```

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # requires `docker compose up -d --wait`
pnpm test:chaos         # chaos battery: stops the worker, Temporal, Valkey and PostgreSQL; slow, run apart from `pnpm test`
pnpm build
```

Integration tests share the Compose services and isolate themselves with unique task queues and
key prefixes ([ADR-0015](docs/adr/0015-pruebas-con-compose-compartido.md)).

Commits follow [Conventional Commits](https://www.conventionalcommits.org); a `commit-msg` hook
enforces it. `main` only accepts pull requests with all six CI checks green.

## Security

Security is part of every spec's definition of done. The F0 controls (validated configuration,
Helmet and strict CORS, no stack traces in errors, log redaction, locked-down supply chain, secret
scanning), the F1 controls (sessions, CSRF, rate limiting, tenant isolation with Row-Level Security,
security events), the accepted deviation from NIST 800-63B-4 in the password length, the F7 controls
(webhook token and replay checks, anti-SSRF, encrypted credentials, approval rules) and the risks
deferred to later phases are catalogued in the
[threat model](docs/threat-model.md).
