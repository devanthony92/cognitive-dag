# Feature Specification: Triggers y control humano (F7)

**Feature Branch**: `008-triggers-human-control`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Fase F7 de docs/PLAN.md: `trigger.webhook`, `trigger.schedule`,
`human.approval` y `http.request` con anti-SSRF. Terminado cuando un webhook con token inválido o
regenerado y un replay son rechazados, y el SSRF a IPs internas queda bloqueado. Incluye credenciales
de conector, circuit breaker y bulkhead HTTP (diferidos en ADR-0060)."

## User Scenarios & Testing *(mandatory)*

Actores: miembros con rol owner o editor (configuran y publican workflows, administran el token del
webhook, aprueban), el owner (administra credenciales y la allowlist de dominios), miembros viewer
(solo leen), un sistema externo que llama a un webhook, el operador de la plataforma, un atacante que
conoce o adivina una URL de webhook, un atacante que controla el destino de una petición HTTP o una
redirección (SSRF), miembros de otra organización (sin acceso).

### User Story 1 - Disparar un workflow desde un webhook (Priority: P1)

Quien edita publica y activa un workflow cuyo trigger es `trigger.webhook`, genera el token del webhook
y copia la URL. Un sistema externo hace `POST` con un cuerpo JSON a esa URL; la API valida el cuerpo
contra los campos declarados, responde `202` de inmediato con el `runId` y el workflow se ejecuta con
la versión activa en ese momento. Los datos del cuerpo viven solo en Temporal.

**Why this priority**: es el trigger externo del producto y el criterio de terminado de la fase.

**Independent Test**: publicar y activar un workflow con webhook, generar el token, hacer `POST` con
`curl` y comprobar el `202`, el `runId` y la ejecución en la vista en vivo.

**Acceptance Scenarios**:

1. **Given** un workflow activo con `trigger.webhook` y un token generado, **When** llega un `POST`
   válido con `X-Event-Id` y `X-Event-Timestamp` vigentes, **Then** responde `202` con `runId` y
   `status: queued`, y existe una ejecución de la versión activa con `trigger_kind = webhook`.
2. **Given** el cuerpo no cumple `bodySchema`, **When** llega, **Then** responde 422 con la lista de
   errores y no se crea ejecución.
3. **Given** un workflow sin versión publicada activa, **When** llega una llamada con token válido,
   **Then** responde 409 `WEBHOOK_NOT_ACTIVE` y no se dispara nada.
4. **Given** una ejecución disparada por webhook, **When** se consulta, **Then** muestra el origen
   "Webhook" con el id de evento y no hay persona que la inició.
5. **Given** que se activa una versión nueva, **When** llega una llamada posterior, **Then** ejecuta
   la versión nueva; las ejecuciones en curso conservan su versión.

---

### User Story 2 - El webhook rechaza tokens inválidos y replays (Priority: P1)

El token vive dentro de la URL, se muestra una sola vez y se puede regenerar. Un token inválido o
regenerado se rechaza. Cada llamada exige un id de evento y una marca de tiempo reciente; repetir el
mismo id de evento no crea una segunda ejecución. El token nunca aparece en logs ni en respuestas.

**Why this priority**: es el criterio de seguridad de la fase (sustituye al de "firma inválida", ver
research R2).

**Independent Test**: llamar con un token alterado, con el token anterior tras regenerar, con una marca
de tiempo vencida y con el mismo `X-Event-Id` dos veces; revisar los logs buscando el token.

**Acceptance Scenarios**:

1. **Given** un token alterado o de otro trigger, **When** llega la llamada, **Then** responde 401
   `WEBHOOK_TOKEN_INVALID`, sin distinguir token incorrecto de trigger inexistente.
2. **Given** un token regenerado, **When** llega una llamada con el token anterior, **Then** responde
   401 y no se dispara nada; el token nuevo funciona.
