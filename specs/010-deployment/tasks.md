---

description: "Task list for F9 — Despliegue (BORRADOR hasta que lleguen las respuestas D1–D22)"
---

# Tasks: Despliegue (F9)

> **BORRADOR.** Escrito sobre las **recomendaciones** de [research.md](./research.md) (D1A … D22A). Se
> cierra cuando el autor responda "1A 2A 3A …": entonces se ajustan las tareas marcadas **[Dn]**, se
> reasignan los números si hace falta y se retira este aviso. Hasta entonces **no se implementa nada**.
> Nada se despliega en la tarea de especificación.

**Input**: `/specs/010-deployment/` (spec, plan, research, data-model sin cambio de esquema, contracts,
quickstart, checklists)

**Tests**: incluidas. TDD obligatorio en las reglas de arranque en producción (T005–T008), `trust proxy`
(T003) y el cliente TLS de Temporal (T004), porque son reglas de seguridad de la aplicación. Cada prueba se
escribe primero y DEBE fallar antes de implementar. En `deploy/` las "pruebas" son pruebas de contrato
sobre los archivos (T027 y T028) y de integración con certificados efímeros (T029). Ninguna prueba de CI
llama a internet más allá de lo que ya hace CI.

**Feature flag**: ninguno nuevo. Los kill switches `LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED` se
conservan y se documentan.

**Esquema**: sin migraciones (ver `data-model.md`). Si D10 = B u otra tarea necesitara una, se detiene y se
pide aprobación del autor.

**Prerrequisitos del autor**: P1 a P9 de la spec. Las tareas marcadas **(autor)** no las puede hacer un
agente; las demás pueden desarrollarse y probarse en local y en CI sin ellos.

## Format: `[ID] [P?] [Story] Description`

Historias: US1 borde y cabeceras, US2 autenticación y TLS de la infraestructura, US3 secretos, US4
backups, US5 publicación, despliegue y reversa, US6 eventos, retención y alertas, US7 staging y ZAP, US8
correo y Gemini, US9 cierre.

---

## Phase 1: Setup

- [ ] T001 (autor) Responder D1 a D22 y entregar los prerrequisitos P1 a P9 de la spec; anotar en esta lista qué prerrequisito ya está listo
- [ ] T002 [P] Confirmar contra la fuente oficial, y anotar fecha y URL en `research.md`, cada cifra marcada **(verificar)**: capa gratuita de Oracle (cupo de Object Storage, Email Delivery, instantáneas, política de instancias inactivas, capacidad A1), límites de GHCR, cupo gratuito de observabilidad y del destino de backups, y condiciones de datos de la capa de pago de Gemini

## Phase 2: Aplicación lista para producción (PR 1)

### Tests

- [ ] T003 [P] [US1] `apps/api/test/integration/trust-proxy.test.ts`: con `TRUSTED_PROXIES` vacío, un `X-Forwarded-For` no cambia la IP vista; con el salto de confianza, la API usa la IP del cliente para el límite de tasa y para el campo `ip` de los eventos de seguridad; un cliente que envía su propio `X-Forwarded-For` no puede falsear su IP (FR-005)
- [ ] T004 [P] [US2] `apps/api/test/unit/temporal-tls.test.ts` y `apps/worker/test/unit/temporal-tls.test.ts`: las opciones de conexión incluyen CA, certificado de cliente y `serverName` cuando están configurados, y se rechaza una configuración incompleta (FR-008)
- [ ] T005 [P] [US2] `apps/api/test/unit/env.production.test.ts`: con `NODE_ENV=production` el arranque falla nombrando solo las variables si `DATABASE_URL` no exige TLS verificado, `VALKEY_URL` no es `rediss://`, falta TLS de Temporal, falta `CREDENTIALS_MASTER_KEY`, una contraseña coincide con un valor de desarrollo, `WEB_ORIGIN`/`API_PUBLIC_URL` no son `https://`; ningún mensaje contiene un valor (FR-012)
- [ ] T006 [P] [US2] Misma prueba en `apps/worker` para su esquema de configuración
- [ ] T007 [P] [US2] `apps/api/test/integration/valkey-acl.test.ts`: con un usuario de comandos mínimos, los scripts Lua, el límite de tasa, la caché de sesión y el circuit breaker siguen funcionando; `FLUSHALL`, `CONFIG` y `KEYS` fallan; con `maxmemory` lleno y `noeviction` la API falla cerrado (503); fija la lista exacta de comandos que la ACL de T034 debe permitir (FR-010)
- [ ] T008 [P] [US1] `apps/web/test/api-base-url.test.ts`: con `VITE_API_URL` vacío el cliente usa rutas relativas `/api/v1/...` (incluido el flujo SSE) y con valor lo antepone; confirma que la imagen puede ser independiente del dominio (FR-006, D6A)
- [ ] T009 [P] [US8] `apps/api/test/unit/mail-transport.test.ts`: el transporte SMTP admite usuario, contraseña y TLS; en producción rechaza un servidor sin TLS (FR-030)
- [ ] T010 [P] [US9] **[D21A]** `apps/api/test/integration/schedule-min-interval.test.ts` y `apps/worker/test/schedules/reconciler-min-interval.test.ts`: una cron más frecuente que `SCHEDULE_MIN_INTERVAL_SECONDS` devuelve 422 `CRON_TOO_FREQUENT` al crear y al actualizar, y el reconciliador pausa o marca las existentes según la decisión del plan (FR-035)

