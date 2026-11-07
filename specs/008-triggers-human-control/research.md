# Research: Triggers y control humano (F7)

**Fecha**: 2026-11-07 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: 1A 2B 3B 4A 5A 6B 7A 8B 9C 10B 11A 12A 13C

Las decisiones del autor fijan el rumbo; cada R de abajo concreta valores y mecanismos que el autor no
fijó. Los valores marcados **(propuesto)** son decisiones mías dentro de ese rumbo y se pueden
cambiar al revisar este documento.

## R1. Alcance (1A)

- Los cuatro nodos del catálogo con `executableFrom: 'F7'` (`trigger.webhook`, `trigger.schedule`,
  `human.approval`, `http.request`) pasan a ejecutables.
- Entran también las piezas diferidas por [ADR-0060](../../docs/adr/0060-decisiones-diferidas-de-resiliencia.md):
  circuit breaker, granularidad por servicio (servicio = host) y bulkhead HTTP.
- Entran las credenciales de conector (R10) y la allowlist de dominios (R9), porque sin credenciales un
  `http.request` no puede llamar a APIs reales y el catálogo prohíbe ponerlas en la definición.
- Cambios al catálogo: `http.request` gana `credentialId` (uuid opcional); `trigger.schedule`,
  `human.approval` y `trigger.webhook` no cambian de forma.

## R2. Webhook con token secreto en la URL, sin HMAC (2B) — desviación de PLAN