3. **Given** una marca de tiempo a más de 5 minutos del reloj del servidor (pasado o futuro), **When**
   llega, **Then** responde 400 `WEBHOOK_TIMESTAMP_INVALID`.
4. **Given** un `X-Event-Id` ya recibido para ese workflow, **When** llega otra vez, **Then** no se
   crea una ejecución nueva y responde `200` con el `runId` original y `duplicate: true`.
5. **Given** un `X-Event-Id` ausente o con caracteres no permitidos, **When** llega, **Then** responde
   400 `WEBHOOK_EVENT_ID_INVALID`.
6. **Given** más de 60 llamadas por minuto al mismo trigger, **When** llega otra, **Then** responde 429
   `WEBHOOK_RATE_LIMITED` con `Retry-After`; además hay un límite de intentos con token inválido por
   dirección IP.
7. **Given** cualquier llamada (válida o no), **When** se revisan logs, trazas y respuestas, **Then**
   el token no aparece: la ruta se registra con el token redactado.
8. **Given** el token se muestra una sola vez, **When** se vuelve a pedir el estado del webhook,
   **Then** solo hay URL base sin token, fecha de generación y quién lo generó.

---

### User Story 3 - Ejecutar un workflow con programación (Priority: P1)

Quien edita configura `trigger.schedule` con una expresión cron y una zona horaria. Al activar la
versión, el sistema crea o actualiza un Temporal Schedule del workflow; al desactivarla o archivarla,
lo borra. Cada disparo ejecuta la versión activa en ese momento. Si hay una ejecución en curso del
mismo workflow, el disparo se salta; si el sistema estuvo caído, se recuperan los disparos perdidos
dentro de un límite.

**Why this priority**: segundo trigger del producto; sin él no hay automatización periódica.

**Independent Test**: activar un workflow con cron cada minuto (ambiente de pruebas con tiempo
simulado), comprobar ejecuciones, el salto por solape, el catch-up y el borrado al desactivar.

**Acceptance Scenarios**:

1. **Given** una versión con `trigger.schedule` válido, **When** se activa, **Then** existe un Schedule
   `sched-<workflowId>` con esa cron y zona; cambiar de versión activa lo actualiza y desactivar lo
   borra.
2. **Given** el Schedule en marcha, **When** llega el disparo, **Then** se crea una ejecución con
   `trigger_kind = schedule`, `scheduled_at` y salida `firedAt` en el nodo.
3. **Given** una ejecución del workflow todavía en curso, **When** llega el siguiente disparo,
   **Then** se salta y queda registrado sin crear ejecución.
4. **Given** una caída de menos de 1 hora, **When** el sistema vuelve, **Then** el disparo perdido se
   ejecuta una vez (catch-up); con una caída mayor, los disparos anteriores a la ventana se descartan
   y se registra la métrica.
5. **Given** un fallo de Temporal al sincronizar el Schedule, **When** se activa la versión, **Then**
   la activación se confirma, el estado de sincronización queda `pending` y un reconciliador lo
   corrige; la UI muestra "Programación pendiente de sincronizar".
6. **Given** una zona horaria o cron inválidos, **When** se intenta publicar, **Then** el borrador
   muestra el error y la publicación se bloquea.
7. **Given** que la organización ya tiene el máximo de programaciones activas (10 por defecto), **When**
   se activa otra, **Then** se rechaza con `SCHEDULE_LIMIT_REACHED`.

---

### User Story 4 - Aprobación humana (Priority: P1)

Un nodo `human.approval` pausa la ejecución y notifica. Cualquier owner o editor de la organización,
salvo quien inició la ejecución, puede aprobar o rechazar desde una bandeja con contador, con un
comentario opcional. Si vence el plazo, la ejecución sigue por la rama `timeout`. El mensaje y el
comentario viven solo en Temporal; también se envía un correo a quienes pueden aprobar.

**Why this priority**: es el control humano de la fase y mitiga LLM03 (agencia excesiva).