### Implementation

- [ ] T011 [US1] `apps/api`: `trust proxy` con lista cerrada `TRUSTED_PROXIES`, usada por el límite de tasa y los eventos de seguridad
- [ ] T012 [US2] Opciones TLS del cliente de Temporal en `apps/api` y `apps/worker/src/main.ts` (`Connection.connect`, `NativeConnection.connect`) y variables `TEMPORAL_TLS_*`
- [ ] T013 [US2] Esquemas Zod de producción de la API y del worker: reglas de arranque, lectura de secretos por `*_FILE`, lista de valores de desarrollo prohibidos (sin imprimirlos), `CREDENTIALS_MASTER_KEY` obligatoria
- [ ] T014 [US2] Opciones de Valkey y PostgreSQL con CA de confianza (`rediss://`, `sslmode=verify-full`) y credenciales por archivo
- [ ] T015 [US8] Transporte SMTP con autenticación y TLS (`SMTP_SECURE`, `SMTP_USER_FILE`, `SMTP_PASSWORD_FILE`); sin cambio de comportamiento en desarrollo con Mailpit
- [ ] T016 [US1] `apps/web`: `VITE_API_URL` vacío por defecto en producción y rutas relativas; `.env.example` actualizado
- [ ] T017 [US9] **[D21A]** Validación de cron mínima en la API y en el reconciliador, con `SCHEDULE_MIN_INTERVAL_SECONDS` (por defecto 300) y mensaje en español; ADR de la mínima

## Phase 3: Imágenes y publicación (PR 2)

### Tests

- [ ] T018 [P] [US5] `scripts/test/unit/images-config.test.ts`: todos los `FROM` de los Dockerfiles y las imágenes de Compose están fijados por digest, ninguna base es Alpine, el usuario final no es root, y ningún Dockerfile copia `.env` ni `node_modules` del anfitrión (FR-018)
- [ ] T019 [P] [US5] `scripts/test/unit/workflows-permissions.test.ts`: `ci.yml` conserva `contents: read` y los 6 jobs requeridos; `packages: write` (o el permiso del registro) solo aparece en `release.yml`; todas las acciones fijadas por SHA (FR-022, FR-023)

### Implementation

- [ ] T020 [US5] `packages/db/Dockerfile`: imagen `migrator` (migraciones como `app_migrator`, sin servidor, Debian `bookworm-slim`, multi-etapa, `pnpm install` dentro) (FR-026)
- [ ] T021 [US1] [US5] `apps/web/Dockerfile`: imagen de borde (build de la SPA dentro + Caddy oficial fijado por digest; sin `VITE_API_URL` fijo al compilar) **[D6A, D7A]**
- [ ] T022 [US5] `.github/workflows/release.yml`: build multi-arch de las 4 imágenes (arm64 en `ubuntu-24.04-arm`, sin QEMU), manifiesto combinado, etiqueta con el SHA, salida por digest, permisos mínimos por job y solo en `main` **[D1A]** (autor: P9)
- [ ] T023 [US5] Paso de escaneo en el job `images` de `ci.yml` (carga la imagen por arquitectura; falla ante altas y críticas con corrección disponible) y archivo versionado de excepciones con razón, dueño y fecha; el número de checks sigue siendo 6 **[D11A]**
- [ ] T024 [US5] SBOM CycloneDX por imagen en `release.yml`, adjunto a lo publicado y consultable **[D11A]**
- [ ] T025 [P] [US5] `shellcheck` en el job `quality` para `deploy/**/*.sh` y `scripts/**/*.sh` (sin job nuevo)
- [ ] T026 [US5] ADR-0089 (registro y etiquetado por digest), ADR-0090 (imagen de borde, mismo origen y URL relativa) y ADR-0096 (SBOM y escaneo)

