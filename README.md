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

**F0 — foundations and walking skeleton: complete. F1 — identity and multi-tenancy: complete** (behind
the `identity-enabled` flag, on by default in `.env.example`).

| Area                 | What F0 delivers                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Monorepo and tooling | pnpm workspaces, Turborepo, ESLint, Prettier, lefthook, commitlint                                               |
| Contracts            | Shared Zod schemas; RFC 9457 errors; `X-Correlation-Id` end to end (API, Temporal search attribute, worker logs) |
| API                  | NestJS 11: health checks, config validation, structured logs with redaction, feature flags (OpenFeature)         |
| Workflow             | Ping workflow with idempotency (`Idempotency-Key`), call deadlines, replay tests and hard-crash chaos tests      |
| Web                  | React 19 + Vite panel that runs a ping and shows its status, behind the `ping-enabled` flag                      |
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
| Documentation | 38 architecture decision records; threat model v1.1 with the F1 rows mitigated                                                                                                       |

**Next: F2 — workflows and DAG model.** Until F9 the system runs locally only and is not deployed
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

| Document                                                           | Content                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                                       | Technical plan: decisions, architecture, resilience, security, phases (es) |
| [Constitution](.specify/memory/constitution.md)                    | Non-negotiable principles every spec, plan and PR must meet (es)           |
| [docs/adr/](docs/adr/)                                             | Architecture decision records, one per decision (es)                       |
| [docs/threat-model.md](docs/threat-model.md)                       | Data-flow diagram, trust boundaries and STRIDE analysis (es)               |
| [specs/001-foundations-skeleton/](specs/001-foundations-skeleton/) | F0 spec, plan, research, tasks and quickstart (es)                         |
| [specs/002-identity-tenancy/](specs/002-identity-tenancy/)         | F1 spec, plan, research, data model, contracts, tasks and quickstart (es)  |

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

Open the web app and press **Ejecutar ping**: the status moves from `pending`/`running` to
`completed` and shows the result and the correlation ID. To follow that ID, search
`CorrelationId="<id>"` in the Temporal UI and in the API and worker logs.

With `identity-enabled` on (the default in `.env.example`) the web app starts at `/login`. Register,
open the verification link in Mailpit and sign in; from the header you can switch organization,
change your password (**Contraseña**) and manage the organization's **Miembros**: owners invite by
email (the invitation link arrives in Mailpit), change roles and remove people. **Olvidé mi
contraseña** on the login screen mails a reset link. Registration lets you name your personal
organization and every password field has a show/hide button; owners rename an organization from
**Ajustes de la organización** on its home page. With the flag off the F0 ping panel is shown
instead and none of these screens exist.

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # requires `docker compose up -d --wait`
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
security events), the accepted deviation from NIST 800-63B-4 in the password length and the risks
deferred to later phases are catalogued in the
[threat model](docs/threat-model.md).