**Independent Test**: ejecutar un workflow con aprobación, ver el contador subir, aprobar con otro
usuario y comprobar que sigue por `approved`; repetir con rechazo, con timeout y con el iniciador.

**Acceptance Scenarios**:

1. **Given** una ejecución que llega a `human.approval`, **When** el nodo comienza, **Then** el paso
   queda "esperando aprobación", se crea la solicitud, el contador de la bandeja de los elegibles
   aumenta y reciben un correo (Mailpit en local) sin el texto del mensaje.
2. **Given** una solicitud pendiente, **When** otro editor u owner aprueba (con o sin comentario),
   **Then** el nodo sigue por la rama `approved` y su salida lleva `decision` y `approvedBy`.
3. **Given** una solicitud pendiente, **When** se rechaza, **Then** sigue por `rejected`; no es un
   fallo de la ejecución.
4. **Given** que la persona que inició la ejecución intenta decidir, **When** envía la decisión,
   **Then** recibe 403 `APPROVAL_SELF_DECISION_FORBIDDEN`; en ejecuciones de webhook o programación
   no hay iniciador y decide cualquier owner o editor.
5. **Given** un viewer, **When** intenta decidir o ver la bandeja, **Then** recibe 403.
6. **Given** el plazo vencido, **When** nadie decidió, **Then** el nodo sigue por `timeout` y la
   solicitud queda `timed_out`; una decisión tardía recibe 409 `APPROVAL_ALREADY_RESOLVED`.
7. **Given** dos personas deciden a la vez, **When** llegan las dos, **Then** gana la primera y la
   segunda recibe 409.
8. **Given** una ejecución cancelada mientras espera, **When** se cancela, **Then** la solicitud queda
   `cancelled` y sale de la bandeja.
9. **Given** que la ejecución espera días, **When** se reinicia el worker o Temporal, **Then** la
   espera continúa y la decisión sigue funcionando.
10. **Given** ejecuciones esperando aprobación, **When** se evalúa el límite de ejecuciones
    simultáneas, **Then** esas ejecuciones no cuentan.

---

### User Story 5 - Petición HTTP saliente con credenciales (Priority: P1)

Un nodo `http.request` llama a una API externa por https. Puede referenciar una credencial de la
organización por id; la credencial nunca aparece en la definición, en la ejecución ni en respuestas. La
respuesta se limita a 1 MB y a JSON o texto, y los errores se clasifican según la taxonomía.

**Why this priority**: primera acción con efecto externo real del producto.

**Independent Test**: contra un servidor de pruebas local permitido en el entorno de pruebas, comprobar
éxito, 429 con `Retry-After`, 5xx reintentado, 4xx permanente, respuesta enorme rechazada y cabecera
`Idempotency-Key`.

**Acceptance Scenarios**:

1. **Given** un nodo con método, URL https y, opcionalmente, `credentialId`, **When** se ejecuta,
   **Then** la salida es `{ status, body }` con el cuerpo como texto, y la credencial se envía en la
   cabecera que corresponde a su tipo.
2. **Given** un 5xx, un fallo de red o un timeout, **When** responde el destino, **Then** el error es
   transitorio y se reintenta según la política del nodo.
3. **Given** un 429 con `Retry-After`, **When** responde, **Then** el error es `rate_limited` y se
   espera lo indicado (hasta el tiempo total del nodo).
4. **Given** cualquier otro 4xx, **When** responde, **Then** el error es permanente y no se reintenta.
5. **Given** una respuesta de más de 1 MB o con un `Content-Type` distinto de JSON o texto, **When**
   se recibe, **Then** el nodo falla permanente (`HTTP_RESPONSE_TOO_LARGE`,
   `HTTP_CONTENT_TYPE_UNSUPPORTED`) sin guardar el cuerpo.
6. **Given** un `POST`, `PUT`, `PATCH` o `DELETE`, **When** se envía, **Then** lleva
   `Idempotency-Key: <runId>:<nodeId>` idéntica en todos los reintentos.
