# Research: Despliegue (F9)

**Fecha**: 2026-11-09 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: **pendientes**. Cada R es una pregunta numerada (D1 a D22) con opciones A/B/C,
ventajas, riesgos y una recomendación. Ninguna está tomada; el plan y las tareas asumen la recomendación
solo como borrador y se rehacen cuando lleguen las respuestas ("1A 2A 3A…").

Las comprobaciones del estado actual se hicieron leyendo el repositorio en `main` (`e424bb5`). Las cifras
de planes gratuitos de terceros (Oracle, GitHub, Grafana, Backblaze y similares) **cambian sin aviso**
(el propio PLAN recuerda el recorte de Oracle de junio de 2026): están marcadas **(verificar)** y cada una
se confirma contra la fuente oficial el día de contratar, antes de depender de ella.

## Hechos técnicos que fijan el diseño

| #   | Hecho                                                                                                                                         | Dónde                                                          | Consecuencia                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| H1  | Solo existen Dockerfile de `api` y `worker`; CI los construye con `push: false`. No hay imagen de web ni de migraciones                       | `apps/*/Dockerfile`, `.github/workflows/ci.yml`                | F9 crea dos imágenes (web/borde y `migrator`) y el workflow de publicación                                       |
| H2  | La web fija `VITE_API_URL` al compilar                                                                                                        | `apps/web/src/api/client.ts`, `.env.example`                   | Con mismo origen (D6A) basta una URL relativa y la imagen es independiente del dominio                          |
| H3  | Cookie `__Host-session`, `SameSite=Lax`, sin `Domain`; CSRF compara `Origin` con `WEB_ORIGIN`                                                 | `apps/api/src/auth/session-cookie.ts`, `csrf.guard.ts`         | La web y la API deben compartir sitio; el mismo origen elimina CORS y simplifica la CSP (`connect-src 'self'`)   |
| H4  | La API no usa `trust proxy`                                                                                                                   | búsqueda en `apps/api/src`                                     | Detrás de Caddy todas las IP serían la del proxy: el límite por IP y el campo `ip` de los eventos quedan rotos   |
| H5  | Los clientes de Temporal se conectan solo con `address`                                                                                       | `apps/worker/src/main.ts:61,84`, cliente de `apps/api`         | Hace falta código para TLS/mTLS (FR-008)                                                                        |
| H6  | `iovalkey` ya acepta `rediss://` (esquema `rediss?` en la validación) y PostgreSQL acepta `sslmode` en la URL                                  | `apps/api/src/config/env.schema.ts`                            | Valkey y PostgreSQL con TLS necesitan sobre todo configuración y pruebas; la CA de confianza requiere una opción |
| H7  | El correo solo tiene `SMTP_HOST`, `SMTP_PORT` y `MAIL_FROM`                                                                                   | `apps/api/src/config/env.schema.ts`                            | Faltan usuario, contraseña y TLS para un proveedor real (FR-030)                                                |
| H8  | `infra/postgres/init/01-roles.sql` fija contraseñas de desarrollo                                                                             | `infra/postgres/init/`                                         | Producción necesita su propio inicializador con contraseñas inyectadas                                          |
| H9  | No hay librerías de métricas ni OpenTelemetry en `apps/api` ni `apps/worker`                                                                  | `package.json` de ambos                                        | D9 puede exigir una dependencia nueva → ADR (principio VII)                                                     |
| H10 | `compose.yaml` usa Temporal `start-dev` con SQLite; el servidor de producción y su esquema en PostgreSQL no están probados aquí                | `compose.yaml`                                                 | Se necesita un servicio de producción y una tarea de esquema (`temporal-sql-tool` o equivalente)                |
| H11 | Las imágenes base ya están fijadas por digest; Renovate las actualiza                                                                         | `compose.yaml`, Dockerfiles                                    | La misma regla se aplica a Caddy, restic y demás servicios nuevos                                               |
| H12 | `app_runtime` no tiene `DELETE`; la tabla de auditoría (D10B) tendría que ser solo de inserción                                               | `infra/postgres`, F1                                           | Un cambio de esquema de D10B exige aprobación del autor antes de implementar                                    |

## Presupuesto de memoria (propuesto, a medir)

`docs/PLAN.md` §9 estima 2–3 GB para producción. Se fija un límite por contenedor; la columna "esperado"
es la estimación del PLAN y los límites son mi propuesta (**propuesto**, se ajustan con la medición de la
tarea T056). Cabe producción más staging bajo demanda.