- **Desviación**: `docs/PLAN.md` §4 ("URL única por trigger, firmada"), §6.2 A08 ("Webhooks firmados
  con HMAC + timestamp anti-replay") y la fila F7 de §10 ("firma inválida") piden HMAC. Por decisión
  del autor, el webhook se autentica con un token secreto dentro de la URL. El criterio de aceptación
  pasa a **"token inválido o regenerado rechazado"**, y se registra en el ADR-0072.
- Ruta: `POST /api/v1/hooks/{triggerId}/{token}`. `triggerId` es un UUID público que identifica el
  trigger; `token` es `cdw_` + base64url de 32 bytes aleatorios (256 bits). El prefijo permite que los
  escáneres de secretos lo reconozcan.
- Guardado: solo `SHA-256(token)` en `webhook_triggers.token_hash`. El token tiene 256 bits de entropía,
  así que no hace falta un KDF lento (Argon2id sirve para contraseñas de baja entropía).
- Comparación en tiempo constante: `timingSafeEqual` sobre los dos hashes. Si el `triggerId` no existe,
  se compara contra un hash ficticio para igualar el tiempo y la respuesta es la misma (401
  `WEBHOOK_TOKEN_INVALID`): no se distingue trigger inexistente de token incorrecto.
- Mostrar una vez: `POST .../webhook/token` crea o regenera y devuelve el token en esa única
  respuesta. Regenerar invalida el anterior al instante (sin periodo de gracia; diferido).
- Un webhook por workflow: la validación semántica exige un solo trigger, así que
  `webhook_triggers.workflow_id` es único.
- **Riesgos de poner el token en la URL** (a diferencia de una firma, que no viaja):
  1. El token puede quedar en logs de acceso, historial de herramientas, proxies o CDN.
  2. Quien lo vea puede disparar el workflow sin más (no hay firma del cuerpo ni integridad del
     contenido).
  3. No hay prueba de integridad del cuerpo: un intermediario con acceso al TLS puede alterarlo.
- **Mitigaciones**:
  - El token nunca se registra: un serializador de `nestjs-pino` y del atributo de traza reemplaza el
    segmento por `[REDACTED]` antes de escribir; una prueba busca el token en los logs.
  - La URL se redacta en eventos de seguridad, errores y respuestas (el `instance` se omite por
    constitución).
  - Rate limit por trigger (R3) y por IP para tokens inválidos.
  - El token se regenera con un clic; TLS obligatorio en producción (F9); el despliegue debe redactar
    la ruta en los logs de Caddy (anotado como requisito para F9).
  - Criterio de F8: verificar que ninguna cadena de logs conserva el token.
- Alternativa registrada: HMAC con secreto compartido (más fuerte en integridad, pero obliga al
  emisor a firmar; muchos emisores simples no pueden). Se puede añadir después como segundo modo
  sin romper la URL.

## R3. Anti-replay: ventana de tiempo e id de evento (3B)

- Cabeceras obligatorias: `X-Event-Id` y `X-Event-Timestamp` (ISO 8601 UTC). Falta o formato inválido:
  400 `WEBHOOK_EVENT_ID_INVALID` o `WEBHOOK_TIMESTAMP_INVALID`.
- **Ventana de ±5 minutos (propuesto)**: tolera desfase de reloj de emisores comunes y limita cuánto
  tiempo un mensaje capturado sirve a quien no conoce el token.
- `X-Event-Id`: 1–128 caracteres `[A-Za-z0-9._:-]`.
- `workflowId` de Temporal y `workflow_runs.temporal_workflow_id` = `hook-<workflowId>-<eventId>`. Dos
  capas de deduplicación:
  1. `workflow_runs.temporal_workflow_id` es `UNIQUE`: el `INSERT` de la ejecución falla con el
     duplicado, de forma permanente (no depende de la retención del namespace de Temporal).
  2. Temporal arranca con `WorkflowIdReusePolicy.REJECT_DUPLICATE` y conflicto `FAIL`, así que
     también rechaza el duplicado ante una carrera.
- El duplicado devuelve `200 { runId, status, duplicate: true }` con el `runId` original, no un
  error: los emisores reintentan ante no-2xx y un reintento legítimo no debe verse como fallo.
- **Límite honesto**: sin firma, la marca de tiempo no está autenticada. La ventana descarta reintentos
  viejos y mensajes capturados con prisa, pero quien conoce el token puede fabricar la marca. La
  garantía fuerte es la deduplicación por id de evento, no el reloj. Queda en el ADR-0072.
- Rate limit **(propuesto)**: token bucket en Valkey `rl:hook:<triggerId>`, capacidad 60, recarga 1/s
  ("por token": el trigger tiene un solo token vigente y la clave sobrevive a la regeneración, para que
  regenerar no reinicie el límite). Intentos con token inválido: `rl:hook-bad:<ip>`, capacidad 20,
  recarga 0,2/s. Respuesta 429 con `Retry-After`. Si Valkey cae, el webhook responde 503 (fail-closed).
- Cuerpo: máximo 64 KiB **(propuesto)** (`WEBHOOK_MAX_BODY_BYTES`); 413 si se pasa. `Content-Type`
  `application/json`; si no, 415.

## R4. Respuesta `202` inmediata (4A)

- La API valida el token, la ventana, el cuerpo, la versión activa y el límite de ejecuciones; inserta
  la fila de la ejecución; arranca `executeDag` con el cliente de Temporal (plazo y reintentos gRPC de
  ADR-0022) y responde `202 { runId, status: "queued" }`. No espera al resultado.
- Si arrancar en Temporal falla, la fila queda `queued` como en el flujo manual de F3; el mecanismo de
  F3 que marca como fallidas las ejecuciones huérfanas se reutiliza (sin cambios).
- `RUN_LIMIT_REACHED` (F3): 429 con `Retry-After`.

## R5. Versión activa al disparar (5A)

- Webhook y schedule resuelven `workflow_active_versions` en el momento del disparo, igual que la
  ejecución manual. Sin versión activa o sin el trigger esperado en esa versión: 409
  `WEBHOOK_NOT_ACTIVE` (webhook) o el lanzador termina sin ejecución (schedule).
- Las ejecuciones en curso conservan su versión (cada ejecución lleva su definición en la entrada,
  ADR-0048).
- Las fases ejecutables de la entrada incluyen `F7` solo si `triggers-enabled` está encendido para la
  organización al disparar (R13).

## R6. Un Temporal Schedule por workflow (6B)

- Id: `sched-<workflowId>`. Se crea o actualiza al **activar** una versión con `trigger.schedule`, se
  actualiza al activar otra versión y se borra al **desactivar** la versión activa o al archivar el
  workflow. Una versión con otro trigger borra el Schedule.
- **Lanzador (`fireSchedule`)**: un Schedule solo arranca un workflow con argumentos fijos, pero la
  versión que debe ejecutarse se decide al disparar (5A). La acción del Schedule arranca un workflow
  corto `fireSchedule` (`organizationId`, `workflowId`, hora programada) que: (1) llama a la activity
  `startScheduledRun` (carga la versión activa, valida el flag y el límite de concurrencia, inserta la
  ejecución) y (2) lanza `executeDag` como child workflow con `workflowId` `run-<runId>` y
  `ParentClosePolicy.ABANDON`, **esperando su fin**.
- **Salto por solape**: la política de solape `SKIP` del Schedule mira si el lanzador sigue abierto.
  Por eso el lanzador espera a la ejecución: mientras ella corre (o espera una aprobación), los
  disparos siguientes se saltan. El historial del lanzador es mínimo.
- **Catch-up (propuesto) = 1 hora** (`SCHEDULE_CATCHUP_WINDOW_SECONDS=3600`). Cubre reinicios y
  ventanas de despliegue de una sola VM (F9) y una caída corta de Temporal, que es lo habitual. No se
  extiende más porque ejecutar tarde un disparo antiguo (un reporte "de las 9:00" a las 20:00) suele
  ser peor que saltarlo; además con `SKIP` los disparos acumulados se reducen a uno. Los descartados
  fuera de la ventana se cuentan en una métrica y un log.
- **Reconciliación**: la tabla `workflow_schedules` guarda el estado deseado (`scheduled` o
  `removed`) y el estado de sincronización (`pending`, `synced`, `failed`). La API lo escribe en la
  misma transacción de la activación e intenta aplicarlo a Temporal al instante; si falla, la
  activación sigue y el reconciliador (un temporizador del worker cada 60 s) reintenta. Idempotente:
  crear = `create` o `update` si existe; borrar = ignorar "no existe".
- **Validación**: la cron de 5 campos ya la valida `dag-schema`; en la publicación se añade la zona
  IANA (`Intl.supportedValuesOf('timeZone')`) y una prueba de que Temporal acepta la combinación
  (conversión a `cronExpressions` con `timezoneName`).
- **Tope**: `organization_limits.max_active_schedules` (default 10, gestionado por el operador,
  ADR-0045) y `SCHEDULE_LIMIT_REACHED`. No se limita la frecuencia mínima de la cron (diferido); la
  política `SKIP`, el límite de ejecuciones simultáneas y el tope acotan el costo.
- Con `triggers-enabled` apagado: no se crean ni actualizan Schedules, y los existentes dejan de
  ejecutar porque el lanzador respeta el kill switch `TRIGGERS_ENABLED` del worker (R13); no se
  borran, así que al reactivar el flag siguen en pie.
- Diferido: varias programaciones por workflow, disparo manual del Schedule, listado de próximos
  disparos en la UI (se puede mostrar leyendo `describe` del Schedule).

## R7. Quién aprueba (7A) y cómo se decide

- Pueden decidir los miembros con rol owner o editor vigente de la organización, salvo quien inició la
  ejecución (`workflow_runs.triggered_by`). En ejecuciones de webhook o programación no hay iniciador
  y decide cualquier owner o editor.
- **Decisión por Temporal Update** (en lugar de Signal; desviación menor de PLAN §4 "usa signals"):
  la API envía el Update `decideApproval { nodeId, decision, decidedBy, comment? }` y espera el
  resultado `{ accepted: true }` o `{ accepted: false, reason }`. Motivo: un Signal no devuelve
  nada, así que no se podría responder 409 a la segunda decisión o a la tardía sin leer el estado
  aparte; con Update la primera decisión dentro del workflow gana de forma determinista y la API
  responde con certeza. Si el workflow ya terminó, el Update falla y la API responde 409.
- El Update lleva un validador que rechaza el nodo inexistente o ya resuelto. El workflow sigue siendo
  determinista: el valor del reloj lo da `sleep`/`condition` con plazo.
- Autorización siempre en la API (guard de rol + comprobación de no-iniciador) y repetida en la base
  con triggers (`approvals_decider_check`), como defensa en profundidad. Los flags no son control de
  seguridad (constitución, I).
- Decidir exige sesión y CSRF como cualquier acción de la UI. El correo solo enlaza; no se decide desde
  el correo.
- Cancelación: la ejecución cancelada mientras espera deja la solicitud `cancelled`.

## R8. Bandeja, contador y correo (8B)

- **Espera**: dentro de `executeDag`, `human.approval` registra el evento `approval.requested` (la
  activity `recordRunEvent` crea la fila en `approvals`), lanza la activity `notifyApprovers` (R8,
  correo) y espera con `condition(() => decision !== undefined, timeoutMs)`. No ocupa un worker. El
  paso queda `running` con `waiting_reason = 'approval'` (extensión del mecanismo de F4).
- **Estado de la ejecución**: no se añade un estado `waiting_approval` a `workflow_runs` (PLAN §5.5
  lo menciona). La ejecución sigue `running` y la UI deriva "Esperando aprobación" del paso. Evita un
  nuevo valor de enum y la lógica de cuándo está "toda" la ejecución en espera. Desviación menor en el
  ADR-0074.
- **Efectos en límites**: las ejecuciones con una aprobación `pending` no cuentan en
  `RUN_LIMIT_REACHED` (si no, 5 aprobaciones de un día bloquearían a la organización). La duración
  máxima de la ejecución (`maxDurationMs`, hoy 30 min) y el `workflowExecutionTimeout` se calculan en
  la API como `base + Σ timeoutSeconds` de los nodos `human.approval` de la versión; los nodos de un
  DAG sin ciclos corren una vez, así que la suma es una cota válida.
- **Contenido solo en Temporal** (5C de F3, ADR-0050): el mensaje (resuelto con plantillas desde las
  salidas) y el comentario viven solo en el historial. La fila de `approvals` guarda metadatos (nodo,
  etiqueta, plazo, estado, quién decidió, si hubo comentario). El detalle de una solicitud lee el
  mensaje del historial con el mismo mecanismo que `run-content`. Si el historial expiró:
  `APPROVAL_CONTENT_EXPIRED` (410) y solo se muestran los metadatos.
- **Bandeja**: `GET .../approvals?status=pending` devuelve lo que la persona puede decidir (excluye
  las de ejecuciones que ella inició) y `GET .../approvals/count` el contador que la barra superior
  consulta con polling (30 s). Historial: `status=resolved` para owner y editor.
- **Correo** (SMTP existente, Mailpit en local): a owners y editores elegibles, máximo 20 destinatarios
  **(propuesto)**; asunto "Aprobación pendiente en <workflow>"; cuerpo con el nombre del workflow, la
  etiqueta del nodo, el plazo y un enlace a la solicitud; **sin** el mensaje (puede llevar datos del
  usuario y saldría de Temporal). El envío vive en una activity en la cola principal, con 3
  reintentos, y su fallo se registra sin afectar a la ejecución. El worker usa las mismas variables
  `SMTP_*` y `nodemailer` (ADR-0034, sin dependencia nueva); sus plantillas se mantienen aparte de las
  del API, que son de identidad.
- **Comentario**: opcional, hasta 500 caracteres, solo en Temporal. La salida del nodo es
  `{ decision, approvedBy }` con el id de la persona (el nombre se resuelve al mostrar).
- Diferido: aprobación por rol o por grupo, varios aprobadores, delegar, recordatorios antes del
  plazo, SSE de la bandeja.

## R9. Anti-SSRF (9C)

Módulo `packages/connectors` (puro y con TDD: se añade a la lista de la constitución por enmienda
PATCH). Funciones: `assertPublicAddress`, `createGuardedLookup`, `guardedRequest`.

1. **Normalizar la URL** con el parser WHATWG: `http://2130706433/` y `http://0x7f.1/` pasan a
   `127.0.0.1`. Solo `https:`; se rechazan credenciales en la URL y hosts con IP literal que sean no
   públicas (la regla de IP aplica a literales igual que a resoluciones).
2. **Resolver** con `dns.lookup(host, { all: true, verbatim: true })`. Si **alguna** dirección es no
   pública, se rechaza todo (fail-closed): no se elige "la buena".
3. **Bloqueo por rango** (IPv4): `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
   `127.0.0.0/8`, `169.254.0.0/16` (link-local y metadata `169.254.169.254`), `172.16.0.0/12`,
   `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`,
   `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255`. IPv6:
   `::`, `::1`, `::ffff:0:0/96` (se extrae y valida el IPv4 incrustado), `64:ff9b::/96` (NAT64; se
   valida el IPv4 incrustado), `64:ff9b:1::/48`, `100::/64`, `2001::/23` (incluye Teredo),
   `2001:db8::/32`, `2002::/16` (6to4; se valida el IPv4 incrustado), `fc00::/7` (ULA; cubre
   `fd00:ec2::254`), `fe80::/10`, `fec0::/10`, `ff00::/8`. Es una lista cerrada y probada; lo que no
   es claramente unicast global se bloquea.
4. **Conectar a la IP validada (anti DNS rebinding)**: se usa `node:https` con una función `lookup`
   propia que resuelve, valida y devuelve **solo** direcciones públicas. Esa dirección es la que abre
   el socket; el nombre no se vuelve a resolver. `servername` y la cabecera `Host` conservan el nombre
   original para la verificación del certificado TLS. Sin dependencias nuevas.
5. **Redirecciones**: manuales, máximo 3, solo `https:`, cada salto vuelve a pasar por 1–4 y por la
   allowlist. Un salto a otro origen (esquema, host o puerto distinto) descarta la cabecera de la
   credencial y `Idempotency-Key`. `303` cambia a `GET`; `301/302` de `POST` cambian a `GET`;
   `307/308` conservan método y cuerpo.
6. **Sin proxy**: se ignoran `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`; el agente no se comparte con el
   resto del proceso.
7. **Allowlist por organización (opcional)**: tabla `http_allowed_hosts`. Entradas: `host` exacto o
   `*.dominio` (solo subdominios); sin IP literal, esquema, puerto ni ruta; máximo 100. Lista vacía =
   solo rigen las reglas anteriores. Lista no vacía = el host (y cada salto) debe coincidir. La
   administra el owner; lectura para owner y editor. El comodín no incluye el dominio base.
8. **Puertos**: se permite cualquier puerto https; la defensa es la IP, no el puerto.
9. Errores: `SSRF_BLOCKED_ADDRESS`, `HTTP_HOST_NOT_ALLOWED`, `HTTP_REDIRECT_NOT_ALLOWED`,
   `HTTP_TOO_MANY_REDIRECTS`: todos permanentes. El mensaje del paso no incluye la IP resuelta (evita
   usar el error como oráculo del DNS interno): "El destino no está permitido."
10. En desarrollo y pruebas, el entorno de pruebas puede registrar hosts de prueba mediante una
    variable de entorno **solo si** `NODE_ENV` no es `production` (`HTTP_TEST_ALLOW_LOOPBACK`); el
    validador de entorno falla al arrancar en producción si está definida.

## R10. Credenciales de conector (10B)

- **Cifrado de sobre AES-256-GCM**: cada credencial genera una llave de datos (DEK) aleatoria de 32
  bytes; el secreto se cifra con la DEK y la DEK se cifra con la llave maestra (`CREDENTIALS_MASTER_KEY`,
  32 bytes en base64, variable de entorno validada con Zod). IV aleatorio de 12 bytes por cifrado.
  Datos autenticados adicionales (AAD): `credential:<id>:<organization_id>`, para que un blob copiado a
  otra fila no se descifre.
- Se guardan DEK cifrada + IV + tag y secreto cifrado + IV + tag, más `key_version` (hoy 1) para
  permitir rotar la maestra más adelante (la rotación queda diferida).
- Tipos que van en cabecera, **solo estos**: `bearer` (`Authorization: Bearer <secreto>`),
  `api_key_header` (`<header_name>: <secreto>`) y `basic` (`Authorization: Basic base64(usuario:clave)`).
  Lista de nombres de cabecera prohibidos para `api_key_header`: `Host`, `Content-Length`,
  `Content-Type`, `Transfer-Encoding`, `Connection`, `Cookie`, `Set-Cookie`, `Authorization`,
  `Idempotency-Key`, `Proxy-*`. No hay credenciales en cuerpo ni en la cadena de consulta.
- **Nunca se devuelve en claro**: ni al crear ni al leer; la API solo devuelve metadatos. Rotar
  reemplaza el secreto (el owner lo envía de nuevo). El secreto no se escribe en logs (redacción de
  `secret`/`password`), ni entra en el historial de Temporal: el nodo solo lleva el `credentialId`; el
  worker descifra dentro de la activity y no lo devuelve.
- **Quién administra**: solo el owner crea, rota y archiva **(propuesto)**; owner y editor listan
  metadatos y las usan por id. Es el mínimo privilegio: un editor puede usar una credencial pero no
  extraerla ni cambiarla, y la allowlist (R9) acota adónde puede enviarse.
- **Archivar** (sin `DELETE`): `archived_at`. Un archivado se rechaza al publicar y al ejecutar
  (`CREDENTIAL_UNAVAILABLE`, permanente). Nombre único entre los vigentes de la organización.
- **Publicar** valida que cada `credentialId` exista, esté vigente y sea de la organización
  (`CREDENTIAL_NOT_FOUND`, 422 en la publicación).
- **Sin llave maestra**: los endpoints responden 503 `CREDENTIALS_NOT_CONFIGURED` y los nodos fallan
  permanente. Obligatoria si `NODE_ENV=production`.
- **Redirecciones**: la credencial se envía solo al origen original (R9.5). No se vincula la credencial
  a hosts (diferido): la allowlist de la organización cumple esa función.
- Eventos de seguridad (ADR-0038): `credential.created`, `credential.rotated`,
  `credential.archived`, sin el valor.

## R11. Respuesta y clasificación de `http.request` (11A)

- **Tamaño**: máximo 1 MiB (1 048 576 bytes) leyendo el flujo y cortando al pasar el límite; no se
  confía en `Content-Length`. Falla permanente `HTTP_RESPONSE_TOO_LARGE`.
- **Tipo**: solo `application/json`, `application/*+json` y `text/*`. Otro tipo (o ninguno con
  cuerpo): permanente `HTTP_CONTENT_TYPE_UNSUPPORTED`. Se decodifica como UTF-8; el `body` sale como
  **texto** (un JSON se queda como texto; si el siguiente nodo lo necesita, lo extrae con `llm.extract`
  u otro nodo posterior; fuera del alcance de F7).
- **Clasificación** (F4, ADR-0055):

  | Respuesta | Clase | Reintento |
  |---|---|---|
  | 2xx | éxito | — |
  | 5xx, error de red (`ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`), timeout | `transient` / `timeout` | sí, backoff exponencial con jitter |
  | 429 | `rate_limited` | espera `Retry-After` (segundos o fecha HTTP), hasta el tiempo total del nodo |
  | resto de 4xx (incluido 408) | `permanent` | no |
  | 3xx sin `Location` válido | `permanent` (`HTTP_REDIRECT_NOT_ALLOWED`) | no |

- **Política por defecto** `http.request` en el catálogo (se añade a `PER_NODE_POLICIES`): 3
  intentos, 30 s por intento, 1 s inicial **(propuesto)**; ajustable dentro de los límites de F4.
- **Cabeceras de la definición**: se mantiene la regla de F2 (sin credenciales ni cabeceras sensibles);
  `User-Agent: CognitiveDAG/1` fijo. Las cabeceras gestionadas por el sistema (`Idempotency-Key`, la de
  la credencial, `Host`) no se pueden definir en el nodo.
- **Salida**: `{ status: number, body: string }` (catálogo vigente). El `body` y la URL resuelta viven
  solo en Temporal.
- Mensajes de error del paso: sin URL ni cuerpo, solo código y clase.

## R12. Idempotencia, circuit breaker y bulkhead (12A)

**Idempotencia**

- `Idempotency-Key: <runId>:<nodeId>` en `POST`, `PUT`, `PATCH` y `DELETE`, igual en todos los
  reintentos (constitución, II). Se registra el efecto en `node_effects` (`begin`/`commit` de F4).
- Si el destino no respeta la cabecera, una reanudación tras fallo ambiguo (efecto `started` con
  más de un intento) puede repetir el efecto: riesgo aceptado y ya anotado en el modelo de amenazas
  (F4, "destino que no deduplica la clave"). Si el efecto ya está `committed` y la activity se
  reintenta, se vuelve a enviar con la misma clave; no se guarda la respuesta en `node_effects`
  (contenido solo en Temporal).

**Circuit breaker** (cierra la deuda de ADR-0060; 3C de F4)

- **Granularidad**: organización + host (el host es el "servicio"). Clave `cb:<organizationId>:<host>`.
  El rate limit de F4 queda por organización y tipo de nodo; un límite por host se difiere.
- Estados con script Lua atómico (como el token bucket de F4, que usa el reloj de Valkey):
  - **cerrado**: cuenta los fallos transitorios en una ventana deslizante
    (`cb:<org>:<host>:f`, conjunto ordenado por marca de tiempo). **5 fallos en 60 s (propuesto)** →
    abierto.
  - **abierto**: rechaza sin llamar; tras **30 s de enfriamiento (propuesto)** → semiabierto.
  - **semiabierto**: deja pasar **una** petición de prueba (bloqueo `SET NX` con TTL de 30 s); si
    tiene éxito → cerrado y se limpian los fallos; si falla → abierto otra vez.
- Cuentan como fallo: 5xx, error de red, timeout. No cuentan: 429, 4xx, bloqueos SSRF, fallos de
  validación.
- **Espera y fallo (3C de F4)**: con el circuito abierto, la activity lanza un error transitorio con
  `nextRetryDelay` igual al tiempo que queda de enfriamiento (como la espera del rate limit en F4, que no
  gasta intentos). El nodo espera hasta **120 s (propuesto)** desde que se programó la activity
  (`scheduledTimestampMs`); pasado ese máximo falla `HTTP_CIRCUIT_OPEN` como transitorio. Los intentos
  contados son los reales.
- Valkey caído: fail-closed, el nodo espera (error transitorio) y no llama al destino.
- Configuración por entorno: `HTTP_CB_FAILURES=5`, `HTTP_CB_WINDOW_SECONDS=60`,
  `HTTP_CB_COOLDOWN_SECONDS=30`, `HTTP_CB_MAX_WAIT_SECONDS=120`.

**Bulkhead**

- Task queue `cognitive-dag-http` (`TEMPORAL_HTTP_TASK_QUEUE`) con un worker en el mismo proceso y su
  propia concurrencia (`HTTP_MAX_CONCURRENT_ACTIVITIES`, default 20), como la cola LLM (ADR-0063). La
  entrada de `executeDag` gana `httpTaskQueue`.
- Las activities de aprobación (`notifyApprovers`) y del lanzador de Schedules van en la cola
  principal.

## R13. Un solo flag `triggers-enabled` y compilador sin nodos nuevos (13C)

- Un flag público `triggers-enabled` (dueño `devanthony92`, issue de eliminación a crear al abrir la
  PR 2) controla todo F7: endpoints (`404 FEATURE_NOT_AVAILABLE`), webhook público (404),
  Schedules (se pausan), bandeja, credenciales, allowlist, UI y las fases ejecutables (`F7` se añade a
  `executablePhases` solo con el flag encendido).
- Kill switch operativo: `HTTP_ENABLED` (default `true`) en el worker, como `LLM_ENABLED`; en `false`
  las activities HTTP fallan `HTTP_DISABLED` sin llamar al destino. El flag no es control de
  seguridad: la autorización y el anti-SSRF se aplican siempre.
- El worker no lee flags (constitución, II: el flag se lee en la API y entra por la entrada del
  workflow): la API decide `executablePhases` al iniciar cada ejecución. Los disparos programados no
  pasan por la API, así que el lanzador respeta el kill switch de proceso `TRIGGERS_ENABLED` (default
  `true`) del worker; el operador lo apaga junto con el flag.
- **Compilador**: `packages/compiler` ya filtra por `executableFrom ≤ F5`; esa regla no cambia, así que
  los nodos F7 no entran al prompt. Se añade una prueba que lo fija (ningún tipo `executableFrom: 'F7'`
  llega al prompt aunque `triggers-enabled` esté encendido). Se difiere a F8 y queda en el ADR-0080.

## R14. Ejecuciones disparadas por el sistema

- `workflow_runs.triggered_by` pasa a admitir `NULL`. Columnas nuevas: `trigger_kind`
  (`manual`, `webhook`, `schedule`), `trigger_event_id` (webhook) y `scheduled_at` (schedule), con
  `CHECK` de consistencia.
- La creación de la ejecución (versión activa, límite de concurrencia, inserción) se extrae a un
  módulo compartido de `packages/db`, usado por la API (manual y webhook) y por el worker (lanzador).
- Cancelar y reejecutar siguen siendo acciones de personas con rol (ADR-0053); reejecutar una
  ejecución de webhook crea una ejecución `manual` con `rerun_of`.
- La UI muestra "Webhook" o "Programación" en lugar del nombre de la persona (`triggeredBy` pasa a
  ser nulo en el contrato).

## R15. Observabilidad y eventos de seguridad

- Eventos de seguridad como logs de tipo estable (ADR-0038): `webhook.token.generated`,
  `webhook.rejected` (con razón: `token`, `timestamp`, `event_id`, `rate_limit`; sin el token),
  `webhook.accepted`, `approval.requested`, `approval.decided`, `approval.timed_out`,
  `credential.*`, `http_host.added|removed`, `schedule.synced|skipped|caught_up|failed`,
  `ssrf.blocked` (sin la IP resuelta) y `circuit.opened|closed`.
- Métricas (solo registros por ahora; el stack es de F9): aperturas del circuito por host, llamadas
  bloqueadas por SSRF, disparos saltados y descartados fuera de la ventana de catch-up.
- Correlation-ID: el webhook acepta `X-Correlation-Id` válido o genera uno, y la ejecución lo hereda; el
  lanzador genera uno por disparo.

## Decisiones diferidas

| Tema | Por qué se difiere |
|---|---|
| Firma HMAC del webhook como segundo modo | El token cubre el MVP; HMAC se puede añadir sin cambiar la URL |
| Periodo de gracia al regenerar el token | Complica el modelo; regenerar corta de inmediato |
| Varios webhooks o programaciones por workflow | La validación semántica exige un solo trigger |
| Frecuencia mínima de cron | `SKIP`, el límite de concurrencia y el tope acotan el costo |
| Aprobación por rol, de varios pasos, delegación y recordatorios | El MVP necesita una decisión simple |
| SSE para la bandeja | El polling de 30 s basta |
| Credenciales OAuth, en cuerpo o consulta | La decisión limita a cabeceras (10B) |
| Rotación de la llave maestra | `key_version` deja el camino; sin operación de rotación aún |
| Credencial atada a hosts | La allowlist por organización cubre el riesgo principal |
| Rate limit por host | El breaker por host acota la presión; el límite sigue por tipo de nodo |
| Nodos de F7 en el compilador | Decisión 13C; a F8 |
| `http.request` con respuesta binaria o mayor de 1 MiB | Decisión 11A |

## ADRs previstos

Numeración desde 0072 (el último ADR de F6 es el 0071).

- 0072: webhook autenticado con token secreto en la URL, sin HMAC; anti-replay con ventana de tiempo e
  id de evento (R2, R3). Registra la desviación de PLAN y sus riesgos.
- 0073: Temporal Schedule por workflow con lanzador, salto por solape, catch-up de 1 hora y
  reconciliación (R6).
- 0074: aprobación humana con Temporal Update, bandeja, contador y correo (R7, R8). Registra la
  desviación de "signals" y de no añadir el estado `waiting_approval`.
- 0075: ejecuciones disparadas por el sistema: `triggered_by` nulo, origen del disparo y conteo del
  límite de concurrencia con aprobaciones pendientes (R8, R14).
- 0076: anti-SSRF: resolución validada, conexión a la IP, redirecciones y allowlist opcional (R9).
- 0077: credenciales de conector con cifrado de sobre AES-256-GCM y llave maestra por entorno (R10).
- 0078: `http.request`: límites de la respuesta, clasificación e idempotencia (R11, R12).
- 0079: circuit breaker por organización y host en Valkey y cola `http` (R12); actualiza el ADR-0060.
- 0080: flag único `triggers-enabled` y compilador sin nodos de F7 (R13).
- 0081: dataset y baterías de seguridad de F7 (SSRF, replay, secretos) y evidencia de cierre (SC-001 a
  SC-007).
