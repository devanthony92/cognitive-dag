---
status: accepted
date: 2026-11-11
decision-makers: autor
---

# Despliegue automático con reversa automática, y la ausencia de backups como riesgo aceptado

## Contexto y problema

El autor decidió (D3C) que cada publicación correcta de `main` llegue a producción sin revisión humana, sin
staging (D2C) y sin copias de seguridad externas (D5). Hace falta un despliegue repetible que detecte por sí
mismo que algo salió mal y vuelva atrás, y dejar escrito qué riesgo se acepta.

## Opciones consideradas

- Despliegue manual desde el portátil: sin secretos en CI, pero poco repetible y sin registro.
- Producción con aprobación humana: recomendación inicial A de `research.md`, descartada por el autor.
- **Todo automático con reversa automática y volcado previo en la VM (elegida, D3C y D17A).**
- Blue/green: duplica la memoria, que no cabe cómodamente en la VM.

## Decisión

- **`deploy.sh <sha>` (`deploy/ops/`)**: solo acepta un SHA completo que sea descendiente de `origin/main`;
  resuelve las 4 imágenes por SHA a **digest** en OCIR con el usuario de solo lectura (nunca una etiqueta
  móvil, FR-018); hace el **volcado previo** (`pg_dump -Fc`, últimos 3, solo en la VM, no es un backup);
  ejecuta el `migrator` antes de arrancar los servicios nuevos; espera la salud (`--wait`) y comprueba las
  cabeceras del sitio real (`check-headers.sh`, FR-034). Un cerrojo impide dos despliegues a la vez.
- **Reversa automática:** si falla el volcado de forma que impida seguir, nada cambia; si falla la
  migración, la salud o las cabeceras, el script vuelve a `current.env`, espera de nuevo la salud y sale con
  error (el workflow queda fallido). En el primer despliegue no hay versión anterior: detiene `edge`, `api`
  y `worker`. `current.env` y `previous.env` solo se actualizan cuando todo pasó.
- **`rollback.sh`:** vuelve a los digests de `previous.env` sin tocar el registro, espera la salud y las
  cabeceras, e intercambia `current` y `previous`. No hay migraciones inversas: las migraciones son
  expand/contract y la versión anterior corre sobre el esquema nuevo.
- **Sin backups (D5, constitución 1.1.0):** se acepta que perder la VM es perder los datos; la demo solo
  admite datos de prueba y el registro de cuentas está cerrado (D23A: Caddy responde 404 a `register` y
  `create-account.sh` crea las cuentas). Antes de admitir datos reales debe existir un backup cifrado
  externo con restauración probada. El volcado previo cubre solo una migración que rompa la regla
  expand/contract, con pérdida de lo escrito desde el despliegue.
- **Quién despliega (T047, elegido por el autor: empuje):** `deploy.yml` se dispara con `workflow_run` de
  `Release` y entra por SSH como `cdag-deploy` con una llave cuya línea de `authorized_keys` es
  `restrict,command="…/ssh-deploy.sh"`: solo acepta `deploy <40 hex>` y `deploy.sh` comprueba que sea de
  `main`. Se descartó la extracción por temporizador porque no puede marcar el workflow como fallido (FR-024),
  tarda hasta 5 minutos y depende de una API sin token. El job no tiene permisos, no hace _checkout_ y solo ve
  el secreto `DEPLOY_SSH_KEY`, en el entorno `deploy` (no `production`, reservado a la publicación). Coste: una
  llave en GitHub, el puerto 22 abierto a los runners y la rotación manual de la llave y de `known_hosts`.

## Consecuencias

- Bueno: despliegue repetible, por digest, con migración antes del arranque y reversa sin intervención;
  el registro `deploy.log` dice qué se desplegó y cuándo.
- Malo: un cambio defectuoso puede llegar a la demo pública antes de que la reversa lo detecte (sin staging);
  una migración que rompa la compatibilidad hacia atrás no se arregla con la reversa de código; sin backup no
  hay salida más allá del volcado previo local; `docker compose --wait` y los servicios de un solo uso
  dependen de la versión de Compose de la VM (se verifica en el primer despliegue real).
- Riesgo aceptado, con dueño (autor) y revisión al cerrar F9 (T057): pérdida total de datos de prueba si la
  VM desaparece.

## Confirmación

`scripts/test/unit/deploy-scripts.test.ts`: volcado y `previous` guardados, `migrator` antes de los servicios,
reversa automática ante migración fallida, salud rota o cabeceras ausentes, `rollback.sh` con espera de salud,
SHA fuera de `main` rechazado y token de OCIR nunca impreso.

## Enlaces

- D2C, D3C, D5, D17A, D23A, FR-024, FR-025, FR-034; ADR-0089, ADR-0093 y ADR-0095.