## Phase 4: Compose de producción y seguridad de datos (PR 3)

### Tests

- [ ] T027 [P] [US1] `scripts/test/unit/deploy-config.test.ts`: contrato del Caddyfile según [contracts/edge-headers.md](./contracts/edge-headers.md): CSP sin `unsafe-inline` en `script-src`, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP/COOP/CORP, HSTS, redirección HTTP→HTTPS, redacción del token de `/api/v1/hooks/*` y de `Cookie`/`Authorization` en el registro, `/api/v1/metrics` y la UI de Temporal sin publicar
- [ ] T028 [P] [US2] Misma prueba, parte de Compose: ningún servicio publica puertos salvo Caddy (80 y 443; y la UI de Temporal solo en `127.0.0.1`); cada servicio tiene `mem_limit`, `restart`, `healthcheck` y usuario no root; las imágenes de terceros por digest; PostgreSQL y Valkey sin puerto en claro; suma de límites ≤ 60 % de 12 GB y producción más staging ≤ 8 GB (FR-017, SC-010)
- [ ] T029 [P] [US2] `scripts/test/integration/deploy-security.test.ts`: con certificados efímeros, el Compose de producción rechaza una conexión sin credenciales y sin TLS en PostgreSQL, Valkey y Temporal, rechaza una contraseña de desarrollo, y acepta las credenciales de la prueba; corre dentro del job `integration` (amd64 y arm64) sin check nuevo (FR-013)

### Implementation

- [ ] T030 [US1] `deploy/caddy/Caddyfile`: TLS automático, redirección, cabeceras, `/api/*` con SSE, límite de cuerpo, registro JSON con redacción, caché de la SPA **[D6A]**; ajustar la CSP al build real con una prueba de navegador y registrar cualquier excepción
- [ ] T031 [US2] `deploy/provision/pki.sh`: CA interna con `openssl`, certificados de Temporal (servidor, API, worker), PostgreSQL y Valkey, vigencias acotadas y comando de rotación **[D8A]**
- [ ] T032 [US2] `deploy/temporal/`: configuración del servidor de producción con PostgreSQL (bases `temporal` y `temporal_visibility`), mTLS en el frontend, namespace propio, search attribute `CorrelationId`, retención corta y tarea de esquema de un solo uso; UI en `127.0.0.1:8233` **[D15A]**
- [ ] T033 [US2] `deploy/postgres/`: `postgresql.conf` (`ssl`, `scram-sha-256`), `pg_hba.conf` solo `hostssl`, inicializador de roles que lee contraseñas de archivos de secretos (sustituye al `01-roles.sql` de desarrollo en producción) (FR-009)
- [ ] T034 [US2] `deploy/valkey/`: `port 0`, `tls-port`, ACL con el conjunto de comandos fijado en T007, `maxmemory` y `noeviction` (FR-010)
- [ ] T035 [US2] `deploy/compose.prod.yaml` y `deploy/compose.staging.yaml`: servicios, redes internas, límites de memoria de [research.md](./research.md) (Presupuesto de memoria), salud, rotación de registros, archivos de secretos como `secrets` **[D2A]**
- [ ] T036 [US2] **[D2A]** Staging: diferencias de proyecto (`name`), dominio, límites menores, sin clave de pago de Gemini ni SMTP de producción
- [ ] T037 [US2] ADR-0091 (Temporal en producción) y ADR-0092 (PostgreSQL y Valkey con TLS y ACL, y PKI interna)

