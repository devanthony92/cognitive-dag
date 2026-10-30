---

description: "Task list for F1 — Identidad y multi-tenant"
---

# Tasks: Identidad y multi-tenant (F1)

**Input**: Design documents from `/specs/002-identity-tenancy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md (aprobado), contracts/, quickstart.md

**Tests**: incluidas. TDD obligatorio en reglas de autorización (constitution, principio III):
guards, políticas RLS, invariante de owner y permisos por rol. Toda prueba se escribe primero y
DEBE fallar antes de implementar.

**Feature flag**: `identity-enabled`. Apagado: los endpoints de F1 responden 404
`FEATURE_NOT_AVAILABLE`, la web oculta las pantallas y el ping sigue en su ruta de F0. Encendido: el
ping vive solo bajo `/api/v1/organizations/{id}/pings` y exige sesión.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable · **[Story]**: US1–US6 de la spec

---

## Phase 1: Setup

- [X] T001 Agregar Mailpit `axllent/mailpit:v1.32.0` por digest a `compose.yaml` (SMTP `127.0.0.1:1025`, UI `127.0.0.1:8025`, healthcheck) y variables `SMTP_*`, `MAIL_FROM`, `APP_BASE_URL` a `.env.example`
- [X] T002 Crear `infra/postgres/init/01-roles.sql` montado en `/docker-entrypoint-initdb.d`: roles `app_migrator` (dueño) y `app_runtime` (`LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`) con contraseñas solo de desarrollo; agregar `DATABASE_URL` (runtime) y `DATABASE_MIGRATOR_URL` a `.env.example`
- [X] T003 Crear `packages/db` (Drizzle ORM 0.45.4, drizzle-kit 0.31.11, `pg`), `drizzle.config.ts` y scripts raíz `db:generate`, `db:migrate`
- [X] T004 [P] Agregar el flag `identity-enabled` (privado al API y público a la web) al catálogo de flags y a `.env.example`
- [X] T005 [P] Configurar la web: TanStack Router con plugin de Vite y rutas por archivo, Tailwind CSS 4.3 (`@tailwindcss/vite`), shadcn/ui (button, input, label, form, card, alert, dropdown-menu, table, dialog) en `apps/web/src/components/ui`; migrar `PingPanel` a la nueva estructura sin cambiar su comportamiento
- [X] T006 [P] Actualizar CI (`.github/workflows/ci.yml`): el job `integration` ejecuta `pnpm db:migrate` tras levantar Compose

---

## Phase 2: Foundational (bloquea todas las historias)

### Tests

- [X] T007 [P] Pruebas de contratos en `packages/contracts/test/auth.test.ts` y `organizations.test.ts`: contraseña "15–128" caracteres Unicode, email normalizado "≤ 254", token "43 caracteres base64url", roles `owner|editor|viewer`, códigos de problema nuevos y `retryAfterSeconds` solo con `RATE_LIMITED`
- [X] T008 [P] Pruebas de RLS en `packages/db/test/rls.test.ts` conectando como `app_runtime`: sin contexto, 0 filas en las 6 tablas; con contexto de la organización A, 0 filas de B en lectura y rechazo en escritura; `DELETE` y `TRUNCATE` rechazados en todas las tablas; `UPDATE` de `deleted_at` permitido y fila invisible después
- [X] T009 [P] Pruebas de invariantes en `packages/db/test/constraints.test.ts`: email único entre no borrados, una organización personal por usuario y no borrable, membresía única activa, trigger "siempre un owner", estados de invitación coherentes
- [X] T010 [P] Pruebas unitarias en `apps/api/test/unit/password-policy.test.ts`: 14 rechazada, 15 y 128 aceptadas, 129 rechazada, NFKC, espacios y emoji válidos, contraseña común rechazada

### Implementation

- [X] T011 [P] Contratos Zod en `packages/contracts/src/auth.ts` y `organizations.ts`; códigos nuevos en `problem.ts` (`UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `CSRF_REJECTED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `TOKEN_INVALID`, `ALREADY_MEMBER`, `LAST_OWNER`) y extensión `retryAfterSeconds`
- [X] T012 Esquema Drizzle de las 6 tablas y 4 enums en `packages/db/src/schema/` exactamente como `data-model.md`; migración inicial generada
- [X] T013 Migración SQL manual: `ENABLE` + `FORCE ROW LEVEL SECURITY`, políticas por tabla, triggers `updated_at` y `memberships_keep_owner`, `GRANT` según la tabla de privilegios de `data-model.md`
- [X] T014 `packages/db/src/tenant.ts`: `withContext({ userId?, organizationId?, lookupEmail?, lookupTokenHash? }, fn)` que abre una transacción y fija `set_config(..., true)`; el API no ejecuta consultas fuera de esta función (regla de lint o revisión)
- [X] T015 [P] `apps/api/src/auth/password-policy.ts` con lista de 100 000 contraseñas comunes en `apps/api/src/auth/common-passwords.txt` (fuente y licencia citadas en el ADR)
- [X] T016 [P] `apps/api/src/mail/`: interfaz `Mailer`, implementación SMTP con nodemailer 10.2.1, envío tras confirmar la transacción con reintentos y backoff, plantillas en español con cabecera `X-Correlation-Id`
- [X] T017 [P] `apps/api/src/security-events/security-event.logger.ts`: tipos de evento estables de FR-026 y campos de FR-027; nunca contraseñas, tokens ni ids de sesión
- [X] T018 [P] `apps/api/src/rate-limit/`: `rate-limiter-flexible` 11.2.3 sobre `iovalkey`, espera progresiva de R10, 429 con `Retry-After` y `retryAfterSeconds`, fallo cerrado si Valkey no responde
- [X] T019 Módulo de base de datos en el API: pool `pg` como `app_runtime`, readiness existente reutilizado, timeouts de consulta

**Checkpoint**: migraciones aplicadas; pruebas de RLS e invariantes en verde

---

## Phase 3: User Story 1 - Registro y verificación (P1) 🎯 MVP

### Tests

- [X] T020 [P] [US1] Integración `apps/api/test/integration/register.test.ts`: registro crea usuario, organización personal y membresía owner; email existente → misma respuesta y correo de aviso (leído vía API de Mailpit); contraseña inválida → 422 con `errors[]`; registros simultáneos con el mismo email → una cuenta
- [X] T021 [P] [US1] Integración `verify-email.test.ts`: token válido verifica y queda consumido; vencido, usado o inexistente → 422 `TOKEN_INVALID`; reenvío con rate limit
- [X] T022 [P] [US1] Web `apps/web/test/register.test.tsx`: validación de formulario con el esquema compartido y mensaje genérico tras enviar

### Implementation

- [X] T023 [US1] `apps/api/src/auth/registration.service.ts` y controlador (`/auth/register`, `/auth/verify-email`, `/auth/verify-email/resend`) según contrato, con ids previos `SELECT uuidv7()` y contexto RLS de `data-model.md`
- [X] T024 [US1] Tokens de un solo uso: 32 bytes, base64url, `SHA-256` en base de datos, vencimiento 24 h, los anteriores se consumen al emitir uno nuevo
- [X] T025 [US1] Web: rutas `/register`, `/verify-email?token=` (el token se envía en el cuerpo y se borra de la barra de direcciones) y reenvío
- [X] T026 [US1] Eventos `user.registered` y `user.email_verified`

---

## Phase 4: User Story 2 - Inicio y cierre de sesión (P1)

### Tests

- [X] T027 [P] [US2] Unitarias `session.service.test.ts`: token 32 bytes, solo hash persistido, rotación, validez = PostgreSQL vigente **y** clave en Valkey; clave ausente → revocada con `idle_timeout`
- [X] T028 [P] [US2] Integración `login.test.ts`: credenciales inválidas, email inexistente y cuenta sin verificar → misma respuesta 401 `INVALID_CREDENTIALS`; cookie `__Host-session` con `HttpOnly`, `Secure`, `SameSite=Lax`; cookie previa invalidada al iniciar sesión
- [X] T029 [P] [US2] Integración `rate-limit.test.ts`: espera progresiva por cuenta y por IP desde el 5.º fallo; 429 con `Retry-After`; Valkey caído → 503
- [X] T030 [P] [US2] Integración `csrf.test.ts`: sin `X-CSRF-Token`, token de otra sesión u `Origin` distinto → 403 `CSRF_REJECTED`
- [X] T031 [P] [US2] Integración `timing.test.ts`: tiempo medio de login, registro y restablecimiento con email existente e inexistente difiere < 50 ms (SC-004)
- [X] T032 [P] [US2] Integración `logout.test.ts`: logout revoca en < 1 s; sesión vencida por 12 h → 401

### Implementation

- [X] T033 [US2] `session.service.ts`: PostgreSQL + Valkey según R5; hash Argon2id ficticio para emails inexistentes (R12)
- [X] T034 [US2] `session.guard.ts` global (excepto salud, flags públicos y autenticación) y `csrf.guard.ts`
- [X] T035 [US2] Controlador: `/auth/login`, `/auth/logout`, `/auth/session`; CORS con `credentials: true` solo para `WEB_ORIGIN`
- [X] T036 [US2] Mover el ping a `/api/v1/organizations/{organizationId}/pings` detrás de `identity-enabled`, con guard de organización; ruta de F0 solo con el flag apagado
- [X] T037 [US2] Web: `/login`, cierre de sesión, rutas protegidas con `beforeLoad`, cliente HTTP con `credentials: 'include'` y `X-CSRF-Token`, redirección a `/login` ante 401
- [X] T038 [US2] Eventos `auth.login_succeeded`, `auth.login_failed`, `auth.logout`, `auth.rate_limited`

---

## Phase 5: User Story 3 - Aislamiento entre organizaciones (P1)

### Tests

- [X] T039 [P] [US3] Integración `cross-tenant.test.ts`: para cada endpoint bajo `/organizations/{id}` y cada combinación (no miembro, recurso de otra organización), 404 `NOT_FOUND` (SC-002)
- [X] T040 [P] [US3] Integración `rls-defense.test.ts`: con el guard de organización desactivado en una app de prueba, las lecturas y escrituras a otra organización siguen bloqueadas (SC-003)
- [X] T041 [P] [US3] Unitarias `organization.guard.test.ts`: membresía activa requerida, rol requerido por ruta, membresía borrada → 404

### Implementation

- [X] T042 [US3] `organization.guard.ts`: valida membresía y rol en cada petición y abre el contexto RLS con `withContext`
- [X] T043 [US3] `POST /api/v1/organizations` (crea y deja owner) y `GET /auth/session` con las organizaciones del usuario
- [X] T044 [US3] Web: selector de organización activa en la cabecera; rutas `/orgs/$organizationId/...`; organización expulsada → redirección a otra

---

## Phase 6: User Story 4 - Recuperación y cambio de contraseña (P2)

### Tests

- [X] T045 [P] [US4] Integración `password-reset.test.ts`: misma respuesta con email existente o no; token de 30 min de un solo uso; restablecer revoca todas las sesiones
- [X] T046 [P] [US4] Integración `password-change.test.ts`: contraseña actual incorrecta → 401 y cuenta para rate limit; cambio revoca las demás sesiones y conserva la actual

### Implementation

- [X] T047 [US4] Endpoints `/auth/password-reset/request`, `/auth/password-reset/confirm`, `/auth/password/change`
- [X] T048 [US4] Web: `/forgot-password`, `/reset-password?token=` (token fuera de la URL tras cargar), `/account/password`
- [X] T049 [US4] Eventos `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.password_changed`

---

## Phase 7: User Story 5 - Miembros y roles (P2)

### Tests

- [X] T050 [P] [US5] Unitarias `member-permissions.test.ts`: solo owner invita, cambia roles, quita y revoca; editor y viewer → 403 `FORBIDDEN`; último owner → 409 `LAST_OWNER`
- [X] T051 [P] [US5] Integración `invitations.test.ts`: invitación de un solo uso, 7 días, ligada al email; aceptar con otro email → 403; email ya miembro → 409 `ALREADY_MEMBER`; aceptar tras registrarse desde el enlace
- [X] T052 [P] [US5] Integración `members.test.ts`: cambio de rol y expulsión aplican en la siguiente petición del afectado; expulsión es borrado lógico y re-invitar crea una membresía nueva

### Implementation

- [X] T053 [US5] Endpoints de miembros e invitaciones según contrato (preview y accept con el token en el cuerpo)
- [X] T054 [US5] Web: página de miembros (lista para todos; invitar, cambiar rol, quitar y revocar solo owner), `/invitations/accept?token=`
- [X] T055 [US5] Eventos `org.created`, `invitation.sent`, `invitation.accepted`, `invitation.revoked`, `membership.role_changed`, `membership.removed`

---

## Phase 8: User Story 6 - Eventos de seguridad (P3)

- [X] T056 [P] [US6] Prueba `security-events.test.ts`: cada acción de FR-026 emite su evento con los campos de FR-027, capturado con un logger de prueba; ningún evento contiene contraseña, token ni id de sesión (SC-007)
- [X] T057 [US6] Completar los eventos que falten según la prueba

---

## Phase 9: Polish

- [X] T058 [P] ADRs: Drizzle, argon2 y política de contraseñas, sesiones opacas y CSRF, organización activa en la ruta, RLS con claves de contexto, dos roles de PostgreSQL, borrado lógico, rate-limiter-flexible, Mailpit y nodemailer, TanStack Router, React Hook Form, Tailwind y shadcn/ui, eventos de seguridad en logs
- [X] T059 [P] Actualizar `docs/threat-model.md`: nuevos elementos (sesiones, correo, Mailpit), filas `planned:F1` pasan a `mitigated` con evidencia
- [X] T060 [P] Actualizar `docs/PLAN.md` (O1 y O2 cerradas) y `README.md` (F1, Mailpit, migraciones)
- [X] T061 Issue de eliminación del flag `identity-enabled` y del ping de F0 sin organización
- [X] T062 Ejecutar los 17 escenarios de `quickstart.md` y registrar resultados en la PR
- [X] T063 Revisar la tabla "Security Considerations" de la spec contra el código y registrar el checklist en la PR

---

## Phase 10: Refinamientos de UX decididos por el autor (2026-10-29, PR 4)

Cada tarea de prueba va antes de su implementación (TDD).

- [X] T064 [P] Pruebas del contrato y de la política: contraseña 7 rechazada, 8 y 25 aceptadas, 26 rechazada; login acepta hasta 128; contraseña común de 8 caracteres rechazada (`packages/contracts/test/auth.test.ts`, `password-policy.test.ts`)
- [X] T065 Aplicar la política 8–25 en `PasswordSchema`, `password-policy.ts`, formularios web y pruebas existentes; regenerar `common-passwords.txt` (8–25 caracteres)
- [X] T066 [P] Pruebas web de confirmación de contraseña y de mostrar/ocultar (`apps/web/test`)
- [X] T067 Confirmación de contraseña (Zod en el formulario, fuera del contrato) y botón de ojo con SVG propio en login, registro, restablecimiento y cambio
- [X] T068 [P] Pruebas de `organizationName` en registro (contrato e integración: por defecto, personalizado, recortado, inválido) y del campo prellenado en la web
- [X] T069 `organizationName` en `RegisterRequestSchema`, `RegistrationService` y `RegisterForm`
- [X] T070 [P] Pruebas de `PATCH /organizations/{id}`: owner 200, editor y viewer 403, no miembro 404, sin CSRF 403, nombre inválido 422, evento `org.renamed`, invitación mostrando el nombre actual
- [X] T071 Endpoint de renombrado, evento `org.renamed` y contrato Zod `RenameOrganizationRequestSchema`
- [X] T072 Web: sección "Ajustes de la organización" solo para owner; selector y cabeceras se actualizan al renombrar
- [X] T073 [P] ADR de la política de contraseñas 8–25 con la desviación de NIST 800-63B-4 y fila en el modelo de amenazas

---

## Dependencies & Execution Order

- Setup → Foundational → historias.
- US1 → US2 (el login necesita cuentas verificadas) → US3 (el aislamiento necesita sesión) → US4 y
  US5 (en paralelo) → US6 → Polish.
- Las pruebas de cada historia van antes de su implementación.

## Implementation Strategy (trunk-based, todo detrás de `identity-enabled`)

1. **PR 1**: Setup + Foundational + US1 (T001–T026). Registro y verificación funcionando con la UI.
2. **PR 2**: US2 + US3 (T027–T044). Login, sesiones, aislamiento y ping bajo organización.
3. **PR 3**: US4 + US5 (T045–T055). Contraseñas, miembros e invitaciones.
4. **PR 4**: US6 + Polish (T056–T063). Eventos, ADRs, modelo de amenazas y cierre.

Cada PR deja los pasos para probar en el navegador lo que entrega.
