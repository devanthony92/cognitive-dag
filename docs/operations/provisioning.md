# Aprovisionamiento y primer despliegue

Lleva una VM nueva de Oracle hasta tener la demo en `https://cognitive.devama.cloud` (T044, FR-016).
Supone la infraestructura de [oracle.md](./oracle.md) (instancia, reglas 22, 80 y 443, Vault, política
y OCIR). Es **el orden exacto del primer despliegue**; cada paso termina con su comprobación.

## Qué hace el aprovisionamiento

`deploy/provision/provision.sh` es idempotente: se puede repetir y no cambia lo que ya está bien. Instala
Docker (paquetes de Ubuntu), `ufw`, `fail2ban` y las herramientas; crea el usuario `cdag-deploy` y los
directorios; clona el repositorio en `/opt/cognitive-dag`; instala la CLI de OCI en `/opt/oci-cli`
(versión fijada); endurece SSH (solo llaves, sin `root`, `AllowUsers`), activa `fail2ban` y deja el
cortafuegos en 22, 80 y 443 (`harden.sh`); e instala y habilita las unidades de `systemd`
(`cognitive-dag-secrets`, `cognitive-dag` y el temporizador de alertas) y la rotación de registros a 90
días. **No** trae secretos ni imprime ningún valor, y no escribe nada dentro del árbol del repositorio.

Lo primero lo hace `cloud-init` al crear la instancia; si hay que repetirlo a mano:

```bash
sudo /opt/cognitive-dag/deploy/provision/provision.sh
```

## Pasos del primer despliegue

### 1. Crear la instancia con el cloud-init

Con `deploy/provision/cloud-init.yaml` como script de arranque ([oracle.md](./oracle.md), paso 1). En la VM:

```bash
ssh ubuntu@<ip-publica>
cloud-init status --wait      # status: done
ls /opt/cognitive-dag/deploy  # el repositorio está clonado
systemctl is-enabled cognitive-dag-secrets.service cognitive-dag-alerts.timer
```

### 2. Cargar los secretos en el Vault (desde tu máquina)

Con la CLI de OCI configurada con tu propio perfil (`oci setup config`) y el entorno de
`deploy/env/operator.env.example` (los OCID del Vault, del compartimento y de la clave maestra):

```bash
export VAULT_OCID=... OCI_COMPARTMENT_OCID=... OCI_VAULT_KEY_OCID=...
deploy/provision/secrets.sh init-generated    # contraseñas, clave maestra y CA interna; no pisa los que existen
printf '%s' "$GEMINI_API_KEY" | deploy/provision/secrets.sh put gemini_api_key
deploy/provision/secrets.sh put smtp_user          # el valor se escribe en el aviso, oculto
deploy/provision/secrets.sh put smtp_password
deploy/provision/secrets.sh put ocir_pull_token
deploy/provision/secrets.sh list                   # los 12 deben decir «present»
```

Guarda ahora una copia cifrada, fuera de Oracle, de `credentials_master_key` y de la CA (sin backups,
D5, lo que no se pueda regenerar solo lo repones tú). Nunca pegues un valor en un chat ni en un registro.

### 3. Configurar la VM

Crea `/etc/cognitive-dag/local.env` (no está en el repositorio; modelo en `deploy/env/local.env.example`):

```bash
sudo install -m 0640 -o root -g cdag-deploy /dev/null /etc/cognitive-dag/local.env
sudoedit /etc/cognitive-dag/local.env        # SITE_DOMAIN=cognitive.devama.cloud y ALERT_EMAIL_TO=<tu buzón>
```

### 4. Volcar los secretos al `tmpfs`

```bash
sudo systemctl start cognitive-dag-secrets
systemctl status cognitive-dag-secrets --no-pager   # active (exited)
sudo ls /run/cognitive-dag/secrets /run/cognitive-dag/pki
```

Si el Vault no responde, la unidad falla y **no deja nada**: revisa la política del grupo dinámico
([oracle.md](./oracle.md), paso 4) y `journalctl -u cognitive-dag-secrets`.

### 5. DNS

`dig +short cognitive.devama.cloud` debe devolver la IP pública de la instancia. Caddy pide el certificado a Let's
Encrypt al arrancar, así que el nombre ha de resolver ya y el 80 ha de estar abierto.

### 6. Primer despliegue

Necesita el SHA de un commit de `main` cuyas imágenes publicó `release.yml` (pestaña Actions → Release →
el commit; las cuatro imágenes terminan en verde). En la VM:

```bash
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/deploy.sh <sha-de-40-hex>
```

Resuelve los digests en OCIR, levanta PostgreSQL, ejecuta el `migrator`, arranca el resto, espera la
salud y comprueba las cabeceras del sitio real. Si algo falla en el primer despliegue no hay versión
anterior: detiene `edge`, `api` y `worker` y sale con error (la causa está en la salida y en
`/var/lib/cognitive-dag/state/deploy.log`).

### 7. Verificar

```bash
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/doctor.sh                 # termina en «ok»
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/check-headers.sh cognitive.devama.cloud
curl -sI http://cognitive.devama.cloud/ | head -n 3                          # 301 a https
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://cognitive.devama.cloud/api/v1/auth/register   # 404 (registro cerrado)
```

### 8. Primera cuenta y alertas

```bash
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/create-account.sh tu@correo "Tu nombre"
sudo systemctl start cognitive-dag-alerts.timer
sudo systemctl start cognitive-dag-alerts.service     # una pasada a mano; no debe enviar correo si todo está sano
```

Prueba cada alerta una vez con el procedimiento de [alerts.md](./alerts.md).

### 9. Despliegue automático

Configura la llave restringida y el entorno `deploy` de GitHub como indica
[deploy.md](./deploy.md#configuración-una-vez). Desde entonces cada publicación correcta de `main` se
despliega sola.

## Después de un reinicio de la VM

`cognitive-dag-secrets.service` vuelca los secretos de nuevo y `cognitive-dag.service` levanta la versión
actual (`deploy.sh --resume`). Si el Vault no responde, no arranca nada y no usa valores viejos: es el
fallo cerrado esperado. Comprobación: `doctor.sh`.
