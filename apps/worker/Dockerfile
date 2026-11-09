# syntax=docker/dockerfile:1
# Build context: repository root. Debian (glibc) base, never Alpine: the Temporal core bridge
# ships no musl binary for arm64 (docs/PLAN.md §9.1).
ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm exec turbo run build --filter=@cognitive-dag/worker...
RUN pnpm deploy --legacy --filter=@cognitive-dag/worker --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# npm, npx and corepack are not used at run time; the npm bundled with Node carries its own
# dependencies (undici, brace-expansion) that the scanner reports and the lockfile does not pin.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
