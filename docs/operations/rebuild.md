# Reconstruir el servicio desde cero (T055, US4 escenario 3)

Sin copias de seguridad (D5), perder la VM es perder la base de datos, pero el servicio se levanta de nuevo
en una VM limpia con el script de aprovisionamiento, los secretos del Vault y las imágenes del registro. Los
datos de prueba se pierden y las cuentas se vuelven a crear con `create-account.sh`.

> **Tiempo medido: pendiente.** Esta reconstrucción requiere una VM real y no se ha ejecutado todavía; no se
> inventa una cifra. Al hacerla por primera vez se anota aquí la fecha, el tiempo de cada paso y el total.

| Paso                                                                | Tiempo medido |
| ------------------------------------------------------------------- | ------------- |
| 1. Instancia nueva con cloud-init (hasta `cloud-init status: done`) | _pendiente_   |
| 2. DNS y volcado de secretos (`cognitive-dag-secrets`)              | _pendiente_   |
| 3. Primer despliegue (`deploy.sh`, hasta salud y cabeceras)         | _pendiente_   |
| 4. Cuentas de nuevo                                                 | _pendiente_   |
| **Total**                                                           | _pendiente_   |

## Procedimiento

1. **Vault, OCIR y DNS siguen existiendo** (no dependen de la VM). Si la IP reservada sigue libre, se
   reasigna a la VM nueva; si no, se actualiza el registro A.
2. Crea la instancia como en [oracle.md](./oracle.md) (mismo `cloud-init.yaml`). `provision.sh` corre solo.
3. Crea `/etc/cognitive-dag/local.env` ([provisioning.md](./provisioning.md), paso 3).
4. `sudo systemctl start cognitive-dag-secrets` trae los secretos del Vault. Los secretos del Vault no cambian
   con la VM: la clave maestra, las contraseñas y la CA son las mismas; la base de datos nueva se crea vacía con
   esas contraseñas.
5. Despliega el commit que estaba en producción (o el último de `main`):
   `sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/deploy.sh <sha>`. Como no hay base de datos, no hay
   volcado previo; el `migrator` crea el esquema desde cero.
6. Crea las cuentas con `create-account.sh` y vuelve a probar las alertas ([alerts.md](./alerts.md)).

Comprobación: `doctor.sh` termina en `ok`, `check-headers.sh` pasa y se puede iniciar sesión.

## Si se perdió también el Vault

Los secretos generados se crean de nuevo con `secrets.sh init-generated` (la clave maestra nueva deja
ilegibles las credenciales cifradas que hubiera, que de todos modos se perdieron con la base); la clave de
Gemini, las credenciales SMTP y el token de OCIR los repone el autor en cada proveedor.
