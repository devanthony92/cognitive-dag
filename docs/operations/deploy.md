# Despliegue y reversa

Decisiones D3C y D17A, ADR-0094. Cada publicación correcta de `main` llega a producción sin revisión
humana y sin staging: las defensas son CI, el escaneo de la publicación, el `migrator`, la salud y la
**reversa automática**. Con ese ritmo, el riesgo principal es una migración que rompa a la versión
anterior; por eso las migraciones son expand/contract y no hay migraciones inversas.

## Qué hace `deploy.sh <sha>`

`deploy/ops/deploy.sh`, en la VM y como `cdag-deploy` (un solo despliegue a la vez, con cerrojo):

1. Comprueba que el SHA es de 40 hexadecimales y **descendiente de `origin/main`**; si no, se niega. El
   _checkout_ de `/opt/cognitive-dag` **no se mueve** (sigue en `main`, y `git pull --ff-only` siempre
   funciona): `deploy.sh` exporta `deploy/` de ese commit a
   `/var/lib/cognitive-dag/state/releases/<sha>` (`git archive`) y se vuelve a ejecutar desde esa copia, de
   modo que ni el script en marcha ni su compose cambian a mitad de ejecución. Compose, `rollback.sh` y
   `compose.sh` usan el compose de la copia de la versión que corren; solo se conservan las copias de
   `current` y `previous`. Las unidades de systemd (`firewall.sh`, `secrets.sh`, `alerts.sh`) siguen
   corriendo desde `/opt/cognitive-dag`, a la versión de `main` que tenga el _checkout_.
2. Entra en OCIR con el usuario de solo lectura (el token por entrada estándar; la sesión de `docker`
   vive en el `tmpfs`) y resuelve cada una de las 4 imágenes `cognitive-dag/{api,worker,edge,migrator}:<sha>`
   a su **digest**. Nunca usa una etiqueta móvil.
3. Si hay una versión en marcha, hace el **volcado previo** de la base (`pg_dump -Fc`) en
   `/var/lib/cognitive-dag/dumps/predeploy-<fecha>-<sha-anterior>.dump` y conserva los **últimos 3**. Es solo
   en la VM y **no es un backup**: sirve para una migración que rompa la regla expand/contract.
4. Descarga las imágenes, levanta PostgreSQL, ejecuta el `migrator` (como `app_migrator`), arranca el resto
   y espera a que todos los servicios estén sanos (`--wait`, 300 s).
5. Ejecuta `check-headers.sh` contra el dominio real: HSTS, CSP, `X-Frame-Options`, `nosniff`,
   `Permissions-Policy`, COEP, COOP, CORP y la redirección de HTTP a HTTPS (FR-034).
6. Solo si todo pasó (y, tras ello, se borran las copias que ya no son `current` ni `previous`), `previous.env` toma el `current.env` anterior y `current.env` la versión nueva
   (los digests y el SHA, en `/var/lib/cognitive-dag/state/`).

**Si falla la migración, la salud o las cabeceras, vuelve solo** a `current.env` (espera de nuevo la salud
y las cabeceras), anota el motivo en `deploy.log` y sale con error. Si es el primer despliegue no hay a qué
volver: detiene `edge`, `api` y `worker`. Si ni la reversa queda sana lo dice como `ROLLBACK FAILED`:
mira `doctor.sh` y [alerts.md](./alerts.md).

## Reversa a mano

```bash
/opt/cognitive-dag/deploy/ops/rollback.sh
```

Arranca los digests de `previous.env` (sin tocar el registro), espera la salud, comprueba las cabeceras y
solo entonces intercambia `current` y `previous`: un segundo `rollback.sh` vuelve hacia delante. No ejecuta
migraciones hacia atrás. Sale con error, sin cambiar el estado, si no hay versión anterior o no queda sana.

Comprobación: `doctor.sh` muestra el SHA de `current` y termina en `ok`.

## Si una migración rompió a la versión anterior

La reversa de código no basta si una migración destructiva se coló (se prohíbe por regla y por revisión).
Queda el volcado previo, **con perdida de lo escrito desde el despliegue**:

```bash
cd /opt/cognitive-dag
deploy/ops/compose.sh stop api worker
ls -1 /var/lib/cognitive-dag/dumps/                      # elige el volcado de la versión a la que vuelves
deploy/ops/compose.sh exec -T postgres pg_restore -U postgres -d cognitive_dag --clean --if-exists \
  < /var/lib/cognitive-dag/dumps/predeploy-<fecha>-<sha>.dump
deploy/ops/rollback.sh
```

## Disparar un despliegue: empuje por SSH restringido (T047)

`.github/workflows/deploy.yml` se dispara cuando `release.yml` termina bien en `main` y entra por SSH a la
VM como `cdag-deploy` con una llave que **solo puede ejecutar `deploy <sha>`**: su línea de
`authorized_keys` lleva `restrict,command="/opt/cognitive-dag/deploy/ops/ssh-deploy.sh"`, y ese script
rechaza cualquier cosa que no sea `deploy` más 40 hexadecimales. `deploy.sh` además exige que el commit sea de
`main` y que sus imágenes existan. Si el despliegue revierte, el job termina en rojo y el registro está en la
ejecución de Actions. El entorno se llama `deploy` (no `production`: ese lo usa solo `release.yml`) y no
lleva revisores.

### Configuración (una vez)

1. En la VM, una llave solo para esto (en tu máquina: `ssh-keygen -t ed25519 -f deploy_key -N ''`) y su parte
   pública restringida:

   ```bash
   sudo install -d -m 700 -o cdag-deploy -g cdag-deploy /home/cdag-deploy/.ssh
   echo 'restrict,command="/opt/cognitive-dag/deploy/ops/ssh-deploy.sh" <contenido de deploy_key.pub>'      | sudo -u cdag-deploy tee -a /home/cdag-deploy/.ssh/authorized_keys
   sudo chmod 600 /home/cdag-deploy/.ssh/authorized_keys
   ```

2. En GitHub, entorno `deploy` (Settings → Environments), sin revisores: secreto `DEPLOY_SSH_KEY` (la
   llave privada) y variables `DEPLOY_HOST` (`cognitive.devama.cloud`) y `DEPLOY_KNOWN_HOSTS` (la salida de
   `ssh-keyscan -t ed25519 cognitive.devama.cloud` tomada desde una red de confianza, o el contenido de
   `/etc/ssh/ssh_host_ed25519_key.pub` de la VM con el nombre delante). Borra la llave privada local.
3. Comprobación: `ssh -i deploy_key cdag-deploy@cognitive.devama.cloud 'id'` responde `refused`, y
   `... 'deploy <sha>'` despliega.

### Rotar la llave

Genera una nueva, sustituye su línea en `authorized_keys`, actualiza `DEPLOY_SSH_KEY` y borra la vieja. Si
recreas la VM, su llave de host cambia: actualiza `DEPLOY_KNOWN_HOSTS`. Si cierras el puerto 22 a tu IP, el
empuje deja de funcionar (los runners de GitHub no tienen IP fija): despliega entonces a mano.

Despliegue a mano, siempre disponible:

```bash
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/deploy.sh <sha-de-40-hex>
```

## Cabeceras: qué hacer si falla la comprobación

`check-headers.sh` nombra la cabecera ausente o con un valor distinto del contrato
(`specs/010-deployment/contracts/edge-headers.md`). Si el despliegue revirtió por eso, la causa suele ser
un cambio en `deploy/caddy/` o en la imagen de borde; corrígelo en `main` y vuelve a publicar. Para
revisar el sitio sin desplegar: `check-headers.sh cognitive.devama.cloud`.
