---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# Temporal en producción: servidor propio con PostgreSQL, mTLS y UI solo por túnel

## Contexto y problema

En desarrollo Temporal corre como `temporal server start-dev`: SQLite, sin autenticación, sin TLS y con la UI abierta. Producción necesita persistencia duradera sin sumar otra base de datos, que solo la API, el worker y la UI puedan hablar con el servidor, y una UI que no sea una puerta a internet (D15A).

## Opciones consideradas

- Seguir con `start-dev` en producción: SQLite en un volumen, sin mTLS. Descartada: no es un modo de producción y no autentica a nadie.
- Servidor con PostgreSQL propio y mTLS en el frontend (elegida).
- Temporal Cloud: otra cuenta, otro proveedor y datos de la aplicación fuera de la VM.

## Decisión

- **Servidor:** `temporalio/server` 1.31.5 (los tres roles en un proceso, adecuado para una VM de 12 GB) con la imagen fijada por digest. La configuración es `deploy/temporal/production.template.yaml`; `entrypoint.sh` la completa al arrancar con la contraseña de la base (leída de su archivo de secreto) y la dirección que anuncia el contenedor, y la deja en un `tmpfs`. Nada secreto se versiona. La contraseña solo admite letras, dígitos, `_`, `.` y `-` porque se sustituye con `sed`; el script que las genera en la VM (PR 4) respeta ese alfabeto.
- **Persistencia:** el mismo PostgreSQL de la aplicación, con dos bases (`temporal` y `temporal_visibility`) y un rol `temporal` que solo se conecta a ellas (`pg_hba.conf`). Conexión por TLS con verificación de nombre contra la CA interna. El esquema lo crea la tarea de un solo uso `temporal-schema` (`schema.sh`, `temporal-sql-tool`), idempotente.
- **mTLS en el frontend:** `requireClientAuth: true`; la API, el worker, la UI y la tarea de inicio presentan un certificado de la CA interna, cada uno el suyo (`temporal-client-api`, `-worker`, `-ui`). El rol de trabajador del sistema usa el certificado del servidor, que lleva `serverAuth` y `clientAuth`. Sin TLS o sin certificado de cliente la conexión se rechaza (`deploy-security.test.ts`).
- **Namespace propio y retención corta:** `cognitive-dag`, con retención de 72 h, creado por `temporal-init` (`init.sh`, idempotente) junto con el atributo de búsqueda `CorrelationId` (Keyword) que usa la API. La historia que importa vive en PostgreSQL; la de Temporal solo sirve para operar. La API y el worker usan `TEMPORAL_NAMESPACE=cognitive-dag`.
- **UI (D15A):** `temporalio/ui` publicada solo en `127.0.0.1:8233` y conectada por mTLS; Caddy no la proxifica. Se llega con `ssh -L 8233:127.0.0.1:8233`. Una prueba fija que ningún otro servicio publica puertos y que ningún proxy de Caddy apunta a Temporal.
- **Límites:** servidor 768 MB, UI 192 MB, tareas de un solo uso 256 MB (presupuesto de `research.md`).
- **Sin autenticación de usuario:** el servidor corre con `--allow-no-auth`: la autenticación es la red interna más mTLS; no hay usuarios finales de Temporal.

## Consecuencias

- Bueno: el servidor persiste en PostgreSQL, solo lo alcanzan servicios con certificado y la UI no es pública.
- Malo: dos imágenes más (`server` y `admin-tools`) y la CLI de `admin-tools` pide las opciones de conexión después del comando, no antes; el namespace tarda unos segundos en propagarse y `init.sh` reintenta. La rotación de certificados exige reiniciar el servidor y sus clientes (ADR-0092). Sin backups mientras solo haya datos de prueba (constitución 1.1.0): perder el volumen pierde también la historia de Temporal.

## Confirmación

`scripts/test/integration/deploy-security.test.ts` levanta PostgreSQL, Valkey y Temporal con el Compose de producción y una PKI efímera, y comprueba el rechazo sin TLS y sin certificado de cliente, la aceptación con el certificado de la prueba, el namespace y el atributo. `scripts/test/unit/deploy-config.test.ts` fija mTLS, TLS hacia PostgreSQL, ausencia de contraseñas en la plantilla y la retención.

## Enlaces

- Decisiones D8A y D15A en `specs/010-deployment/research.md`; ADR-0090, ADR-0092.
