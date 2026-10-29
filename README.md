# CognitiveDAG

AI workflow orchestrator: automations described in natural language are compiled into typed DAGs
and executed as durable, fault-tolerant workflows on [Temporal](https://temporal.io).

> Status: **F0 — foundations and walking skeleton** (in progress). See the
> [technical plan](docs/PLAN.md) (Spanish) and the
> [project constitution](.specify/memory/constitution.md).

## Architecture

| Path                 | Role                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `apps/web`           | React + Vite single-page app                                           |
| `apps/api`           | NestJS HTTP API (RFC 9457 errors, correlation IDs, health checks)      |
| `apps/worker`        | Temporal worker (workflows and activities)                             |
| `packages/contracts` | Zod schemas shared by every app (single source of truth for contracts) |
| `packages/logger`    | Structured pino logging with redaction of sensitive fields             |
| `packages/config`    | Shared TypeScript and Prettier configuration                           |

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
`POSTGRES_HOST_PORT` or `VALKEY_HOST_PORT` in `.env` (and the matching URL).

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # requires `docker compose up -d --wait`
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org); a `commit-msg` hook
enforces it.