| Servicio                 | Esperado (PLAN) | Límite producción | Límite staging |
| ------------------------ | --------------- | ----------------- | -------------- |
| Temporal server          | 0,3–0,6 GB      | 768 MB            | 512 MB         |
| Temporal UI (solo túnel) | ~0,1 GB         | 192 MB            | 128 MB         |
| PostgreSQL               | 0,3–0,5 GB      | 768 MB            | 384 MB         |
| API                      | 0,2–0,3 GB      | 512 MB            | 256 MB         |
| Worker                   | 0,2–0,4 GB      | 768 MB            | 384 MB         |
| Valkey                   | < 0,1 GB        | 192 MB (`maxmemory` 128 MB) | 96 MB (`maxmemory` 64 MB) |
| Caddy (borde + web)      | < 0,1 GB        | 128 MB            | 96 MB          |
| Agente de observabilidad | —               | 192 MB (D9A)      | —              |
| **Suma**                 |                 | **≈ 3,4 GB**      | **≈ 1,8 GB**   |

Con 12 GB en total quedan ≈ 6,8 GB de margen para el sistema, el caché de disco de PostgreSQL y los picos.
Si D9B (todo en la VM) se elige, la suma sube ≈ 1,5 GB (Loki, Prometheus, Grafana) y el margen sigue
positivo, pero se acerca al límite de 8 GB que fija SC-010 con staging encendido.

---

## R1 / D1. Registro de imágenes

**Pregunta:** ¿Dónde se publican las imágenes `api`, `worker`, `migrator` y web?

| Opción                                     | Ventajas                                                                                                                                                                         | Riesgos                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. GHCR** (recomendada)                  | Integrado con GitHub Actions (`GITHUB_TOKEN` con `packages: write`, sin secreto extra); gratuito para paquetes públicos (**verificar** límites); procedencia ligada al repositorio | La VM necesita un token de solo lectura para extraer si las imágenes son privadas; depende de GitHub (ya es el origen del código); paquetes públicos revelan las imágenes |
| B. OCIR (registro de Oracle)               | Mismo proveedor que la VM, tráfico interno rápido; almacenamiento gratuito acotado (**verificar**)                                                                               | Credenciales de OCI en CI (secreto de larga vida); atado a Oracle justo donde el PLAN pide portabilidad; si Oracle reclama la cuenta se pierde también el registro |
| C. Docker Hub, o construir en la VM        | Docker Hub: conocido; construir en la VM: sin registro                                                                                                                           | Docker Hub tiene límites de extracción y de repositorios privados (**verificar**); construir en la VM gasta CPU/RAM de las 2 OCPU, ensucia la VM y no deja digest verificable |

**Recomendación: A.** Es el menor número de secretos y de piezas. Paquetes **públicos** si el autor acepta
que las imágenes (sin secretos, con SBOM) son visibles, como el repositorio; si no, privados con un token
de solo lectura en la VM (prerrequisito P9). Las imágenes se referencian siempre por digest.

## R2 / D2. Staging

**Pregunta:** ¿Hay un staging separado donde probar y donde corra ZAP?

| Opción                                                    | Ventajas                                                                                                                            | Riesgos                                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Segundo proyecto Compose en la misma VM, bajo demanda** (recomendada) | Coste cero; mismo host y misma arquitectura (arm64) que producción, lo que es justo lo que se quiere probar; se levanta solo para desplegar y para ZAP | Comparte CPU, disco y red con producción (un ZAP activo puede degradarla): se limita con `mem_limit`/`cpus` menores y se exige apagarlo después; un fallo de configuración podría mezclar redes |
| B. Segunda VM                                             | Aislamiento real                                                                                                                    | La capa gratuita no la cubre (12 GB y 2 OCPU en total); coste de pago o recorte de producción                                                                                  |
| C. Sin staging                                            | Menos trabajo                                                                                                                       | ZAP activo y con sesión no puede ir contra producción (rompería datos y la demo); #65 y el criterio "ZAP contra staging" de ADR-0088 no se cumplen                              |

**Recomendación: A.** Redes y volúmenes distintos (`name: cognitive-dag-staging`), PostgreSQL propio,
secretos propios, dominio `staging.<dominio>` (prerrequisito P2), sin clave de Gemini de pago ni
`HTTP_ENABLED` hacia internet. Staging es efímero: se destruye y se recrea desde datos sintéticos.

## R3 / D3. Modo de despliegue

**Pregunta:** ¿Se despliega automáticamente al hacer merge, o a mano?

| Opción                                                              | Ventajas                                                                                                                                                | Riesgos                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Staging automático al publicar; producción manual con aprobación** (recomendada) | Staging siempre al día con `main`; producción exige una persona (el entorno `production` de GitHub con revisor) y un digest ya probado                   | Requiere que GitHub llegue a la VM: llave SSH de despliegue restringida a un comando (`command=` en `authorized_keys`) o un agente en la VM que extrae (pull). El secreto de la llave vive en GitHub |
| B. Todo manual por script desde el portátil del autor               | Cero secretos en CI para desplegar; el autor controla cada paso                                                                                         | Depende de que el autor tenga el portátil y las llaves; poco repetible; sin registro de quién desplegó qué                                                   |
| C. Todo automático, incluida producción                             | Mínima fricción                                                                                                                                         | Un merge malo llega a la demo pública sin revisión humana; el rollback pasa a ser la primera defensa                                                         |