7. **Given** que la ejecución, los pasos y los logs, **When** se revisan, **Then** no contienen el
   secreto de la credencial ni cabeceras de autorización.
8. **Given** una credencial archivada o de otra organización, **When** el nodo la referencia, **Then**
   falla permanente `CREDENTIAL_UNAVAILABLE` sin llamar al destino; al publicar, una referencia
   inexistente bloquea la publicación.

---

### User Story 6 - Anti-SSRF (Priority: P1)

Una petición HTTP nunca llega a direcciones internas: se resuelve el DNS, se bloquean las IP privadas,
de loopback, link-local, CGNAT y de metadata (IPv4 e IPv6), se conecta a la IP ya validada y cada
redirección (máximo 3) se revalida.

**Why this priority**: es el criterio de seguridad de la fase y mitiga A01.

**Independent Test**: batería de destinos (`127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`,
`[::ffff:127.0.0.1]`, un nombre que resuelve a loopback, un DNS que cambia entre consultas, una
redirección a `169.254.169.254`): todos bloqueados.

**Acceptance Scenarios**:

1. **Given** una URL cuyo host es o resuelve a una dirección bloqueada, **When** se ejecuta, **Then**
   falla permanente `SSRF_BLOCKED_ADDRESS` sin abrir conexión.
2. **Given** un host con varios registros donde alguno es bloqueado, **When** se resuelve, **Then** se
   rechaza (fail-closed), no se elige "el bueno".
3. **Given** un DNS que devuelve primero una IP pública y luego una privada (rebinding), **When** se
   conecta, **Then** la conexión usa exactamente la IP validada y el nombre no se vuelve a resolver.
4. **Given** una redirección a una dirección bloqueada, a `http` o más allá de 3 saltos, **When** se
   recibe, **Then** falla (`SSRF_BLOCKED_ADDRESS`, `HTTP_REDIRECT_NOT_ALLOWED`,
   `HTTP_TOO_MANY_REDIRECTS`).
5. **Given** una redirección a otro origen, **When** se sigue, **Then** la cabecera de la credencial no
   se reenvía.
6. **Given** la allowlist de la organización con dominios, **When** el host (o un salto) no está en la
   lista, **Then** falla permanente `HTTP_HOST_NOT_ALLOWED`; con la lista vacía solo rige el bloqueo
   de direcciones.
7. **Given** una dirección en forma alternativa (decimal, octal, IPv4 mapeada a IPv6, NAT64), **When**
   se analiza, **Then** se normaliza y se bloquea igual.

---

### User Story 7 - Circuit breaker y bulkhead HTTP (Priority: P2)

Si un servicio externo falla de forma sostenida, el circuit breaker de la organización y el host se
abre y corta el tráfico en lugar de seguir reintentando. El nodo espera hasta un máximo y después
falla. Las llamadas HTTP corren en su propia cola, sin quitar capacidad a los demás nodos.

**Acceptance Scenarios**:

1. **Given** 5 fallos transitorios en 60 s al mismo host de una organización, **When** llega otra
   llamada, **Then** el circuito está abierto y no se hace la petición.
2. **Given** el circuito abierto, **When** pasan 30 s, **Then** pasa a semiabierto y deja pasar una
   sola petición de prueba; si funciona se cierra, si falla se abre de nuevo.
3. **Given** el circuito abierto, **When** un nodo espera más de 120 s, **Then** falla transitorio
   `HTTP_CIRCUIT_OPEN` y se registra en el paso.
4. **Given** una organización A con el circuito abierto para un host, **When** la organización B llama
   al mismo host, **Then** B no se ve afectada.
5. **Given** 4xx, 429 o respuestas válidas, **When** ocurren, **Then** no cuentan como fallos del
   circuito.
6. **Given** una cola `http` saturada, **When** hay nodos LLM o simulados, **Then** siguen ejecutando.

