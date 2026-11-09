# Feature Specification: Despliegue (F9)

**Feature Branch**: `010-deployment`

**Created**: 2026-11-09

**Status**: Decisiones D1 a D22 respondidas el 2026-11-09 (ver «Decisiones del autor»). D23 respondida: A (Caddy 404).

**Input**: User description: "Fase F9 de docs/PLAN.md: VM Oracle Always Free (ARM), Compose de
producción, Caddy, backups, observabilidad y todo lo que F7 y F8 difirieron al despliegue
([ADR-0088](../../docs/adr/0088-riesgos-aceptados-y-diferidos-a-f9.md)): autenticación y TLS de
Temporal, PostgreSQL y Valkey (#63), cabeceras de la SPA (ZAP 10038, 10020, 10021, 10063 y 90004),
redacción de `/api/v1/hooks/*`, SBOM y escaneo de imágenes (#64), ZAP activo y con sesión contra
(#65), retención y alertas de eventos de seguridad (#62), SPF, DKIM y DMARC, y
demo cerrada con TLS. Terminado cuando (ajustado por D5 y D13): demo por invitación con TLS, cabeceras
verificadas y despliegue con reversa; el PLAN se corrige donde exigía backup y restauración."

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

Actores: el autor y operador de la plataforma (despliega y rota secretos), el visitante de la
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

**Independent Test**: contra el dominio real, `curl -sI` a `/`, a una ruta de la SPA y a `/api/v1/health`; ZAP
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

### User Story 4 - Pérdida de datos aceptada, acotada y documentada (Priority: P2)

**Retirada la historia original de backups externos por la decisión D5** («sin backup»). El autor acepta que
la pérdida de la VM es la pérdida de los datos. La fase hace explícito ese riesgo, evita que una migración
fallida lo agrave y deja la reconstrucción del servicio medida.

**Why this priority**: el criterio de terminado del PLAN §10 («restauración de backup probada») deja de
aplicar por decisión del autor; hay que corregir el PLAN y registrar el riesgo con dueño y revisión.

**Independent Test**: reconstruir el servicio desde cero en una VM limpia con el script de aprovisionamiento
y las imágenes del registro, con una base vacía, y pasar la prueba de humo.

**Acceptance Scenarios**:

1. **Given** el modelo de amenazas, **When** se cierra la fase, **Then** la fila «pérdida o fuga de datos por
   falta de copias» pasa de `deferred:F9` a `accepted`, con dueño: autor, la razón (D5) y revisión «antes
   de admitir datos reales»; el PLAN §9 y §10 dejan de prometer backups externos y restauración.
2. **Given** una migración, **When** se despliega, **Then** antes de aplicarla se guarda un volcado lógico en
   la VM (últimos 3) para el rollback de FR-025; no se presenta como backup.
3. **Given** una VM nueva, **When** se ejecutan el aprovisionamiento y el despliegue, **Then** el servicio
   queda operativo con una base vacía y el tiempo se mide y se registra.
4. **Given** la pantalla de la demo, **When** se entra a la aplicación, **Then** consta que los datos no
   tienen copia de seguridad y que la demo es solo con datos de prueba.
---

### User Story 5 - Se publican imágenes verificadas y se despliega con migraciones y reversa (Priority: P1)

Un cambio en `main` termina en imágenes `linux/amd64` y `linux/arm64` en un registro, identificadas por
digest, escaneadas y con SBOM. El operador despliega una versión concreta, las migraciones corren antes
de arrancar la versión nueva y, si algo falla, vuelve a la versión anterior con un comando.

**Why this priority**: hoy CI no publica nada; sin esto no hay despliegue repetible. Cubre #64.

**Independent Test**: tras un merge de prueba, comprobar que el registro tiene el manifiesto multi-arch
con las imágenes de `api`, `worker`, `migrator` y la web; desplegar; forzar un fallo y comprobar la reversa automática.

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

### User Story 6 - Eventos de seguridad con retención y alertas por correo (Priority: P2)

El operador recibe un correo cuando hay un pico de fallos de autenticación, un servicio deja de estar
sano, un certificado está por caducar o el disco se llena, y los eventos de seguridad se conservan 90 días
para investigar. No hay métricas ni agente externo (D9C, D20).

**Why this priority**: cierra A09 (#62) con lo mínimo que el autor aceptó.

**Independent Test**: provocar 20 logins fallidos y comprobar que llega la alerta de prueba; buscar un evento
dentro de la retención.

**Acceptance Scenarios**:

1. **Given** los eventos de seguridad de ADR-0038, **When** se despliega, **Then** quedan en los registros de
   la VM con rotación y compresión, 90 días, consultables por `event`, `organizationId` y `correlationId`
   sin contenido de usuario (canario).
2. **Given** más de un umbral configurado de `auth.login_failed` o `auth.rate_limited` en una ventana,
   **When** se supera, **Then** el temporizador envía un correo al operador.
3. **Given** un servicio no sano, un certificado a menos de 30 días de caducar o el disco por encima del
   umbral, **When** el temporizador corre, **Then** envía el correo correspondiente; la prueba de cada una
   está escrita.
4. **Given** la decisión D20 (sin métricas), **When** se cierra la fase, **Then** #67 y la ausencia de métrica
   de disparos fuera del catch-up quedan `accepted` con dueño y revisión.
5. **Given** que el correo de alertas sale por el mismo proveedor que el de la aplicación, **When** el
   proveedor cae, **Then** la alerta no llega: consta como límite conocido.
---

### User Story 7 - Cabeceras verificadas sin staging (Priority: P2)

Sin staging (D2C) y sin ZAP activo ni con sesión (D12), el autor verifica las cabeceras de Caddy con el
baseline pasivo contra la imagen de borde levantada en local y con una comprobación por `curl` en cada
despliegue.

**Why this priority**: es la prueba de aceptación de las cabeceras que ZAP pidió en F8. #65 queda `accepted`.

**Independent Test**: levantar la imagen de borde y la API en local y ejecutar `scripts/security/zap-baseline.sh`.

**Acceptance Scenarios**:

1. **Given** la imagen de borde en local, **When** corre el baseline pasivo, **Then** 10038, 10020, 10021,
   10063 y 90004 desaparecen y no aparece ninguna alerta nueva media o alta sin decisión.
2. **Given** el script de ZAP, **When** se revisa, **Then** sigue limitado a loopback, con la prueba de F8
   intacta.
3. **Given** cada despliegue, **When** termina, **Then** una comprobación por `curl` contra el dominio real
   verifica HSTS, CSP, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP, COOP y CORP y la
   redirección HTTP→HTTPS; si falta alguna, el despliegue se revierte.
4. **Given** #65, **When** se cierra la fase, **Then** queda `accepted`: sin análisis activo ni con sesión
   iniciada y sin ZAP contra TLS real; dueño: autor, revisión: antes de admitir datos reales.
---

### User Story 8 - Correo que no se puede falsificar y demo cerrada con Gemini gratuito (Priority: P2)

Los correos del sistema salen de OCI Email Delivery con SPF, DKIM y DMARC válidos. La demo es solo por
invitación y sigue en la capa gratuita de Gemini con datos de prueba (D13C).

**Why this priority**: A07 y E10; LLM02 sigue `accepted`.

**Independent Test**: enviar un correo de prueba a un buzón que muestre las cabeceras de autenticación;
comprobar que el registro de cuentas está cerrado.

**Acceptance Scenarios**:

1. **Given** el dominio del sistema, **When** se envía un correo de prueba, **Then** SPF, DKIM y DMARC pasan
   y la política DMARC arranca en `p=none` con informes y sube a `quarantine` tras una ventana escrita.
2. **Given** el cliente SMTP de la API, **When** se configura para producción, **Then** admite STARTTLS o TLS
   implícito y autenticación, y falla cerrado en producción si el servidor no ofrece TLS.
3. **Given** la demo cerrada, **When** alguien externo intenta registrarse, **Then** no puede (D23) y el
   autor crea las cuentas autorizadas.
4. **Given** la capa gratuita de Gemini, **When** se revisa el modelo de amenazas, **Then** LLM02 sigue
   `accepted` con la razón «demo cerrada y datos de prueba» y la condición para reabrirlo: migrar a la capa
   de pago antes de admitir datos reales.
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
   v3.0 sin filas `deferred:F9`, con Caddy, observabilidad por registros y el registro de imágenes incorporados
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
  de consulta anotada) y la pérdida de la VM significa reconstruir con una base vacía (D5, riesgo aceptado).
- La VM se queda sin memoria: cada servicio tiene límite y reinicio; el orden de OOM prefiere sacrificar
  la interfaz de Temporal y el agente de observabilidad antes que la base de datos.
- Sin staging, un cambio defectuoso llega a producción: la reversa automática y la salud son la defensa;
  no se desactiva sin una razón escrita.
- Un secreto se sospecha filtrado: existe una lista de qué rotar y en qué orden, y gitleaks sigue
  escaneando todo el historial.
- Los registros de Caddy tienen otros datos personales (IP, user agent): se documenta la retención de los
  registros de acceso y no se registran cuerpos ni cabeceras `Cookie` ni `Authorization`.
- El navegador de un usuario guarda en caché una SPA antigua tras un despliegue: los archivos con hash se
  sirven con caché larga e inmutable y `index.html` con `no-cache`.
- El volcado previo a una migración está corrupto o falta: el despliegue se detiene antes de migrar y se
  conserva el último volcado válido.

## Requirements *(mandatory)*

### Functional Requirements

Las marcas **[Dn]** señalan los requisitos cuya forma exacta depende de la decisión del autor. Mientras no
haya respuesta, el requisito rige en la forma recomendada.

**Borde, TLS y cabeceras (Caddy)**

- **FR-001**: Caddy MUST terminar TLS para el dominio público con certificados automáticos, redirigir HTTP
  a HTTPS y enviar HSTS (`max-age` ≥ 1 año en producción).
- **FR-002**: La web estática MUST servirse con `Content-Security-Policy` (`default-src 'self'`, sin
  `unsafe-inline` en `script-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy` restrictiva, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy` y
  `Cross-Origin-Resource-Policy` [D6, D7]. Una prueba MUST fijar el conjunto sobre la configuración
  real, y el baseline de ZAP contra la imagen de borde en local MUST no mostrar 10038, 10020, 10021, 10063 ni 90004.
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
- **FR-013**: Una prueba de despliegue MUST demostrar, en CI con certificados efímeros y tras el despliegue, que cada servicio rechaza una
  conexión sin credenciales y sin TLS (las "pruebas previstas" de las filas `deferred:F9`).

**Secretos y aprovisionamiento (D4B, D16A)**

- **FR-014**: El repositorio MUST contener únicamente plantillas sin valores de los archivos de entorno de
  producción (nombres de variables y su origen), y gitleaks MUST seguir pasando sobre todo el historial;
  ningún valor con forma de secreto, ni de ejemplo, entra al repositorio.
- **FR-015**: Los secretos de producción MUST vivir en **OCI Vault**; la VM los lee con la identidad de la
  instancia (política de solo lectura sobre sus propios secretos) y los deja en un sistema de archivos en
  memoria (`tmpfs`) con permisos `0600`, nunca en disco ni en variables visibles con `docker inspect`. Los
  secretos que el autor entrega (SMTP, clave de Gemini) y los que genera el aprovisionamiento (contraseñas,
  CA) se cargan en el Vault desde la máquina del operador; la VM no tiene permiso de escritura. Cada
  secreto tiene procedimiento de rotación probado [D4].
- **FR-016**: Un script idempotente MUST aprovisionar una VM Linux limpia (x64 o arm64) hasta dejar Docker,
  el cortafuegos del anfitrión, SSH endurecido (solo llaves, sin contraseña ni `root`), `fail2ban`, usuario
  de despliegue, directorios de datos, lectura del Vault y el Compose de producción listo para arrancar
  [D16]. La infraestructura de Oracle (instancia, red, reglas de entrada 22, 80 y 443, Vault y su política)
  se documenta paso a paso, sin automatizar la creación de la cuenta.
- **FR-017**: El Compose de producción MUST fijar por servicio un límite de memoria (`mem_limit`), política
  de reinicio, comprobación de salud, usuario no root, sistema de archivos de solo lectura donde sea posible
  y rotación de los registros del motor (`max-size`, `max-file`). Los límites y el consumo real medido se
  tabulan en el plan (la suma queda por debajo del 50 % de los 12 GB).
- **FR-018**: Las imágenes del Compose de producción MUST fijarse por digest (como en desarrollo) y las
  imágenes propias MUST referenciarse por digest en el despliegue, nunca por una etiqueta móvil.

**Backups (retirado por D5)**

- **FR-019 a FR-021**: _(retirados: el autor decidió no tener backups externos)_. Consecuencias en
  [Decisiones del autor](#decisiones-del-autor-respondidas-2026-11-09) y en el modelo de amenazas
  (`accepted`). No se escribe ningún script de backup ni de restauración; el volcado previo a la migración
  de FR-025 es solo un seguro de despliegue.

**Publicación, despliegue y reversa (D1B, D3C, D11C, D17A)**

- **FR-022**: Un workflow de publicación MUST construir y publicar las imágenes `api`, `worker`,
  `migrator` y de borde para `linux/amd64` y `linux/arm64` en OCIR, con permisos de escritura solo en ese
  workflow, acciones fijadas por SHA y salida por digest [D1].
- **FR-023**: En ese mismo workflow, cada imagen MUST escanearse (la publicación falla ante altas y
  críticas con corrección disponible, con excepciones versionadas con razón, dueño y fecha) y llevar un SBOM
  CycloneDX adjunto. El job `images` de `ci.yml` y los 6 checks no cambian [D11].
- **FR-024**: Cuando la publicación termine bien, un workflow de despliegue MUST resolver los digests,
  ejecutar `migrator`, arrancar los servicios nuevos, esperar las comprobaciones de salud y la de cabeceras
  (FR-034) y, si fallan, **revertir solo** a la versión anterior y marcar el workflow como fallido [D3].
- **FR-025**: El rollback MUST consistir en volver a los digests anteriores (registrados en la VM tras cada
  despliegue correcto) con un comando o automáticamente, más un volcado lógico previo a la migración que se
  conserva **en la VM** (últimos 3). Las migraciones siguen siendo expand/contract y no hay migraciones
  inversas [D17].
- **FR-026**: Un `migrator` MUST ejecutar las migraciones con `app_migrator` desde una imagen propia, sin
  herramientas de desarrollo en la imagen de la API.

**Observabilidad, eventos y alertas (#62; D9C, D10A)**

- **FR-027**: Los registros estructurados de API, worker y Caddy MUST conservarse en la VM con rotación y
  compresión, **90 días** como máximo, consultables por `event`, `organizationId` y `correlationId` con
  un comando documentado; una prueba MUST demostrar que un canario de contenido de usuario no llega a los
  registros. No hay archivo externo (D5) ni envío a terceros (D9C).
- **FR-028**: Un temporizador `systemd` MUST contar eventos de los registros y enviar un correo al operador
  cuando: los fallos de autenticación (`auth.login_failed`, `auth.rate_limited`) superen un umbral en una
  ventana, un servicio deje de estar sano, un certificado interno esté a menos de 30 días de caducar o el
  disco supere un umbral. El procedimiento de prueba de cada alerta MUST estar escrito. **No hay alerta de
  costo por métrica**: con la capa gratuita de Gemini (D13C) el gasto es cero y la defensa es la cuota; el
  worker ya falla con códigos de presupuesto y de límite de tasa que quedan en los registros.
- **FR-029**: _(retirado por D9C y D20: sin métricas ni OpenTelemetry; PLAN §7 se corrige para decir que la
  observabilidad de F9 son registros y alertas por script)_.
- **FR-030**: SPF, DKIM y DMARC MUST publicarse para el dominio de envío con OCI Email Delivery, y el
  cliente SMTP MUST admitir autenticación y TLS con fallo cerrado en producción [D14].
- **FR-031**: Producción MUST usar la clave de la capa gratuita de Gemini con sus cuotas, sin datos reales:
  el registro está cerrado (D23) y el aviso de los paneles LLM se mantiene. LLM02 sigue `accepted`.

**Verificación de cabeceras sin staging (#65; D2C, D12)**

- **FR-032**: _(retirado por D2C: no hay staging)_.
- **FR-033**: El script de ZAP MUST mantener su lista cerrada a loopback. No se amplía el script: el baseline
  pasivo se ejecuta contra la imagen de borde y la API levantadas en local, y `zap-script.test.ts` sigue
  rechazando cualquier otro host.
- **FR-034**: El informe del baseline contra la imagen de borde MUST versionarse en `docs/security/zap/`
  mostrando 10038, 10020, 10021, 10063 y 90004 resueltas; una comprobación por `curl` de las mismas
  cabeceras contra el dominio real MUST ejecutarse en cada despliegue (si faltan, el despliegue se revierte).

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
  rollback, rotación de secretos, reconstrucción desde cero, acceso a la interfaz de Temporal, respuesta a una alerta y
  baja de la VM; cada procedimiento con su comando de verificación.

### Key Entities

- **Imagen publicada**: nombre, digest por arquitectura, SHA del commit, SBOM, resultado del escaneo.
- **Versión desplegada**: conjunto de digests (api, worker, migrator, web), fecha, resultado de la salud;
  la anterior se conserva para el rollback.
- **Secreto de producción**: nombre, origen (generado en la VM, entregado por el autor, de la plataforma),
  permisos, procedimiento de rotación y copia fuera de la VM. Sin valor en el repositorio.
- **Certificado interno**: sujeto, vigencia, emisor y fecha de caducidad vigilada.
- **Regla de alerta**: condición, umbral, canal y procedimiento de prueba.
- **Entorno**: producción, con dominio, secretos en el Vault y límites.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La demo responde en `https://` con certificado válido, HSTS y CSP; `http://` redirige; la
  imagen de borde levantada en local muestra 0 alertas de ZAP 10038, 10020, 10021, 10063 y 90004, y una
  comprobación por `curl` tras el despliegue confirma las cabeceras en el dominio real.
- **SC-002**: En producción, 0 servicios de datos (PostgreSQL, Valkey, Temporal) aceptan una conexión sin
  credencial o sin TLS, y 0 puertos distintos de 80, 443 y 22 son alcanzables desde internet, comprobado
  con un escaneo de puertos desde fuera.
- **SC-003**: 0 coincidencias del token de un webhook de prueba en los registros de Caddy y de la API.
- **SC-004**: _(retirado por D5: sin backups)_. En su lugar, el riesgo de pérdida total consta como
  `accepted` en el modelo de amenazas con dueño y revisión, y el servicio se reconstruye desde cero en una
  VM limpia en un tiempo medido.
- **SC-005**: El tiempo desde un merge en `main` hasta la versión en producción es ≤ 30 minutos, y la
  reversa automática ante una salud fallida tarda ≤ 10 minutos.
- **SC-006**: 0 vulnerabilidades altas o críticas con corrección disponible sin decisión en las 4 imágenes
  publicadas; 4 de 4 imágenes con SBOM CycloneDX adjunto a la publicación.
- **SC-007**: 0 secretos en el repositorio (gitleaks sobre el historial completo) y en las capas de las
  imágenes; 0 secretos en los registros de CI y del despliegue.
- **SC-008**: Las alertas de fallos de autenticación, servicio no sano, certificado próximo a caducar y
  disco bajo llegan al operador en ≤ 10 minutos en su prueba (temporizador de 5 minutos).
- **SC-009**: SPF, DKIM y DMARC en `pass` en un correo de prueba recibido.
- **SC-010**: La suma de límites de memoria de producción no pasa de 6 GB y el consumo medido bajo la
  prueba de humo queda por debajo del 60 % de los límites.
- **SC-011**: Los 6 checks de CI siguen pasando en cada PR de la fase; 0 filas `deferred:F9` en el modelo
  de amenazas y en la matriz al cerrar.

## Assumptions

- Oracle Cloud Always Free (Ampere A1, 2 OCPU y 12 GB) sigue siendo el destino (`docs/PLAN.md` §9), con el
  Compose portable a cualquier host Linux con Docker. Ninguna decisión de esta fase ata la aplicación a
  Oracle; lo único específico de Oracle son sus pasos de red y de cuenta, documentados aparte.
- Una sola VM aloja producción; no hay staging (D2C). No hay alta disponibilidad, balanceo ni backups
  (D5): la recuperación ante la pérdida de la VM es reconstruir el servicio con una base vacía.
- Las imágenes siguen sobre Debian `bookworm-slim` (nunca Alpine) y fijadas por digest; no se añade ninguna
  dependencia de aplicación nueva salvo, si hace falta, un helper de TLS para los clientes (decisión en el plan); sin métricas (D9C).
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

| #   | Prerrequisito                                                                                                                                           | Bloquea                       | Depende de |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
| P1  | Cuenta de Oracle Cloud (Always Free), región con capacidad A1 y la instancia Ampere creada con la llave SSH del autor                                   | Aprovisionamiento, despliegue | D16        |
| P2  | Dominio registrado y acceso a su DNS (A/AAAA, SPF, DKIM y DMARC)                                                                                        | TLS, correo                   | D6, D14    |
| P3  | _(retirado por D5: no hay destino de backups)_                                                                                                          | —                             | D5         |
| P4  | _(retirado por D13C: sin Gemini de pago)_ La clave de la capa gratuita de Gemini solo en el Vault de producción                                         | —                             | D13        |
| P5  | Dominio verificado en OCI Email Delivery y credenciales SMTP generadas en Oracle                                                                        | Correo, DMARC                 | D14        |
| P6  | Un buzón de correo que el autor lea para las alertas                                                                                                    | Alertas                       | D9         |
| P7  | Entorno `production` de GitHub (sin revisores, D3C) y los secretos de CI que D1 y D3 exijan: token de OCIR y llave de despliegue                         | Publicación y despliegue      | D1, D3     |
| P8  | Vault de OCI con una política que permita a la instancia leer solo sus secretos; una copia fuera de Oracle de lo que no pueda regenerarse (sin backups)   | Secretos                      | D4         |
| P9  | Repositorio en OCIR (espacio de nombres y visibilidad) y un token de autenticación de Oracle para CI                                                    | Publicación                   | D1         |
| P10 | _(cumplido: D23A elegida)_                                                                                                                              | —                             | D13        |

## Decisiones del autor (respondidas 2026-11-09)

Respuesta del autor: `1B 2C 3C 4B 5 sin backup, 6A 7A 8A 9C 10A 11C 12A 13C 14A 15A 16A 17A 18A 19A 20 sin métricas 21B 22A`.
Tres respuestas chocaban con requisitos de la spec y el autor las resolvió así: **D5** sin backup, riesgo
aceptado; **D2/D3/D12** sin staging, ZAP solo pasivo y local; **D13** demo cerrada, LLM02 sigue `accepted`.
Comparación completa de opciones en [research.md](./research.md) (R1 a R22).

| #   | Decisión                   | Respuesta                         | Efecto sobre la fase                                                                                                                                              |
| --- | -------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Registro de imágenes       | **B** OCIR                        | Imágenes en el registro de Oracle; CI necesita un token de OCI en un secreto de GitHub (P9); ligado a la cuenta de Oracle                                         |
| D2  | Staging                    | **C** sin staging                 | No hay entorno de pruebas aparte: cada cambio llega a producción; ZAP activo y con sesión (#65) no se hace                                                        |
| D3  | Modo de despliegue         | **C** todo automático             | Cada publicación correcta se despliega sola; los frenos son CI, el escaneo de la publicación, la salud y la reversa automática                                    |
| D4  | Gestor de secretos         | **B** OCI Vault                   | Los secretos viven en el Vault de Oracle y la VM los lee con la identidad de la instancia                                                                         |
| D5  | Backups                    | **Sin backup**                    | Riesgo aceptado: pérdida total si la VM desaparece. Se retiran FR-019 a FR-021, SC-004 y la restauración probada; el PLAN §10 se corrige                           |
| D6  | Origen de la web y la API  | **A** mismo origen                | `/api/*` detrás de Caddy; URL de API relativa                                                                                                                     |
| D7  | Web estática               | **A** imagen de borde única       | Caddy + `dist` + Caddyfile en una imagen                                                                                                                          |
| D8  | PKI interna                | **A** CA con `openssl`            | Generada por el aprovisionamiento; su clave va al Vault                                                                                                           |
| D9  | Observabilidad             | **C** logs + script de alertas    | Sin agente, sin métricas, sin tercero: registros del motor con rotación y un temporizador que cuenta eventos y avisa por correo                                   |
| D10 | Retención de eventos (#62) | **A** solo logs                   | 90 días en la VM, comprimidos; **sin archivo de 12 meses** (no hay destino externo, D5); #62 se cierra con la retención y las alertas, sin tabla                  |
| D11 | SBOM y escaneo (#64)       | **C** solo al publicar            | En `release.yml`: el escaneo falla la publicación y por tanto el despliegue; el SBOM CycloneDX se adjunta; el job `images` de CI no cambia                        |
| D12 | ZAP (#65)                  | **A** modificada                  | Sin staging: ZAP sigue **pasivo, local, loopback**, contra la imagen de borde levantada en local; #65 queda `accepted` (sin activo ni sesión)                     |
| D13 | Gemini                     | **C** demo cerrada                | Capa gratuita, solo datos de prueba; LLM02 sigue `accepted`; demo por invitación (ver D23)                                                                        |
| D14 | Correo                     | **A** OCI Email Delivery          | SPF, DKIM y DMARC con el dominio del autor                                                                                                                        |
| D15 | Acceso del operador        | **A** SSH + `fail2ban` + `ssh -L` | UI de Temporal solo por túnel                                                                                                                                     |
| D16 | Aprovisionamiento          | **A** scripts y cloud-init        | `shellcheck` en `quality`                                                                                                                                         |
| D17 | Rollback                   | **A** digests + volcado previo    | El volcado previo a cada migración queda **en la VM** (últimos 3); no protege contra la pérdida de la VM                                                          |
| D18 | #61 MFA                    | **A** fuera de F9                 | Sin cambio; revisión posterior                                                                                                                                    |
| D19 | #66                        | **A** fuera de F9                 | Sin cambio; revisión posterior                                                                                                                                    |
| D20 | #67                        | **Sin métricas**                  | #67 queda `accepted`; no hay métrica de disparos descartados                                                                                                      |
| D21 | #68                        | **B**                             | Sin frecuencia mínima de la cron; `accepted` (acotada por el tope de 10 programaciones, `overlap = SKIP` y `max_concurrent_runs`)                                |
| D22 | Alcance                    | **A**                             | F9 en 5 PR (ver plan); #61, #65, #66, #67 y #68 fuera                                                                                                             |

### Consecuencias que el autor debe conocer

- **Sin backup y sin staging, todo depende de una sola VM de Oracle y de la cuenta del autor.** Si Oracle
  reclama la instancia o la cuenta, se pierden las bases (incluido el historial de Temporal con las entradas
  y salidas de las ejecuciones), los secretos del Vault, el registro de imágenes y el correo a la vez. El
  repositorio conserva código y ADR, y las imágenes se reconstruyen desde `main` en otro registro, pero
  **los datos y `CREDENTIALS_MASTER_KEY` (credenciales cifradas de los conectores) no se recuperan**. El
  modelo de amenazas lo registra como `accepted`, dueño: autor, revisión: antes de admitir datos reales.
- **Despliegue automático sin staging:** un cambio con una migración defectuosa o una configuración rota
  llega a la demo. Las defensas son CI en verde, el escaneo de la publicación, `migrator` antes de arrancar,
  la comprobación de salud con **reversa automática** y el volcado previo local.
- **D1B + D4B + D14A concentran tres servicios en Oracle:** una suspensión de la cuenta tumba imágenes,
  secretos y correo. Es coherente con la capa gratuita, pero resta portabilidad operativa al PLAN §9 (el
  Compose sigue siendo portable; los accesos no).
- **D12 sin staging:** las cinco alertas de ZAP de la web se verifican contra la imagen de borde en local y,
  tras cada despliegue, con una comprobación de cabeceras por `curl` contra el dominio real. Eso **no**
  sustituye a un ZAP contra TLS real: queda dicho en el modelo de amenazas.
- **D13C:** LLM02 sigue `accepted`; ADR-0088 y PLAN §9 piden la capa de pago «antes de la demo pública»,
  así que la demo **no es pública**: solo con cuentas que el autor autoriza.

### D23 (respondida: **A**)

El autor eligió **A**: Caddy responde 404 a `POST /api/v1/auth/register` y las cuentas las crea un script en la VM. Sin cambio de código en la API.

| #   | Pregunta                                                                                          | Opciones                                                                                                                                                                                   | Recomendación |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| D23 | ¿Cómo se cierra la demo? Hoy `POST /api/v1/auth/register` está abierto a cualquiera con un correo | A) Caddy responde 404 a `register` y el autor crea cuentas con un script en la VM · B) variable de operación `REGISTRATION_ENABLED` en la API (cambio de código; kill switch, no flag de producto) · C) dejar el registro abierto | **A** (elegida) |

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
