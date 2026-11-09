---

description: "Task list for F9 — Despliegue"
---

# Tasks: Despliegue (F9)

> **Cerrada con las respuestas del autor del 2026-11-09** (`1B 2C 3C 4B 5 sin backup, 6A 7A 8A 9C 10A 11C 12A
> 13C 14A 15A 16A 17A 18A 19A 20 sin métricas 21B 22A`). D23 respondida: **A** (Caddy responde 404 a
> `register`; T018 eliminada, T051 vigente).
> Nada se despliega en la tarea de especificación.

**Input**: `/specs/010-deployment/` (spec, plan, research, data-model sin cambio de esquema, contracts,
quickstart, checklists)

**Tests**: incluidas. TDD obligatorio en las reglas de arranque en producción (T005, T006), `trust proxy`
(T003) y el cliente TLS de Temporal (T004), porque son reglas de seguridad de la aplicación. Cada prueba se
escribe primero y DEBE fallar antes de implementar. En `deploy/` las «pruebas» son pruebas de contrato sobre
los archivos (T028 y T029) y de integración con certificados efímeros (T030). Ninguna prueba de CI llama a
internet más allá de lo que ya hace CI.

**Feature flag**: ninguno nuevo. Los kill switches `LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED` se
conservan y se documentan.

**Esquema**: sin migraciones (ver `data-model.md`). Si alguna tarea necesitara una, se detiene y se pide
aprobación del autor.

**Prerrequisitos del autor**: P1, P2, P5 a P10 de la spec (P3 y P4 se retiraron por D5 y D13C). Las tareas
marcadas **(autor)** no las puede hacer un agente; las demás pueden desarrollarse y probarse en local y en
CI sin ellos.