**Recomendación: A**, con despliegue **pull** como variante a evaluar en la tarea T047: el workflow solo
publica y registra el digest "listo"; un temporizador `systemd` en la VM extrae la versión aprobada. Evita
dar a CI un acceso SSH. El autor elige entre push por SSH restringido o pull al ver el plan.

## R4 / D4. Gestor de secretos

**Pregunta:** ¿Dónde viven los secretos de producción?

| Opción                                                               | Ventajas                                                                                                                                    | Riesgos                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Archivos en la VM (`/etc/cognitive-dag/secrets/*`, `0600`, montados como Compose `secrets`) con copia cifrada fuera de la VM** (recomendada) | Portable (funciona en cualquier host); sin dependencia de un proveedor; los secretos generables (contraseñas, CA) nacen en la VM y no viajan | Si se pierde la VM sin copia, se pierden; rotación manual con script; la copia cifrada depende de la disciplina del autor (prerrequisito P8)                |
| B. OCI Vault                                                         | Gestión y auditoría del proveedor; versionado (**verificar** cupo gratuito)                                                                  | Atado a Oracle; la VM necesita credenciales de instancia para leerlo (otro secreto de arranque); más piezas                                               |
| C. Secretos de GitHub Environments inyectados al desplegar           | Todo en un lugar; sin servicio extra                                                                                                         | Los secretos pasan por CI y su registro; un workflow comprometido los expone; no sirve para secretos de la propia VM (CA); mezcla CI con secretos de datos |

**Recomendación: A.** Alineada con "despliegue portable" y con que el repositorio es público. Regla:
nunca pasar por CI ningún secreto que la VM pueda generar sola. Solo viaja al servidor el mínimo
inevitable (clave de Gemini, credenciales SMTP, credenciales de backup), entregado por el autor una vez en
el aprovisionamiento. `docker inspect` solo muestra rutas de archivos, no valores (las imágenes leen
`*_FILE`).

## R5 / D5. Destino de los backups

**Pregunta:** ¿Adónde van las copias fuera de la VM?

| Opción                                           | Ventajas                                                                                                                                  | Riesgos                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. OCI Object Storage (el PLAN lo prevé)         | Gratis dentro de la capa (**verificar** cupo); mismo panel; tráfico rápido                                                                | **Mismo proveedor y misma cuenta que la VM**: si Oracle reclama o suspende la cuenta, se pierden la VM y las copias a la vez, que es justo el riesgo que el PLAN señala |
| **B. Otro proveedor compatible con S3** (recomendada) | Sobrevive a un problema de la cuenta de Oracle; restic/rclone hablan S3; plan gratuito o de pocos céntimos al mes (**verificar** precio y cupo) | Una cuenta más (P3); puede salir un coste pequeño; credenciales de escritura en la VM                                                                                |
| C. Ambos (3-2-1)                                 | Máxima durabilidad                                                                                                                        | Doble configuración y doble prueba de restauración; más credenciales                                                                                                 |

**Recomendación: B** con `restic` (cifrado del lado del cliente, deduplicación, comprobación de
integridad) y una clave guardada fuera de la VM (P3, P8). Retención propuesta: 7 diarias, 4 semanales,
6 mensuales. Credencial de la VM de **solo escritura/anexado** si el proveedor lo permite; el borrado de
rotación (`forget --prune`) lo hace un trabajo con otra credencial, ejecutado desde fuera de la VM de
producción o desde el portátil del autor. Si el autor prefiere quedarse en la capa gratuita de Oracle,
A es válida **solo** si acepta ese riesgo correlado por escrito.

## R6 / D6. Origen de la web y la API

**Pregunta:** ¿La web y la API comparten origen?

| Opción                                                    | Ventajas                                                                                                                                                                | Riesgos                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Mismo origen: `https://dominio/` web y `/api/*` a la API** (recomendada) | La cookie `__Host-session` funciona sin cambios; no hay CORS; la CSP puede usar `connect-src 'self'`; un solo certificado; `VITE_API_URL` relativo → la imagen sirve para cualquier dominio; los webhooks usan el mismo host | La API y la web comparten superficie: una XSS en la web llega a la API con la sesión (la CSP es la defensa); `API_PUBLIC_URL` y `WEB_ORIGIN` son el mismo valor; el proxy debe enrutar bien `/api/*` y SSE |
| B. Subdominios `app.` y `api.`                            | Separación visible por host; la API puede tener su propia política de cabeceras                                                                                          | Dos certificados y dos virtual hosts; CORS con credenciales; cookie `__Host-` válida solo para el host de la API; la CSP debe permitir `connect-src https://api.…`; `VITE_API_URL` en el build |
| C. Dominios distintos                                     | —                                                                                                                                                                       | **Descartada**: con `SameSite=Lax` la cookie de la API no viaja en peticiones `fetch` entre sitios y la sesión deja de funcionar                                                           |

