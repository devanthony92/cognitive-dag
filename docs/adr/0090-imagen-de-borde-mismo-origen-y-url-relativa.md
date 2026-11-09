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
- **Imagen `edge`** (`apps/web/Dockerfile`): una etapa de `pnpm install --frozen-lockfile` y `turbo run build` dentro de la imagen (nunca el `node_modules` del anfitrión) y una etapa final sobre `debian:bookworm-slim` fijada por digest. **Caddy se compila, no se copia** (decisión del autor, PR 3): la imagen oficial `caddy:2.11.9` trae `golang.org/x/net` 0.60.0 (GO-2026-6860, corregida en 0.62.0) y `github.com/klauspost/compress` 1.20.1 (GO-2026-6865, corregida en 1.20.2), y 2.11.9 es la última versión. Una etapa con la imagen oficial de Go (Debian, fijada por digest) compila Caddy v2.11.9 desde `deploy/caddy/build/` (un `main.go` mínimo con los módulos estándar, más `go.mod` y `go.sum` versionados, con esas dos dependencias subidas). Se compila con `CGO_ENABLED=0`, `-trimpath`, `-ldflags "-s -w"` y `GOARCH=${TARGETARCH}` en el ejecutor de cada arquitectura, sin QEMU. El binario resultante lista los mismos 136 módulos que el oficial y la imagen final sigue sobre Debian. Con esto desaparecen las dos excepciones de escaneo (`.github/image-scan-exceptions.json` queda en `[]`).
- **Sin root:** el proceso corre como `caddy` (uid 10001). Escuchar en 80 y 443 sin root exige el sysctl `net.ipv4.ip_unprivileged_port_start=0`, que fija `deploy/compose.prod.yaml`. La imagen lleva el `Caddyfile` de producción (T031): `deploy/caddy/Caddyfile` (dominio de `SITE_DOMAIN`, TLS automático y redirección 301) e `import` de `deploy/caddy/site.caddy`, que reúne cabeceras, proxy, registro y 404 de rutas cerradas y es la misma que usa `deploy/caddy/local.Caddyfile` para las comprobaciones locales (ZAP). `caddy validate` corre en la compilación, así que un `Caddyfile` roto falla al construir y no al desplegar.
- **Imagen `migrator`** (`packages/db/Dockerfile`): aplica las migraciones como `app_migrator` con el migrador de drizzle-orm (`packages/db/src/migrate-cli.ts`, la misma tabla de journal que drizzle-kit), lee `DATABASE_MIGRATOR_URL` y la contraseña de `DATABASE_PASSWORD_FILE`, no abre puertos y termina. Se instala solo con dependencias de producción: sin drizzle-kit ni esbuild (el escaneo de la primera publicación halló 55 hallazgos en esa imagen, casi todos de la biblioteca estándar de Go dentro de los binarios de esbuild). Las imágenes de Node borran npm, npx y corepack en la etapa de ejecución: el npm que trae Node lleva dependencias propias (`undici`, `brace-expansion`) que el lockfile no controla.

## Contrato del borde en producción

- **Cabeceras** de la web estática según `contracts/edge-headers.md`, sin cambios de valor: CSP sin `unsafe-inline` ni `unsafe-eval`, `frame-ancestors 'none'`, XFO, `nosniff`, Permissions-Policy, COEP `require-corp`, COOP y CORP `same-origin`, Referrer-Policy y HSTS sin `preload`. Una prueba de navegador contra la imagen real (SPA, inicio de sesión y editor de React Flow, con `crossOriginIsolated` verdadero) no registró ninguna violación de CSP: no hizo falta `style-src-attr` ni bajar COEP a `credentialless`, así que **no hay excepciones**.
- **`/api/*`** pasa a la API sin añadir más que HSTS (Helmet conserva las suyas); Caddy fija `X-Forwarded-For` y `-Proto` porque no confía en ningún proxy anterior; `flush_interval -1` y sin compresión para SSE; `read_timeout` de 60 s (mayor que `SSE_HEARTBEAT_MS`); cuerpo máximo de 128 KB (por encima de `BODY_LIMIT` y del tope de 64 KB del webhook; si se sube `WEBHOOK_MAX_BODY_BYTES`, este tope sube con él).
- **Registro** JSON a la salida estándar, con el token de `/api/v1/hooks/{trigger}/{token}` reemplazado por `REDACTED` y sin `Cookie`, `Authorization`, `X-Csrf-Token` ni `Set-Cookie`. El registro de errores de Caddy repite la petición, y filtrar solo el de acceso dejaba pasar el token (hallado probando); por eso el registro por defecto usa el mismo filtro.
- **Registro cerrado (D23A):** `POST /api/v1/auth/register` (y su variante con barra final, en cualquier combinación de mayúsculas y en forma codificada) y `/api/v1/metrics` responden 404 desde el borde. Aceptar una invitación no pasa por `register`: es `POST /api/v1/invitations/accept` y exige una sesión, así que sigue funcionando; lo que no puede hacer una persona sin cuenta es registrarse para aceptarla, y su cuenta la crea el script de la PR 4 (T051). La interfaz aún muestra «Crear cuenta»; ocultarla es una mejora de la web fuera de esta PR.
- **Dominio:** solo la variable `SITE_DOMAIN`; la PR 4 pone el real.

## Consecuencias

- Bueno: una pieza menos, cabeceras y archivos versionados juntos, imagen independiente del dominio.
- Malo: compilar Caddy nos hace responsables de sus dependencias: Renovate sube `go.mod` (`deploy/caddy/build/`), y cuando una versión oficial de Caddy incluya `x/net` ≥ 0.62.0 y `klauspost/compress` ≥ 1.20.2 se **vuelve a copiar el binario de la imagen oficial** (se borra la etapa `golang` y la prueba que fija las versiones mínimas). Cada cambio de la web reconstruye la imagen de borde; una XSS en la web llega a la API con la sesión (la defensa es la CSP de la tarea T031).

## Confirmación

`scripts/test/unit/images-config.test.ts`: todos los `FROM` por digest, ninguna base Alpine, usuario final sin root, nada de `.env` ni `node_modules` copiados, `VITE_API_URL` ausente del Dockerfile de borde, Caddy sin copiarse de una imagen `caddy:*` y versiones mínimas de las dependencias en `go.mod`. `scripts/test/unit/deploy-config.test.ts` fija el contrato del Caddyfile. El escaneo local de la imagen con Grype (`--only-fixed`, mismo umbral que `check-image-scan.ts`) no halló ningún hallazgo con corrección, y sin excepciones.

## Enlaces

- Decisiones D6A y D7A en `specs/010-deployment/research.md`; ADR-0089.
