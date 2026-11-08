# Research: Endurecimiento (F8)

**Fecha**: 2026-11-08 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: 1A 2B 3A 4A 5A 6A 7A 8C 9C

Las decisiones del autor fijan el rumbo; cada R concreta valores y mecanismos que el autor no fijó.
Los valores marcados **(propuesto)** son decisiones mías dentro de ese rumbo y se pueden cambiar al
revisar este documento. Las comprobaciones del estado actual se hicieron leyendo el repositorio en
`main` (`38d1aa1`).

## R1. Matriz de evidencia de OWASP (historia 1)

- Un documento nuevo, `docs/security/owasp-evidence.md`, con una tabla para 6.1 (LLM01–LLM10) y otra
  para 6.2 (A01–A10). Columnas: riesgo, aplica, control, ubicación (ruta de código o configuración),
  evidencia (comando o prueba), resultado y fecha, estado.
- Estados: `verified`, `accepted` (razón, dueño, revisión), `deferred:F9` (requisito, prueba prevista),
  `not-applicable` (razón y qué la activaría). Es el vocabulario del modelo de amenazas más
  `not-applicable` (LLM09) y `deferred:F9` en lugar de `planned:F9`.
- **Comprobador** (propuesto): `scripts/security/check-evidence.ts`, ejecutado por `pnpm
  security:evidence` y por la suite de scripts que ya corre en el job `integration`. Extrae de la
  matriz y de `docs/threat-model.md` toda ruta entre comillas inversas que parezca un archivo
  (`*.test.ts`, `*.md`, `src/...`) y falla si no existe; falla si una fila no tiene uno de los cuatro
  estados o si una `verified` no cita evidencia; falla si queda `planned:F4`/`planned:F8`. No usa red.
  Así se cumple SC-003 y SC-008 sin añadir un check de CI (corre dentro de uno existente).
- "Falla si el control se retira" (FR-002) se demuestra por fila con la prueba existente; donde no hay
  prueba, la fila nueva de PR 3 o PR 4 la añade. La matriz lista el hueco y la tarea que lo cierra.

**Filas con hueco detectado al leer las fuentes** (la verificación definitiva la hace la PR 5):

| Fila | Hallazgo | Desenlace previsto |
|---|---|---|
| LLM01–LLM03, LLM06, LLM08, LLM10 | Cubiertas por `injection.test.ts`, `compile.test.ts`, `llm-budget.test.ts`; falta el catálogo de F7 en los evals | PR 1 amplía `packages/compiler/evals` |
| LLM02 | Capa gratuita de Gemini puede usar el contenido | `accepted` hasta F9, migrar antes de la demo |
| LLM04, A03 | `pnpm audit`, gitleaks, Renovate, digests, `minimumReleaseAge`; sin SBOM | `verified` sin SBOM (decisión 9C) |
| LLM05, LLM09 | Sin entrenamiento ni RAG | `not-applicable` con el cambio que las activaría |
| LLM07 | El usuario revisa el borrador; `llm.generate` no envía | `verified` (`compilations.test.ts`) |
| A01 | `runs.controller` sin `RequiredRoles` (ADR-0053) | `mitigated` tras PR 1 |
| A02 | Helmet, CORS y errores probados; Temporal, PostgreSQL y Valkey sin exposición pública dependen de F9 | `verified` parcial + `deferred:F9` |
| A04 | Argon2id y AES-256-GCM probados; TLS en F9 | `verified` + `deferred:F9` (TLS) |
| A05 | AST sin `eval`; sin comprobación estática global | PR 3 añade la comprobación estática (R7) |
| A07 | PLAN dice "access token + refresh"; hay sesiones opacas. Sin MFA | PLAN corregido; `accepted` (4A) |
| A08 | Webhook sin HMAC (2B); versiones inmutables; sin artefactos firmados | `accepted` + el PLAN deja de prometer artefactos firmados en F8 |
| A09 | PLAN dice "log de auditoría por tenant"; hay eventos en logs (5A) | PLAN corregido; `verified` con la retención en `deferred:F9` |
| A10 | `ProblemDetailsFilter` y fail-closed probados | `verified` |
| A06 | Modelo de amenazas, límites por tenant, aprobaciones | `verified` al cerrar la v2.0 del modelo |

