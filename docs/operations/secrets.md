# Secretos en OCI Vault y rotación

Decisión D4B, ADR-0093. Los secretos de producción viven en **OCI Vault** con el prefijo `cdag-`. La VM
los lee con su identidad de instancia (`--auth instance_principal`, sin llaves de API en el disco) y los
deja en `tmpfs`; el operador los carga desde su máquina (la VM no puede escribir en el Vault).

## Dónde está cada cosa

| Qué                               | Dónde                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valor de cada secreto             | Vault, secreto `cdag-<nombre>`                                                                                                                                                                                                   |
| Archivos de los secretos en la VM | `/run/cognitive-dag/secrets/<nombre>` (`tmpfs`; directorio `0700`, archivos `0444`, también `pki/ca.crt` y las claves de las hojas; `ocir_pull_token` `0400`; `fetch` falla si un archivo montado no lo puede leer otro usuario) |
| Certificados internos             | `/run/cognitive-dag/pki/` (`tmpfs`; la clave de la CA **no** queda en la VM)                                                                                                                                                     |
| Config no secreta                 | `/etc/cognitive-dag/cognitive-dag.env` y `local.env`                                                                                                                                                                             |

Nada secreto se imprime, se versiona ni se escribe en disco. `docker inspect` solo muestra rutas
(`*_FILE`), nunca valores. Si el Vault no responde al arrancar, `cognitive-dag-secrets.service` falla y no
deja nada: la pila no arranca con valores viejos.

## Los 12 secretos

| Nombre                                                                  | Origen                      | Quién lo usa                                        | Copia del autor fuera de Oracle |
| ----------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- | ------------------------------- |
| `postgres_superuser_password`                                           | generado (`init-generated`) | PostgreSQL                                          | cifrada                         |
| `app_migrator_password`, `app_runtime_password`, `temporal_db_password` | generado                    | PostgreSQL, migrator, API, worker, Temporal         | cifrada                         |
| `valkey_password`                                                       | generado                    | Valkey, API, worker                                 | cifrada                         |
| `credentials_master_key`                                                | generado                    | API, worker (cifrado de credenciales de conectores) | cifrada, **obligatoria**        |
| `pki_ca_key`, `pki_ca_crt`                                              | generado (CA propia)        | solo `secrets.sh fetch`, para firmar las hojas      | clave de la CA cifrada          |
| `gemini_api_key`                                                        | el autor                    | worker                                              | el proveedor la regenera        |
| `smtp_user`, `smtp_password`                                            | el autor (Oracle)           | API, worker, alertas                                | Oracle las regenera             |
| `ocir_pull_token`                                                       | el autor (Oracle)           | `docker login` del despliegue                       | Oracle lo regenera              |

Las contraseñas generadas son 48 caracteres hexadecimales (alfabeto seguro para el `sed` de Temporal y
para `psql`); la clave maestra son 32 bytes en base64, como `pnpm credentials:gen-key`.

## Cargar y consultar (desde tu máquina)

```bash
deploy/provision/secrets.sh init-generated     # crea lo generado; nunca pisa un secreto que ya existe
deploy/provision/secrets.sh put <nombre>       # nueva versión; el valor se lee de la entrada estándar
deploy/provision/secrets.sh list               # present / MISSING por nombre
```

El valor llega a la CLI de OCI como argumento en base64, visible un instante para los procesos de tu
usuario: hazlo en una máquina que solo uses tú. El script no imprime el valor ni su base64.

## Rotar un secreto

Regla general: cambia el valor en el Vault, vuelca de nuevo en la VM y **recrea** los contenedores que lo
leen (un archivo enlazado conserva el contenido viejo hasta que el contenedor se recrea).

```bash
# en la VM
sudo systemctl restart cognitive-dag-secrets
/opt/cognitive-dag/deploy/ops/compose.sh up -d --force-recreate <servicios>
/opt/cognitive-dag/deploy/ops/doctor.sh
```