---

### User Story 8 - Credenciales de conector (Priority: P2)

El owner crea credenciales de la organización (bearer, API key en cabecera o basic), las rota y las
archiva. El secreto se cifra con cifrado de sobre y no se puede leer después. Owners y editores ven
solo metadatos y las usan por id en los nodos.

**Acceptance Scenarios**:

1. **Given** un owner, **When** crea una credencial, **Then** se guarda cifrada y la respuesta no
   incluye el secreto; la lista muestra nombre, tipo, nombre de cabecera y fechas.
2. **Given** un editor, **When** intenta crear, rotar o archivar, **Then** recibe 403; un viewer no
   las ve.
3. **Given** un volcado de la base de datos sin la llave maestra, **When** se inspecciona, **Then** no
   hay secretos legibles.
4. **Given** una credencial rotada, **When** corre un nodo, **Then** usa el secreto nuevo sin cambiar
   la definición.
5. **Given** un nombre de cabecera prohibido (`Host`, `Content-Length`, `Cookie`…) para una API key,
   **When** se crea, **Then** se rechaza con 422.

---

### User Story 9 - Allowlist de dominios por organización (Priority: P2)

El owner puede restringir los destinos de `http.request` a una lista de dominios. Es opcional: sin
lista rige solo el bloqueo de direcciones.

**Acceptance Scenarios**:

1. **Given** una lista con `api.example.com` y `*.partner.com`, **When** el nodo llama a
   `api.example.com`, `x.partner.com` y `partner.com`, **Then** se permiten los dos primeros y se
   rechaza el último.
2. **Given** un editor, **When** intenta modificar la lista, **Then** recibe 403; puede leerla.
3. **Given** una entrada con IP literal, esquema, puerto o ruta, **When** se agrega, **Then** se
   rechaza con 422.

---

### User Story 10 - Activación por flag, aislamiento y compilador (Priority: P2)

Todo lo visible de F7 depende de `triggers-enabled`. Una organización nunca ve webhooks, aprobaciones,
credenciales ni listas de otra. El compilador de F6 no ofrece los nodos nuevos.

**Acceptance Scenarios**:

1. **Given** el flag apagado, **When** se llama a los endpoints de F7, **Then** responden 404
   `FEATURE_NOT_AVAILABLE`, la UI no muestra los nodos ni la bandeja, el webhook público responde 404,
   y no se crean Schedules nuevos; los existentes no ejecutan mientras el operador mantenga apagado el
   kill switch `TRIGGERS_ENABLED` del worker.
2. **Given** el flag apagado, **When** una versión con nodos F7 intenta ejecutarse, **Then** falla
   `UNSUPPORTED_NODES` como en F6.
3. **Given** una aprobación o credencial de la organización A, **When** un miembro de B la pide por id,
   **Then** recibe 404.
4. **Given** `triggers-enabled` encendido, **When** el compilador arma el catálogo, **Then** no incluye
   `trigger.webhook`, `trigger.schedule`, `human.approval` ni `http.request` (diferido a F8).

### Edge Cases

- El workflow tiene un `trigger.webhook` pero se cambia a otro trigger en la siguiente versión: el
  webhook queda sin efecto (409 `WEBHOOK_NOT_ACTIVE`); el token se conserva.
- Se archiva un workflow con webhook o schedule: el webhook responde 409 y el Schedule se borra.
- Un `X-Event-Id` reutilizado en otro workflow de la misma organización: es un evento distinto
  (el id se acota por workflow).
- El cuerpo del webhook supera 64 KiB: 413 sin leer el resto; sin `Content-Type: application/json`:
  415.
- Dos disparos de Schedule en el mismo instante tras el catch-up: el solape se salta.
- El Schedule dispara y el workflow ya no tiene versión activa (desactivado entre medias): el lanzador
  termina sin ejecución y lo registra.