**Retirado por las respuestas**: backups y restauración (FR-019 a FR-021, SC-004), métricas (FR-029),
staging y ZAP activo o con sesión (FR-032; #65), alerta de costo por métrica, escaneo en el job `images`,
cron mínima (#68), métrica de disparos descartados (#67).

## Format: `[ID] [P?] [Story] Description`

Historias: US1 borde y cabeceras, US2 autenticación y TLS de la infraestructura, US3 secretos, US4 pérdida de
datos aceptada, US5 publicación, despliegue y reversa, US6 eventos y alertas, US7 cabeceras sin staging, US8
correo y demo cerrada, US9 cierre.

---

## Phase 1: Setup

- [ ] T001 (autor) Entregar los prerrequisitos P1, P2, P5 a P9 de la spec; anotar en esta lista cuál ya está listo
- [ ] T002 [P] Confirmar contra la fuente oficial, y anotar fecha y URL en `research.md`, cada cifra marcada **(verificar)**: capa gratuita de Oracle (OCIR, Vault, Email Delivery, política de instancias inactivas, capacidad A1) y condiciones de datos de la capa gratuita de Gemini

## Phase 2: Aplicación lista para producción (PR 1)

### Tests

- [x] T003 [P] [US1] `apps/api/test/integration/trust-proxy.test.ts`: con `TRUSTED_PROXIES` vacío, un `X-Forwarded-For` no cambia la IP vista; con el salto de confianza, la API usa la IP del cliente para el límite de tasa y para el campo `ip` de los eventos de seguridad; un cliente que envía su propio `X-Forwarded-For` no puede falsear su IP (FR-005)
- [x] T004 [P] [US2] `apps/api/test/unit/temporal-tls.test.ts` y `apps/worker/test/unit/temporal-tls.test.ts`: las opciones de conexión incluyen CA, certificado de cliente y `serverName` cuando están configurados, y se rechaza una configuración incompleta (FR-008)
- [x] T005 [P] [US2] `apps/api/test/unit/env.production.test.ts`: con `NODE_ENV=production` el arranque falla nombrando solo las variables si `DATABASE_URL` no exige TLS verificado, `VALKEY_URL` no es `rediss://`, falta TLS de Temporal, falta `CREDENTIALS_MASTER_KEY`, una contraseña coincide con un valor de desarrollo, `WEB_ORIGIN` o `API_PUBLIC_URL` no son `https://`; ningún mensaje contiene un valor (FR-012)
- [x] T006 [P] [US2] Misma prueba en `apps/worker` para su esquema de configuración
- [x] T007 [P] [US2] `apps/api/test/integration/valkey-acl.test.ts`: con un usuario de comandos mínimos, los scripts Lua, el límite de tasa, la caché de sesión y el circuit breaker siguen funcionando; `FLUSHALL`, `CONFIG` y `KEYS` fallan; con `maxmemory` lleno y `noeviction` la API falla cerrado (503); fija la lista exacta de comandos que la ACL de T035 debe permitir (FR-010)
- [x] T008 [P] [US1] `apps/web/test/api-base-url.test.ts`: con `VITE_API_URL` vacío el cliente usa rutas relativas `/api/v1/...` (incluido el flujo SSE) y con valor lo antepone, de modo que la imagen es independiente del dominio (FR-006)
- [x] T009 [P] [US8] `apps/api/test/unit/mail-transport.test.ts`: el transporte SMTP admite usuario, contraseña y TLS; en producción rechaza un servidor sin TLS (FR-030)
- [x] T010 [P] [US4] `apps/web/test/demo-notice.test.tsx`: la web muestra el aviso «demo sin copias de seguridad, solo datos de prueba» cuando la configuración de despliegue lo activa

### Implementation

- [x] T011 [US1] `apps/api`: `trust proxy` con lista cerrada `TRUSTED_PROXIES`, usada por el límite de tasa y los eventos de seguridad
- [x] T012 [US2] Opciones TLS del cliente de Temporal en `apps/api` y `apps/worker/src/main.ts` (`Connection.connect`, `NativeConnection.connect`) y variables `TEMPORAL_TLS_*`
- [x] T013 [US2] Esquemas Zod de producción de la API y del worker: reglas de arranque, lectura de secretos por `*_FILE`, lista de valores de desarrollo prohibidos (sin imprimirlos), `CREDENTIALS_MASTER_KEY` obligatoria
- [x] T014 [US2] Opciones de Valkey y PostgreSQL con CA de confianza (`rediss://`, `sslmode=verify-full`) y credenciales por archivo
- [x] T015 [US8] Transporte SMTP con autenticación y TLS (`SMTP_SECURE`, `SMTP_USER_FILE`, `SMTP_PASSWORD_FILE`); sin cambio de comportamiento en desarrollo con Mailpit
- [x] T016 [US1] `apps/web`: `VITE_API_URL` vacío por defecto en producción y rutas relativas; `.env.example` actualizado
- [x] T017 [US4] `apps/web`: aviso de demo sin copias de seguridad y con datos de prueba
- ~~T018~~ _(eliminada: D23A elegida; no hay `REGISTRATION_ENABLED`)_

## Phase 3: Imágenes y publicación (PR 2)

### Tests

- [ ] T019 [P] [US5] `scripts/test/unit/images-config.test.ts`: todos los `FROM` de los Dockerfiles y las imágenes de Compose están fijados por digest, ninguna base es Alpine, el usuario final no es root, y ningún Dockerfile copia `.env` ni `node_modules` del anfitrión (FR-018)
- [ ] T020 [P] [US5] `scripts/test/unit/workflows-permissions.test.ts`: `ci.yml` conserva `contents: read` y los 6 jobs requeridos; el permiso y el secreto de publicación solo aparecen en `release.yml`; todas las acciones fijadas por SHA (FR-022, FR-023)

### Implementation

- [ ] T021 [US5] `packages/db/Dockerfile`: imagen `migrator` (migraciones como `app_migrator`, sin servidor, Debian `bookworm-slim`, multi-etapa, `pnpm install` dentro) (FR-026)
- [ ] T022 [US1] [US5] `apps/web/Dockerfile`: imagen de borde (build de la SPA dentro + Caddy oficial fijado por digest; sin `VITE_API_URL` fijo al compilar) [D6A, D7A]
- [ ] T023 [US5] `.github/workflows/release.yml`: build multi-arch de las 4 imágenes (arm64 en `ubuntu-24.04-arm`, sin QEMU), manifiesto combinado, etiqueta con el SHA, publicación en OCIR, salida por digest, permisos mínimos por job y solo en `main` [D1B] (autor: P7, P9)
- [ ] T024 [US5] Escaneo de cada imagen en `release.yml` (falla la publicación ante altas y críticas con corrección disponible) y archivo versionado de excepciones con razón, dueño y fecha; el job `images` y los 6 checks no cambian [D11C]
- [ ] T025 [US5] SBOM CycloneDX por imagen en `release.yml`, adjunto a lo publicado y consultable [D11C]
- [ ] T026 [P] [US5] `shellcheck` en el job `quality` para `deploy/**/*.sh` y `scripts/**/*.sh` (sin job nuevo) [D16A]
- [ ] T027 [US5] ADR-0089 (OCIR y etiquetado por digest), ADR-0090 (imagen de borde, mismo origen y URL relativa) y ADR-0096 (SBOM y escaneo al publicar)

## Phase 4: Compose de producción y seguridad de datos (PR 3)

### Tests

- [ ] T028 [P] [US1] `scripts/test/unit/deploy-config.test.ts`: contrato del Caddyfile según [contracts/edge-headers.md](./contracts/edge-headers.md): CSP sin `unsafe-inline` en `script-src`, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP/COOP/CORP, HSTS, redirección HTTP→HTTPS, redacción del token de `/api/v1/hooks/*` y de `Cookie`/`Authorization` en el registro, y `/api/v1/metrics` y la UI de Temporal sin publicar
- [ ] T029 [P] [US2] Misma prueba, parte de Compose: ningún servicio publica puertos salvo Caddy (80 y 443) y la UI de Temporal solo en `127.0.0.1`; cada servicio tiene `mem_limit`, `restart`, `healthcheck` y usuario no root; las imágenes de terceros por digest; PostgreSQL y Valkey sin puerto en claro; suma de límites ≤ 6 GB (FR-017, SC-010)
- [ ] T030 [P] [US2] `scripts/test/integration/deploy-security.test.ts`: con certificados efímeros, el Compose de producción rechaza una conexión sin credenciales y sin TLS en PostgreSQL, Valkey y Temporal, rechaza una contraseña de desarrollo, y acepta las credenciales de la prueba; corre dentro del job `integration` (amd64 y arm64) sin check nuevo (FR-013)

### Implementation

- [ ] T031 [US1] `deploy/caddy/Caddyfile`: TLS automático, redirección, cabeceras, `/api/*` con SSE, límite de cuerpo, registro JSON con redacción, caché de la SPA [D6A]; ajustar la CSP al build real con una prueba de navegador y registrar cualquier excepción
- [ ] T032 [US2] `deploy/provision/pki.sh`: CA interna con `openssl`, certificados de Temporal (servidor, API, worker), PostgreSQL y Valkey, vigencias acotadas y comando de rotación; la clave de la CA sale al Vault [D8A]
- [ ] T033 [US2] `deploy/temporal/`: configuración del servidor de producción con PostgreSQL (bases `temporal` y `temporal_visibility`), mTLS en el frontend, namespace propio, search attribute `CorrelationId`, retención corta y tarea de esquema de un solo uso; UI en `127.0.0.1:8233` [D15A]
- [ ] T034 [US2] `deploy/postgres/`: `postgresql.conf` (`ssl`, `scram-sha-256`), `pg_hba.conf` solo `hostssl`, inicializador de roles que lee contraseñas de archivos de secretos (sustituye al `01-roles.sql` de desarrollo en producción) (FR-009)
- [ ] T035 [US2] `deploy/valkey/`: `port 0`, `tls-port`, ACL con el conjunto de comandos fijado en T007, `maxmemory` y `noeviction` (FR-010)
- [ ] T036 [US2] `deploy/compose.prod.yaml`: servicios, redes internas, límites de memoria de [research.md](./research.md) (Presupuesto de memoria), salud, rotación de registros y archivos de secretos como `secrets`
- [ ] T037 [US7] Levantar la imagen de borde y la API en local y ejecutar `scripts/security/zap-baseline.sh` (sin ampliar sus hosts, `zap-script.test.ts` intacto): 10038, 10020, 10021, 10063 y 90004 desaparecen; informe y decisión por alerta nueva en `docs/security/zap/` y `docs/security/zap.md` (FR-033, FR-034)
- [ ] T038 [US2] ADR-0091 (Temporal en producción) y ADR-0092 (PostgreSQL y Valkey con TLS y ACL, y PKI interna)

## Phase 5: Aprovisionamiento, secretos, despliegue, reversa y alertas (PR 4)

### Tests

- [ ] T039 [P] [US3] `scripts/test/unit/provision.test.ts`: `provision.sh` es idempotente en un contenedor Debian de prueba, no imprime ningún valor, no escribe nada dentro del árbol del repositorio y deja los secretos solo en `tmpfs`; `shellcheck` limpio
- [ ] T040 [P] [US5] `scripts/test/unit/deploy-scripts.test.ts`: `deploy.sh` guarda el volcado previo y `previous`, ejecuta `migrator` antes de arrancar los servicios nuevos, y ante migración fallida, salud rota o cabeceras ausentes **revierte solo** y sale con error; `rollback.sh` vuelve a los digests anteriores y espera la salud
- [ ] T041 [P] [US6] `scripts/test/unit/alerts.test.ts`: el contador de `auth.login_failed` y `auth.rate_limited` con ventana deslizante dispara por encima del umbral y no por debajo; cada alerta (servicio, certificado, disco) produce el correo correspondiente con un SMTP de prueba
- [ ] T042 [P] [US6] `apps/api/test/integration/log-redaction.test.ts`: un canario de contenido de usuario no aparece en los registros de la API, y los eventos de seguridad conservan `event`, `organizationId` y `correlationId` (FR-027)

### Implementation

- [ ] T043 (autor) Crear la instancia Ampere A1, la red y las reglas de entrada 22, 80 y 443, el Vault y la política de lectura de la instancia en Oracle; anotar los pasos reales en `docs/operations/oracle.md` (P1, P8) [D16A]
- [ ] T044 [US3] `deploy/provision/{provision.sh,secrets.sh,harden.sh,cloud-init.yaml}`: Docker, cortafuegos, SSH endurecido (solo llaves), `fail2ban`, usuario de despliegue, directorios, servicio `systemd` que vuelca los secretos del Vault a `tmpfs` y falla cerrado si no responde [D4B, D15A, D16A]
- [ ] T045 [US3] `deploy/env/*.example`: solo nombres de variables y su origen; comprobar que gitleaks sigue pasando sobre todo el historial
- [ ] T046 [US5] `deploy/ops/{deploy.sh,rollback.sh,doctor.sh}`: resolver digests, volcado previo en la VM (últimos 3), `migrator`, arranque, espera de salud, reversa automática, `current`/`previous` [D17A]
- [ ] T047 [US5] **[D3C]** `.github/workflows/deploy.yml`: se dispara con la publicación correcta; evaluar con el autor despliegue por empuje (SSH restringido con `command=`) frente a extracción (temporizador en la VM) y elegir una; entorno `production` sin revisores (P7)
- [ ] T048 [US7] `deploy/ops/check-headers.sh`: `curl` contra el dominio real que verifica HSTS, CSP, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP, COOP, CORP y la redirección HTTP→HTTPS; lo llama `deploy.sh` (FR-034)
- [ ] T049 [US6] `deploy/ops/alerts.sh` y temporizador `systemd` de 5 minutos; rotación y compresión de los registros a 90 días; procedimiento de prueba de cada alerta (FR-027, FR-028) [D9C, D10A]
- [ ] T050 (autor) Registros A/AAAA del dominio y SPF, DKIM y DMARC (`p=none` con informes y plan de subida a `quarantine`) con OCI Email Delivery; correo de prueba con las tres comprobaciones en `pass` (P2, P5) [D14A]
- [ ] T051 [US8] **[D23A]** Caddy responde 404 a `POST /api/v1/auth/register` y un script en la VM crea las cuentas autorizadas; comprobar antes en el código si la aceptación de invitaciones pasa por `register`
- [ ] T052 [US6] Medir el consumo real de memoria con la prueba de humo y ajustar los límites de [research.md](./research.md); registrar la tabla medida (SC-010)
- [ ] T053 [US3] [US5] `docs/operations/`: aprovisionamiento, despliegue y reversa, rotación de secretos, reconstrucción desde cero, acceso a la UI de Temporal por `ssh -L`, kill switches, respuesta a alertas y baja de la VM (FR-038)
- [ ] T054 [US3] [US5] [US6] ADR-0093 (secretos en OCI Vault), ADR-0094 (despliegue automático, reversa y ausencia de backups, riesgo aceptado) y ADR-0095 (registros, retención y alertas por script)
- [ ] T055 [US4] Reconstruir el servicio en una VM limpia con el script y las imágenes del registro, con una base vacía, y registrar el tiempo en `docs/operations/rebuild.md` (US4 escenario 3)

## Phase 6: Cierre (PR 5)

### Tests

- [ ] T056 [P] [US9] `scripts/test/unit/check-evidence.test.ts`: el comprobador rechaza cualquier fila `deferred:F9` en la matriz y en el modelo de amenazas tras el cierre de F9

### Implementation

- [ ] T057 [US9] `docs/threat-model.md` v3.0: sin `deferred:F9`; Caddy, registro de imágenes y alertas como elementos reales; pasan a `accepted` con dueño, razón y revisión: pérdida de datos sin copias (D5), ZAP sin staging ni activo (D2, #65), LLM02 con la capa gratuita y demo cerrada (D13), cron sin mínimo (#68), disparos descartados sin métrica (#67), alerta de costo ausente (D9C)
- [ ] T058 [US9] `docs/security/owasp-evidence.md` regenerado: A02 (TLS y cabeceras), A03 (SBOM y escaneo al publicar), A04 (TLS interno), A05 y A09 (retención y alertas) pasan a `verified`; LLM02 sigue `accepted`; `pnpm security:evidence` en verde (FR-036)
- [ ] T059 [US9] Tratamiento de issues: #62, #63 y #64 se cierran con la PR (`Closes`); #61, #65, #66, #67 y #68 quedan abiertos con su fase de revisión y razón vigente según D18, D19, D20, D21 y D12 (FR-035)
- [ ] T060 [P] [US9] `docs/PLAN.md` §7 (observabilidad = registros y alertas), §9 (topología real, tabla de memoria medida, sin backups) y §10 (F9 completada con su criterio ajustado: «demo cerrada con TLS, cabeceras verificadas y despliegue con reversa»); README (estado y enlace a la guía de operación) e índice de ADR
- [ ] T061 [US9] ADR-0097 (verificación de cabeceras sin staging; #65 `accepted`) y ADR-0098 (cierre de F9: D1 a D23, riesgos aceptados y su revisión, y la enmienda 1.1.0 de la constitución ya aplicada); ADR-0088 marcado cumplido o reabierto fila por fila
- [ ] T062 Ejecutar los escenarios de `quickstart.md` en producción y registrar resultados en la PR (SC-001 a SC-011)
- [ ] T063 Checklist de Security Considerations en la PR (principios I, III, VII, VIII y IX), `checklists/security.md` revisado y marcar T001–T062 como hechas en este archivo

---

## Implementation Strategy

1. **PR 1 — Aplicación lista para producción** (Sonnet): T003–T017. Parte de `main`. Sin prerrequisitos del
   autor.
2. **PR 2 — Imágenes y publicación** (Sonnet): T019–T027. Depende de PR 1 (variables y arranque). T023 necesita
   P7 y P9.
3. **PR 3 — Compose de producción y seguridad de datos** (Sonnet): T028–T038. Depende de PR 1 y PR 2. Se
   puede probar completo en local y en CI con certificados efímeros.
4. **PR 4 — Aprovisionamiento, secretos, despliegue, reversa y alertas** (Sonnet; Haiku para ADR y guía):
   T039–T055. Depende de PR 3. T043, T047 y T050 requieren P1, P2, P5, P7 y P8. **Hito:** primer despliegue
   real a producción.
5. **PR 5 — Cierre** (Sonnet para el modelo y la matriz; Haiku para PLAN, README, ADR y `tasks.md`):
   T056–T063. Depende de PR 4. **Hito:** demo cerrada con TLS y cierre de ADR-0088.

T001 y T002 son previos a PR 1. Dentro de cada PR, las pruebas `[P]` se escriben primero y deben fallar antes
de implementar. PR 1 y PR 2 pueden ir en paralelo solo si no tocan los mismos archivos (PR 1 toca
`apps/*/src` y `apps/web`; PR 2 toca Dockerfiles y workflows), pero PR 2 necesita el esquema de variables de
PR 1 para el arranque de la imagen. Sin staging, **PR 4 es la primera vez que algo llega a una VM real**: se
despliega primero con el registro cerrado y datos de prueba.
