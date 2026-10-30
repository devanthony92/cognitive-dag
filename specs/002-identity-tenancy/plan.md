# Implementation Plan: Identidad y multi-tenant (F1)

**Branch**: `002-identity-tenancy` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-identity-tenancy/spec.md`

## Summary

Cuentas con verificación de email, sesiones opacas en cookie con CSRF y rate limit progresivo,
organizaciones con membresías y roles, invitaciones y aislamiento entre organizaciones en dos capas:
guards de NestJS y Row-Level Security de PostgreSQL con un rol de ejecución sin privilegios para
saltarlo ni borrar filas (borrado lógico). La web suma router, formularios y un sistema de
componentes. Todo F1 queda detrás del flag `identity-enabled` hasta completarse. Decisiones en
[research.md](./research.md); esquema aprobado por el autor en [data-model.md](./data-model.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: las de F0 más Drizzle ORM 0.45.4 y drizzle-kit 0.31.11, argon2 0.45.1,
rate-limiter-flexible 11.2.3, nodemailer 10.2.1; en la web TanStack Router 1.170, React Hook Form
7.91 con `@hookform/resolvers` 6.0.2, Tailwind CSS 4.3 y componentes shadcn/ui

**Storage**: PostgreSQL 18 (6 tablas, RLS forzado, `uuidv7()`), Valkey 9 (sesiones e inactividad,
rate limit); Mailpit v1.32.0 en desarrollo

**Testing**: Vitest; integración contra Compose compartido (incluye Mailpit y su API HTTP); pruebas
de RLS conectando como `app_runtime`

**Target Platform**: igual que F0 (Linux amd64/arm64 en contenedores; desarrollo en Windows,
Linux y macOS)

**Project Type**: aplicación web (SPA + API + worker) en monorepo

**Performance Goals**: login < 1 s p95 excluyendo esperas de rate limit; diferencia de tiempo
medio < 50 ms entre email existente e inexistente (SC-004)

**Constraints**: fallo cerrado si PostgreSQL o Valkey no responden; ningún token ni identificador de
sesión en claro en base de datos, logs o URLs; `app_runtime` sin `DELETE`, `TRUNCATE` ni `BYPASSRLS`

**Scale/Scope**: 6 tablas, ~20 endpoints, ~10 pantallas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento en F1 | Estado |
|---|---|---|
| I. Seguridad por defecto | Tabla OWASP de la spec; aislamiento en dos capas; fallo cerrado; tokens solo como hash; sin secretos reales en el repo | PASS |
| II. Resiliencia explícita | Timeouts en PostgreSQL, Valkey y SMTP; reintentos del correo con backoff tras confirmar la transacción | PASS |
| III. Pruebas primero | TDD obligatorio en **reglas de autorización** (guards, políticas RLS, invariante de owner); pruebas de acceso cruzado por endpoint | PASS |
| IV. Contratos tipados | Esquemas Zod nuevos en `packages/contracts`, compartidos con los formularios de la web | PASS |
| V. Errores RFC 9457 | 9 códigos nuevos; `retryAfterSeconds` como extensión en 429 | PASS |
| VI. Correlation-ID | Presente en eventos de seguridad, correos (cabecera) y logs | PASS |
| VII. Simplicidad | ADRs nuevos para cada dependencia y para las decisiones del modelo de datos | PASS |
| VIII. Feature flags | `identity-enabled`; encenderlo nunca desactiva controles; issue de eliminación | PASS |
| IX. Idioma | UI y errores en español; código y README en inglés | PASS |

**Re-check post-diseño**: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-identity-tenancy/
├── spec.md
├── plan.md
├── research.md
├── data-model.md        # aprobado por el autor
├── quickstart.md
├── contracts/api.openapi.yaml
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── contracts/src/
│   ├── auth.ts               # registro, login, sesión, contraseñas, tokens
│   ├── organizations.ts      # organizaciones, miembros, invitaciones, roles
│   └── problem.ts            # códigos nuevos y retryAfterSeconds
└── db/                       # NUEVO
    ├── src/schema/*.ts       # tablas Drizzle según data-model.md
    ├── src/tenant.ts         # withTenantContext(): transacción + set_config
    ├── migrations/           # SQL generado por drizzle-kit + SQL manual de RLS, roles y triggers
    └── drizzle.config.ts
apps/api/src/
├── auth/                     # registro, verificación, login, logout, sesión, contraseñas
│   ├── session.service.ts    # PostgreSQL + Valkey, rotación, revocación
│   ├── csrf.guard.ts
│   ├── session.guard.ts
│   └── password-policy.ts    # 8–25, NFKC, lista de comunes
├── organizations/            # organizaciones, miembros, invitaciones
│   └── organization.guard.ts # membresía + rol + contexto RLS
├── rate-limit/
├── mail/                     # interfaz Mailer + SMTP + plantillas
├── security-events/          # SecurityEventLogger
└── ping/                     # pasa a /organizations/{id}/pings
apps/web/src/
├── routes/                   # TanStack Router (registro, login, verificación, recuperación, cuenta, organizaciones)
├── components/ui/            # shadcn/ui
├── features/{auth,organizations,ping}/
└── api/client.ts             # credentials + X-CSRF-Token
infra/postgres/init/          # creación de roles app_migrator y app_runtime para Compose
compose.yaml                  # + Mailpit
```

**Structure Decision**: nuevo paquete `packages/db` con el esquema y las migraciones, usado por el
API y por las pruebas de RLS; el worker no accede a la base de datos en F1.

## Complexity Tracking

| Decisión | Motivo | Alternativa más simple descartada |
|---|---|---|
| Nuevo paquete `packages/db` | Las pruebas de RLS y futuras apps comparten esquema y migraciones | Esquema dentro de `apps/api` (las pruebas de RLS dependerían del API) |
| Dos roles de PostgreSQL | RLS no aplica al dueño de las tablas; FR-020 | Un solo rol (RLS sin efecto real) |
| Claves de contexto de búsqueda previas a la autenticación | Login y tokens se consultan antes de conocer al usuario | Funciones `SECURITY DEFINER` con un rol `BYPASSRLS` |
| Sin tabla de auditoría, inactividad solo en Valkey | Decisiones del autor al revisar el modelo | — |