**Recomendación: A.** Es lo que hace más pequeña la superficie y la CSP. Verificación en T008: confirmar
que el cliente concatena `VITE_API_URL` + `/api/v1/...` y que con valor vacío funciona (si no, ajuste
mínimo con prueba).

## R7 / D7. Cómo se sirve la web estática

**Pregunta:** ¿Qué imagen entrega los archivos de la SPA?

| Opción                                                              | Ventajas                                                                                                                                       | Riesgos                                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Imagen de borde única: Caddy + `dist` + Caddyfile** (recomendada) | Una pieza menos (RAM, superficie, digest, escaneo); cabeceras y archivos versionados juntos; el contenedor de borde es de solo lectura          | Cada cambio de la web reconstruye la imagen de borde (rápido); si Caddy se ve comprometido, los archivos también; hay que fijar bien el digest de la base |
| B. Imagen `web` separada (Caddy mínimo) detrás del Caddy de borde   | Separación de responsabilidades (el borde solo hace TLS y enrutado)                                                                            | Dos Caddy, dos configuraciones de cabeceras que no deben divergir; más memoria; un salto más                                                              |
| C. Hosting estático externo (Pages, etc.)                           | Sin servidor para la web; CDN                                                                                                                  | Rompe el mismo origen (D6A) y la cookie; otra cuenta y otro proveedor; cabeceras limitadas a lo que ese servicio permita; ZAP de staging cubre menos       |

**Recomendación: A.** Imagen multi-arch `edge` construida con una etapa de `pnpm build` de `apps/web`
dentro del Dockerfile (sin `node_modules` de Windows, regla del PLAN §9.1) y una etapa final sobre la imagen
oficial de Caddy fijada por digest.

## R8 / D8. PKI interna

**Pregunta:** ¿Cómo se emiten los certificados de Temporal, PostgreSQL y Valkey?

| Opción                                                          | Ventajas                                                                                                                                 | Riesgos                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. CA propia generada con `openssl` en el aprovisionamiento** (recomendada) | Sin servicios extra; una sola CA de confianza para todos; vigencias cortas (hoja 90 días, CA 5 años) y rotación por script               | Rotación manual (alerta de caducidad obligatoria); la clave de la CA es un secreto crítico: se queda fuera de los contenedores y con copia cifrada |
| B. `step-ca` (CA en un contenedor)                              | Emisión y renovación automáticas (ACME interno)                                                                                          | Otro servicio permanente y con memoria; su compromiso emite certificados; más superficie en una VM pequeña                                    |
| C. Certificados autofirmados por servicio, sin CA común         | Sencillo al inicio                                                                                                                       | Cada cliente debe fijar cada certificado; rotación multiplicada; mTLS de Temporal mal modelado                                                |

**Recomendación: A.** Los certificados internos solo existen dentro de la red de Compose, por lo que no
necesitan una CA pública. mTLS de Temporal: certificados distintos para API, worker y servidor; el
`serverName` se verifica.

## R9 / D9. Observabilidad y alertas

**Pregunta:** ¿Dónde van los registros y métricas y quién envía las alertas?

| Opción                                                                       | Ventajas                                                                                                                                                              | Riesgos                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Grafana Cloud (nivel gratuito) con un agente en la VM** (recomendada)   | Poca RAM en la VM (agente ≈ 150–200 MB); alertas y paneles incluidos; los registros salen de la VM, útil si la VM muere; retención y cupos gratuitos (**verificar**: 14 días de logs, series y GB al mes) | **Un tercero recibe los registros**: se confía en la redacción (FR-027, prueba con canario); retención gratuita más corta que 90 días → se completa con archivo en el bucket (R10); cupo gratuito que puede cambiar |
| B. Todo en la VM (Loki, Prometheus, Alertmanager, Grafana)                   | Datos propios; sin tercero; retención a voluntad                                                                                                                      | ≈ 1,5 GB de RAM y disco de la VM; si la VM muere, mueren las alertas y los registros; hay que operar y parchear cuatro servicios más                                                  |
| C. Solo registros del motor + un script que cuenta eventos y alerta por correo | Mínimo; sin dependencias ni terceros                                                                                                                                  | Sin métricas ni paneles; búsquedas rudimentarias; las alertas dependen del correo y de que la VM esté viva; no cubre #67 ni las métricas de PLAN §7                                 |

**Recomendación: A**, con la regla de que **ningún dato de usuario sale**: los registros ya se emiten con
redacción y la tarea T052 añade una prueba de canario sobre el canal de salida. Dependencia nueva probable
(`prom-client` u OpenTelemetry) → ADR (principio VII). Si el autor prefiere no enviar registros a un
tercero, B es la alternativa, y el presupuesto de memoria sigue cumpliéndose. Si prefiere un mínimo, C
cubre solo FR-028 y deja FR-029 `accepted`.

## R10 / D10. Retención de eventos de seguridad y #62

**Pregunta:** ¿Cuánto se conservan los eventos de seguridad y hace falta una tabla de auditoría?

