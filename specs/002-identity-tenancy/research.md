# Research: Identidad y multi-tenant (F1)

**Fecha**: 2026-10-29 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Versiones consultadas en npm y Docker Hub el 2026-10-29. Las publicadas hace menos de un día se
reemplazan por el parche anterior (política de pnpm, ADR-0020). Cada dependencia nueva lleva ADR.

## R1. Acceso a datos

- **Decision**: Drizzle ORM 0.45.4 + drizzle-kit 0.31.11 sobre el driver `pg` ya presente.
- **Rationale**: SQL explícito y tipado, migraciones versionadas generadas desde el esquema, y control
  directo de la transacción para fijar el contexto de RLS.
- **Alternatives considered**: Prisma (RLS solo con extensiones y transacciones envolventes),
  Kysely (sin migraciones integradas).

## R2. Identificadores

- **Decision**: UUID v7 generados por PostgreSQL 18 con la función nativa `uuidv7()` como valor por
  defecto.
- **Rationale**: no adivinables (A01) y ordenados por tiempo (índices B-tree compactos). Sin
  librería adicional.
- **Alternatives considered**: bigint (secuencial y enumerable), UUID v4 (índices fragmentados).

## R3. Borrado lógico

- **Decision**: columna `deleted_at timestamptz` en `users`, `organizations` y `memberships`. Las
  entidades con ciclo de vida propio usan su estado en vez de `deleted_at`: invitaciones (`status`),
  sesiones (`revoked_at`), tokens de un solo uso (`consumed_at`).
- **Consecuencias**:
  - Las restricciones de unicidad pasan a ser índices únicos parciales `WHERE deleted_at IS NULL`.
  - Las políticas de lectura de RLS excluyen filas borradas.
  - El rol de ejecución no tiene privilegio `DELETE` en ninguna tabla: el borrado lógico queda
    garantizado por la base de datos, no solo por el código.
  - Expulsar a un miembro marca su membresía como borrada; si vuelve, se crea una membresía nueva.
  - Retener datos personales de usuarios borrados exige una política de anonimización, que se define
    junto con la retención en F9.
- **Alternatives considered**: borrado físico (recomendado inicialmente; el autor eligió lógico).
- **Actualización (2026-10-29, opción A del autor)**: las políticas de RLS no filtran `deleted_at` en `users`,
  `organizations` y `memberships`; ver R8.

## R4. Contraseñas

- **Decision**: `argon2` 0.45.1 con Argon2id, parámetros mínimos de OWASP Password Storage Cheat
  Sheet (m = 19 MiB, t = 2, p = 1), revisables por configuración. Política: 15–128 caracteres,
  normalización Unicode NFKC, sin reglas de composición, rechazo contra una lista de 100 000
  contraseñas comunes incluida en el repo.
- **Rationale**: NIST 800-63B-4 para contraseña como único factor (decisión del autor).
- **Nota**: `argon2` trae binarios precompilados para linux-arm64 (glibc) y win32-x64; no necesita
  scripts de build.

## R5. Sesiones

- **Decision**: token opaco de 32 bytes aleatorios (`crypto.randomBytes`), entregado en la cookie
  `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). En base de datos solo se guarda
  `SHA-256(token)`.
- PostgreSQL (tabla `sessions`) es la fuente de verdad de revocación y vida absoluta (12 h).
  Valkey guarda `sess:<hash>` con TTL de 2 h que se renueva en cada petición: es la única fuente de
  la inactividad (decisión del autor: sin columna `last_seen_at`).
- Si la clave no existe en Valkey, la sesión se considera expirada y se revoca con `idle_timeout`,
  porque no se distingue la inactividad de un Valkey vaciado (fallo cerrado). Consecuencia aceptada:
  reiniciar Valkey cierra todas las sesiones.
- Si Valkey o PostgreSQL no responden, 503.
- **Desarrollo local**: el prefijo `__Host-` y `Secure` funcionan en `http://localhost` en navegadores
  actuales; si algún navegador lo impide, la cookie usa el nombre `session` solo cuando
  `NODE_ENV=development`.

## R6. CSRF

- **Decision**: token sincronizador por sesión. Se entrega en la respuesta de inicio de sesión y en
  `GET /api/v1/auth/session`, la SPA lo envía en el header `X-CSRF-Token` en toda petición que cambia
  estado y el API lo compara en tiempo constante con el hash guardado en la sesión. Además se
  verifica que `Origin` coincida con `WEB_ORIGIN`.
- **Alternatives considered**: double-submit cookie (más débil sin firma), solo `SameSite`
  (insuficiente como única defensa).

## R7. Organización activa

- **Decision**: en la ruta: `/api/v1/organizations/{organizationId}/...`. Un guard verifica la
  membresía y fija el contexto de RLS. El ping de F0 pasa a
  `/api/v1/organizations/{organizationId}/pings` (cambio de contrato documentado).
- **Rationale**: visible, cacheable y explícito; cada pestaña opera sobre su organización.
- **Alternatives considered**: header `X-Organization-Id` (invisible en logs de acceso y enlaces).

## R8. Aislamiento con Row-Level Security

