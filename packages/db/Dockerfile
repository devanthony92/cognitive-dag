# syntax=docker/dockerfile:1
# Migrator image (F9, FR-026): applies the Drizzle migrations as app_migrator and exits. It runs no
# server and listens on no port. Build context: repository root. Debian (glibc) base, never Alpine.
# Connection: DATABASE_MIGRATOR_URL (a password may come from a *_FILE secret mounted by Compose).
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
# drizzle-kit is a development dependency of the package, so the deploy keeps dev dependencies.
RUN pnpm deploy --legacy --filter=@cognitive-dag/db /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/packages/db/drizzle.config.ts ./drizzle.config.ts
USER node
# `migrations` and `src/schema` come from the package files; the exit code is drizzle-kit's.
CMD ["node_modules/.bin/drizzle-kit", "migrate", "--config", "drizzle.config.ts"]
