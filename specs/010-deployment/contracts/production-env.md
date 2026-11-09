# Contrato de configuración de producción

Solo **nombres**, origen y reglas. **No hay valores** en el repositorio (principio I; gitleaks escanea
todo el historial). Los nombres marcados *(nuevo)* son los que F9 añade al esquema de configuración Zod
(`apps/api/src/config/env.schema.ts` y el del worker). Convención propuesta: una variable `NOMBRE_FILE`
apunta a un archivo de secreto montado de solo lectura; el esquema lee el archivo y la variable directa
queda prohibida en producción.

## Reglas de arranque en producción (FR-012)

`NODE_ENV=production` ⇒ el proceso termina nombrando solo las variables si:

| Condición                                                                                | Variables nombradas                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| La URL de PostgreSQL no exige TLS con verificación completa                              | `DATABASE_URL`                                                |
| La URL de Valkey no usa `rediss://`                                                      | `VALKEY_URL`                                                  |
| Falta la configuración TLS de Temporal                                                   | `TEMPORAL_TLS_CA_FILE`, `TEMPORAL_TLS_CERT_FILE`, `TEMPORAL_TLS_KEY_FILE` |
| Una contraseña o clave coincide con un valor de desarrollo conocido                      | la variable afectada (nunca el valor)                          |
| Falta `CREDENTIALS_MASTER_KEY`                                                           | `CREDENTIALS_MASTER_KEY`                                      |
| `WEB_ORIGIN` o `API_PUBLIC_URL` no son `https://`                                        | `WEB_ORIGIN`, `API_PUBLIC_URL`                                |
| El SMTP no ofrece TLS o falta autenticación                                              | `SMTP_SECURE`, `SMTP_USER_FILE`, `SMTP_PASSWORD_FILE`          |
| `LLM_PROVIDER=gemini` sin clave                                                          | `GEMINI_API_KEY_FILE`                                         |

## Variables nuevas *(nuevo)* y modificadas

| Variable                                              | Lee         | Origen                    | Regla                                                                       |
| ----------------------------------------------------- | ----------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `TRUSTED_PROXIES`                                     | API         | configuración (no secreto)         | Lista cerrada de CIDR del salto de Caddy; vacía = no se confía en `X-Forwarded-For` |
| `TEMPORAL_TLS_CA_FILE`, `TEMPORAL_TLS_CERT_FILE`, `TEMPORAL_TLS_KEY_FILE`, `TEMPORAL_TLS_SERVER_NAME` | API, worker | secreto (clave) y PKI interna      | mTLS con el frontend de Temporal                                             |
| `DATABASE_URL`, `DATABASE_MIGRATOR_URL`               | API, worker, migrator | secreto (contraseña vía archivo) | `sslmode=verify-full` y CA de la PKI interna; la contraseña no va en la URL versionada |
| `VALKEY_URL`, `VALKEY_CA_FILE`, `VALKEY_USERNAME`, `VALKEY_PASSWORD_FILE` | API, worker | secreto                            | `rediss://` y ACL                                                            |
| `SMTP_SECURE`, `SMTP_USER_FILE`, `SMTP_PASSWORD_FILE` | API         | secreto (entregado por el autor)   | TLS obligatorio en producción                                                |
| `API_PUBLIC_URL`, `WEB_ORIGIN`, `APP_BASE_URL`        | API         | configuración                      | Mismo origen `https://<dominio>` (D6A)                                       |
| `GEMINI_API_KEY_FILE`                                 | worker, API | secreto (entregado por el autor)   | Clave de la capa gratuita (D13C); solo datos de prueba                       |
| `REGISTRATION_ENABLED` *(solo si D23B)*               | API         | configuración                      | Kill switch de operación; con D23A no existe y Caddy cierra la ruta           |
| `CREDENTIALS_MASTER_KEY_FILE`                         | API, worker | secreto generado en la VM          | Con copia cifrada fuera de la VM                                             |
| `LLM_ENABLED`, `TRIGGERS_ENABLED`, `HTTP_ENABLED`     | worker      | configuración                      | Kill switches; se documentan en la guía de operación                         |

## Secretos en OCI Vault (D4B) — nombre, generador y copia

| Secreto                                     | Genera              | Copia fuera de Oracle                        | Rotación                                         |
| ------------------------------------------- | ------------------- | -------------------------------------------- | ------------------------------------------------ |
| Contraseñas de `app_runtime`, `app_migrator` y del rol de Temporal | la VM (aleatorias)  | cifrada, en el gestor del autor              | Procedimiento con reinicio ordenado              |
| Contraseña del usuario ACL de Valkey        | la VM               | ídem                                         | ídem                                             |
| CA interna (clave) y certificados           | la VM (`pki.sh`)    | clave de la CA cifrada                       | Hojas cada 90 días; CA cada 5 años               |
| `CREDENTIALS_MASTER_KEY`                    | la VM               | cifrada, **distinta** de la de los backups   | Fuera de alcance (rotación diferida)             |
| Clave de Gemini (capa gratuita)             | el autor            | el proveedor la puede regenerar              | Regenerar en el proveedor y reiniciar el worker  |
| Credenciales SMTP                           | el autor (P5)       | el proveedor las puede regenerar             | ídem                                             |

## Reglas

- Los archivos de entorno versionados (`deploy/env/*.example`) llevan solo nombres y comentarios. Ningún
  valor con forma de secreto, tampoco de ejemplo.
- `docker inspect` solo muestra rutas, no valores. Ninguna imagen contiene `.env`.
- Los secretos viven en OCI Vault y la VM solo los lee; se vuelcan a `tmpfs` al arrancar. Sin backups (D5), lo que no se pueda regenerar tiene su copia en el gestor del autor (P8).
