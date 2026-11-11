# Guía de operación (F9)

Cómo se despliega, se opera y se da de baja la demo de CognitiveDAG en una VM de Oracle Cloud Always
Free. Lo decidido y su razón están en los ADR-0089 a 0096; esta guía es el «cómo». Cada procedimiento
termina con un comando que comprueba que funcionó (FR-038).

> **Aviso de datos:** no hay copias de seguridad (ADR-0094, constitución 1.1.0). La demo solo admite datos
> de prueba y el registro de cuentas está cerrado. Perder la VM es perder los datos.

## Documentos

| Documento                              | Para qué                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| [oracle.md](./oracle.md)               | La infraestructura de Oracle: instancia, red, IP, Vault, política, OCIR y correo |
| [provisioning.md](./provisioning.md)   | Aprovisionar la VM y hacer el primer despliegue, en orden                        |
| [secrets.md](./secrets.md)             | Secretos en OCI Vault: carga, rotación de cada uno y certificados internos       |
| [deploy.md](./deploy.md)               | Despliegue automático, reversa, volcados previos y qué hacer si falla            |
| [alerts.md](./alerts.md)               | Registros (90 días), alertas por correo, respuesta a cada una y su prueba        |
| [temporal-ui.md](./temporal-ui.md)     | Acceso a la interfaz de Temporal por `ssh -L`                                    |
| [kill-switches.md](./kill-switches.md) | Apagar el LLM, los disparadores o los nodos HTTP sin desplegar                   |
| [rebuild.md](./rebuild.md)             | Reconstruir el servicio desde cero en una VM limpia                              |
| [memory.md](./memory.md)               | Presupuesto de memoria y la medición pendiente (T052)                            |
| [decommission.md](./decommission.md)   | Dar de baja la VM y sus recursos                                                 |

## Cómo está montado

- Una VM `cognitive-dag-prod` (Ubuntu 24.04 aarch64, A1.Flex 2 OCPU y 12 GB) en `sa-bogota-1`. Un
  Compose (`deploy/compose.prod.yaml`) con Caddy (único punto de entrada, 80 y 443), API, worker,
  PostgreSQL, Valkey, Temporal y su UI (solo en `127.0.0.1:8233`).
- Las imágenes propias las publica `release.yml` en OCIR por digest; el despliegue las resuelve por el
  SHA del commit (`deploy.sh`) y nunca usa una etiqueta móvil.
- Los secretos viven en OCI Vault; la VM los vuelca a un `tmpfs` (`/run/cognitive-dag/secrets`) al
  arrancar y falla cerrada si el Vault no responde.
- En la VM: `/opt/cognitive-dag` (el repositorio, dueño `cdag-deploy`), `/etc/cognitive-dag/` (la
  configuración: `cognitive-dag.env` y `local.env`), `/var/lib/cognitive-dag/` (estado, volcados y
  estado de alertas), `/var/log/cognitive-dag/` (registros archivados) y `/run/cognitive-dag/`
  (secretos y certificados internos, en memoria).

## Comandos del día a día

Todos en la VM, como `cdag-deploy` (`sudo -iu cdag-deploy`).

```bash
/opt/cognitive-dag/deploy/ops/doctor.sh                      # estado: versión, secretos, servicios, certificados, disco
/opt/cognitive-dag/deploy/ops/deploy.sh <sha-de-40-hex>      # desplegar un commit de main (lo hace deploy.yml)
/opt/cognitive-dag/deploy/ops/rollback.sh                    # volver a la versión anterior
/opt/cognitive-dag/deploy/ops/check-headers.sh <dominio>     # contrato de cabeceras contra el sitio real
/opt/cognitive-dag/deploy/ops/compose.sh ps                  # docker compose con la configuración y la versión actual
```

### Crear una cuenta (el registro está cerrado, D23A)

Caddy responde 404 a `POST /api/v1/auth/register`, así que las cuentas autorizadas se crean desde la VM,
por la API dentro de la red de Compose. La contraseña se lee de la entrada estándar y nunca va en un
argumento. La política de la API es de 8 a 25 caracteres. La persona termina con el enlace del correo de
verificación, que además comprueba que el SMTP funciona.

```bash
/opt/cognitive-dag/deploy/ops/create-account.sh persona@ejemplo.com "Nombre Apellido"
```

Aceptar una invitación **no** pasa por `register` (`POST /api/v1/invitations/accept`), así que las
invitaciones de una organización siguen funcionando para quien ya tenga una cuenta.

### Consultar los registros

Los registros de API, worker y Caddy se archivan cada 5 minutos en `/var/log/cognitive-dag/<servicio>.log`
y rotan a diario con compresión y 90 días de retención. Son JSON, una línea por evento:

```bash
# Fallos de inicio de sesión de una organización en los últimos archivos
grep -h '"event":"auth.login_failed"' /var/log/cognitive-dag/api.log | grep '"organizationId":"<id>"'
# Todo lo de una petición, por su identificador de correlación
zgrep -h '"correlationId":"<uuid>"' /var/log/cognitive-dag/api.log* /var/log/cognitive-dag/worker.log*
# Lo más reciente, sin esperar al archivo
/opt/cognitive-dag/deploy/ops/compose.sh logs --since 30m api
```
