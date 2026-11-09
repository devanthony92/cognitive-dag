# Feature Specification: Despliegue (F9)

**Feature Branch**: `010-deployment`

**Created**: 2026-11-09

**Status**: Draft. Las decisiones D1 a D22 esperan la respuesta del autor (formato "1A 2B 3A…").

**Input**: User description: "Fase F9 de docs/PLAN.md: VM Oracle Always Free (ARM), Compose de
producción, Caddy, backups, observabilidad y todo lo que F7 y F8 difirieron al despliegue
([ADR-0088](../../docs/adr/0088-riesgos-aceptados-y-diferidos-a-f9.md)): autenticación y TLS de
Temporal, PostgreSQL y Valkey (#63), cabeceras de la SPA (ZAP 10038, 10020, 10021, 10063 y 90004),
redacción de `/api/v1/hooks/*`, SBOM y escaneo de imágenes (#64), ZAP activo y con sesión contra
staging (#65), retención y alertas de eventos de seguridad y de costo (#62), SPF, DKIM y DMARC, y
Gemini de pago antes de la demo pública. Terminado cuando: demo pública con TLS y restauración de
backup probada."

> **Esta tarea solo especifica.** No se despliega nada, no se crean cuentas, no se registran dominios y
> no se toca ningún servicio externo. Lo que depende del autor está en
> [Prerrequisitos del autor](#prerrequisitos-del-autor).

## Estado de partida (leído en `main` e424bb5)

Hechos que condicionan el diseño y que la spec no puede dar por supuestos:

- CI solo **construye** las imágenes de `api` y `worker` (`push: false`). No existe registro, ni
  publicación, ni workflow de despliegue. No hay Dockerfile de la web ni de las migraciones.
- `compose.yaml` es solo para desarrollo: Temporal corre con `server start-dev` (SQLite, sin
  autenticación), PostgreSQL con contraseñas `*_dev_only`, Valkey sin contraseña, Mailpit como correo.
- La web usa `VITE_API_URL` **en tiempo de compilación** (`apps/web/src/api/client.ts`): una imagen
  construida para un dominio no sirve para otro.
- La sesión es la cookie `__Host-session` (`SameSite=Lax`, sin `Domain`) y el CSRF compara `Origin`
  con `WEB_ORIGIN`. Web y API deben compartir sitio; conviene que compartan origen.
- La API no configura `trust proxy`: detrás de Caddy vería siempre la IP del proxy, y el límite de
  tasa por IP y el campo `ip` de los eventos de seguridad quedarían inservibles.
- Los clientes de Temporal (`apps/api`, `apps/worker`) se conectan sin opciones TLS; el correo
  (`SMTP_HOST`, `SMTP_PORT`) no admite usuario, contraseña ni TLS; no hay métricas ni OpenTelemetry
  instalados aunque `docs/PLAN.md` §7 los prevé.
- `infra/postgres/init/01-roles.sql` fija contraseñas de desarrollo en el propio script.
- Migraciones: `pnpm db:migrate` como `app_migrator`; son expand/contract (constitución, principio VIII).

## User Scenarios & Testing *(mandatory)*

Actores: el autor y operador de la plataforma (despliega, rota secretos, restaura), el visitante de la
demo pública, el usuario registrado (owner, editor o viewer), el emisor de un webhook, un atacante en
internet que sondea Caddy, la API, Temporal, PostgreSQL y Valkey, un atacante con acceso a la red
interna de contenedores, y quien revisa la seguridad (ZAP, escáner de imágenes).

### User Story 1 - La plataforma responde por HTTPS con las cabeceras de seguridad (Priority: P1)

Un visitante abre el dominio de la demo y obtiene la SPA por TLS, con HSTS y las cabeceras que ZAP pidió
en F8. Una petición `http://` redirige a `https://`. El navegador no puede enmarcar la web ni ejecutar
scripts en línea. Los webhooks entran solo por TLS y su token nunca queda en los registros de acceso de
Caddy.

**Why this priority**: es el criterio de terminado ("demo pública con TLS") y cierra cinco alertas de ZAP
y dos amenazas `deferred:F9` del modelo de amenazas.

**Independent Test**: contra staging, `curl -sI` a `/`, a una ruta de la SPA y a `/api/v1/health`; ZAP
baseline sin las alertas 10038, 10020, 10021, 10063 y 90004; una petición a
`/api/v1/hooks/<id>/<token-de-prueba>` y búsqueda del token en los registros de Caddy.

**Acceptance Scenarios**:

1. **Given** una petición `http://` al dominio, **When** llega a Caddy, **Then** recibe un redireccionamiento
   permanente a `https://` y ningún contenido ni cookie por HTTP.
2. **Given** cualquier respuesta de la web estática, **When** se inspeccionan sus cabeceras, **Then**
   incluye `Strict-Transport-Security`, `Content-Security-Policy` con `default-src 'self'`, sin
   `unsafe-inline` en `script-src` y con `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
   `X-Content-Type-Options: nosniff`, `Permissions-Policy`, `Cross-Origin-Embedder-Policy`,
   `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`; y no revela `Server` ni versión.
3. **Given** el build de producción de la SPA, **When** se carga en un navegador con esa CSP, **Then**
   la aplicación funciona completa (editor, ejecución en vivo por SSE, compilador) sin violaciones de CSP
   en la consola; si el build exige relajar una directiva de estilos, la excepción queda en un ADR.
4. **Given** una petición a `/api/v1/hooks/{triggerId}/{token}`, **When** Caddy escribe su registro de
   acceso, **Then** la ruta aparece con el token redactado y una búsqueda del token en todos los registros
   no encuentra nada.
5. **Given** la API detrás de Caddy, **When** una petición llega con `X-Forwarded-For`, **Then** la API
   usa la IP real del cliente solo si el salto viene del proxy configurado, para el límite de tasa y para
   el campo `ip` de los eventos de seguridad; un cliente que envía su propio `X-Forwarded-For` no puede
   falsear su IP.
6. **Given** el flujo en vivo de una ejecución (SSE), **When** pasa por Caddy, **Then** los eventos
   llegan sin retraso por búfer y la conexión sobrevive al latido de la API.

---

### User Story 2 - Producción no sale sin autenticación y TLS en Temporal, PostgreSQL y Valkey (Priority: P1)

El operador despliega y comprueba que Temporal exige mTLS, PostgreSQL exige TLS y credenciales propias, y
Valkey exige TLS y ACL, y que una conexión sin credenciales falla en cada uno. La interfaz de Temporal
solo es alcanzable por túnel SSH. La API y el worker se niegan a arrancar en producción si falta TLS o
una credencial fuerte.

**Why this priority**: es la condición explícita de la decisión 8C y del issue #63 ("producción no puede
salir sin esto"); cubre 14 filas `deferred:F9` del modelo de amenazas.

**Independent Test**: desde dentro de la red de contenedores y desde fuera de la VM, intentar conectar a
cada servicio sin credencial, con credencial de desarrollo y sin TLS; todos fallan. Con las credenciales
de producción, la aplicación funciona.

**Acceptance Scenarios**:

1. **Given** el servidor de Temporal de producción, **When** un cliente se conecta sin certificado de
   cliente, con uno de otra CA o sin TLS, **Then** la conexión se rechaza; con el certificado del worker
   o de la API se acepta. Los certificados tienen vigencia acotada y un procedimiento de rotación.
2. **Given** la interfaz de Temporal, **When** se intenta alcanzar desde internet, **Then** no responde:
   solo escucha en el loopback de la VM y se usa por `ssh -L`; el acceso queda en el registro de SSH.
3. **Given** PostgreSQL de producción, **When** se conecta sin TLS, con `local_dev_only` o con la
   contraseña de desarrollo de `app_runtime`, **Then** falla; `app_runtime` y `app_migrator` tienen
   contraseñas propias y distintas, y `pg_hba` rechaza lo que no sea `hostssl` con `scram-sha-256`.
4. **Given** Valkey de producción, **When** se envía `PING` sin autenticar, o `FLUSHALL`, `CONFIG` o
   `KEYS *` con el usuario de la aplicación, **Then** falla; con memoria llena la API falla cerrado
   (503) en lugar de colgarse; los scripts Lua y los comandos de la aplicación siguen funcionando.
5. **Given** `NODE_ENV=production`, **When** la API o el worker arrancan con una URL de PostgreSQL o
   Valkey sin TLS, una conexión a Temporal sin TLS, o una contraseña presente en la lista de valores de
   desarrollo, **Then** el proceso termina nombrando solo las variables, nunca los valores (principio I,
   fallar cerrado).
6. **Given** el almacén de Temporal, **When** se inspecciona la instalación, **Then** usa PostgreSQL (base
   distinta de la de la aplicación, con su propio rol) y no SQLite; el namespace de producción no es el de
   desarrollo.
7. **Given** la red de contenedores, **When** se listan los puertos publicados en el anfitrión, **Then**
   solo Caddy publica 80 y 443; PostgreSQL, Valkey, Temporal, la API y el worker no publican nada.

---

### User Story 3 - Secretos fuera del repositorio y rotables (Priority: P1)

El operador provisiona una VM nueva con un script y esta obtiene sus secretos sin que ninguno viva en el
repositorio, en una imagen, en los registros de CI ni en una variable visible con `docker inspect` de
forma innecesaria. Rotar un secreto es un procedimiento escrito y probado.

**Why this priority**: el repositorio es público (constitución, principio I) y gitleaks escanea todo el
historial; una fuga de producción obliga a rotarlo todo.

**Independent Test**: clonar el repositorio y las imágenes publicadas en un directorio limpio y buscar
cualquier valor de la VM; provisionar una VM de prueba desde cero y comprobar que arranca; rotar un
secreto y comprobar que el servicio vuelve sano.

**Acceptance Scenarios**:

1. **Given** el script de aprovisionamiento, **When** se ejecuta en una VM limpia, **Then** genera o recibe
   los secretos (contraseñas de PostgreSQL y Valkey, CA y certificados internos, `CREDENTIALS_MASTER_KEY`,
   clave de Gemini, credenciales SMTP) y los deja con permisos `0600` de `root` fuera del árbol del
   repositorio; ninguno se imprime en pantalla ni en los registros.
2. **Given** las imágenes publicadas, **When** se inspeccionan sus capas y su configuración, **Then** no
   contienen ningún secreto ni `.env`.
3. **Given** la llave maestra de credenciales de los conectores, **When** se pierde la VM, **Then** existe
   una copia cifrada fuera de la VM, distinta de la de los backups de datos, o queda escrito que sin ella
   las credenciales de los conectores no son recuperables.
4. **Given** el procedimiento de rotación, **When** se rota la contraseña de PostgreSQL, el certificado de
   Temporal o la clave de Gemini, **Then** el servicio afectado se reinicia en orden y el sistema vuelve a
   estado sano sin pérdida de datos; la llave maestra de credenciales queda fuera de alcance (ya diferida).
5. **Given** el flujo de CI y de despliegue, **When** corre, **Then** los secretos necesarios para
   desplegar viven solo en el almacén de secretos de la plataforma elegida y nunca aparecen en los
   registros (`--redact`, enmascarado).

---

### User Story 4 - Backups externos con restauración probada (Priority: P1)

Cada día se copia la base de datos de la aplicación y la de Temporal fuera de la VM, cifradas. El
operador restaura una copia en un entorno limpio y comprueba que la aplicación funciona y que RLS sigue
forzada.

**Why this priority**: es el segundo criterio de terminado ("restauración de backup probada") y el riesgo
nº 1 de Oracle Always Free (puede reclamar o cambiar la instancia).

**Independent Test**: ejecutar el script de restauración sobre una VM o Compose vacíos con la última
copia; ejecutar la prueba de humo y la comprobación de RLS.

**Acceptance Scenarios**:

1. **Given** el trabajo de backup, **When** corre, **Then** produce una copia cifrada de PostgreSQL
   (aplicación y Temporal) y la sube al destino externo; si falla, genera una alerta; la clave de cifrado
   no vive solo en la VM.
2. **Given** la copia más reciente, **When** se restaura en un entorno limpio con el script documentado,
   **Then** las migraciones quedan al día, los roles `app_migrator` y `app_runtime` existen con sus
   privilegios (sin `DELETE`, sin `BYPASSRLS`), la RLS sigue forzada y la prueba de humo de la aplicación
   pasa; se mide y se registra el tiempo de restauración (RTO) y la antigüedad de la copia (RPO).
3. **Given** el destino de backups, **When** se revisa la retención, **Then** hay una política escrita
   (diaria, semanal y mensual) y un borrado automático, y el acceso de escritura de la VM no puede borrar
   copias antiguas.
4. **Given** la restauración, **When** termina, **Then** se repite cada cierto tiempo (frecuencia en el
   plan) y su fecha y resultado quedan registrados como evidencia.
5. **Given** que el contenido de entradas y salidas vive en el historial de Temporal (ADR-0050), **When**
   se define qué se respalda, **Then** el almacén de Temporal está incluido y la copia hereda el mismo
   cifrado y retención.

---

### User Story 5 - Se publican imágenes verificadas y se despliega con migraciones y reversa (Priority: P1)

Un cambio en `main` termina en imágenes `linux/amd64` y `linux/arm64` en un registro, identificadas por
digest, escaneadas y con SBOM. El operador despliega una versión concreta, las migraciones corren antes
de arrancar la versión nueva y, si algo falla, vuelve a la versión anterior con un comando.

**Why this priority**: hoy CI no publica nada; sin esto no hay despliegue repetible. Cubre #64.

**Independent Test**: tras un merge de prueba, comprobar que el registro tiene el manifiesto multi-arch
con las imágenes de `api`, `worker`, `migrator` y la web; desplegar a staging; forzar un fallo y revertir.

**Acceptance Scenarios**:

1. **Given** un merge en `main`, **When** corre el workflow de publicación, **Then** publica por separado
   las imágenes `api`, `worker`, `migrator` y la de la web estática, cada una con manifiesto multi-arch
   (build arm64 en el runner nativo), etiquetada con el SHA del commit y referenciada por digest; los
   6 checks requeridos de CI no cambian y `ci.yml` conserva `contents: read`.
2. **Given** las imágenes finales, **When** se escanean, **Then** el escáner falla ante vulnerabilidades
   altas o críticas con corrección disponible (con una lista de excepciones con razón, dueño y fecha) y
   cada imagen publicada lleva un SBOM CycloneDX consultable.
3. **Given** una versión nueva, **When** se despliega, **Then** primero corre `migrator` como
   `app_migrator` en un contenedor de un solo uso; si la migración falla, no se arranca nada nuevo y la
   versión anterior sigue sirviendo; nunca se usa `app_migrator` desde la API.
4. **Given** un despliegue que falla la comprobación de salud, **When** se ejecuta el rollback, **Then** el
   sistema vuelve a los digests anteriores en minutos, y la regla expand/contract garantiza que la versión
   anterior funciona con el esquema nuevo.
5. **Given** los workflows con permisos de publicación, **When** se revisan, **Then** el permiso
   `packages: write` (o el del registro elegido) vive solo en el workflow de publicación, las acciones
   están fijadas por SHA y ningún secreto se imprime.
6. **Given** el arranque de un servicio nuevo, **When** el despliegue lo verifica, **Then** espera a las
   comprobaciones de salud (`/api/v1/health/ready`, salud del worker) y el despliegue falla si no se
   cumplen en un plazo fijado.

---

### User Story 6 - Eventos de seguridad con retención y alertas de autenticación y de costo (Priority: P2)

El operador recibe una alerta cuando hay un pico de fallos de autenticación o de gasto de Gemini, y los
eventos de seguridad se conservan un tiempo definido para investigar. Las métricas necesarias para #67
existen.

**Why this priority**: cierra A09 (#62) y la lectura de los riesgos aceptados de F8.

**Independent Test**: provocar 20 logins fallidos y comprobar que llega la alerta de prueba; superar un
umbral de costo de prueba y comprobar la alerta; buscar un evento de hace N días dentro de la retención.

**Acceptance Scenarios**:

1. **Given** los eventos de seguridad de ADR-0038 (`auth.login_failed`, `auth.rate_limited`,
   `approval.*`, `circuit.*`, `schedule.*`), **When** se despliega, **Then** llegan a un almacén con la
   retención definida en D10, consultable por `event`, `organizationId` y `correlationId`, sin contenido
   de usuario (la redacción de logs se verifica con una búsqueda de un canario).
2. **Given** más de un umbral configurado de `auth.login_failed` o `auth.rate_limited` en una ventana,
   **When** se supera, **Then** se envía una alerta al operador por el canal elegido.
3. **Given** el gasto de Gemini (tokens y costo por organización y global), **When** supera el umbral
   diario, **Then** se envía una alerta; existe además un tope de gasto en el proveedor (prerrequisito
   del autor).
4. **Given** un fallo de la base, del worker o de Temporal, **When** el estado de salud cambia, **Then**
   se alerta; las alertas de prueba se ejecutan con un procedimiento y llegan.
5. **Given** la elección de D20, **When** se cierra la fase, **Then** existe la métrica de disparos
   descartados fuera de la ventana de catch-up o queda `accepted` con la nueva fecha de revisión.

---

### User Story 7 - Staging, ZAP activo y con sesión (Priority: P2)

Existe un entorno de staging con TLS donde ZAP corre con sesión iniciada y análisis activo sin tocar
datos reales ni a terceros, y se repite el baseline pasivo que debe mostrar las cinco alertas de la web
ya resueltas.

**Why this priority**: es la prueba de aceptación de las cabeceras de Caddy y cierra #65.

**Independent Test**: ejecutar el script ampliado contra staging y comparar el informe con
`docs/security/zap.md`.

**Acceptance Scenarios**:

1. **Given** staging, **When** corre el baseline pasivo, **Then** 10038, 10020, 10021, 10063 y 90004
   desaparecen y no aparece ninguna alerta nueva media o alta sin decisión.
2. **Given** el script de ZAP, **When** se amplía para staging, **Then** solo acepta los hosts de una
   lista cerrada y versionada (loopback y los hosts de staging), con una prueba que falla si se añade el
   dominio de producción o un host de terceros; el análisis activo nunca apunta a producción.
3. **Given** el análisis con sesión, **When** se ejecuta, **Then** usa un usuario de prueba creado en
   staging, con los tres roles, y el informe no contiene cookies, tokens ni valores de secretos (la
   comprobación del script de F8 se mantiene).
4. **Given** el análisis activo, **When** corre, **Then** staging tiene `LLM_ENABLED=false`, el correo
   desviado a un buzón de captura y límites de tasa de producción intactos, y ningún destino HTTP
   saliente permitido más allá del propio staging.
5. **Given** cada alerta nueva de nivel medio o alto, **When** termina, **Then** se corrige con prueba de
   regresión, se marca falso positivo o se acepta con razón, dueño y fecha, como en F8.

---

### User Story 8 - Correo que no se puede falsificar y Gemini de pago antes de la demo (Priority: P2)

Los correos del sistema (verificación, restablecimiento, invitaciones, aprobaciones) salen de un
proveedor real con SPF, DKIM y DMARC válidos. La demo pública usa la capa de pago de Gemini.

**Why this priority**: A07, E10 y LLM02; son condiciones de la demo pública.

**Independent Test**: enviar un correo de prueba a un buzón que muestre las cabeceras de autenticación
(SPF, DKIM y DMARC en `pass`); comprobar que la configuración de producción usa la clave de pago.

**Acceptance Scenarios**:

1. **Given** el dominio del sistema, **When** se envía un correo de prueba, **Then** SPF, DKIM y DMARC
   pasan y la política DMARC arranca en `p=none` con informes y sube a `quarantine` tras una ventana de
   observación escrita.
2. **Given** el cliente SMTP de la API, **When** se configura para producción, **Then** admite STARTTLS o
   TLS implícito y autenticación, y falla cerrado en producción si el servidor no ofrece TLS.
3. **Given** la clave de pago de Gemini, **When** se carga, **Then** vive solo en el almacén de secretos
   de la VM, el worker de producción la usa, y staging y desarrollo siguen con la capa gratuita o sin
   LLM; la tabla de precios `LLM_PRICES` coincide con la facturación real.
4. **Given** que el aviso de la capa gratuita se muestra en los paneles LLM y en el compilador, **When**
   producción usa la capa de pago, **Then** el aviso refleja la política de datos real o se retira, con
   la fecha de verificación en el modelo de amenazas.

---

### User Story 9 - Cierre: modelo de amenazas, matriz y deuda de F8 (Priority: P2)

Cada fila `deferred:F9` y `accepted` con revisión F9 de la matriz OWASP y del modelo de amenazas termina
`verified` con su prueba o se reabre con razón nueva. Los issues #61 a #68 reciben el tratamiento que el
autor decidió.

**Why this priority**: [ADR-0088](../../docs/adr/0088-riesgos-aceptados-y-diferidos-a-f9.md) exige que
"al cerrar F9 cada fila pase a `verified` o se reabra".

**Independent Test**: `pnpm security:evidence` pasa; ninguna fila `deferred:F9`; cada issue tiene su
desenlace (cerrado con la PR, o abierto con su fase de revisión).

**Acceptance Scenarios**:

1. **Given** el modelo de amenazas v2.0 y la matriz, **When** se cierra F9, **Then** el modelo pasa a
   v3.0 sin filas `deferred:F9`, con Caddy, backups, observabilidad, registro y staging incorporados
   al diagrama como elementos reales.
2. **Given** los issues #61 a #68, **When** se cierra F9, **Then** cada uno queda cerrado por una tarea
   de F9 o abierto con la fase de revisión que decidió el autor en D18 a D21.
3. **Given** la matriz, **When** se regenera, **Then** A03 pasa a `verified` con SBOM y escaneo, A09 a
   `verified` con retención y alertas, A02 y A04 sin parciales por falta de TLS, y LLM02 a `verified`
   con la capa de pago.
4. **Given** `docs/PLAN.md` §9, **When** se cierra F9, **Then** describe lo desplegado (no lo previsto),
   incluida la tabla de memoria medida y las decisiones D1 a D22.

### Edge Cases

- Oracle no tiene capacidad A1 en la región al crear la instancia: la spec exige que todo funcione igual
  en cualquier host Linux x64 o arm64 con Docker (portabilidad, constitución); el plan lo prueba
  levantando el mismo Compose en otro host.
- Let's Encrypt limita certificados o el DNS aún no apunta a la VM: el procedimiento incluye el entorno
  de pruebas de la CA (staging de Caddy) y no repite emisiones fallidas.
- Un certificado interno caduca un fin de semana: la vigencia, el aviso previo (≥ 30 días) y el comando
  de rotación están escritos y la alerta de caducidad existe.
- La migración nueva tarda o bloquea: el despliegue tiene un plazo y deja la versión anterior servida;
  se prohíben migraciones que rompan a la versión anterior (expand/contract).
- Oracle reclama la VM por inactividad: se vigila el uso mínimo exigido por la política vigente (fecha
  de consulta anotada) y la restauración en otro host cubre ese caso.
- La VM se queda sin memoria: cada servicio tiene límite y reinicio; el orden de OOM prefiere sacrificar
  la interfaz de Temporal y el agente de observabilidad antes que la base de datos.
- Staging y producción en la misma VM compiten por recursos: staging se levanta bajo demanda y tiene
  límites menores (D2).
- Un secreto se sospecha filtrado: existe una lista de qué rotar y en qué orden, y gitleaks sigue
  escaneando todo el historial.
- Los registros de Caddy tienen otros datos personales (IP, user agent): se documenta la retención de los
  registros de acceso y no se registran cuerpos ni cabeceras `Cookie` ni `Authorization`.
- El navegador de un usuario guarda en caché una SPA antigua tras un despliegue: los archivos con hash se
  sirven con caché larga e inmutable y `index.html` con `no-cache`.
- La restauración encuentra una copia corrupta: se verifica la integridad al subir y al restaurar, y se
  conserva más de una generación.

## Requirements *(mandatory)*

### Functional Requirements

Las marcas **[Dn]** señalan los requisitos cuya forma exacta depende de la decisión del autor. Mientras no
haya respuesta, el requisito rige en la forma recomendada.

**Borde, TLS y cabeceras (Caddy)**

- **FR-001**: Caddy MUST terminar TLS para el dominio público con certificados automáticos, redirigir HTTP
  a HTTPS y enviar HSTS (`max-age` ≥ 1 año en producción; corto en staging mientras no se verifique).
- **FR-002**: La web estática MUST servirse con `Content-Security-Policy` (`default-src 'self'`, sin
  `unsafe-inline` en `script-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy` restrictiva, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy` y
  `Cross-Origin-Resource-Policy` [D6, D7]. Una prueba MUST fijar el conjunto sobre la configuración
  real, y repetir ZAP contra staging MUST no mostrar 10038, 10020, 10021, 10063 ni 90004.
- **FR-003**: El registro de acceso de Caddy MUST redactar el token de `/api/v1/hooks/*`, no registrar
  cuerpos ni las cabeceras `Cookie`, `Authorization` y `X-CSRF-Token`, y una prueba MUST demostrar que un
  token de prueba no aparece en ninguna línea.
- **FR-004**: Caddy MUST ser el único servicio que publica puertos (80 y 443) en el anfitrión; las rutas
  `/api/*` pasan a la API con soporte de SSE (sin búfer ni compresión del flujo, plazos compatibles con el
  latido) y un límite de cuerpo coherente con `BODY_LIMIT` [D6].
- **FR-005**: La API MUST configurar `trust proxy` solo para el salto de Caddy (lista cerrada), de modo que
  el límite de tasa y los eventos de seguridad usen la IP real y un `X-Forwarded-For` del cliente no
  tenga efecto. Prueba de integración con y sin proxy de confianza.
- **FR-006**: Los archivos con hash de la SPA MUST servirse con caché larga e inmutable y `index.html` sin
  caché; la imagen de la web MUST ser independiente del dominio (sin `VITE_API_URL` fijo al compilar)
  [D6, D7].

**Autenticación y TLS de la infraestructura (#63)**

- **FR-007**: Temporal MUST ejecutarse como servidor de producción con PostgreSQL como almacén (base y rol
  propios, distintos de los de la aplicación), mTLS en el frontend, namespace propio, y sin publicar
  puertos en el anfitrión. La interfaz MUST escuchar solo en el loopback de la VM, accesible por túnel
  SSH [D15].
- **FR-008**: El cliente de Temporal de la API y del worker MUST admitir TLS con certificado de cliente
  (variables de CA, certificado, clave y nombre del servidor) y MUST fallar al arrancar en producción sin
  ellas.
- **FR-009**: PostgreSQL MUST exigir TLS (`ssl=on`, `pg_hba` solo `hostssl` con `scram-sha-256`), con
  contraseñas propias y distintas para `app_migrator`, `app_runtime` y el rol del almacén de Temporal,
  inyectadas desde el almacén de secretos y no escritas en scripts versionados. Las URL de conexión MUST
  verificar el certificado del servidor (`verify-full`).
- **FR-010**: Valkey MUST exigir TLS (sin puerto en claro), autenticación por ACL con un usuario de la
  aplicación de comandos mínimos (sin `FLUSHALL`, `FLUSHDB`, `CONFIG`, `KEYS`, `DEBUG`, `SHUTDOWN`; con
  los comandos y scripts Lua que la aplicación usa), `maxmemory` fijado y la política de expulsión que
  haga fallar cerrado (`noeviction`) en lugar de perder sesiones o contadores. La URL MUST usar `rediss://`.
- **FR-011**: Una PKI interna (CA propia, certificados de vigencia acotada para Temporal, PostgreSQL y
  Valkey, y para los clientes) MUST generarse por el script de aprovisionamiento, con procedimiento de
  rotación y alerta de caducidad [D8].
- **FR-012**: En `NODE_ENV=production` la API y el worker MUST fallar al arrancar si una URL de PostgreSQL o
  Valkey no usa TLS, si falta la configuración TLS de Temporal, si una contraseña coincide con las de
  desarrollo conocidas o si falta `CREDENTIALS_MASTER_KEY`; el mensaje nombra variables, nunca valores
  (principios I y IV; `env.schema.test.ts` se extiende).
- **FR-013**: Una prueba de despliegue MUST demostrar, contra staging, que cada servicio rechaza una
  conexión sin credenciales y sin TLS (las "pruebas previstas" de las filas `deferred:F9`).

**Secretos y aprovisionamiento**

- **FR-014**: El repositorio MUST contener únicamente plantillas sin valores de los archivos de entorno de
  producción (nombres de variables y su origen), y el comprobador de gitleaks MUST seguir pasando sobre
  todo el historial; ningún valor con forma de secreto, ni de ejemplo, entra al repositorio.
- **FR-015**: El almacén de secretos de la VM MUST ser el de D4, con permisos mínimos, generación local de
  los secretos que pueda producir la propia VM, una copia cifrada fuera de la VM y un procedimiento de
  rotación probado por secreto [D4].
- **FR-016**: Un script idempotente MUST aprovisionar una VM Linux limpia (x64 o arm64) hasta dejar Docker,
  el cortafuegos del anfitrión, SSH endurecido (solo llaves, sin contraseña ni acceso de `root`), usuario
  de despliegue, directorios de datos, PKI, secretos y el Compose de producción listo para arrancar
  [D16]. La infraestructura de Oracle (instancia, red, reglas de entrada 22, 80 y 443) se documenta paso a
  paso con sus valores, sin automatizar la creación de la cuenta.
- **FR-017**: El Compose de producción MUST fijar por servicio un límite de memoria (`mem_limit`), CPU
  compartida razonable, política de reinicio, comprobación de salud, usuario no root, sistema de archivos
  de solo lectura donde sea posible y rotación de los registros del motor (`max-size`, `max-file`). Los
  límites y el consumo real medido se tabulan en el plan (la suma queda por debajo del 60 % de los 12 GB).
- **FR-018**: Las imágenes del Compose de producción MUST fijarse por digest (como en desarrollo) y las
  imágenes propias MUST referenciarse por digest en el despliegue, nunca por una etiqueta móvil.

**Backups y restauración**

- **FR-019**: Un trabajo programado MUST respaldar PostgreSQL (aplicación y almacén de Temporal) con
  cifrado del lado del cliente, subirlo al destino de D5 y alertar si falla o si la última copia supera
  el RPO acordado (24 h) [D5].
- **FR-020**: Un script de restauración MUST dejar un entorno limpio operativo desde una copia, y una
  prueba de humo MUST comprobar roles, RLS forzada y un flujo de extremo a extremo; el resultado, el RTO y
  el RPO medidos MUST registrarse en un documento de evidencia versionado (sin datos).
- **FR-021**: La política de retención de las copias MUST estar escrita y automatizada, y las credenciales
  de la VM sobre el destino MUST permitir escribir pero no borrar copias ajenas a la rotación [D5].

**Publicación, despliegue y reversa**

- **FR-022**: Un workflow de publicación MUST construir y publicar las imágenes `api`, `worker`,
  `migrator` y web para `linux/amd64` y `linux/arm64` en el registro de D1, con permisos de escritura solo
  en ese workflow, acciones fijadas por SHA y salida por digest [D1].
- **FR-023**: Cada imagen publicada MUST escanearse (falla ante altas y críticas con corrección
  disponible) y llevar un SBOM CycloneDX; el escaneo y el SBOM MUST ejecutarse sin añadir checks
  requeridos a la rama (siguen siendo 6) [D11].
- **FR-024**: Existe un workflow o script de despliegue que MUST: resolver los digests de una versión,
  ejecutar `migrator`, arrancar los servicios nuevos, esperar las comprobaciones de salud y fallar con la
  versión anterior intacta [D3].
- **FR-025**: El rollback MUST consistir en volver a los digests anteriores (registrados en la VM tras cada
  despliegue correcto) con un comando, más una copia lógica previa a la migración; las migraciones siguen
  siendo expand/contract y no hay migraciones inversas [D17].
- **FR-026**: Un `migrator` MUST ejecutar las migraciones con `app_migrator` desde una imagen propia, sin
  herramientas de desarrollo en la imagen de la API.

**Observabilidad, eventos y costo (#62)**

- **FR-027**: Los registros estructurados de API, worker y Caddy MUST llegar a un almacén con la
  retención de D10 y consultable por `event`, `organizationId` y `correlationId`; el envío MUST reutilizar
  la redacción existente y una prueba MUST demostrar que un canario de contenido de usuario no llega
  [D9, D10].
- **FR-028**: MUST existir alertas con procedimiento de prueba para: fallos de autenticación por encima de
  umbral, gasto de Gemini por encima de umbral diario, servicio no sano, última copia vieja, certificado
  próximo a caducar y espacio en disco bajo [D9].
- **FR-029**: La API y el worker MUST exponer las métricas mínimas de `docs/PLAN.md` §7 que F9 necesita
  (peticiones por estado, ejecuciones por estado, tokens y costo por organización y global, estado de los
  circuit breakers) sin etiquetas de alta cardinalidad ni contenido; el endpoint de métricas no es público
  [D9].
- **FR-030**: SPF, DKIM y DMARC MUST publicarse para el dominio de envío con el proveedor de D14, y el
  cliente SMTP MUST admitir autenticación y TLS con fallo cerrado en producción [D14].
- **FR-031**: La configuración de producción MUST usar la clave de pago de Gemini con un tope de gasto en
  el proveedor y el umbral de alerta de FR-028; staging y desarrollo MUST NOT usarla [D13].

**Staging y ZAP (#65)**

- **FR-032**: MUST existir un staging con TLS, datos sintéticos, secretos propios, `LLM_ENABLED=false`
  y correo capturado, aislado de producción [D2].
- **FR-033**: El script de ZAP MUST ampliar su lista cerrada de destinos con los hosts de staging (variable
  explícita y versionada) sin permitir el dominio de producción ni terceros, con una prueba que lo fije;
  MUST admitir análisis con sesión (usuario de prueba) y activo solo contra staging [D12].
- **FR-034**: El informe de ZAP contra staging MUST versionarse en `docs/security/zap/` con la decisión por
  alerta media o alta, y la comprobación de secretos del informe MUST mantenerse.

**Issues diferidos de F8 (#61, #66, #67, #68)**

- **FR-035**: Cada uno de #61, #66, #67 y #68 MUST terminar con exactamente un desenlace decidido por el
  autor (D18 a D21): implementado con prueba en F9, o abierto con fase de revisión y razón vigente.

**Cierre**

- **FR-036**: `docs/threat-model.md` MUST pasar a v3.0 sin filas `deferred:F9`, `docs/security/owasp-evidence.md`
  MUST regenerarse con las filas A02, A03, A04, A09 y LLM02 en `verified`, y `pnpm security:evidence` MUST
  pasar.
- **FR-037**: Los ADR de F9 MUST registrar cada decisión D1 a D22 con su opción elegida; `docs/PLAN.md` §9
  MUST describir lo desplegado y el README MUST enlazar la guía de operación.
- **FR-038**: Una guía de operación en `docs/operations/` MUST cubrir: aprovisionamiento, despliegue,
  rollback, rotación de secretos, restauración, acceso a la interfaz de Temporal, respuesta a una alerta y
  baja de la VM; cada procedimiento con su comando de verificación.

### Key Entities

- **Imagen publicada**: nombre, digest por arquitectura, SHA del commit, SBOM, resultado del escaneo.
- **Versión desplegada**: conjunto de digests (api, worker, migrator, web), fecha, resultado de la salud;
  la anterior se conserva para el rollback.
- **Secreto de producción**: nombre, origen (generado en la VM, entregado por el autor, de la plataforma),
  permisos, procedimiento de rotación y copia fuera de la VM. Sin valor en el repositorio.
- **Certificado interno**: sujeto, vigencia, emisor y fecha de caducidad vigilada.
- **Copia de seguridad**: fecha, base, tamaño, hash, cifrado, destino y resultado de la última restauración.
- **Regla de alerta**: condición, umbral, canal y procedimiento de prueba.
- **Entorno**: producción o staging, con dominio, secretos, límites y reglas de ZAP propias.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La demo pública responde en `https://` con certificado válido, HSTS y CSP; `http://`
  redirige; ZAP baseline contra staging muestra 0 alertas de 10038, 10020, 10021, 10063 y 90004.
- **SC-002**: En producción, 0 servicios de datos (PostgreSQL, Valkey, Temporal) aceptan una conexión sin
  credencial o sin TLS, y 0 puertos distintos de 80, 443 y 22 son alcanzables desde internet, comprobado
  con un escaneo de puertos desde fuera.
- **SC-003**: 0 coincidencias del token de un webhook de prueba en los registros de Caddy, de la API y del
  almacén de registros.
- **SC-004**: Restauración en un entorno limpio con RTO medido ≤ 60 minutos y RPO ≤ 24 horas; la prueba de
  humo y la comprobación de RLS pasan.
- **SC-005**: El tiempo desde un merge en `main` hasta la versión en staging es ≤ 30 minutos, y el rollback
  de producción tarda ≤ 10 minutos.
- **SC-006**: 0 vulnerabilidades altas o críticas con corrección disponible sin decisión en las 4
  imágenes; 4 de 4 imágenes con SBOM CycloneDX.
- **SC-007**: 0 secretos en el repositorio (gitleaks sobre el historial completo) y en las capas de las
  imágenes; 0 secretos en los registros de CI y del despliegue.
- **SC-008**: Las alertas de autenticación, costo, salud, copia vieja y caducidad de certificados llegan al
  operador en ≤ 5 minutos en su prueba; la última copia nunca supera 24 h.
- **SC-009**: SPF, DKIM y DMARC en `pass` en un correo de prueba recibido.
- **SC-010**: La suma de límites de memoria de producción más staging no pasa de 8 GB y el consumo medido
  bajo la prueba de humo queda por debajo del 60 % de los límites.
- **SC-011**: Los 6 checks de CI siguen pasando en cada PR de la fase; 0 filas `deferred:F9` en el modelo
  de amenazas y en la matriz al cerrar.

## Assumptions

- Oracle Cloud Always Free (Ampere A1, 2 OCPU y 12 GB) sigue siendo el destino (`docs/PLAN.md` §9), con el
  Compose portable a cualquier host Linux con Docker. Ninguna decisión de esta fase ata la aplicación a
  Oracle; lo único específico de Oracle son sus pasos de red y de cuenta, documentados aparte.
- Una sola VM aloja producción y, bajo demanda, staging. No hay alta disponibilidad ni balanceo; la
  recuperación ante un fallo es la restauración desde backup en otro host (RTO de horas, no segundos).
- Las imágenes siguen sobre Debian `bookworm-slim` (nunca Alpine) y fijadas por digest; no se añade ninguna
  dependencia de aplicación nueva salvo las que exijan D9 (métricas) y el cliente TLS (decisión en el plan).
  Las herramientas de operación (Caddy, restic, escáner) corren como contenedores o binarios fuera de pnpm.
- La web ya es estática y no depende de la arquitectura; solo se publica una vez por commit.
- Los controles de F0 a F8 se reutilizan sin cambios; esta fase no cambia reglas de autorización ni el
  esquema, salvo que el autor elija la opción de tabla en D10 o de arreglo en D19 (ver `data-model.md`).
- Los textos de la UI y los mensajes de la API van en español; los códigos, scripts y commits en inglés.
- Ninguna prueba automática de CI llama a internet más allá de lo que ya hace CI (registro de imágenes
  base); los escáneres usan bases de datos descargadas al inicio del job y el resto de pruebas sigue
  sin red.
- Fuera de alcance: alta disponibilidad, multi-región, WAF administrado, autoescalado, rotación de
  `CREDENTIALS_MASTER_KEY`, firma HMAC del webhook, MFA (salvo D18), integraciones (F10) y cualquier
  cambio de producto. Los elementos "recomendados, no obligatorios" van marcados en `tasks.md`.

## Prerrequisitos del autor

Nada de esto lo hace la fase de especificación ni un agente: sin ellos las tareas de despliegue real
(PR 3 en adelante, parcialmente) no pueden cerrarse. Las PR de código y de scripts se pueden desarrollar y
probar en local sin ellos.

| #   | Prerrequisito                                                                                                                   | Bloquea                     | Depende de |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------- |
| P1  | Cuenta de Oracle Cloud (Always Free), región con capacidad A1 y la instancia Ampere creada con la llave SSH del autor           | Aprovisionamiento, despliegue | D16      |
| P2  | Dominio registrado y acceso a su DNS (registros A/AAAA, TXT de SPF, DKIM y DMARC, y un subdominio de staging)                   | TLS, correo, staging        | D2, D6     |
| P3  | Cuenta del destino de backups, credenciales de un usuario con solo escritura y una clave de cifrado guardada fuera de la VM     | Backups, restauración       | D5         |
| P4  | Facturación de Gemini habilitada, clave de producción y tope de gasto en el proveedor                                           | Demo pública                | D13        |
| P5  | Proveedor de correo (SMTP) con el dominio verificado                                                                            | Correo, DMARC               | D14        |
| P6  | Cuenta o espacio del destino de observabilidad (si D9 lo usa) y un canal de alertas (correo o mensajería) que el autor lea      | Alertas                     | D9         |
| P7  | Entornos de GitHub (`staging`, `production`) con revisores requeridos y los secretos que D3 exija, creados por el autor          | Workflow de despliegue      | D3         |
| P8  | Gestor de contraseñas o equivalente con la copia cifrada de los secretos y de la clave de backups                               | Secretos                    | D4         |
| P9  | Permiso para publicar paquetes en el registro (GHCR o el elegido) y visibilidad (pública o privada) de las imágenes             | Publicación                 | D1         |

## Decisiones del autor (D1 a D22)

> **Ninguna está tomada.** Cada una tiene opciones, ventajas, riesgos y una recomendación en
> [research.md](./research.md) (R1 a R22, mismo número). Responde con el formato de F8, por ejemplo
> `1A 2A 3A …`. `tasks.md` queda como borrador hasta que lleguen las respuestas. El texto de las
> opciones es una síntesis; la comparación completa está en `research.md`.

| #   | Decisión                                              | Opciones                                                                                                                | Recomendación |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | Registro de imágenes                                  | A GHCR · B OCIR (Oracle) · C Docker Hub o construir en la VM                                                            | **A**         |
| D2  | Staging                                               | A segundo proyecto Compose en la misma VM, bajo demanda · B segunda VM · C sin staging                                  | **A**         |
| D3  | Modo de despliegue                                    | A staging automático y producción manual con aprobación · B todo manual por script desde el portátil · C todo automático | **A**         |
| D4  | Gestor de secretos                                    | A archivos en la VM con copia cifrada externa · B OCI Vault · C secretos de GitHub Environments                         | **A**         |
| D5  | Destino de los backups                                | A OCI Object Storage · B otro proveedor (S3 compatible) · C ambos                                                       | **B**         |
| D6  | Origen de la web y la API                             | A mismo origen (`/api` detrás de Caddy) · B subdominios `app.` y `api.` · C dominios distintos                           | **A**         |
| D7  | Cómo se sirve la web estática                         | A imagen de borde única (Caddy + `dist`) · B imagen web separada detrás de Caddy · C hosting estático externo           | **A**         |
| D8  | PKI interna (TLS y mTLS entre servicios)              | A CA propia con `openssl` en el aprovisionamiento · B `step-ca` · C certificados por servicio sin CA común              | **A**         |
| D9  | Observabilidad y alertas                              | A Grafana Cloud (nivel gratuito) con agente · B todo en la VM (Loki, Prometheus, Grafana) · C solo registros + alertas por script | **A** |
| D10 | Retención de eventos de seguridad y #62               | A solo logs, 90 días consultables y 12 meses archivados · B tabla `audit_events` por organización · C A y B               | **A**         |
| D11 | SBOM y escaneo de imágenes (#64)                      | A escáner + SBOM dentro del job `images` y del de publicación · B check requerido nuevo · C solo al publicar            | **A**         |
| D12 | ZAP contra staging (#65)                              | A script manual ampliado, con sesión y activo solo en staging · B workflow manual en CI · C programado                  | **A**         |
| D13 | Gemini de pago                                        | A capa de pago antes de la demo, con tope · B demo con `LLM_ENABLED=false` · C demo cerrada con datos de prueba         | **A**         |
| D14 | Proveedor de correo                                   | A OCI Email Delivery · B proveedor transaccional externo · C SMTP del dominio en la VM                                   | **A**         |
| D15 | Acceso del operador (SSH y túnel a la UI de Temporal) | A SSH con llaves, puerto 22 y fail2ban · B OCI Bastion · C VPN mallada (WireGuard/Tailscale)                            | **A**         |
| D16 | Aprovisionamiento                                     | A scripts shell y cloud-init · B Terraform/OpenTofu + scripts · C Ansible                                               | **A**         |
| D17 | Rollback                                              | A digests anteriores + copia lógica previa · B instantánea de volumen · C blue/green                                    | **A**         |
| D18 | #61 MFA y política de contraseñas                     | A fuera de F9, revisión posterior · B TOTP en F9 · C solo revisar la política de contraseñas                            | **A**         |
| D19 | #66 ejecución `failed` tras fallo de Temporal         | A fuera de F9 · B corregir en F9                                                                                        | **A**         |
| D20 | #67 disparos fuera del catch-up                       | A métrica en F9 con las métricas de Temporal · B dejar `accepted`                                                       | **A**         |
| D21 | #68 frecuencia mínima de la cron                      | A mínimo configurable (por defecto 5 min) en F9 · B dejar `accepted`                                                    | **A**         |
| D22 | Qué entra en F9 y qué se difiere                      | A F9 completa con las 6 PR · B partir en F9 (despliegue seguro) y F9.1 (observabilidad, ZAP activo) · C mínimo viable   | **A**         |

## Fuentes y trazabilidad

- [docs/PLAN.md](../../docs/PLAN.md) §7, §9 (incluidos "Requisitos para F9 derivados de F7 y de F8") y §10.
- [ADR-0088](../../docs/adr/0088-riesgos-aceptados-y-diferidos-a-f9.md),
  [ADR-0072](../../docs/adr/0072-webhook-con-token-en-la-url-sin-hmac.md),
  [ADR-0038](../../docs/adr/0038-eventos-de-seguridad-en-logs.md) y
  [ADR-0066](../../docs/adr/0066-modelos-por-tipo-de-nodo-y-capa-gratuita-de-gemini.md).
- [docs/security/zap.md](../../docs/security/zap.md), [docs/threat-model.md](../../docs/threat-model.md)
  (sección 3.7 y filas `deferred:F9`) y [docs/security/owasp-evidence.md](../../docs/security/owasp-evidence.md).
- Issues #61 a #68 del repositorio.
- [Constitución](../../.specify/memory/constitution.md) v1.0.3 (principios I, II, III, V, VI, VII, VIII y IX).
- [specs/009-hardening](../009-hardening/) como modelo de formato.