| Opción                                                                  | Ventajas                                                                                                                                     | Riesgos                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Solo logs: 90 días consultables y 12 meses archivados comprimidos** (recomendada) | Cumple 5A sin cambio de esquema; el archivo mensual se sube al bucket de D5 con el mismo cifrado                                               | No es una auditoría **por organización** que un tenant pueda consultar; cualquiera con acceso al backend de logs ve eventos de todas las organizaciones; el archivo no es consultable rápido |
| B. Tabla `audit_events` por organización (RLS, solo inserción)          | Auditoría consultable por el propio tenant; retención con SQL                                                                                | **Cambio de esquema** (exige aprobación, H12), endpoints y UI nuevos, riesgo de volumen en la base y de guardar contenido; contradice 5A salvo que el autor la reabra                          |
| C. A ahora y B diferida con criterio de reapertura (usuarios reales que lo pidan) | Cierra #62 de forma honesta y deja la puerta abierta                                                                                         | #62 queda abierto con otra fase de revisión                                                                                                                                                   |

**Recomendación: A**, cerrar #62 con la retención y las alertas, y dejar B como mejora si aparece una
demanda real de auditoría por tenant. Valores propuestos: 90 días en el backend, 12 meses archivados.
Los registros de acceso de Caddy: 30 días (contienen IP).

## R11 / D11. SBOM y escaneo de imágenes (#64)

**Pregunta:** ¿Dónde se generan el SBOM y el escaneo, y bloquean el merge?

| Opción                                                                                   | Ventajas                                                                                                                                                                | Riesgos                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Un paso en el job `images` existente (escaneo, falla en altas/críticas con corrección) y SBOM CycloneDX en el workflow de publicación** (recomendada) | Mantiene los 6 checks requeridos; el escaneo bloquea el merge a través de un check ya requerido; el SBOM se adjunta a lo que de verdad se publica                        | `images` pasa a cargar la imagen (`load: true`) por arquitectura, lo que alarga el job; falsos positivos de la base Debian obligan a una lista de excepciones con dueño y fecha; el escáner y su base de datos son una dependencia de la cadena de suministro (se fija por digest) |
| B. Un check requerido nuevo                                                              | Visibilidad explícita                                                                                                                                                   | Cambia las reglas de la rama (7 checks) y los gates de F0 a F8; más lento                                                                                              |
| C. Solo al publicar                                                                      | CI de PR más rápido                                                                                                                                                     | Un problema se descubre después del merge, cuando ya está en `main`                                                                                                   |

**Recomendación: A.** Herramientas candidatas: Trivy o Grype para el escaneo, Syft para CycloneDX
(**evaluar** y fijar por digest; el repositorio ya fija imágenes y acciones por digest/SHA). Las
excepciones viven en un archivo versionado con razón, dueño y fecha. La imagen base `bookworm-slim` se
actualiza con Renovate (ya existe).

## R12 / D12. ZAP contra staging (#65)

**Pregunta:** ¿Cómo y cuándo se ejecuta ZAP con sesión y activo?

| Opción                                                                         | Ventajas                                                                                                                                                         | Riesgos                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Script manual ampliado: lista cerrada con staging, usuario de prueba y análisis activo solo en staging** (recomendada) | Coherente con 6A/ADR-0086 (manual, sin check nuevo); sin credenciales de prueba en CI; el autor controla cuándo hay carga                                          | Depende de que el autor lo ejecute (se añade a la lista de comprobación previa a la demo); la evidencia depende de la disciplina                                              |
| B. Workflow manual (`workflow_dispatch`) en CI contra staging                  | Repetible, sin la máquina del autor                                                                                                                              | Credenciales de prueba en GitHub; el runner de GitHub atacando staging por internet (permitido sobre lo propio); ZAP activo contra un staging en la misma VM de producción       |
| C. Programado (nocturno)                                                       | Detecta regresiones sin acordarse                                                                                                                                | Carga continua en la VM compartida; ruido; coste de minutos                                                                                                                    |

**Recomendación: A.** Mantiene la lista cerrada (FR-033): staging definido en un archivo versionado y una
prueba de que el dominio de producción y los hosts de terceros se rechazan. El análisis activo exige las
condiciones de la historia 7 (LLM apagado, correo capturado, límites de tasa intactos).

## R13 / D13. Gemini de pago

**Pregunta:** ¿Cómo se trata la capa gratuita de Gemini en la demo pública (LLM02)?

| Opción                                                      | Ventajas                                                                                                                                | Riesgos                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Capa de pago antes de la demo, con tope en el proveedor y alerta** (recomendada) | El contenido enviado deja de usarse para mejorar productos según las condiciones de la capa de pago (**verificar** el texto vigente); cuotas más altas; es lo que el PLAN y ADR-0088 piden | Coste real (acotado por `LLM_MAX_TOKENS_PER_ORG_DAY`, el presupuesto por ejecución y el tope externo); un registro público puede quemar presupuesto → el límite por organización y el registro son la defensa |
| B. Demo con `LLM_ENABLED=false`                             | Sin coste ni riesgo de datos                                                                                                            | La demo no muestra el valor central (nodos cognitivos y compilador)                                                                                                    |
| C. Demo cerrada (invitaciones) con datos de prueba y la capa gratuita | Sin coste                                                                                                                              | Se queda en `accepted` sin cerrar LLM02; cuotas gratuitas bajas; contradice el requisito "migrar antes de la demo pública"                                              |