## Phase 5: Aprovisionamiento, secretos, backups, despliegue y reversa (PR 4)

### Tests

- [ ] T038 [P] [US3] `scripts/test/unit/provision.test.ts`: `provision.sh` es idempotente en un contenedor Debian de prueba, deja los secretos con `0600`, no imprime ningún valor y no escribe nada dentro del árbol del repositorio; `shellcheck` limpio
- [ ] T039 [P] [US4] `scripts/test/integration/backup-restore.test.ts`: con un Compose limpio y datos sintéticos, `backup.sh` genera una copia cifrada, `restore.sh` la restaura en un entorno vacío y `smoke.sh` comprueba roles, RLS forzada y un flujo de extremo a extremo (FR-020)
- [ ] T040 [P] [US5] `scripts/test/unit/deploy-scripts.test.ts`: `deploy.sh` ejecuta `migrator` antes de arrancar los servicios nuevos, deja la versión anterior intacta si falla y registra `current` y `previous`; `rollback.sh` vuelve a los digests anteriores y espera la salud

### Implementation

- [ ] T041 (autor) Crear la instancia Ampere A1, la red y las reglas de entrada 22, 80 y 443 en Oracle, y el DNS del dominio; anotar los pasos reales en `docs/operations/oracle.md` (P1, P2) **[D16A]**
- [ ] T042 [US3] `deploy/provision/{provision.sh,secrets.sh,harden.sh,cloud-init.yaml}`: Docker, cortafuegos, SSH endurecido (solo llaves), `fail2ban`, usuario de despliegue, directorios, PKI, generación de secretos y entrega de los que da el autor **[D4A, D15A, D16A]**
- [ ] T043 [US3] `deploy/env/*.example`: solo nombres de variables y su origen; comprobar que gitleaks sigue pasando sobre todo el historial
- [ ] T044 [US4] `deploy/backup/{backup.sh,restore.sh,smoke.sh,verify.sh}`: `pg_dump` de ambas bases y de los roles, `restic` cifrado hacia el destino externo, retención, alerta de fallo, comprobación de integridad **[D5B]** (autor: P3)
- [ ] T045 [US4] Temporizadores `systemd` del backup, de la verificación semanal y del recordatorio de restauración periódica
- [ ] T046 [US5] `deploy/ops/{deploy.sh,rollback.sh,doctor.sh}`: resolver digests, `migrator`, arranque, espera de salud, `current`/`previous`, copia lógica previa a la migración **[D17A]**
- [ ] T047 [US5] **[D3A]** Evaluar despliegue por empuje (SSH restringido con `command=`) frente a por extracción (temporizador en la VM) y elegir una con el autor; `.github/workflows/deploy.yml` con staging automático y producción manual con aprobación (autor: P7)
- [ ] T048 [US3] Copia cifrada de los secretos fuera de la VM y procedimiento de rotación por secreto, probado en staging (autor: P8)
- [ ] T049 [US5] [US9] `docs/operations/`: aprovisionamiento, despliegue, rollback, rotación de secretos, restauración, acceso a la UI de Temporal por `ssh -L`, kill switches, respuesta a alertas y baja de la VM (FR-038)
- [ ] T050 [US3] [US4] [US5] ADR-0093 (secretos de la VM) y ADR-0094 (backups, retención, despliegue y rollback)
- [ ] T051 [US4] Primera restauración completa en un entorno limpio; registrar RTO y RPO en `docs/security/restore-evidence.md` (SC-004)

## Phase 6: Observabilidad, correo y Gemini (PR 5)

### Tests

- [ ] T052 [P] [US6] `apps/api/test/integration/log-shipping-redaction.test.ts`: un canario de contenido de usuario no aparece en la salida enviada al almacén de registros; los eventos de seguridad conservan `event`, `organizationId` y `correlationId` (FR-027)
- [ ] T053 [P] [US6] **[D9]** `apps/api/test/unit/metrics.test.ts` y `apps/worker/test/unit/metrics.test.ts`: métricas mínimas (T6 de research) sin etiquetas de alta cardinalidad ni contenido; el endpoint no se publica por Caddy (FR-029)
- [ ] T054 [P] [US6] **[D20A]** Prueba de la métrica y de la alerta de disparos fuera del catch-up con las métricas del servidor de Temporal

