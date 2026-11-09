# syntax=docker/dockerfile:1
# Edge image (F9, D7A): the SPA build plus Caddy. Build context: repository root. The web talks to
# the API on the same origin with relative URLs (D6A), so no VITE_API_URL is set here and the image
# does not depend on the domain. Debian (glibc) base, never Alpine.
ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG GO_IMAGE=golang:1.26.10-bookworm@sha256:5de7c99eb78ca5e515a4c340235d0955ec5964a5071c492c15503d7c267da473

# Caddy is compiled here, not copied from the official image: that binary carries golang.org/x/net
# and klauspost/compress versions with known fixes (GO-2026-6860, GO-2026-6865). deploy/caddy/build
# pins Caddy and raises those two modules in go.mod/go.sum (ADR-0090). Go cross-compiles natively
# for TARGETARCH with CGO off, so no QEMU is needed: BUILDPLATFORM runs the compiler.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS caddy
ARG TARGETARCH
WORKDIR /src
COPY deploy/caddy/build/ ./
RUN --mount=type=cache,id=go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=go-build,target=/root/.cache/go-build \
    GOFLAGS=-mod=readonly CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-s -w" -o /out/caddy .

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
COPY --from=caddy /out/caddy /usr/bin/caddy
RUN groupadd --system --gid 10001 caddy \
 && useradd --system --uid 10001 --gid caddy --no-create-home --shell /usr/sbin/nologin caddy \
 && mkdir -p /data /config /srv \
 && chown caddy:caddy /data /config
COPY --from=build /repo/apps/web/dist /srv
COPY deploy/caddy/Caddyfile deploy/caddy/site.caddy /etc/caddy/
# A broken Caddyfile fails the build, not the deploy.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
USER caddy
EXPOSE 80 443
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
