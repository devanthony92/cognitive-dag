# Quickstart: validar F1

Contratos: [contracts/api.openapi.yaml](./contracts/api.openapi.yaml). Modelo:
[data-model.md](./data-model.md).

## Arranque

```bash
pnpm install
cp .env.example .env          # identity-enabled en true para desarrollo
docker compose up -d --wait   # + Mailpit en http://localhost:8025
pnpm db:migrate               # como app_migrator
pnpm dev
```

## Escenarios

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | Registrarse en la web con una contraseña de 15+ caracteres | Mensaje "revisa tu correo"; correo de verificación en Mailpit |
| 2 | US1 | Registrarse otra vez con el mismo email | Misma respuesta; el titular recibe un correo de aviso |
| 3 | US1 | Registrarse con `password123456789` (común) o con 14 caracteres | Rechazo con el motivo |
| 4 | US1 | Iniciar sesión sin verificar | "Credenciales inválidas" (igual que una contraseña errónea) |
| 5 | US1/US2 | Abrir el enlace del correo e iniciar sesión | Sesión iniciada; se ve la organización personal como owner |
| 6 | US2 | 6 intentos fallidos seguidos | Desde el 6.º, 429 `RATE_LIMITED` con `Retry-After` creciente |
| 7 | US2 | Petición que cambia estado sin `X-CSRF-Token` | 403 `CSRF_REJECTED` |
| 8 | US2 | Cerrar sesión y reutilizar la cookie anterior | 401 `UNAUTHENTICATED` |
| 9 | US2 | `docker compose restart valkey` con sesión iniciada | La siguiente petición exige iniciar sesión otra vez |
| 10 | US3 | Usuario A pide `/api/v1/organizations/<org de B>/members` | 404 `NOT_FOUND` |
| 11 | US3 | `pnpm --filter @cognitive-dag/db test:rls` | Como `app_runtime` sin contexto, 0 filas en todas las tablas; sin `DELETE` posible |
| 12 | US4 | Solicitar restablecimiento, usar el enlace, iniciar sesión con la nueva | Funciona; las sesiones anteriores quedan revocadas |
| 13 | US5 | Owner invita un email nuevo; la persona se registra desde el enlace | Queda como miembro con el rol invitado |
| 14 | US5 | Quitar al único owner o cambiarle el rol | 409 `LAST_OWNER` |
| 15 | US5 | Viewer intenta invitar | 403 `FORBIDDEN` |
| 16 | US6 | Revisar los logs del API tras los escenarios anteriores | Un evento por acción con `event`, `outcome`, `correlationId`; sin contraseñas ni tokens |
| 17 | FR-033 | `identity-enabled=false` | Endpoints de F1 404 `FEATURE_NOT_AVAILABLE`; la web oculta registro y login |

## Pruebas automatizadas

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration   # requiere Compose y migraciones aplicadas
```