### Implementation

- [ ] T055 [US6] **[D9]** Dependencia de métricas con ADR (principio VII), instrumentación en API y worker, agente de observabilidad en `deploy/observability/` con su límite de memoria (autor: P6)
- [ ] T056 [US6] Medir el consumo real de memoria con la prueba de humo y ajustar los límites de [research.md](./research.md) (Presupuesto de memoria); registrar la tabla medida (SC-010)
- [ ] T057 [US6] Reglas de alerta con procedimiento de prueba: fallos de autenticación, gasto de Gemini, servicio no sano, última copia vieja, certificado próximo a caducar, disco bajo; canal elegido por el autor (FR-028)
- [ ] T058 [US6] **[D10A]** Retención: 90 días consultables, 12 meses archivados en el destino de D5, 30 días para los registros de acceso de Caddy
- [ ] T059 [US8] **[D14A]** SPF, DKIM y DMARC (`p=none` con informes y plan de subida a `quarantine`) para el dominio de envío; correo de prueba con las tres comprobaciones en `pass` (autor: P2, P5)
- [ ] T060 [US8] **[D13A]** Clave de pago de Gemini en el secreto de producción, `LLM_PRICES` revisado, tope de gasto en el proveedor (autor: P4); actualizar el aviso de la capa gratuita en los paneles LLM y el compilador
- [ ] T061 [US6] ADR-0095 (observabilidad, alertas y retención)

## Phase 7: Staging, ZAP y cierre (PR 6)

### Tests

- [ ] T062 [P] [US7] `scripts/test/unit/zap-script.test.ts`: la lista de destinos admite loopback y los hosts de staging definidos en un archivo versionado, rechaza el dominio de producción y cualquier tercero, y el análisis activo solo se acepta para staging (FR-033)
- [ ] T063 [P] [US9] `scripts/test/unit/check-evidence.test.ts`: el comprobador rechaza cualquier fila `deferred:F9` en la matriz y en el modelo de amenazas tras el cierre de F9

### Implementation

- [ ] T064 [US7] **[D12A]** `scripts/security/zap-baseline.sh`: lista cerrada ampliada, usuario de prueba con los tres roles, análisis con sesión y activo solo en staging, `.zap/rules.tsv` actualizado (FR-033)
- [ ] T065 [US7] **[D2A]** Staging con datos sintéticos, `LLM_ENABLED=false`, correo capturado y destinos HTTP restringidos (condiciones de la historia 7)
- [ ] T066 [US7] Ejecutar el baseline pasivo contra staging: 10038, 10020, 10021, 10063 y 90004 desaparecen; informe en `docs/security/zap/` y decisión por alerta nueva media o alta
- [ ] T067 [US7] Ejecutar el análisis con sesión y el activo contra staging; corregir con prueba de regresión, marcar falso positivo o aceptar con razón, dueño y fecha (SC-001)
- [ ] T068 [US1] [US7] Verificar con una petición de prueba que ningún registro (Caddy, API, almacén) contiene el token de un webhook (T068 de F7; SC-003)
- [ ] T069 [US2] Escaneo de puertos desde fuera de la VM: solo 22, 80 y 443; intento de conexión sin credenciales a Temporal, PostgreSQL y Valkey desde fuera y desde la red interna (SC-002)
- [ ] T070 [US6] Provocar 20 inicios de sesión fallidos y un exceso de costo de prueba; confirmar que las alertas llegan en ≤ 5 minutos (SC-008)
- [ ] T071 [US9] `docs/threat-model.md` v3.0 (sin `deferred:F9`; Caddy, backups, observabilidad, registro y staging como elementos reales), `docs/security/owasp-evidence.md` regenerado con A02, A03, A04, A09 y LLM02 en `verified`, y `pnpm security:evidence` en verde (FR-036)
- [ ] T072 [US9] Tratamiento de #61, #66, #67, #68, #62, #63, #64 y #65 según D10, D11, D12, D18 a D21: cerrar con la PR (`Closes`) o dejar abiertos con su fase de revisión
- [ ] T073 [P] [US9] `docs/PLAN.md` §9 y §10 (F9 completada, topología real y tabla de memoria medida), README (estado y enlace a la guía de operación) y `docs/adr/` índice
- [ ] T074 [US9] ADR-0097 (ZAP contra staging) y ADR-0098 (cierre de F9, D18 a D22 y riesgos que siguen `accepted`); ADR-0088 marcado cumplido
- [ ] T075 Ejecutar los escenarios de `quickstart.md` contra staging y producción y registrar resultados en la PR (SC-001 a SC-011)
- [ ] T076 Checklist de Security Considerations en la PR (principios I, III, VII, VIII y IX) y `checklists/security.md` revisado
- [ ] T077 Marcar T001–T076 como hechas en este archivo

