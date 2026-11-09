# Data Model: Despliegue (F9)

> **Sin cambio de esquema** en la forma recomendada. F9 no añade tablas, columnas, `CHECK`, índices,
> triggers, políticas de RLS ni privilegios, y no hay migraciones nuevas. La única decisión que podría
> cambiar esto es **D10B** (tabla `audit_events`); si el autor la elige, se detiene la implementación, se
> documenta el modelo aquí y se pide aprobación antes de `tasks`, como exige F8.

## Qué toca cada decisión y por qué no necesita esquema

| Cambio                                                                          | Datos que usa                                                                                                       | Esquema |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| `trust proxy`, TLS de clientes, SMTP con auth, validación de producción         | Configuración y variables de entorno                                                                                | Ninguno |
| Temporal con almacén PostgreSQL (bases `temporal` y `temporal_visibility`, ver research T2)         | Bases nuevas en la misma instancia, creadas por la herramienta SQL de Temporal; **no** pasan por Drizzle ni por RLS | Ninguno en la base de la aplicación |
| Roles de PostgreSQL con contraseñas de producción                               | `app_migrator`, `app_runtime` (existentes) y un rol nuevo para Temporal; solo cambian las contraseñas               | Ninguno |
| Backups y restauración                                                          | Volcados de ambas bases y de los roles; objetos en el destino externo                                               | Ninguno |
| Retención y alertas de eventos de seguridad (D10A)                              | Líneas de log con tipo estable (ADR-0038); sin tabla                                                                | Ninguno |
| Métricas de costo y de disparos (D9, D20A)                                      | `llm_usage` (ya existe) y métricas de Temporal; solo lectura                                                        | Ninguno |
| Cron mínima (D21A)                                                              | `workflow_schedules.cron_expression` (existente); validación en la API y en el reconciliador                         | Ninguno |
| Staging                                                                         | Su propia instancia de PostgreSQL con datos sintéticos                                                              | Ninguno |
| SBOM, escaneo, registro, ZAP                                                    | Archivos y artefactos                                                                                               | Ninguno |

## Invariantes que F9 no debe romper

- RLS forzado con `app.organization_id` en todas las tablas con datos de organización; `app_runtime` sin
  `DELETE` ni `TRUNCATE`, sin `BYPASSRLS`. La restauración MUST comprobarlo (FR-020).
- Sin contenido en PostgreSQL (cuerpos, respuestas, mensajes, comentarios ni secretos en claro); las copias
  heredan esa propiedad.
- Migraciones compatibles hacia atrás (expand/contract): condición del rollback por digest (D17A).
- El contenido de entradas y salidas de los nodos vive en el historial de Temporal (ADR-0050): el almacén
  de Temporal entra en los backups y en la política de cifrado.

## Si D10 = B (tabla `audit_events`) — esquema provisional para que el autor lo apruebe

Solo se aplica con aprobación explícita. Propuesta mínima:

| Columna            | Tipo            | Regla                                                                                         |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| `id`               | `uuid`          | PK                                                                                            |
| `organization_id`  | `uuid`          | NOT NULL, FK; RLS forzada con `app.organization_id`                                           |
| `event`            | `text`          | `CHECK` contra la lista estable de ADR-0038                                                   |
| `actor_user_id`    | `uuid` o `NULL` | sin PII adicional                                                                             |
| `outcome`          | `text`          | `success` o `failure`                                                                         |
| `correlation_id`   | `uuid`          | NOT NULL                                                                                      |
| `created_at`       | `timestamptz`   | NOT NULL, `DEFAULT now()`                                                                     |

`app_runtime` solo `INSERT` y `SELECT`; sin `UPDATE` ni `DELETE`; índice `(organization_id, created_at)`;
retención por una tarea del migrador (no por la aplicación). Sin contenido de usuario ni IP.

## Datos que se leen por primera vez

Ninguno desde la aplicación. Los operadores leen los volcados de las bases durante la restauración y las
métricas del servidor de Temporal para D20A.