- **Decision**: cada petición autenticada abre una transacción que fija
  `set_config('app.user_id', …, true)` y `set_config('app.organization_id', …, true)`. Las políticas
  comparan contra `current_setting('app.…', true)`. Todas las tablas usan `ENABLE` y
  `FORCE ROW LEVEL SECURITY`.
- Consultas previas a la autenticación (login por email, resolución de sesión por hash, tokens de un
  solo uso, invitaciones por token) usan claves de contexto específicas
  (`app.lookup_email`, `app.lookup_token_hash`) que solo el módulo de autenticación fija.
- **Soft delete y RLS (2026-10-29)**: PostgreSQL aplica la política `SELECT` también a la fila nueva de un
  `UPDATE` que lee columnas, así que una política con `deleted_at IS NULL` impide marcar `deleted_at`. Las
  políticas de `SELECT` de `users`, `organizations` y `memberships` no lo comprueban; el filtro vive en los
  selectores `active` de `packages/db` (regla de ESLint en `apps/api`).
- **Rationale**: RLS protege contra el olvido del filtro por organización en la aplicación
  (SC-003), sin funciones `SECURITY DEFINER` ni roles con `BYPASSRLS`.
- **Alternatives considered**: funciones `SECURITY DEFINER` para las consultas previas (requieren un
  rol con `BYPASSRLS` o dueño distinto, más superficie).

## R9. Roles de PostgreSQL

- **Decision**:
  - `app_migrator`: dueño del esquema y de las tablas; ejecuta las migraciones; nunca lo usa el API.
  - `app_runtime`: `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`; privilegios
    `SELECT`, `INSERT`, `UPDATE` por tabla, sin `DELETE` ni `TRUNCATE`; `INSERT` y `SELECT` solo en
    `audit_events`.
- Los roles se crean con un script de inicialización de Compose y con la primera migración en otros
  entornos.

## R10. Rate limit

- **Decision**: `rate-limiter-flexible` 11.2.3 sobre Valkey (cliente `iovalkey`). Login: contadores
  por cuenta (`SHA-256` del email) y por IP; desde el 5.º fallo en 15 min, espera que se duplica de
  1 s a 15 min. Registro, reenvío, restablecimiento e invitaciones: límites fijos por IP y por email.
- Si Valkey no responde, el login falla cerrado (503).

## R11. Correo

- **Decision**: interfaz `Mailer` con implementación SMTP sobre `nodemailer` 10.2.1 (10.3.x tiene
  menos de un día). Desarrollo: Mailpit `axllent/mailpit:v1.32.0` en Compose (SMTP `:1025`, UI
  `:8025`, solo `127.0.0.1`). Los envíos se hacen tras confirmar la transacción y se reintentan con
  backoff; los fallos se registran sin cambiar la respuesta al usuario.
- **Plantillas**: texto plano y HTML simples, en español, sin recursos externos.

## R12. Igualar tiempos de respuesta (SC-004)

- **Decision**: ante un email inexistente en el login se calcula igualmente un hash Argon2id contra un
  hash ficticio; registro y restablecimiento responden tras encolar el correo, nunca tras enviarlo.

## R13. Frontend

- **Decision**: TanStack Router 1.170 (rutas tipadas, `beforeLoad` para proteger rutas) con su plugin
  de Vite para rutas por archivo; React Hook Form 7.91 + `@hookform/resolvers` 6.0.2 con los esquemas
  Zod de `packages/contracts`; Tailwind CSS 4.3 (`@tailwindcss/vite`) + componentes shadcn/ui copiados
  en `apps/web/src/components/ui`.
- El cliente HTTP envía `credentials: 'include'` y el header `X-CSRF-Token`.

## R14. Feature flag de entrega

- **Decision**: flag `identity-enabled` (default `false`, `true` en `.env.example`). Con el flag
  apagado, los endpoints de F1 responden 404 `FEATURE_NOT_AVAILABLE` y la web oculta las pantallas.
  Los controles de seguridad (exigir sesión en el ping, RLS) se activan cuando el flag se enciende y
  nunca se desactivan una vez encendido en un entorno.
- Issue de eliminación al cerrar F1.

## R15. Eventos de seguridad

- **Decision**: sin tabla de auditoría en F1 (decisión del autor). Los eventos de FR-026 se emiten
  como logs estructurados con un campo `event` estable, `outcome`, `userId`, `organizationId`, `ip` y
  `correlationId`, a través de un `SecurityEventLogger` único. La consulta por owners (antes US6) se
  difiere.
- **Consecuencia**: OWASP A09 se cubre con logs; la evidencia para el owner llega cuando exista la
  tabla.

## R16. Pruebas

- Unitarias: política de contraseñas, hashing de tokens, cálculo de esperas progresivas, guards.
- Integración (Compose compartido): flujos completos con Mailpit (API HTTP de Mailpit para leer
  correos), pruebas de acceso cruzado por endpoint (SC-002), pruebas de RLS conectando como
  `app_runtime` sin contexto de organización (SC-003), medición de tiempos anti-enumeración (SC-004)
  y captura de los eventos de seguridad con un logger de prueba (SC-007).
- Web: pruebas de componentes de formularios y de rutas protegidas.
- Aislamiento entre corridas: emails y nombres de organización con sufijo aleatorio.