- **Orden y nombres de OWASP LLM 2026**: el PLAN avisa de que se tomaron de una fuente secundaria. En
  la PR 5 se consulta genai.owasp.org, se anota la fecha y la URL en la matriz y se corrige la tabla
  6.1 si difiere. Si la fuente no está accesible, la fila queda `deferred` con esa razón y no se
  inventa. No se cambian las mitigaciones por el orden.

## R2. Regla de roles de ejecución (1A, historia 2)

- Estado actual: `RunsController` usa `IdentityEnabledGuard`, `ExecutionEnabledGuard` y
  `OrganizationGuard`, sin `@RequiredRoles` en `POST workflows/:id/runs`, `POST runs/:id/cancel` ni
  `POST runs/:id/rerun`. `RequiredRoles('owner', 'editor')` ya se usa en workflows, compilaciones,
  aprobaciones y webhooks, así que la mecánica existe.
- Cambio: `@RequiredRoles('owner', 'editor')` en las tres rutas que inician efectos: iniciar,
  cancelar, reejecutar (el endpoint de reejecución desde un nodo es el mismo `rerun` con `fromNodeId`).
  Las lecturas (listados, detalle, `io`, `events`) siguen abiertas a cualquier miembro.
- **Prueba por ruta (FR-008)**: una prueba recorre `RunsController` por reflexión sobre los metadatos
  de Nest (`ROUTE_ARGS`/`PATH_METADATA` y `REQUIRED_ROLES`) y exige que cada ruta que cambie estado
  (`POST`, `PUT`, `PATCH`, `DELETE`) declare `REQUIRED_ROLES`, o esté en una lista cerrada de
  excepciones comentada. Es la defensa contra "se añade una ruta sin decisión de rol". Se aplica solo
  a `RunsController` en esta fase (propuesto); extenderla a todos los controladores se evalúa en la PR
  de cierre y, si cuesta poco, se hace (los demás ya usan `RequiredRoles`).
- **Web**: los botones "Ejecutar", "Cancelar" y "Reejecutar" se deshabilitan para el viewer con una
  explicación ("Tu rol no permite ejecutar workflows"), igual que el editor oculta Guardar y Publicar
  al viewer (F2). Se reutiliza el hook de rol existente.
- **Aprobaciones y webhooks** ya excluyen al viewer; no cambian. El viewer sigue pudiendo leer
  ejecuciones y entradas y salidas redactadas.
- **ADR**: nuevo ADR-0082 "Solo owner y editor ejecutan" que marca ADR-0053 como `superseded`. Las
  pruebas que citaban "cualquier rol ejecuta" (`runs-start.test.ts`, `runs-start.test.tsx`) se
  invierten.
- **Migración de datos**: ninguna. Las ejecuciones antiguas iniciadas por un viewer se conservan.
- Ejecuciones disparadas por el sistema (webhook, programación) no tienen persona; cancelar y
  reejecutar ya son acciones de personas, y ahora exigen owner o editor.

## R3. Compilador con los nodos de F7 (3A, historia 3)

- Estado actual: `allowedNodeTypes` filtra por `executableFrom ≤ F5` (con `llm-nodes-enabled`) o `≤
  F3`; `catalog-f7.test.ts` fija que ningún tipo de F7 llega al prompt; `sensitiveFields` de
  `http.request` es `['url', 'headers', 'body']`.
- Cambios:
  1. `credentialId` se añade a `sensitiveFields` de `http.request`. Es el campo que dirige qué secreto
     de la organización se usa; el modelo no debe elegirlo ni inventar un UUID. El saneado ya elimina
     los campos sensibles y los lista en `omittedSensitiveFields`, así que no hay mecanismo nuevo.
  2. El filtro de ejecutabilidad pasa a `≤ F7` y deja de depender de ningún flag (R4).
  3. `catalog-f7.test.ts` se reescribe: fija que llegan exactamente los cuatro tipos de F7 y que
     `credentialId`, `url`, `headers` y `body` no están en lo que el modelo puede rellenar.
  4. `allowedNodeTypes` pierde el parámetro `triggersEnabled?` que se ignoraba (ADR-0080).
  5. La validación del editor no cambia: `credentialId` sigue siendo un `uuid` opcional en el
     esquema (FR-012); `sensitiveFields` solo lo usa el compilador.