**Recomendación: A** (prerrequisito P4). Producción usa su propia clave; staging, ninguna.

## R14 / D14. Proveedor de correo

**Pregunta:** ¿Quién envía los correos del sistema con SPF, DKIM y DMARC?

| Opción                                           | Ventajas                                                                                                                          | Riesgos                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. OCI Email Delivery** (recomendada)          | Mismo panel que la VM; cupo gratuito mensual (**verificar**); DKIM y SPF guiados; el puerto 25 saliente de la VM está bloqueado por defecto, pero este servicio se usa por 587 | Atado a la cuenta de Oracle (se reclama la cuenta, se pierde el correo); proceso de aprobación del remitente puede tardar; reputación de IP compartida                       |
| B. Proveedor transaccional externo (cupo gratuito) | Independiente de Oracle; buena entregabilidad; panel de rebotes                                                                  | Una cuenta más (P5); cupo gratuito que cambia; el contenido de los correos pasa por un tercero (enlaces con tokens de un solo uso: caducan y se usan una vez)                  |
| C. SMTP propio del dominio en la VM              | Control total                                                                                                                     | **Desaconsejada**: reputación de IP, puerto 25 bloqueado, entregabilidad pobre y más superficie que operar                                                               |

**Recomendación: A** (o B si OCI rechaza el remitente). En ambos, el cliente SMTP necesita autenticación y
TLS (H7). DMARC arranca en `p=none` con informes, sube a `quarantine` tras 2 semanas sin falsos negativos
y se evalúa `reject` después.

## R15 / D15. Acceso del operador

**Pregunta:** ¿Cómo entra el operador a la VM y a la interfaz de Temporal?

| Opción                                                        | Ventajas                                                                                                    | Riesgos                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. SSH con llaves en el puerto 22, `fail2ban` y túnel `ssh -L`** (recomendada) | Simple y portable; el acceso a la UI de Temporal queda en el registro de SSH (fila R de E5)                  | Puerto 22 abierto a internet (ruido y fuerza bruta; mitigado con solo llaves, sin `root`, `fail2ban` y reglas de entrada limitadas a la IP del autor si es estática) |
| B. OCI Bastion                                                | Sin puerto 22 público; sesiones con caducidad y auditoría de Oracle                                          | Atado a Oracle; más pasos para cada sesión; no portable                                                                                               |
| C. VPN mallada (WireGuard o Tailscale)                        | Sin puertos públicos salvo 80/443; acceso uniforme a todo                                                   | Un servicio más (cuenta/coordinador en el caso de Tailscale); dependencia del coordinador; más piezas para una sola persona                            |

**Recomendación: A.** Es lo que el PLAN y el modelo de amenazas prevén ("túnel SSH") y lo más portable.

## R16 / D16. Aprovisionamiento

**Pregunta:** ¿Con qué se automatiza la VM?

| Opción                                                   | Ventajas                                                                                                            | Riesgos                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Scripts shell idempotentes y cloud-init** (recomendada) | Sin herramientas extra; portable a cualquier host Linux; se puede probar con un contenedor o una VM de prueba          | Sin estado declarativo: la deriva se detecta por la comprobación del propio script; Bash exige disciplina (`set -euo pipefail`, `shellcheck`)   |
| B. Terraform/OpenTofu para OCI + scripts                 | La infraestructura de Oracle (red, instancia) queda como código y reproducible                                       | Herramienta nueva, estado del plan (secreto), proveedor de OCI, y el PLAN pide portabilidad: Terraform de OCI no migra a otro proveedor      |
| C. Ansible                                               | Idempotencia declarativa, roles                                                                                     | Dependencia de Python/Ansible en el portátil; curva y peso para una sola VM                                                                   |

**Recomendación: A** (Constitución: "aprovisionamiento por script"). `shellcheck` en el job `quality`
sin añadir un check. Los pasos de OCI (crear instancia, red, reglas) se documentan a mano.

## R17 / D17. Rollback

**Pregunta:** ¿Cómo se vuelve atrás?

| Opción                                                               | Ventajas                                                                                                                                       | Riesgos                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Volver a los digests anteriores + copia lógica previa a la migración** (recomendada) | Rápido (minutos) y sin duplicar infraestructura; las migraciones expand/contract permiten que la versión anterior use el esquema nuevo; la copia cubre una migración destructiva | Si una migración rompe la compatibilidad hacia atrás, el rollback del código no basta y hay que restaurar: se prohíbe por regla y por revisión (la copia previa es el seguro) |
| B. Instantánea de volumen antes de cada despliegue                   | Vuelta exacta del estado                                                                                                                       | Dependiente del proveedor, pierde los datos escritos desde el despliegue, y el volumen de arranque de Oracle limita las instantáneas gratuitas (**verificar**)         |
| C. Blue/green                                                        | Cambio instantáneo                                                                                                                             | Duplica la memoria (no cabe cómodamente en la VM) y la complejidad con migraciones compartidas                                                                  |

