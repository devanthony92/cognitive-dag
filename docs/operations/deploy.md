# Despliegue y reversa

Decisiones D3C y D17A, ADR-0094. Cada publicación correcta de `main` llega a producción sin revisión
humana y sin staging: las defensas son CI, el escaneo de la publicación, el `migrator`, la salud y la
**reversa automática**. Con ese ritmo, el riesgo principal es una migración que rompa a la versión
anterior; por eso las migraciones son expand/contract y no hay migraciones inversas.

## Qué hace `deploy.sh <sha>`

`deploy/ops/deploy.sh`, en la VM y como `cdag-deploy` (un solo despliegue a la vez, con cerrojo):

1. Comprueba que el SHA es de 40 hexadecimales y **descendiente de `origin/main`**; si no, se niega. El
   _checkout_ del repositorio pasa a ese commit (compose y scripts son los de esa versión).
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
6. Solo si todo pasó, `previous.env` toma el `current.env` anterior y `current.env` la versión nueva
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

## Disparar un despliegue

`.github/workflows/deploy.yml` lo dispara cuando `release.yml` termina bien y se detiene si falla. Hasta
decidir su forma (T047) se despliega a mano:

```bash
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/deploy.sh <sha-de-40-hex>
```

> **Pendiente de decisión del autor (T047):** despliegue por empuje (el workflow entra por SSH con una
> llave restringida a un comando) o por extracción (un temporizador en la VM). La opción elegida y su
> procedimiento se anotan aquí al decidirla.

## Cabeceras: qué hacer si falla la comprobación

`check-headers.sh` nombra la cabecera ausente o con un valor distinto del contrato
(`specs/010-deployment/contracts/edge-headers.md`). Si el despliegue revirtió por eso, la causa suele ser
un cambio en `deploy/caddy/` o en la imagen de borde; corrígelo en `main` y vuelve a publicar. Para
revisar el sitio sin desplegar: `check-headers.sh cognitive.devama.cloud`.
