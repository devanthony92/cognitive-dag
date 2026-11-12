---
status: accepted
date: 2026-11-12
decision-makers: autor
---

# Configuración de los servicios con estado en rutas estables, con etiqueta de hash

## Contexto y problema

Desde que `deploy.sh` exporta `deploy/` de cada commit a `state/releases/<sha>` ([ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md)), `compose.prod.yaml` montaba la configuración de Valkey, PostgreSQL y Temporal con rutas relativas a esa copia. La ruta de origen del montaje cambia con cada SHA, así que Compose recreaba esos tres contenedores en **cada** despliegue aunque el contenido fuera idéntico. Valkey guarda `/data` en `tmpfs` sin persistencia (decisión de seguridad que se mantiene), de modo que cada _merge_ a `main` cerraba las sesiones de todos los usuarios, y PostgreSQL y Temporal se reiniciaban sin motivo (502 y 503 durante el despliegue). Además, al montar archivos sueltos, Temporal siguió leyendo un `dynamicconfig.yaml` viejo tras un cambio.

## Opciones consideradas

- Persistir Valkey en disco: las sesiones sobrevivirían, pero se guardarían en claro fuera del `tmpfs`; contradice la decisión de seguridad.
- Dejar de exportar la copia por commit y montar desde el _checkout_: vuelve el problema de ADR-0094 (el compose cambia bajo el script en marcha).
- Montar desde un enlace simbólico estable: Docker lo resuelve al crear el contenedor y la ruta de origen guardada sigue cambiando.
- **Copiar la configuración a `$CDAG_STATE/config/<servicio>/`, montar ese directorio y poner su hash como etiqueta (elegida).**

## Decisión

- `deploy.sh`, `rollback.sh` y `deploy.sh --resume` copian `deploy/valkey/`, `deploy/postgres/` y `deploy/temporal/` de la versión que van a correr a `/var/lib/cognitive-dag/config/<servicio>/` (`SERVICE_CONFIG_DIR` en `lib.sh`), solo si el contenido difiere. La copia se arma aparte y se renombra, así que nunca queda un directorio a medias; los archivos quedan legibles por los usuarios de los contenedores y no hay nada secreto (los secretos siguen en el `tmpfs`).
- `compose()` exporta `<SERVICIO>_CONFIG_DIR` (ruta estable) y `<SERVICIO>_CONFIG_HASH` (SHA-256 de nombres y contenido del directorio instalado). `compose.prod.yaml` monta **directorios**, no archivos sueltos, en `/etc/cdag/<servicio>` y pone `cdag.config-hash: ${<SERVICIO>_CONFIG_HASH}` como etiqueta. Compose recrea un servicio solo si cambia su imagen, su definición o ese hash.
- Las rutas internas (`entrypoint`, `config_file`, `hba_file`, `dynamicconfig`, plantilla de Temporal) leen dentro de `/etc/cdag/<servicio>`. Los _scripts_ de `initdb` de PostgreSQL pasan a `deploy/postgres/initdb/`, montado como `/docker-entrypoint-initdb.d`, para que no se ejecute ahí el resto de archivos del directorio.
- Una reversa o un despliegue que revierte reinstala la configuración de la versión a la que vuelve, y con ella su hash.
- `api`, `worker`, `edge` y `migrator` no cambian: se recrean por su imagen, que es lo esperado.

## Consecuencias

- Bueno: un despliegue sin cambios de configuración deja Valkey, PostgreSQL y Temporal en marcha; las sesiones sobreviven y no hay 502 por reinicios de datos.
- Bueno: un cambio real de configuración (por ejemplo `dynamicconfig.yaml`) recrea ese servicio y solo ese, así que ya no queda configuración vieja montada.
- Malo: el primer despliegue tras este cambio recrea los tres servicios una última vez (cambia la ruta de montaje) y cierra las sesiones una vez.
- Malo: un cambio de configuración de Valkey sigue cerrando las sesiones (se recrea con `/data` en `tmpfs`); es raro y deliberado.

## Confirmación

`scripts/test/unit/deploy-scripts.test.ts`: dos despliegues sin cambios de configuración dan la misma ruta y el mismo hash para los tres servicios; un cambio en `valkey.conf` cambia solo el hash de Valkey; la reversa, el despliegue que revierte y `--resume` restauran la configuración y su hash. `deploy-config.test.ts` fija que ningún servicio con estado monte archivos por ruta relativa.