**Recomendación: A.** Cada despliegue correcto escribe `current` y `previous` (digests) en la VM; el script
`rollback` intercambia y espera la salud.

## R18 / D18. #61 MFA y política de contraseñas

| Opción                                                      | Ventajas                                                                                  | Riesgos                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Fuera de F9; revisión posterior, como dice ADR-0088** (recomendada) | F9 ya está cargada; la decisión 4A se respeta; el rate limit progresivo y Argon2id siguen   | La demo pública acepta contraseñas de 8 a 25 y sin segundo factor (riesgo aceptado ya documentado)                                                      |
| B. TOTP con códigos de recuperación dentro de F9            | Cierra #61                                                                                | Función de producto con esquema, flujos, correo y UI; amplía una fase de despliegue y contradice 4A                                                       |
| C. Solo revisar la política de contraseñas (NIST) sin MFA   | Barato; reduce el riesgo de contraseñas débiles                                           | Cambio de producto menor pero real (ADR-0026 se reemplaza, migración de reglas)                                                                          |

**Recomendación: A.**

## R19 / D19. #66 ejecución `failed` tras fallo de Temporal (webhook)

| Opción                                               | Ventajas                                                  | Riesgos                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Fuera de F9; revisar con datos reales** (recomendada) | Cumple ADR-0088 ("posterior a F9"); el emisor ya reintenta con otro `X-Event-Id` | Con Temporal por mTLS en producción puede haber más fallos transitorios en el arranque; se mide en la observabilidad (métrica de fallos de inicio) antes de decidir |
| B. Corregir en F9                                    | Elimina el caso                                           | Compensación transaccional entre PostgreSQL y Temporal; tocar el camino del webhook justo al desplegar                                                        |

**Recomendación: A**, con una métrica de fallos de inicio de ejecución por webhook en D9 para decidir con
datos.

## R20 / D20. #67 disparos fuera del catch-up

| Opción                                                         | Ventajas                                                                                                       | Riesgos                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Métrica y alerta con las métricas del servidor de Temporal** (recomendada) | ADR-0088 pide revisarlo en F9; el servidor de producción expone métricas Prometheus; barato con D9A o D9B       | Depende de D9 (con D9C no hay métricas); hay que verificar qué métrica expone la versión fijada                                                |
| B. Dejar `accepted`                                            | Cero trabajo                                                                                                   | Pérdida silenciosa de disparos sin medir, justo cuando hay usuarios reales                                                                     |

**Recomendación: A.**

## R21 / D21. #68 frecuencia mínima de la cron

| Opción                                                              | Ventajas                                                                                                                             | Riesgos                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Mínimo configurable (por defecto 5 minutos) validado al crear y al reconciliar** (recomendada) | Barato (validación de la cron en la API y el reconciliador), acota costo y carga en una VM pequeña antes de abrir la demo; sin esquema | Cambio de producto visible (nuevo 422 con `code` estable); programaciones antiguas de menor intervalo: se avisa y se les aplica el mínimo o se pausan (se decide en el plan) |
| B. Dejar `accepted`                                                 | Cero trabajo                                                                                                                         | Cualquier usuario registrado puede programar disparos cada minuto en una demo pública (acotado por 10 programaciones, SKIP y concurrencia) |

**Recomendación: A.**

## R22 / D22. Qué entra en F9 y qué se difiere

