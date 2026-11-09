---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# PostgreSQL y Valkey con TLS y ACL, y una PKI interna con openssl

## Contexto y problema

En desarrollo PostgreSQL y Valkey aceptan conexiones sin TLS y con contraseñas del repositorio (R9). La aplicación ya exige en producción `sslmode=verify-full`, `rediss://`, un usuario de ACL y mTLS con Temporal (PR 1). Faltan los servicios que lo cumplan y los certificados con que hacerlo.

## Opciones consideradas

- Certificados públicos (Let's Encrypt) para los servicios internos: sin nombres públicos, sin necesidad.
- Sin TLS interno porque la red es privada: descartada, FR-009 y FR-010 lo exigen.
- CA interna con `openssl` (elegida, D8A): sin dependencias nuevas y con vigencias propias.

## Decisión

### PKI (`deploy/provision/pki.sh`)

- **CA** de curva P-256 con 5 años de vigencia y **hojas** de 90 días: PostgreSQL, Valkey, servidor de Temporal (`serverAuth` y `clientAuth`) y tres clientes de Temporal (API, worker, UI y tarea de inicio). Cada una con su nombre en `subjectAltName`, que es el que verifican los clientes.
- Comandos: `pki.sh init <dir> [--ca-key <archivo>] [--key-mode <octal>]`, `pki.sh rotate <dir> --ca-key <archivo>` y `pki.sh status <dir> [--min-days <n>]` (falla si algo vence antes; lo usará la alerta de certificado de la PR 4).
- **La clave de la CA no queda junto a las hojas:** va al archivo de `--ca-key` (por defecto `<dir>/../ca-private/ca.key`). En la VM la PR 4 la guarda en OCI Vault, la trae solo para `rotate` y la borra después (D8A). El script no imprime claves ni contraseñas.
- **Rotación:** `rotate` emite todas las hojas de nuevo con claves nuevas y la misma CA; luego se reinician `postgres`, `valkey`, `temporal`, `api`, `worker` y `temporal-ui`, en ese orden. Hojas cada 90 días y CA cada 5 años (`contracts/production-env.md`); si la CA vence, se crea una nueva con `init` en un directorio vacío y se reemplaza `ca.crt` en los clientes.
- Las claves de las hojas son `0600` por defecto. Los contenedores las leen por _bind mount_ con otros usuarios (999, 1000, 10001) y Compose no aplica `uid`, `gid` ni `mode` a secretos de archivo, así que el despliegue pasa `--key-mode 0444` y mantiene el directorio en `0700`. Los certificados y claves generados nunca se versionan: las pruebas los crean en tiempo de ejecución.

### PostgreSQL (`deploy/postgres/`)

- `postgresql.conf`: `ssl = on` con TLS 1.3 como mínimo, `password_encryption = scram-sha-256` y tamaños para 768 MB.
- `pg_hba.conf`: solo líneas `hostssl` (más `local` para el propio contenedor): `app_runtime` y `app_migrator` a `cognitive_dag`, `temporal` a sus dos bases, todo con `scram-sha-256`. No hay `host`, `trust` ni acceso del superusuario por red. Una conexión sin TLS no encuentra entrada y se rechaza.
- `init-roles.sh` sustituye en producción al `01-roles.sql` de desarrollo: crea `app_migrator`, `app_runtime` (sin `BYPASSRLS`) y `temporal` con contraseñas leídas de archivos de secreto, que llegan a `psql` por el entorno y no por argumentos.
- PostgreSQL rechaza una clave privada con permisos de grupo o de otros, así que `entrypoint.sh` la copia a un `tmpfs` con modo `0600` antes de arrancar.

### Valkey (`deploy/valkey/`)

- `port 0` y `tls-port 6379`; los clientes verifican el servidor con la CA y se autentican con un usuario de ACL (no se pide certificado de cliente).
- **ACL:** `user default off` y un único usuario `cognitive_dag_app` con exactamente los comandos que fija `apps/api/test/integration/valkey-acl.test.ts` (`VALKEY_ALLOWED_COMMANDS`) y solo el canal `run:*`. `entrypoint.sh` genera el archivo de ACL al arrancar en un `tmpfs` con el SHA-256 de la contraseña, así que no se versiona ningún valor. Una prueba compara la lista del script con la de la prueba de la aplicación: un comando nuevo en el código falla ahí.
- `maxmemory 128mb` dentro del límite de 192 MB del contenedor y `maxmemory-policy noeviction`: con la memoria llena la API falla cerrada (503) en lugar de perder claves de límites o sesiones. Sin persistencia: son caché, límites y eventos.

### Redes y secretos

- `backend` es una red `internal` (sin salida): PostgreSQL, Valkey y Temporal solo viven ahí y no publican puertos. `front` (con la subred de Caddy fija para `TRUSTED_PROXIES`) lleva Caddy y los servicios que necesitan salir (correo, LLM, nodos HTTP).
- Todos los secretos son archivos bajo `/run/secrets`; ninguna contraseña ni clave está en el Compose ni en el repositorio (`gitleaks` revisa todo el historial).

## Consecuencias

- Bueno: ninguna conexión de datos va en claro ni con credenciales de desarrollo, y `deploy-security.test.ts` lo demuestra en cada ejecución de integración, en amd64 y arm64.
- Malo: hay que rotar hojas cada 90 días con reinicio ordenado; las claves legibles por todos dentro del contenedor dependen de que el directorio del anfitrión sea `0700` y de que los secretos vivan en `tmpfs` (PR 4); la contraseña de la base de Temporal tiene un alfabeto restringido.

## Confirmación

`scripts/test/integration/deploy-security.test.ts` (rechazo sin TLS y sin credenciales, rechazo de una contraseña de desarrollo, aceptación de las credenciales de la prueba, ACL con `NOPERM`) y `scripts/test/unit/deploy-config.test.ts` (`pg_hba.conf` solo `hostssl`, `port 0`, `noeviction`, lista de comandos, sin contraseñas en los archivos).

## Enlaces

- Decisión D8A en `specs/010-deployment/research.md`; FR-009, FR-010, FR-013; ADR-0091.