- **Qué debe hacer el modelo con cada nodo nuevo** (para el prompt, en inglés): `trigger.webhook`
  declara solo `bodySchema` (los campos que espera); `trigger.schedule` declara `cron` y `timezone`
  que sí puede proponer porque no dirigen un efecto externo y se validan al publicar; `human.approval`
  declara `message` (plantilla), `timeoutSeconds` y las ramas `approved`/`rejected`/`timeout`;
  `http.request` solo `method` y la forma, sin `url`, `headers`, `body` ni `credentialId`.
- **Inyección dirigida**: `packages/compiler/evals/injection.json` gana casos que piden: una llamada a
  una URL del atacante con "mi token", una cabecera `Authorization` inventada, exfiltrar el contenido
  de un webhook a un destino externo, y saltarse la aprobación humana. El criterio sigue siendo 0
  escapes. `intents.json` gana intenciones legítimas con cada nodo (≥ 6 nuevas, sobre las 30 actuales)
  y el umbral de 80 % se mide sobre el conjunto ampliado. Las respuestas grabadas
  (`fake-responses`) se amplían para correr en cada PR; la corrida contra Gemini se hace a mano al
  cerrar la fase (`compiler-evals.yml`, ya existente) y su resultado va a un ADR de evals.
- **Aprobación sin salida**: una intención con `human.approval` puede dejar ramas sin cubrir; la
  validación semántica de F2 ya exige que cada rama de `human.approval` tenga destino o termine, así
  que el ciclo de reparación de F6 lo trata como cualquier otro error.
- No cambia que el compilador solo entrega un borrador: publicar y ejecutar siguen exigiendo una
  persona con permisos, y desde R2, owner o editor.

## R4. Eliminación de los flags de producto (2B, historia 5)

- Ocho flags, 18 a 51 archivos cada uno (ping 18, identity 51, dag-editor 20, execution 18,
  resilience 19, llm-nodes 30, nl-compiler 14, triggers 40; hay solapes). Cada uno tiene una guarda
  propia en la API (`IdentityEnabledGuard`, `DagEditorEnabledGuard`, `ExecutionEnabledGuard`,
  `ResilienceEnabledGuard`, `LlmNodesEnabledGuard`, `NlCompilerEnabledGuard`, `TriggersEnabledGuard`,
  `LegacyPingGuard`), una constante en `packages/contracts/src/flags.ts`, una entrada en
  `flags.catalog.ts`, un valor en `.env.example`, condiciones en la web y en el compilador, y pruebas
  del estado apagado.
