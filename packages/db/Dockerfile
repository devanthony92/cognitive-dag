# syntax=docker/dockerfile:1
# Migrator image (F9, FR-026): applies the migrations as app_migrator and exits. It runs
# packages/db/src/migrate-cli.ts, which uses the drizzle-orm migrator (same journal as drizzle-kit),
# so drizzle-kit and esbuild (and the Go standard library they bundle) are not in the image. It runs
# no server and listens on no port. Build context: repository root. Debian (glibc) base, never
# Alpine.
# Connection: DATABASE_MIGRATOR_URL, with the password from the file DATABASE_PASSWORD_FILE.
ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm exec turbo run build --filter=@cognitive-dag/db...
RUN pnpm deploy --legacy --filter=@cognitive-dag/db --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# npm, npx and corepack are not used at run time (see the api image).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/migrate-cli.js"]
