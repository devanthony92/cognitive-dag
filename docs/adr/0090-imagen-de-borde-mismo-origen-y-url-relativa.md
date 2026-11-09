---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# Imagen de borde con la web y Caddy, mismo origen y URL de API relativa

## Contexto y problema

La web es una SPA estática y la API vive en otro proceso. Hace falta decidir quién entrega los archivos y cómo se llega a la API sin CORS, con la cookie `__Host-session` intacta y sin que la imagen dependa del dominio.

## Opciones consideradas

- Imagen de borde única: Caddy más la SPA compilada (elegida, D7A).
- Imagen `web` separada detrás de un Caddy de borde: dos configuraciones de cabeceras que no deben divergir.
- Alojamiento estático externo: rompe el mismo origen.

## Decisión

- **Mismo origen (D6A):** `https://dominio/` entrega la web y `/api/*` va a la API. La compilación de producción deja `VITE_API_URL` vacío, de modo que toda ruta es relativa y la misma imagen sirve para cualquier dominio; el `Dockerfile` no define esa variable.
- **Imagen `edge`** (`apps/web/Dockerfile`): una etapa de `pnpm install --frozen-lockfile` y `turbo run build` dentro de la imagen (nunca el `node_modules` del anfitrión) y una etapa final sobre `debian:bookworm-slim` fijada por digest. El binario de Caddy se copia desde la imagen oficial, también fijada por digest: esa imagen es Alpine, pero Caddy es un binario estático de Go y de ella solo se toma ese archivo, así que en la imagen final no hay nada de Alpine.
- **Sin root:** el proceso corre como `caddy` (uid 10001). Escuchar en 80 y 443 sin root exige el sysctl `net.ipv4.ip_unprivileged_port_start=0` en el servicio de Compose (PR 3). Mientras tanto la imagen escucha en 8080 con un `Caddyfile` mínimo (`deploy/caddy/Caddyfile`: archivos de la SPA con respaldo a `index.html` y `/api/*` hacia `api:3000`); la configuración de producción (TLS, HSTS, CSP, redacción del token, SSE) la reemplaza la tarea T031. `caddy validate` corre en la compilación, así que un `Caddyfile` roto falla al construir y no al desplegar.
- **Imagen `migrator`** (`packages/db/Dockerfile`): aplica las migraciones como `app_migrator` con el migrador de drizzle-orm (`packages/db/src/migrate-cli.ts`, la misma tabla de journal que drizzle-kit), lee `DATABASE_MIGRATOR_URL` y la contraseña de `DATABASE_PASSWORD_FILE`, no abre puertos y termina. Se instala solo con dependencias de producción: sin drizzle-kit ni esbuild (el escaneo de la primera publicación halló 55 hallazgos en esa imagen, casi todos de la biblioteca estándar de Go dentro de los binarios de esbuild). Las imágenes de Node borran npm, npx y corepack en la etapa de ejecución: el npm que trae Node lleva dependencias propias (`undici`, `brace-expansion`) que el lockfile no controla.

## Consecuencias

- Bueno: una pieza menos, cabeceras y archivos versionados juntos, imagen independiente del dominio.
- Malo: cada cambio de la web reconstruye la imagen de borde; una XSS en la web llega a la API con la sesión (la defensa es la CSP de la tarea T031).

## Confirmación

`scripts/test/unit/images-config.test.ts`: todos los `FROM` por digest, ninguna base Alpine, usuario final sin root, nada de `.env` ni `node_modules` copiados, y `VITE_API_URL` ausente del Dockerfile de borde.

## Enlaces

- Decisiones D6A y D7A en `specs/010-deployment/research.md`; ADR-0089.