- Se alcanza `RUN_LIMIT_REACHED` en un disparo programado: se salta y se registra; en un webhook,
  responde 429 `RUN_LIMIT_REACHED`.
- La aprobación vence con la ejecución cancelada al mismo tiempo: gana la cancelación (`cancelled`).
- Nadie puede aprobar (la organización solo tiene a quien inició la ejecución): la ejecución espera
  hasta el plazo y sigue por `timeout`; la UI lo advierte al ver la solicitud.
- La persona aprobadora pierde el rol entre que se notifica y decide: se valida el rol vigente al
  decidir (403).
- Fallo del correo (SMTP caído): no afecta a la ejecución; la solicitud sigue visible en la bandeja.
- Un destino HTTP devuelve `Content-Length` mentiroso o transmite sin fin: se corta al llegar al
  límite de 1 MB leyendo el flujo.
- Un destino no resuelve (`ENOTFOUND`): transitorio; cuenta para el circuit breaker.
- Valkey no disponible: el rate limit y el breaker fallan cerrado para el webhook (503) y para el nodo
  HTTP (transitorio con espera); no se llama al destino sin consultar el estado del circuito.
- `CREDENTIALS_MASTER_KEY` ausente o con formato inválido: los endpoints de credenciales responden 503
  `CREDENTIALS_NOT_CONFIGURED` y los nodos que las usan fallan permanente.

## Requirements *(mandatory)*

### Functional Requirements

**Webhook**

- **FR-001**: El sistema MUST exponer `POST /api/v1/hooks/{triggerId}/{token}` sin sesión ni CSRF,
  autenticado solo por el token, y responder `202` inmediato con `runId` tras crear la ejecución.
- **FR-002**: El token MUST generarse con 256 bits aleatorios, mostrarse una sola vez, guardarse solo
  como hash SHA-256 y compararse en tiempo constante; regenerarlo MUST invalidar el anterior al
  instante.
- **FR-003**: Una llamada MUST llevar `X-Event-Id` (1–128 caracteres `[A-Za-z0-9._:-]`) y
  `X-Event-Timestamp` (ISO 8601 UTC) a ±5 minutos del reloj del servidor; si no, se rechaza.
- **FR-004**: El `workflowId` de Temporal MUST derivarse del workflow y del id de evento; un evento
  repetido MUST NOT crear otra ejecución y MUST devolver el `runId` original.
- **FR-005**: El cuerpo MUST ser JSON de hasta 64 KiB y validarse contra `bodySchema` con el mismo
  validador de `trigger.manual`; los datos MUST vivir solo en Temporal.
- **FR-006**: El webhook MUST ejecutar la versión activa publicada en el momento del disparo; sin
  versión activa con `trigger.webhook`, MUST NOT disparar.
- **FR-007**: El sistema MUST limitar a 60 llamadas por minuto por trigger y a los intentos con token
  inválido por IP, con `Retry-After`.
- **FR-008**: El token MUST NOT aparecer en logs, trazas ni respuestas: la ruta se redacta antes de
  registrarse. Las respuestas de autenticación fallida MUST ser idénticas para trigger inexistente y
  token incorrecto.
- **FR-009**: Owner y editor MUST poder generar o regenerar el token, ver su estado (sin el token) y
  ver la URL base; viewer solo lee el estado.

**Schedule**

- **FR-010**: Al activar una versión con `trigger.schedule`, el sistema MUST crear o actualizar un
  Temporal Schedule `sched-<workflowId>`; al desactivar la versión activa o archivar el workflow, MUST
  borrarlo.
- **FR-011**: Cada disparo MUST ejecutar la versión activa en ese momento, con política de solape
  `SKIP` y ventana de catch-up de 1 hora (`SCHEDULE_CATCHUP_WINDOW_SECONDS`).
- **FR-012**: La sincronización MUST ser recuperable: el estado deseado se guarda en PostgreSQL en la
  misma transacción que la activación y un reconciliador lo aplica; los fallos no revierten la
  activación.
