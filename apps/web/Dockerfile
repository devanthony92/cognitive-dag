# syntax=docker/dockerfile:1
# Edge image (F9, D7A): the SPA build plus Caddy. Build context: repository root. The web talks to
# the API on the same origin with relative URLs (D6A), so no VITE_API_URL is set here and the image
# does not depend on the domain. Debian (glibc) base, never Alpine.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG CADDY_IMAGE=caddy:2.11.9@sha256:0c2243efcf437ab7f7a978f1027fcf0d4f9be8a75df27b1b3fbc5dbe0ffa8cf0

# The official Caddy image is Alpine-based, but Caddy is a static Go binary: only that file is taken,
# so nothing of Alpine reaches the final image (it runs on Debian).
FROM ${CADDY_IMAGE} AS caddy

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm exec turbo run build --filter=@cognitive-dag/web...

FROM ${DEBIAN_IMAGE} AS runtime
# Caddy needs the system roots to reach Let's Encrypt (ACME); bookworm-slim ships none.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN groupadd --system --gid 10001 caddy \
 && useradd --system --uid 10001 --gid caddy --no-create-home --shell /usr/sbin/nologin caddy \
 && mkdir -p /data /config /srv \
 && chown caddy:caddy /data /config
COPY --from=build /repo/apps/web/dist /srv
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
# A broken Caddyfile fails the build, not the deploy.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
USER caddy
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