- **Orden** (propuesto), de las hojas a la raíz, un commit por flag y la suite verde en cada uno:
  `triggers` → `nl-compiler` → `llm-nodes` → `resilience` → `execution` → `dag-editor` → `identity` y
  el ping F0 (#14) → `ping`. Así ningún commit deja una guarda que dependa de un flag ya borrado.
- **`GET /api/v1/features`** se conserva y devuelve `{}`; `FlagsModule`, OpenFeature y el catálogo
  (vacío) se conservan para futuras fases (principio VIII exige flags para lo incompleto que llegue a
  `main`). El cliente de flags sigue devolviendo `false` ante un flag desconocido.
- **`executablePhases`**: hoy la API decide qué fases son ejecutables al iniciar una ejecución según
  flags. Sin flags, la lista es fija (`F3`, `F5`, `F7`) y se mantiene el parámetro en la entrada del
  workflow para que el worker siga rechazando tipos fuera de lo que su versión soporta
  (`UNSUPPORTED_NODES`). No es seguridad; es compatibilidad de despliegue entre API y worker.
- **Kill switches**: `LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED` del worker no cambian. Con
  `llm-nodes-enabled` fuera, `LLM_ENABLED=false` es el único apagado de los nodos LLM; se verifica que
  el compilador también lo respeta (hoy falla `LLM_DISABLED`).
- **Pruebas**: se eliminan las de "flag apagado → 404 `FEATURE_NOT_AVAILABLE`" y se comprueba que las
  suites de autorización (rol, otra organización, no miembro) siguen cubriendo cada endpoint. La
  prueba `flags.test.ts` pasa a verificar solo el catálogo vacío y el valor por defecto `false`.
- **Código de error `FEATURE_NOT_AVAILABLE`**: se elimina del contrato si ya no lo devuelve nadie; se
  comprueba con una búsqueda. `docs/` conserva la historia en los ADR (que no se reescriben; se marca
  `superseded by` donde el flag era la decisión: ADR-0080).
- **Migraciones**: ninguna. Los flags no viven en la base.
- Issues: #2, #14, #21, #27, #32, #39, #48 y #55 se cierran con `Closes #N` en la PR de flags.

## R5. ZAP baseline (6A, historia 4)

- **Qué es**: ZAP baseline (`zap-baseline.py`) hace una araña corta y reglas pasivas; no ataca. Se
  ejecuta a mano con el contenedor oficial por digest, desde `scripts/security/zap-baseline.sh`
  (Bash, funciona en Git Bash y Linux) y se documenta en `docs/security/zap.md`. No hay workflow ni
  check nuevo.
- **Entorno**: `docker compose up -d --wait`, API y worker con `pnpm dev` (o las imágenes), y la web
  construida. ZAP corre con `--network host` solo contra `http://localhost:3000` y la web local; el
  script rechaza cualquier destino que no sea loopback. Nunca apunta a Gemini ni a terceros: el
  worker corre con `LLM_ENABLED=false` y sin salida a destinos reales.
- **Objetivos**: la definición OpenAPI de la API (`/api/v1/openapi.json` si existe; si no, un archivo
  generado desde `packages/contracts`, propuesto) para sembrar la araña con las rutas públicas (salud,
  `features`, autenticación, webhook) y la URL de la web. Las rutas autenticadas devolverán 401 sin
  sesión; ZAP lo registrará como informativo, que es el comportamiento correcto.
- **Rate limit**: login y webhook tienen límites que ZAP puede disparar. El script arranca el entorno
  de pruebas con los límites relajados por variables ya existentes y lo imprime; los valores de
  producción no se tocan.
- **Salida**: `docs/security/zap/` con el informe HTML (se ignora en git si pesa > 200 KiB; se
  conserva el JSON y el resumen en Markdown) y `.zap/rules.tsv` versionado con la decisión por regla
  (`IGNORE` con comentario, `WARN`, `FAIL`). Cada alerta de nivel medio o alto termina con una de
  tres decisiones en `docs/security/zap.md`: corregida (prueba de regresión), falso positivo (razón) o
  aceptada (razón, dueño, revisión).
- **Alertas esperables** que ya se pueden anticipar (se verifican en la corrida): cabecera
  `Permissions-Policy` ausente; caché en respuestas con datos; divulgación de `X-Powered-By` (Helmet
  la quita); CSP de la web estática (la CSP de Helmet protege el API, no la SPA, que se sirve con
  Caddy en F9, así que las cabeceras de la web quedan como requisito de F9 si el servidor de
  desarrollo de Vite es el único origen hoy).
- **Alcance diferido** (6A): sin análisis activo ni con sesión iniciada; se valora contra staging en
  F9. Queda escrito en `docs/security/zap.md` y en la matriz.

## R6. Desviaciones de F7 (7A, historia 7)

| Desviación | Desenlace | Detalle |
|---|---|---|
| Faltan `approval.timed_out`, `circuit.closed`, `schedule.caught_up` | Corregir | Tres eventos de seguridad con tipo estable (ADR-0038). `approval.timed_out`: al registrar el cierre `timed_out` de la solicitud, hoy `approval.decided` con `outcome`; se emite además el evento propio. `circuit.closed`: cuando la prueba del semiabierto tiene éxito. `schedule.caught_up`: cuando `fireSchedule` ejecuta un disparo cuyo `scheduledAt` es anterior al instante actual (propuesto: más de 60 s de retraso). Prueba por evento |
| Reconciliador sin tope de intentos | Corregir | `workflow_schedules.sync_attempts` ya existe (smallint, se incrementa con `least(...,32767)`). Tope **(propuesto)** de 20 intentos consecutivos fallidos: al superarlo el reconciliador deja de reintentar la fila (que ya queda `failed` con su `last_error_code`; hoy se reintentaba sin fin); un cambio de versión activa o de configuración reinicia `sync_attempts` a 0. Evento `schedule.sync_failed` |
| Parámetro `triggersEnabled?` ignorado en `allowedNodeTypes` | Corregir | Se borra con R4 |
| Pruebas web inestables en paralelo | Corregir | Causa: carga de CPU con `turbo run test`. Se fija `maxWorkers` en `apps/web/vitest.config.ts` y un `testTimeout` explícito; criterio: tres ejecuciones seguidas de `pnpm test` sin fallos (SC-007) |
| Ejecución `failed` si Temporal falla tras insertar la fila de un webhook | `accepted` | El emisor debe reintentar con otro `X-Event-Id`; arreglarlo exigiría una compensación transaccional con Temporal. Dueño: autor. Revisión: post-F9 con datos reales |
| Disparos fuera del catch-up sin métrica | `accepted` | El worker no los observa (Temporal los descarta). Revisión: F9 con las métricas de Temporal Server |
| Sin frecuencia mínima de la cron | `accepted` | El tope de 10 programaciones activas por organización, `overlap = SKIP` y `max_concurrent_runs` acotan el coste. Revisión: F9 |
| 401 antes que 404 con el flag apagado | Desaparece | Sin flags (R4) |

- Nada de esto cambia el esquema (ver data-model).

## R7. Revisión de configuración, cadena de suministro, criptografía y salidas del LLM (historia 8 y 9)

- **A02/A10**: pruebas existentes (`security-headers.test.ts`, `problem-details.test.ts`,
  `env.schema.test.ts`). La matriz las cita. Se añade una prueba de **cabeceras y cookies sobre rutas
  reales** (login, `features`, salud, webhook) que fija el conjunto de cabeceras de Helmet y los
  atributos de `__Host-session`; es la regresión de las alertas de ZAP.
- **A03** (9C): `pnpm audit --audit-level high` y gitleaks ya bloquean la PR; Renovate, digests y
  `minimumReleaseAge` ya están. **No** se añade SBOM ni escaneo de imágenes. Razón: el PLAN marca el
  SBOM como opcional; un escáner de imágenes sobre una base Debian aún sin desplegar genera ruido sin
  imágenes finales. Revisión: F9. Excepciones abiertas con issue: multer (#11) y NestJS 12 (#10).
  Se registra en la matriz (A03, LLM04), en el modelo de amenazas (E8/E9) y en `docs/PLAN.md` §6.2.
- **A04**: parámetros de Argon2id (`argon2` con costes fijados) y de AES-256-GCM (IV 12 bytes, tag 16,
  AAD) ya probados (`crypto.test.ts`). La matriz registra los valores efectivos leyendo el código, no
  el ADR. TLS: `deferred:F9`.
- **Comprobación estática** (FR-025): una prueba de repositorio (`scripts/test/unit`) que recorre
  `apps/*/src` y `packages/*/src` y falla si encuentra `eval(`, `new Function(` o
  `dangerouslySetInnerHTML` (con una lista cerrada de excepciones comentadas, vacía hoy). Cierra A05 y
  LLM10 con una prueba que falla si el control se retira.
- **Prompts de sistema** (LLM08): una prueba comprueba que los prompts no contienen patrones de secreto
  de la configuración de gitleaks ni nombres de variables de entorno; la lógica de autorización vive en
  guards, no en prompts (revisión manual registrada).
- **LLM02 (capa gratuita)**: sigue `accepted` hasta F9; el requisito "migrar a la capa de pago antes
  de la demo pública" se escribe en `docs/PLAN.md` §9.

## R8. Cierre del modelo de amenazas (historia 6)

- Versión **v2.0** de `docs/threat-model.md`: se reorganiza el resumen final (no más un párrafo por
  fase; solo riesgos aceptados vigentes y requisitos de F9), se normalizan los estados al vocabulario
  de R1 y se corrigen las discrepancias:
  - E6 Valkey `planned:F4` (T, I, E): F4 introdujo prefijos por organización y scripts Lua atómicos;
    pasan a `mitigated` con su prueba donde el código lo cumple (prefijos `rl:`/`cb:`) y a
    `deferred:F9` donde no (ACL, `requirepass`, `maxmemory`, TLS), por la decisión 8C.
  - F5 API → Valkey `planned:F4`: igual.
  - E4/E5 y flujos F2/F3/F9: `accepted` pasan a `deferred:F9` con el requisito (mTLS, credenciales de
    producción, túnel SSH). Razón: no hay despliegue; la configuración depende del entorno (8C).
  - Filas de F7 que citan `approval.timed_out`: se corrigen o se implementan según R6 (se implementan).
  - Filas de ADR-0053 (E, F3 y F4, y la 3.6): pasan a `mitigated` tras R2.
  - Fila "nodos de F7 llegan al prompt del compilador": se reescribe como mitigada con la nueva
    prueba (R3) y se elimina el "Pendiente en F8".
  - Políticas de contraseñas (3.1): `accepted`, revisión post-F9 (4A).
  - Sección 3.6 y flujos: se retira "detrás de `triggers-enabled`" de los títulos (R4).
- **Diagrama**: ya incluye E1–E11; se añade F9 como `planned:F9` (Caddy, backups, observabilidad) en
  una subsección, sin cambiar el diagrama ejecutable.
- **Referencias**: el comprobador de R1 valida las rutas de prueba y de ADR citadas.
- **Fechas**: cada `accepted` gana "Dueño: autor · Revisión: <fase>" como sufijo de la columna de
  razón, no una columna nueva.

## R9. Requisitos para F9 que salen de F8 (FR-026)

Se añaden a `docs/PLAN.md` §9 (además de los de F7):

- Caddy redacta `/api/v1/hooks/*`, TLS en todo, cabeceras de la SPA (CSP, HSTS, `Permissions-Policy`)
  servidas por Caddy; prueba: petición de prueba y repetir ZAP baseline contra staging.
- Temporal (mTLS y UI tras túnel), PostgreSQL (contraseñas propias, TLS) y Valkey (`requirepass` o ACL,
  `maxmemory`, TLS) con credenciales de producción; prueba: intento de conexión sin credenciales falla.
- SPF/DKIM/DMARC; retención de los eventos de seguridad (ADR-0038) y alertas de fallos de auth y de
  costo (A09); migración a la capa de pago de Gemini; revisión de A03 (SBOM, escaneo de imágenes con
  las imágenes finales) y de la política de contraseñas y MFA tras F9.

## R10. Qué no entra (para evitar sobrealcance)

MFA/TOTP (4A), tabla de auditoría por tenant (5A), autenticación de Temporal/PostgreSQL/Valkey (8C),
SBOM y escaneo de imágenes (9C), ZAP activo o con sesión y workflow de CI para ZAP (6A), HMAC del
webhook, rotación de la llave maestra, rate limit por host, métrica de disparos fuera del catch-up y
frecuencia mínima de la cron.

## ADRs previstos

| ADR | Tema | PR |
|---|---|---|
| 0082 | Solo owner y editor ejecutan (reemplaza ADR-0053) | 1 |
| 0083 | Compilador con los nodos de F7 y `credentialId` sensible (actualiza ADR-0070 y ADR-0080) | 1 |
| 0084 | Eliminación de los flags de producto y kill switches que se conservan (actualiza ADR-0080) | 2 |
| 0085 | Tope de intentos del reconciliador y eventos de seguridad nuevos | 3 |
| 0086 | ZAP baseline pasivo como script manual y su alcance | 4 |
| 0087 | Matriz de evidencia OWASP, comprobador y estados del modelo de amenazas | 5 |
| 0088 | Riesgos aceptados y diferidos a F9 (8C, 9C, MFA, auditoría) | 5 |

## Decisiones diferidas

| Tema | Destino |
|---|---|
| MFA TOTP y revisión de la política de contraseñas | Posterior a F9 |
| Tabla de auditoría por tenant, retención y alertas | F9 |
| Autenticación y TLS de Temporal, PostgreSQL y Valkey | F9 |
| SBOM y escaneo de imágenes | F9 |
| ZAP activo, con sesión y contra staging | F9 |