- **FR-013**: La cron y la zona horaria MUST validarse al publicar (cron de 5 campos y zona IANA
  existente).
- **FR-014**: Cada organización MUST tener un máximo de programaciones activas gestionado por el
  operador (10 por defecto).

**Aprobación humana**

- **FR-015**: El nodo `human.approval` MUST pausar la ejecución sin ocupar un worker, hasta una
  decisión, el plazo o la cancelación, y seguir por la rama `approved`, `rejected` o `timeout`.
- **FR-016**: La decisión MUST aceptarse de cualquier owner o editor vigente de la organización
  excepto quien inició la ejecución, validado en la API y de nuevo por la base de datos.
- **FR-017**: La primera decisión MUST ganar; las posteriores MUST recibir 409.
- **FR-018**: La bandeja MUST listar las solicitudes pendientes que la persona puede decidir, con un
  contador, y un historial de las resueltas; el mensaje y el comentario MUST leerse de Temporal y no
  guardarse en PostgreSQL.
- **FR-019**: El sistema MUST enviar un correo a los owners y editores elegibles (máximo 20) con el
  enlace a la solicitud y sin el texto del mensaje; un fallo del correo MUST NOT afectar a la
  ejecución.
- **FR-020**: Una ejecución con aprobación pendiente MUST NOT contar para el límite de ejecuciones
  simultáneas, y su duración máxima MUST ampliarse con los plazos de sus nodos de aprobación.
- **FR-021**: Decidir, solicitar y vencer MUST registrarse como eventos de seguridad con tipo estable.

**HTTP**

- **FR-022**: `http.request` MUST usar solo https, con timeout, política de reintentos y clasificación
  de errores: 5xx, red y timeout transitorios; 429 `rate_limited` con `Retry-After`; resto de 4xx
  permanente.
- **FR-023**: La respuesta MUST limitarse a 1 MiB leyendo el flujo, aceptar solo `application/json`,
  `+json` y `text/*`, y entregarse como texto en `body`.
- **FR-024**: Las peticiones `POST`, `PUT`, `PATCH` y `DELETE` MUST enviar
  `Idempotency-Key: <runId>:<nodeId>` y registrarse en `node_effects` (F4).
- **FR-025**: El sistema MUST resolver el DNS, bloquear direcciones no públicas (IPv4 e IPv6,
  incluidas formas mapeadas y alternativas), conectar a la IP validada sin nueva resolución y
  revalidar cada redirección (máx. 3, solo https, sin reenviar la credencial a otro origen).
- **FR-026**: El owner MUST poder definir una allowlist de dominios (exactos o `*.dominio`) que, si no
  está vacía, restringe todos los saltos.
- **FR-027**: El sistema MUST ignorar variables de proxy del entorno y MUST NOT seguir redirecciones
  con método que cambie el destino a un esquema distinto de https.

**Credenciales**

- **FR-028**: El sistema MUST guardar credenciales por organización de tipo `bearer`, `api_key_header`
  o `basic`, cifradas con cifrado de sobre AES-256-GCM, con la llave maestra fuera de la base de datos
  (`CREDENTIALS_MASTER_KEY`) y el id de la credencial y de la organización como datos autenticados.
- **FR-029**: El secreto MUST NOT devolverse nunca por la API, ni registrarse, ni entrar en la
  ejecución, la definición, los eventos o las trazas.
- **FR-030**: Solo el owner MUST poder crear, rotar y archivar; owner y editor ven metadatos.
- **FR-031**: El nodo `http.request` MUST referenciar la credencial con `credentialId`; publicar con una
  referencia inexistente, archivada o de otra organización MUST bloquearse.

**Resiliencia**

- **FR-032**: El sistema MUST mantener un circuit breaker por organización y host con estado en Valkey
  (cerrado → abierto tras 5 fallos transitorios en 60 s → semiabierto tras 30 s con una petición de
  prueba), y el nodo MUST esperar hasta 120 s con el circuito abierto antes de fallar.