| Secreto                         | Procedimiento                                                                                                                                                                        | Servicios a recrear (en orden)                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `gemini_api_key`                | Regenera la clave en el proveedor, `put gemini_api_key`                                                                                                                              | `worker`                                                     |
| `smtp_user`, `smtp_password`    | Regenera las credenciales SMTP en Oracle, `put` de ambas                                                                                                                             | `api`, `worker` (las alertas leen el archivo en cada pasada) |
| `ocir_pull_token`               | Genera un token nuevo del usuario `vm-ocir-pull`, `put ocir_pull_token`                                                                                                              | ninguno; el próximo despliegue lo usa                        |
| `valkey_password`               | `put valkey_password` con 48 hexadecimales nuevos (`openssl rand -hex 24`)                                                                                                           | `valkey`, `api`, `worker`                                    |
| Contraseña de un rol de la base | Ver «Contraseña de un rol de la base» abajo                                                                                                                                          | `api`, `worker` (y `temporal` si es `temporal_db_password`)  |
| `postgres_superuser_password`   | Solo se usa al inicializar un volumen vacío; el superusuario entra por socket local (`peer`). Rotar el valor del Vault no cambia el rol: hazlo con `ALTER ROLE postgres` como arriba | —                                                            |
| `credentials_master_key`        | **No se rota** en F9 (rotación diferida). Cambiarla deja ilegibles las credenciales cifradas                                                                                         | —                                                            |

### Contraseña de un rol de la base

El Vault solo cambia el archivo; el rol de PostgreSQL se cambia a la vez. La contraseña viaja por la
entrada estándar, nunca como argumento (son hexadecimales: no llevan comillas). Ejemplo con `app_runtime`:

```bash
# 1. desde tu máquina:  openssl rand -hex 24 | deploy/provision/secrets.sh put app_runtime_password
# 2. en la VM, como cdag-deploy:
sudo systemctl restart cognitive-dag-secrets
sudo sh -c 'printf "ALTER ROLE app_runtime PASSWORD '"'"'%s'"'"';\n" "$(cat /run/cognitive-dag/secrets/app_runtime_password)"' \
  | /opt/cognitive-dag/deploy/ops/compose.sh exec -T postgres psql -U postgres -d cognitive_dag
/opt/cognitive-dag/deploy/ops/compose.sh up -d --force-recreate api worker
```

Entre el paso de `ALTER ROLE` y la recreación la API falla al abrir conexiones nuevas: es un corte corto.
Este procedimiento no se ha medido en una VM real: se prueba la primera vez con el servicio sin uso y se
corrige aquí.

## Certificados internos (PKI, ADR-0092)

La CA vale 5 años y las hojas 90 días. **Cada vez que se ejecuta `secrets.sh fetch` se emiten hojas nuevas**
(al arrancar la VM o con `systemctl restart cognitive-dag-secrets`), con la clave de la CA traída del Vault
solo mientras dura el comando. `alerts.sh` avisa cuando una hoja vence en menos de 30 días.

Rotación de hojas (cada ~60 días, o al recibir la alerta):

```bash
sudo systemctl restart cognitive-dag-secrets
cd /opt/cognitive-dag
# En este orden: cada servicio debe ver los certificados nuevos antes que sus clientes.
deploy/ops/compose.sh up -d --force-recreate postgres valkey temporal
deploy/ops/compose.sh up -d --force-recreate api worker temporal-ui
deploy/ops/doctor.sh      # «internal certificates» sin «EXPIRING»
```

Si la CA está a punto de vencer: crea una CA nueva con `pki.sh init` en un directorio vacío, carga su
clave y su certificado con `secrets.sh put pki_ca_key` y `put pki_ca_crt`, y recrea toda la pila.

## Si un secreto se pierde o se filtra

- Se filtra: rótalo de inmediato (tabla anterior) y revisa los registros de acceso de SSH y de Caddy.
- Se pierde del Vault: los generados se vuelven a crear con `init-generated` (las contraseñas de la base
  exigen `ALTER ROLE`, y una clave maestra nueva deja ilegibles las credenciales de los conectores);
  `gemini_api_key`, `smtp_*` y `ocir_pull_token` los repone el autor desde cada proveedor.