---

## Implementation Strategy

1. **PR 1 — Aplicación lista para producción** (Sonnet): T003–T017. Parte de `main`. Sin prerrequisitos del
   autor; T010 y T017 solo si D21A.
2. **PR 2 — Imágenes y publicación** (Sonnet): T018–T026. Depende de PR 1. T022 necesita P9.
3. **PR 3 — Compose de producción y seguridad de datos** (Sonnet): T027–T037. Depende de PR 1 y PR 2. Se
   puede probar completo en local y en CI con certificados efímeros.
4. **PR 4 — Aprovisionamiento, secretos, backups, despliegue y reversa** (Sonnet): T038–T051. Depende de
   PR 3. T041, T044, T047 y T048 requieren P1, P2, P3, P7 y P8. **Hito:** primer despliegue real a staging.
5. **PR 5 — Observabilidad, correo y Gemini** (Sonnet; Haiku para ADR y documentación): T052–T061. Depende
   de PR 4. Requiere P4, P5 y P6.
6. **PR 6 — Staging, ZAP y cierre** (Sonnet para ZAP, modelo y matriz; Haiku para PLAN, README, ADR y
   `tasks.md`): T062–T077. Depende de PR 4 y PR 5. **Hito:** demo pública y cierre de ADR-0088.

T001 y T002 son previos a PR 1 y los hace el autor o quien orquesta la fase. Dentro de cada PR, las
pruebas `[P]` se escriben primero y deben fallar antes de implementar. PR 1 y PR 2 pueden ir en paralelo
solo si no tocan los mismos archivos (PR 1 toca `apps/*/src` y `apps/web`; PR 2 toca Dockerfiles y
workflows), pero PR 2 necesita el esquema de variables de PR 1 para el arranque de la imagen.

### Si el autor responde distinto a la recomendación

| Respuesta                    | Efecto en las tareas                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D1B o D1C                    | T022 cambia de registro y de credenciales; T018 igual                                                                         |
| D2B o D2C                    | D2B: T035/T036 pasan a una segunda VM (fuera de la capa gratuita); D2C: se retira T036/T065 y #65 queda `deferred` con razón |
| D3B o D3C                    | D3B: T047 se reduce a un script local; D3C: T047 elimina la aprobación y exige proteger `main` más                            |
| D4B o D4C                    | T042/T048 cambian de origen de secretos; se agrega un ADR de la dependencia                                                   |
| D5A o D5C                    | T044 cambia de destino (A) o duplica configuración y prueba (C)                                                               |
| D6B                          | T016 mantiene `VITE_API_URL`; T030 y T021 añaden un host `api.`; CSP con `connect-src` del host de la API                     |
| D7B o D7C                    | T021 se divide en dos imágenes (B) o desaparece y cambia el modelo de origen (C, incompatible con D6A)                        |
| D9B o D9C                    | D9B: T055 despliega Loki/Prometheus/Grafana (+1,5 GB); D9C: T053/T054 se retiran y FR-029 queda `accepted`                    |
| D10B                         | Se detiene: esquema y endpoints nuevos, aprobación previa (`data-model.md`)                                                   |
| D18B o D18C                  | Fuera de este plan: se abre una spec propia (producto), no se mezcla con el despliegue                                        |
| D19B                         | Tarea nueva en `apps/api` sobre el webhook, con prueba; cambia PR 1                                                            |
| D20B o D21B                  | Se retiran T054 o T010/T017 y la fila queda `accepted` con la fecha de revisión                                               |
| D22B                         | PR 5 y la parte activa de PR 6 pasan a F9.1; el modelo v3.0 conserva esas filas `deferred:F9.1`                               |