- **FR-033**: Las activities HTTP MUST correr en la task queue `http`
  (`TEMPORAL_HTTP_TASK_QUEUE`), en el mismo proceso del worker, con concurrencia propia.

**Plataforma**

- **FR-034**: Las ejecuciones disparadas por webhook o programación MUST registrar origen
  (`trigger_kind`), id de evento u hora programada, y no requerir una persona que las inicie.
- **FR-035**: Todo lo visible MUST depender de `triggers-enabled`; el aislamiento por organización MUST
  cumplirse con RLS forzado en las tablas nuevas.
- **FR-036**: El compilador de F6 MUST NOT incluir los nodos de F7 en su catálogo.
- **FR-037**: Las tablas nuevas MUST NOT dar `DELETE` ni `TRUNCATE` a `app_runtime`.

### Key Entities

- **Webhook trigger**: token (solo hash) y metadatos de un workflow; uno por workflow.
- **Programación**: estado deseado y estado de sincronización del Temporal Schedule de un workflow.
- **Aprobación**: solicitud de decisión de un nodo `human.approval` de una ejecución.
- **Credencial**: secreto cifrado de la organización que un nodo HTTP referencia por id.
- **Host permitido**: dominio de la allowlist de la organización.
- **Ejecución disparada por el sistema**: ejecución con origen webhook o programación y sin persona.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las llamadas con token inválido o regenerado, marca de tiempo fuera de
  ventana y `X-Event-Id` repetido se rechazan o deduplican (pruebas automatizadas, 0 ejecuciones
  extra).
- **SC-002**: La batería de SSRF (≥ 25 destinos, IPv4 e IPv6, DNS rebinding, redirecciones) tiene 0
  conexiones a direcciones no públicas.
- **SC-003**: Ningún log, traza, fila ni respuesta contiene el token del webhook, el secreto de una
  credencial ni el mensaje o comentario de una aprobación (prueba automatizada).
- **SC-004**: Una ejecución con aprobación pendiente sobrevive a un reinicio del worker y continúa al
  decidir (prueba de caos).
- **SC-005**: Un webhook válido responde `202` en menos de 500 ms (p95, entorno local).
- **SC-006**: Con un host caído, tras 5 fallos el circuito abre y las siguientes llamadas no llegan al
  destino; el tráfico se reanuda solo al recuperarse el host.
- **SC-007**: Ninguna fila de PostgreSQL contiene el cuerpo del webhook, la respuesta HTTP, el mensaje
  ni el comentario de la aprobación.

## Assumptions

- Se reutilizan de F3–F6: el intérprete `executeDag`, `node_effects`, el rate limit y la taxonomía de
  F4, el patrón de cola propia de F5 (ADR-0063), el SMTP y Mailpit de F1, los eventos de seguridad como
  logs (ADR-0038) y OpenFeature.
- El TLS del webhook lo termina el proxy de F9 (Caddy); en local se usa HTTP. El token viaja en la
  ruta, así que el despliegue DEBE redactarlo también en los logs de acceso del proxy (F9).
- Las ejecuciones por webhook o programación corren con la versión activa en ese momento y sin persona
  iniciadora; cancelar y reejecutar siguen siendo acciones de personas.
- Un correo de aprobación solo avisa; la decisión siempre exige sesión iniciada en la UI.
- Los textos de la UI y los mensajes de la API van en español; los códigos en inglés.
- Fuera de alcance (diferido en research): firma HMAC del webhook, rotación con periodo de gracia,
  varios webhooks o schedules por workflow, aprobaciones por rol o de varios pasos, delegación,
  recordatorios, SSE para la bandeja, credenciales OAuth o en cuerpo/consulta, rotación de la llave
  maestra, límite de frecuencia mínima de cron, rate limit por host, nodos de F7 en el compilador (F8).