| Opción                                                                                       | Ventajas                                                                                                    | Riesgos                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A. F9 completa en 6 PR**: todo el alcance mínimo, #62, #64, #65, #67 y #68 (según D10, D11, D12, D20, D21); #61 y #66 fuera | Cumple el criterio del PLAN ("demo pública con TLS; restauración probada") y las filas `deferred:F9` de ADR-0088 | Fase larga y dependiente de cuentas del autor; el riesgo es que las PR 5 y 6 se retrasen por prerrequisitos                       |
| B. Partir en F9 (despliegue seguro: PR 1–4) y F9.1 (observabilidad avanzada, ZAP activo, #67, #68) | La demo sale antes con TLS, autenticación, backups y rollback                                                | ADR-0088 y la constitución piden cerrar las filas en F9; habría una demo pública con A09 y ZAP activo aún pendientes                |
| C. Mínimo viable: solo borde, #63, secretos y backups                                        | Rápido                                                                                                      | Deja SBOM, ZAP, alertas y Gemini de pago sin hacer: no cumple la condición "no salir sin esto" de ADR-0088 para la demo pública   |

**Recomendación: A**, pero con el hito intermedio de PR 4 ("producción segura"): a partir de ahí se puede
desplegar staging y producción; las PR 5 y 6 cierran observabilidad, correo, ZAP y documentos. Si el
autor se apura, B es el corte natural. **Lo no recomendable es C.**

---

## Detalles técnicos (consecuencia de las recomendaciones; se ajustan con las respuestas)

### T1. Cabeceras de Caddy

- CSP propuesta (a validar contra el build real; se ajusta con una prueba de navegador): `default-src
  'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. React Flow aplica
  estilos en línea mediante el atributo `style`: si el build lo exige se usa `style-src-attr
  'unsafe-inline'` (solo atributos, nunca scripts) y se registra en un ADR. `script-src` nunca lleva
  `unsafe-inline` ni `unsafe-eval`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` en producción (sin `preload` hasta
  verificar que todo subdominio es HTTPS); en staging `max-age=300` hasta confirmar.
- `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`: con mismo origen y sin recursos de terceros no rompen nada;
  si COEP rompiera algún recurso, se baja a `credentialless` y se documenta.
- `Permissions-Policy` con todas las funciones sensibles vacías (`camera=(), microphone=(), geolocation=()
  …`). `Referrer-Policy: strict-origin-when-cross-origin`. Se elimina `Server`.
- `/api/*`: `reverse_proxy` a la API; las cabeceras de Helmet de la API se respetan (Caddy no las pisa); SSE
  con `flush_interval -1` y sin compresión de `text/event-stream`.
- Registro de acceso: formato JSON, filtro que reemplaza el segmento de token de `/api/v1/hooks/*` y
  elimina `Cookie`, `Authorization` y `X-CSRF-Token`; prueba con el token de un webhook de prueba (T068 de F7).

### T2. Temporal en producción

- Servidor `temporalio/server` (no `temporal server start-dev`), con PostgreSQL como persistencia y
  visibilidad (bases `temporal` y `temporal_visibility` en la misma instancia, rol propio), esquema
  creado con la herramienta SQL oficial por una tarea de un solo uso, search attribute `CorrelationId`
  registrado, namespace propio, mTLS en el frontend (`requireClientAuth`) y TLS interno; UI en
  `127.0.0.1:8233` de la VM, sin autenticación propia (por eso solo túnel).
- Retención del namespace acotada: el historial contiene entradas y salidas sin cifrar (ADR-0050,
  fila F3-I `accepted`); se fija una retención corta y se evalúa un data converter después.
- Las métricas del servidor se exponen en la red interna para D9 y #67.

### T3. PostgreSQL y Valkey

- PostgreSQL: `ssl=on`, `ssl_min_protocol_version=TLSv1.3` (verificar compatibilidad del cliente),
  `pg_hba.conf` solo `hostssl … scram-sha-256`, `password_encryption=scram-sha-256`, inicializador de
  roles que lee las contraseñas desde archivos de secretos (el actual `01-roles.sql` es de desarrollo).
- Valkey: `port 0`, `tls-port 6379`, `tls-auth-clients optional` o `yes` según el cliente, ACL en archivo
  con usuario `app` de comandos mínimos (los scripts Lua requieren `+eval`/`+evalsha` y sus `+@`
  asociados; se deriva el conjunto exacto de las pruebas de integración y se fija con una prueba),
  `maxmemory` y `maxmemory-policy noeviction`, y contraseña del usuario por defecto desactivada.

### T4. Imágenes y publicación

- Cuatro imágenes: `api`, `worker`, `migrator` (herramienta de migraciones, sin servidor), `edge`.
  Todas Debian `bookworm-slim` (la de borde sobre la de Caddy oficial), usuario no root, fijadas por
  digest, multi-arch con el builder arm64 nativo y manifiesto combinado (sin QEMU, regla del PLAN §9.1).
- Workflow `release.yml` separado de `ci.yml`: `on: push` a `main`; permisos mínimos por job; etiqueta con
  SHA; salida con el digest; no se ejecuta en PR de forks.
- Provenance y SBOM de BuildKit son una opción; el SBOM exigido es CycloneDX.

### T5. Backups

- `restic` contra el destino de D5 con contraseña de repositorio de la VM (para escribir) y copia en el
  gestor del autor; `pg_dump` en formato personalizado de las bases `cognitive_dag` y `temporal`, más
  `pg_dumpall --globals-only` para los roles; comprobación semanal `restic check` y restauración
  completa periódica (mensual propuesto) en un contenedor limpio con la prueba de humo.
- La copia **no** incluye secretos de la VM; esos viajan por la copia cifrada del gestor del autor (D4).

### T6. Métricas mínimas (PLAN §7)

Peticiones por ruta normalizada y estado; ejecuciones por estado; fallos de inicio por webhook (D19);
tokens y costo (por organización con un tope de cardinalidad, y global); circuit breakers abiertos;
latencia de actividades LLM; salud de dependencias. Sin etiquetas con identificadores de usuario ni
contenido.
