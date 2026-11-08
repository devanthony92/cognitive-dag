# Data Model: Endurecimiento (F8)

> **Sin cambios de esquema.** F8 no añade tablas, columnas, `CHECK`, índices, triggers, políticas de
> RLS ni privilegios, y no hay migraciones nuevas. Por eso no hay un modelo que el autor deba aprobar
> antes de `tasks`; si durante la implementación alguna tarea necesitara un cambio de esquema, se
> detiene, se documenta aquí y se pide aprobación antes de continuar.

## Qué toca cada decisión y por qué no necesita esquema

| Cambio | Datos que usa | Esquema |
|---|---|---|
| Solo owner y editor ejecutan (R2) | `memberships.role`, leído en cada petición por `OrganizationGuard` | Ninguno |
| Compilador con nodos de F7 (R3) | Catálogo en `packages/dag-schema` (código); `compilations` sin cambios | Ninguno |
| Eliminar los ocho flags (R4) | Los flags viven en el cliente de OpenFeature y en `.env`, no en la base | Ninguno |
| Tope de intentos del reconciliador (R6) | `workflow_schedules.sync_attempts` (smallint, ya existe), `sync_status` con `failed` y `last_error_code` ya existentes | Ninguno |
| Eventos `approval.timed_out`, `circuit.closed`, `schedule.caught_up` (R6) | Eventos de seguridad como logs (ADR-0038); sin tabla | Ninguno |
| Matriz de evidencia, ZAP y modelo de amenazas (R1, R5, R8) | Archivos de documentación y scripts | Ninguno |

## Invariantes que F8 no debe romper

- RLS forzado con `app.organization_id` en todas las tablas con datos de organización; `app_runtime`
  sin `DELETE` ni `TRUNCATE`.
- Sin contenido en PostgreSQL (cuerpos, respuestas, mensajes, comentarios ni secretos en claro).
- Migraciones compatibles hacia atrás (expand/contract): al no haber migraciones, las ejecuciones
  antiguas con fase `F7` o iniciadas por un viewer siguen siendo legibles.

## Datos que se leen por primera vez

Ninguno. La reflexión de R2 lee metadatos de Nest, no datos.
