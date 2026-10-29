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

**F0 — foundations and walking skeleton: complete.** The repository contains a runnable end-to-end
skeleton and no product features yet.

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

**Next: F1 — identity and multi-tenancy** (registration, login, roles, Row-Level Security). Until
then the system runs locally only and is not deployed publicly. Phases are listed in
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

| Path                 | Role                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `apps/web`           | React + Vite single-page app                                           |
| `apps/api`           | NestJS HTTP API (RFC 9457 errors, correlation IDs, health checks)      |
| `apps/worker`        | Temporal worker (workflows and activities)                             |
| `packages/contracts` | Zod schemas shared by every app (single source of truth for contracts) |
| `packages/logger`    | Structured pino logging with redaction of sensitive fields             |
| `packages/config`    | Shared TypeScript and Prettier configuration                           |

In F0 the API only checks PostgreSQL and Valkey for readiness; the data model arrives in F1.

## Documentation

| Document                                                           | Content                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                                       | Technical plan: decisions, architecture, resilience, security, phases (es) |
| [Constitution](.specify/memory/constitution.md)                    | Non-negotiable principles every spec, plan and PR must meet (es)           |
| [docs/adr/](docs/adr/)                                             | Architecture decision records, one per decision (es)                       |
| [docs/threat-model.md](docs/threat-model.md)                       | Data-flow diagram, trust boundaries and STRIDE analysis (es)               |
| [specs/001-foundations-skeleton/](specs/001-foundations-skeleton/) | F0 spec, plan, research, tasks and quickstart (es)                         |

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
pnpm dev
```

| Service           | URL                                |
| ----------------- | ---------------------------------- |
| Web               | http://localhost:5173              |
| API               | http://localhost:3000              |
| API readiness     | http://localhost:3000/health/ready |
| Worker readiness  | http://localhost:3001/health/ready |
| Temporal UI       | http://localhost:8233              |
| PostgreSQL (host) | `127.0.0.1:5433`                   |
| Valkey (host)     | `127.0.0.1:6379`                   |

Infrastructure ports listen on `127.0.0.1` only. If a port is already taken, change
`POSTGRES_HOST_PORT` or `VALKEY_HOST_PORT` in `.env` (and the matching URL). PostgreSQL uses 5433 on
the host so it does not clash with a local installation
([ADR-0021](docs/adr/0021-postgresql-en-puerto-5433.md)).

Open the web app and press **Ejecutar ping**: the status moves from `pending`/`running` to
`completed` and shows the result and the correlation ID. To follow that ID, search
`CorrelationId="<id>"` in the Temporal UI and in the API and worker logs.

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
scanning) and the risks deferred to later phases are catalogued in the
[threat model](docs/threat-model.md).
