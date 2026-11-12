# CognitiveDAG — Plan técnico

> Estado: F0 a F9 completadas; la demo cerrada corre en producción (`https://cognitive.devama.cloud`). Fecha: 2026-11-12.
> Documento vivo: cada decisión cerrada se registra aquí o en un ADR ([`docs/adr/`](adr/)).

## 1. Visión

Plataforma multiusuario donde una persona describe una automatización en lenguaje natural
y el sistema la convierte en un DAG tipado, editable visualmente y ejecutado de forma
durable y tolerante a fallos.

El LLM actúa como **compilador** (lenguaje natural → DAG) y como **función** dentro de
nodos cognitivos concretos. Nunca decide en tiempo de ejecución qué acción tomar fuera
del grafo publicado.

### Objetivos del portafolio

- Motor de ejecución de workflows durable (Temporal) con resiliencia de nivel producción.
- Uso seguro de LLMs, alineado con OWASP LLM Top 10 y OWASP Top 10 (web).
- Arquitectura multi-tenant real.

### Fuera de alcance (por ahora)

- Integraciones reales con terceros (Gmail, Slack, etc.). Ver fase 10.
- Agentes autónomos que deciden pasos en tiempo de ejecución.
- RAG / búsqueda vectorial.

## 2. Decisiones cerradas

| #   | Decisión           | Elección                                                    | Motivo                                                       |
| --- | ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| D1  | Rol del LLM        | Compilador NL → DAG + nodos cognitivos acotados             | Determinismo, auditabilidad, menor superficie de ataque      |
| D2  | Lenguaje           | TypeScript en todo el stack                                 | Esquema compartido front/back; aprendizaje                   |
| D3  | Motor de ejecución | Temporal (SDK TypeScript)                                   | Estado durable, reintentos, timers, signals                  |
| D4  | Framework API      | NestJS                                                      | Módulos, DI, guards/interceptors para controles de seguridad |
| D5  | Proveedor LLM      | Gemini vía SDK oficial `@google/genai`                      | Elección del autor                                           |
| D6  | Usuarios           | Multiusuario real, multi-tenant                             | Requisito del producto                                       |
| D7  | Integraciones      | Diferidas; MVP con conectores genéricos + conector simulado | Enfocar el MVP en el motor                                   |
| D8  | Base de datos      | PostgreSQL                                                  | Relacional, RLS, ya conocido                                 |
| D9  | Frontend           | React + Vite + React Flow                                   | SPA; no se requiere SSR                                      |
| D10 | Hosting            | Oracle Cloud Always Free (Ampere A1)                        | Ver sección 9                                                |

### 2.1 Cambios y decisiones tomadas en F0

Cada decisión de F0 tiene su ADR; aquí solo se listan los cambios que afectan a este plan.

| Tema                   | Cambio respecto al plan                                                                                                                       | ADR                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Registro de decisiones | ADRs MADR 4 en `docs/adr/`; D1–D10 tienen un ADR cada una                                                                                     | [0001](adr/0001-registrar-decisiones-de-arquitectura.md)–[0011](adr/0011-oracle-cloud-always-free.md)                             |
| TypeScript             | 6.0.3 (no 7): `typescript-eslint` aún no lo soporta                                                                                           | [0012](adr/0012-typescript-6.md)                                                                                                  |
| NestJS                 | 11.2.8 (no 12): `nestjs-zod` y `@openfeature/nestjs-sdk` no soportan 12; issue [#10](https://github.com/devanthony92/cognitive-dag/issues/10) | [0013](adr/0013-nestjs-11.md)                                                                                                     |
| Gestor de paquetes     | pnpm 12.16.1 vía Corepack; Node.js 24.22.1; todas las versiones fijadas de forma exacta                                                       | [0017](adr/0017-tooling-de-calidad-y-ci.md), [0020](adr/0020-politica-de-cadena-de-suministro-de-pnpm.md)                         |
| Estado de la web       | Polling cada 1 s en F0; SSE para ejecuciones desde F3                                                                                         | [0014](adr/0014-polling-en-f0.md)                                                                                                 |
| Pruebas de integración | Contra el Compose compartido, no Testcontainers (§8)                                                                                          | [0015](adr/0015-pruebas-con-compose-compartido.md)                                                                                |
| Librerías del API      | `nestjs-pino`, `nestjs-cls`, `nestjs-zod`, terminus, OpenFeature, `iovalkey`, `pg`                                                            | [0016](adr/0016-librerias-del-api.md)                                                                                             |
| Tipos entre paquetes   | Condición de exportación `@cognitive-dag/source`                                                                                              | [0018](adr/0018-condicion-de-exportacion-source-para-tipos.md)                                                                    |
| Dependencia vulnerable | Override de `multer` 2.5.0 hasta que Nest lo actualice; issue [#11](https://github.com/devanthony92/cognitive-dag/issues/11)                  | [0019](adr/0019-override-de-multer-2-5-0.md)                                                                                      |
| PostgreSQL local       | Puerto de host 5433 (no 5432)                                                                                                                 | [0021](adr/0021-postgresql-en-puerto-5433.md)                                                                                     |
| Llamadas a Temporal    | Plazo de 5 s y reintentos gRPC acotados en el API                                                                                             | [0022](adr/0022-plazo-y-reintentos-grpc-en-llamadas-a-temporal.md)                                                                |
| Imágenes               | Debian `bookworm-slim` fijada por digest; CI en amd64 y arm64                                                                                 | [0023](adr/0023-imagenes-de-contenedor-sobre-debian.md)                                                                           |
| Acceso a datos         | Drizzle ORM sobre `pg`; migraciones SQL manuales para RLS                                                                                     | [0024](adr/0024-drizzle-como-orm.md)                                                                                              |
| Contraseñas            | Argon2id (`argon2`); política de 8–25 caracteres con lista de comunes (desviación aceptada de NIST 800-63B-4)                                 | [0025](adr/0025-argon2id-para-contrasenas.md), [0026](adr/0026-politica-de-contrasenas-8-25.md)                                   |
| Sesiones               | Cookie opaca `__Host-session`, PostgreSQL + Valkey y token CSRF sincronizador                                                                 | [0027](adr/0027-sesiones-opacas-y-csrf.md)                                                                                        |
| Organización activa    | En la ruta `/api/v1/organizations/{id}/...` con guard de membresía                                                                            | [0028](adr/0028-organizacion-activa-en-la-ruta.md)                                                                                |
| Aislamiento            | RLS forzada con claves de contexto por transacción; roles `app_migrator` y `app_runtime`                                                      | [0029](adr/0029-rls-con-claves-de-contexto.md), [0030](adr/0030-dos-roles-de-postgresql.md)                                       |
| Borrado lógico         | Filtro en `packages/db` (opción A); organización legible con token de invitación (opción B)                                                   | [0031](adr/0031-borrado-logico-con-filtro-en-packages-db.md), [0032](adr/0032-organizaciones-legibles-con-token-de-invitacion.md) |
| Abuso y correo         | `rate-limiter-flexible` sobre Valkey; Mailpit y nodemailer                                                                                    | [0033](adr/0033-rate-limiter-flexible.md), [0034](adr/0034-mailpit-y-nodemailer.md)                                               |
| Web de F1              | TanStack Router, React Hook Form, Tailwind y shadcn/ui                                                                                        | [0035](adr/0035-tanstack-router.md), [0036](adr/0036-react-hook-form.md), [0037](adr/0037-tailwind-y-shadcn-ui.md)                |
| Eventos de seguridad   | Logs estructurados con tipo estable, sin tabla de auditoría                                                                                   | [0038](adr/0038-eventos-de-seguridad-en-logs.md)                                                                                  |

Modelo de amenazas v1.2: [`threat-model.md`](threat-model.md).

## 3. Decisiones abiertas

| #   | Tema                                            | Opciones                         | Recomendación                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | ORM / acceso a datos                            | Drizzle, Prisma, Kysely          | **Cerrada en F1: Drizzle** ([ADR-0024](adr/0024-drizzle-como-orm.md))                                                                                                                                                                                                                                                                                   |
| O2  | Autenticación                                   | Propia o librería                | **Cerrada en F1: propia** con Argon2id y sesiones opacas en cookie ([ADR-0025](adr/0025-argon2id-para-contrasenas.md), [ADR-0027](adr/0027-sesiones-opacas-y-csrf.md))                                                                                                                                                                                  |
| O3  | Estado compartido (circuit breaker, rate limit) | Redis o PostgreSQL               | **Cerrada en F0: Valkey** (imagen en `compose.yaml`, cliente `iovalkey`; [ADR-0016](adr/0016-librerias-del-api.md)). Token bucket y CB con operaciones atómicas en F4                                                                                                                                                                                   |
| O4  | Lenguaje de condiciones                         | JSONLogic, AST propio            | **Cerrada en F2: AST propio** pequeño y tipado en Zod; nunca `eval` ([ADR-0043](adr/0043-ast-de-condiciones-y-plantillas-sin-evaluacion.md))                                                                                                                                                                                                            |
| O5  | Observabilidad en producción                    | Grafana Cloud free, stack propio | Grafana Cloud free para no consumir RAM de la VM                                                                                                                                                                                                                                                                                                        |
| O6  | Modelo Gemini concreto (**cerrada en F5**)      | Familia Flash / Flash-Lite / Pro | Cerrada: Flash-Lite (`gemini-3.5-flash-lite`) para clasificar, extraer y generar, por variable de entorno ([ADR-0066](adr/0066-modelos-por-tipo-de-nodo-y-capa-gratuita-de-gemini.md)); el compilador de F6 usa el suyo, `LLM_MODEL_COMPILER` ([ADR-0071](adr/0071-dataset-de-evals-del-compilador-umbral-y-modelo-elegido.md)); cerrada del todo en F6 |

## 4. Arquitectura

```
                 ┌──────────────┐
  Navegador ───► │  apps/web    │  React + Vite + React Flow
                 └──────┬───────┘
                        │ HTTPS (REST + SSE)
                 ┌──────▼───────┐        ┌──────────────┐
  Webhooks ────► │  apps/api    │ ─────► │  Temporal    │
                 │  NestJS      │ client │  Server      │
                 └──────┬───────┘        └──────┬───────┘
                        │                       │ task queues
                 ┌──────▼───────┐        ┌──────▼───────┐
                 │  PostgreSQL  │ ◄───── │ apps/worker  │ ──► Gemini API
                 │  (RLS)       │        │ workflows +  │ ──► conectores
                 └──────────────┘        │ activities   │
                 ┌──────────────┐        └──────┬───────┘
                 │ Redis/Valkey │ ◄─────────────┘  rate limit, circuit breaker
                 └──────────────┘
```

### Monorepo (pnpm workspaces)

```
apps/
  web/          React + Vite + React Flow
  api/          NestJS: auth, tenants, DAGs, runs, webhooks, SSE
  worker/       Temporal worker: workflow intérprete + activities
packages/
  dag-schema/   Zod: nodos, aristas, DAG, validación semántica (fuente única de verdad)
  llm/          Gateway Gemini: structured output, guardrails, presupuesto, telemetría
  connectors/   Cliente HTTP guardado (anti-SSRF y allowlist), cifrado de credenciales y circuit
                breaker puro (F7, TDD)
  resilience/   Taxonomía de errores, circuit breaker, rate limiter
  config/       eslint, tsconfig, utilidades compartidas
docs/
  PLAN.md
  adr/
  threat-model.md
```

### Modelo del DAG

- Un **Workflow** pertenece a un tenant y tiene **versiones inmutables**.
- Solo una versión publicada está activa a la vez; cada ejecución queda ligada a su versión.
- Nodos del MVP:

| Tipo               | Categoría | Descripción                                                                                                            |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `trigger.manual`   | Trigger   | Ejecución desde la UI o API                                                                                            |
| `trigger.webhook`  | Trigger   | URL única por trigger con token secreto (sin firma HMAC, [ADR-0072](adr/0072-webhook-con-token-en-la-url-sin-hmac.md)) |
| `trigger.schedule` | Trigger   | Temporal Schedules                                                                                                     |
| `llm.classify`     | Cognitivo | Devuelve un enum/booleanos según esquema                                                                               |
| `llm.extract`      | Cognitivo | Extrae campos tipados de texto libre                                                                                   |
| `llm.generate`     | Cognitivo | Genera texto; su salida nunca se ejecuta                                                                               |
| `logic.condition`  | Lógica    | Ramifica según un AST de condición tipado                                                                              |
| `logic.merge`      | Lógica    | Une ramas                                                                                                              |
| `human.approval`   | Control   | Pausa hasta aprobación (Temporal Update) con timeout                                                                   |
| `http.request`     | Acción    | Llamada HTTP saliente con allowlist anti-SSRF                                                                          |
| `mock.service`     | Acción    | Conector simulado con fallos configurables                                                                             |

- Las referencias entre nodos usan rutas declarativas (`nodes.classify.output.tone`),
  resueltas por un resolver seguro. No hay plantillas evaluables ni `eval`.
- Restricción de diseño: el esquema JSON del DAG que se entrega a Gemini debe ser
  compatible con el subconjunto de JSON Schema que acepta su structured output.

### Ejecución con Temporal

- Un workflow genérico `executeDag(runInput)` interpreta la versión del DAG en orden
  topológico. Las ramas independientes corren en paralelo.
- Cada nodo de efecto o de LLM es una **activity**; la lógica pura (condiciones, merge)
  corre dentro del workflow, que es determinista.
- `human.approval` usa un Temporal Update (`decideApproval`) en lugar de signals, para responder 409 a
  la segunda decisión con certeza ([ADR-0074](adr/0074-aprobacion-humana-con-temporal-update.md)); el estado en vivo se expone con queries y con una tabla
  de eventos de ejecución que el API transmite por SSE.
- Implementado en F3: `executeDag` recibe la definición completa en su entrada
  ([ADR-0048](adr/0048-interprete-unico-con-la-definicion-en-la-entrada.md)); el registro de
  ejecuciones y pasos vive en PostgreSQL con RLS ([ADR-0049](adr/0049-registro-de-ejecuciones-en-postgresql.md))
  y el contenido solo en Temporal ([ADR-0050](adr/0050-contenido-de-entradas-y-salidas-solo-en-temporal.md));
  la vista en vivo usa SSE con Valkey pub/sub ([ADR-0051](adr/0051-vista-en-vivo-por-sse-con-valkey-pub-sub.md)).
- `workflowId` = clave de idempotencia del evento disparador, para que Temporal descarte
  duplicados. En webhooks, `hook-<workflowId>-<eventId>` con `REJECT_DUPLICATE` ([ADR-0072](adr/0072-webhook-con-token-en-la-url-sin-hmac.md)).
- Desde F7, `trigger.schedule` usa un Temporal Schedule por workflow que arranca un lanzador
  (`fireSchedule`) con solape `SKIP` y catch-up de 1 hora; el lanzador ejecuta `executeDag` como child
  workflow ([ADR-0073](adr/0073-temporal-schedule-por-workflow.md)).
- Grafos grandes o bucles futuros: `continueAsNew` y child workflows para respetar los
  límites de historial.
- Versionado del código del workflow: `patched()` / Worker Versioning, y pruebas de
  replay en CI.

### Compilador NL → DAG

1. El usuario escribe la intención.
2. El LLM recibe el catálogo cerrado de tipos de nodo y devuelve un DAG con structured output.
3. Validación en dos niveles: esquema Zod, luego validación semántica (acíclico,
   referencias existentes, tipos compatibles entre salidas y entradas, configuración requerida).
4. Si falla, se reintenta con los errores como contexto (máximo N intentos).
5. El DAG se muestra en React Flow como **borrador**; el usuario revisa, edita y publica.
6. Nada se ejecuta sin publicación explícita por un usuario con permisos.

## 5. Resiliencia

Objetivo: que cualquier fallo sea **clasificado, contenido, observable y recuperable**.

### 5.1 Taxonomía de errores

| Clase               | Ejemplos                                 | Tratamiento                                         |
| ------------------- | ---------------------------------------- | --------------------------------------------------- |
| Transitorio         | 5xx, timeout, reset de conexión, 429     | Reintento con backoff exponencial + jitter          |
| Limitado            | 429 con `Retry-After`                    | Esperar lo indicado; respetar el rate limiter       |
| Permanente          | 400, 401, 403, 404, validación           | `ApplicationFailure` no reintentable; falla el nodo |
| Salida LLM inválida | Esquema no cumplido, contenido bloqueado | Reintento con reparación (máx. 2), luego falla      |
| Presupuesto agotado | Tokens o costo por ejecución/tenant      | No reintentable; ejecución detenida y alertada      |

Cada conector traduce sus errores a esta taxonomía; el motor nunca interpreta errores crudos.
Implementado en F4: la taxonomía y su clasificación por nodo ([ADR-0055](adr/0055-taxonomia-de-errores-y-clasificacion-por-nodo.md)).

### 5.2 Políticas por tipo de nodo

- `RetryPolicy` y timeouts (`startToCloseTimeout`, `scheduleToCloseTimeout`,
  `heartbeatTimeout`) definidos por tipo de nodo, con overrides acotados por configuración.
- Activities largas envían heartbeats.
- Implementado en F4: valores por defecto en el catálogo y ajustes por nodo dentro de límites,
  en la definición del DAG ([ADR-0056](adr/0056-politicas-de-reintento-por-tipo-de-nodo.md)).

### 5.3 Idempotencia

- Clave por efecto: `runId:nodeId`, igual en todos los reintentos.
- Los conectores envían la clave al destino cuando el destino lo soporta, o registran
  el efecto en una tabla `effects` antes de confirmar.
- Webhooks entrantes deduplicados por ID de evento (vía `workflowId`).
- Implementado en F4: tabla `node_effects` con protocolo `started`/`committed`
  ([ADR-0058](adr/0058-efectos-idempotentes-con-clave-runid-nodeid.md)).

### 5.4 Contención

- **Circuit breaker** por (organización, host) con estado en Valkey: cerrado → abierto → semiabierto.
  Implementado en F7 ([ADR-0079](adr/0079-circuit-breaker-por-organizacion-y-host.md)).
- **Rate limiting** por (tenant, conector) con token bucket, más límites por task queue de Temporal.
- **Bulkheads**: task queues separadas para LLM, HTTP y conectores simulados.
- **Cuotas por tenant**: ejecuciones concurrentes, ejecuciones por día y tokens LLM.
- Implementado en F4: rate limit por organización y tipo de nodo, con token bucket en Valkey y sin ocupar el worker ([ADR-0057](adr/0057-rate-limit-con-token-bucket-sin-ocupar-el-worker.md)). Diferidos a F5 y F7: circuit breaker (decisión 3C), granularidad por servicio, cuotas diarias y bulkheads ([ADR-0060](adr/0060-decisiones-diferidas-de-resiliencia.md)).
- Implementado en F5: cuota diaria de tokens LLM por organización con reserva atómica en PostgreSQL ([ADR-0062](adr/0062-presupuesto-de-tokens-con-reserva-en-postgresql.md)) y bulkhead de LLM con una task queue propia en el mismo proceso ([ADR-0063](adr/0063-bulkhead-con-cola-llm-en-el-mismo-proceso.md)).
- Implementado en F7 (cierra la deuda de [ADR-0060](adr/0060-decisiones-diferidas-de-resiliencia.md)): circuit breaker y granularidad por servicio (servicio = host) con clave `cb:<organizationId>:<host>` en Valkey (5 fallos transitorios en 60 s, 30 s de enfriamiento, 120 s de espera máxima por nodo), y bulkhead HTTP con la task queue `cognitive-dag-http`. Siguen diferidos: cuotas de ejecuciones por día y rate limit por host.

### 5.5 Recuperación

- Estados de ejecución: `running`, `succeeded`, `failed`, `cancelled` (y `timed_out` desde F3). Una
  ejecución en espera de aprobación sigue `running`: la espera se muestra en el paso con
  `waiting_reason = 'approval'`; no hay estado `waiting_approval` ([ADR-0074](adr/0074-aprobacion-humana-con-temporal-update.md)).
- Ejecuciones fallidas quedan como **cola de revisión** (equivalente a una DLQ) con el
  error clasificado y las entradas/salidas de cada nodo.
- **Reejecución desde un nodo**: nueva ejecución que reutiliza las salidas memorizadas de
  los nodos previos exitosos. Implementada en F4 sobre la versión original
  ([ADR-0059](adr/0059-reejecucion-desde-nodo-sobre-la-version-original.md)).
- Efectos que deban deshacerse: compensaciones declaradas por nodo (patrón saga), cuando aplique.

### 5.6 Verificación

- `mock.service` permite inyectar latencia, 429, 5xx, timeouts y caídas intermitentes.
- Pruebas de caos: matar el worker a mitad de una ejecución y verificar que continúa.
- Pruebas de workflow con `TestWorkflowEnvironment` (tiempo simulado).
- Pruebas de replay de historiales en CI para detectar no determinismo.

## 6. Seguridad

La seguridad es transversal: cada fase tiene criterios de seguridad en su definición de terminado.
Se mantiene un modelo de amenazas en `docs/threat-model.md`.

### 6.1 OWASP Top 10 for LLM Applications (edición 2025)

> Verificado contra <https://genai.owasp.org/llm-top-10/> el 2026-11-09: la página publica la edición 2025 y no una 2026. El orden y los nombres siguientes son los oficiales; la evidencia de cada fila está en [owasp-evidence.md](security/owasp-evidence.md).

| Riesgo                                 | Aplica          | Mitigación                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM01 Prompt Injection                 | **Sí, crítico** | El contenido externo (webhooks, correos futuros) entra delimitado como datos; los nodos LLM solo devuelven salidas estructuradas; ninguna salida del LLM elige herramientas ni acciones; valores sensibles (montos, destinos) vienen de la configuración del DAG; pruebas con un set de inyecciones conocidas |
| LLM02 Sensitive Information Disclosure | **Sí**          | Minimizar datos enviados al LLM; redacción de PII en logs y trazas; aislamiento por tenant en el contexto; la capa gratuita de Gemini puede usar el contenido: la demo es cerrada y solo admite datos de prueba (D13C), y se migra a la de pago antes de abrir el registro o admitir datos reales             |     |
| LLM03 Supply Chain                     | Sí              | Solo SDK oficial; dependencias fijadas y auditadas; sin modelos de terceros. Escaneo y SBOM CycloneDX de cada imagen al publicar (F9, [ADR-0096](adr/0096-sbom-y-escaneo-de-imagenes-al-publicar.md), issue #64 cerrada)                                                                                      |
| LLM04 Data and Model Poisoning         | Bajo            | No se entrena ni se ajusta modelos; aplica si en el futuro se usan ejemplos de usuarios como few-shot                                                                                                                                                                                                         |
| LLM05 Improper Output Handling         | **Sí**          | Toda salida se valida con Zod; nunca se ejecuta, interpola en SQL ni se renderiza como HTML; escape en la UI; una prueba de repositorio falla ante `eval(`, `new Function(` o `dangerouslySetInnerHTML`                                                                                                       |
| LLM06 Excessive Agency                 | **Sí, crítico** | Es la razón del modelo compilador: catálogo cerrado de nodos, publicación explícita, `human.approval` para acciones sensibles, credenciales de conector con mínimo privilegio, y solo owner y editor ejecutan ([ADR-0082](adr/0082-solo-owner-y-editor-ejecutan.md))                                          |
| LLM07 System Prompt Leakage            | Sí              | Los prompts de sistema no contienen secretos ni lógica de autorización; la autorización vive en el código                                                                                                                                                                                                     |
| LLM08 Vector and Embedding Weaknesses  | No (por ahora)  | Sin RAG; revisar si se agrega pgvector                                                                                                                                                                                                                                                                        |
| LLM09 Misinformation                   | Sí              | El usuario revisa el DAG antes de publicar; validación semántica; `llm.generate` produce borradores, no envíos directos                                                                                                                                                                                       |
| LLM10 Unbounded Consumption            | **Sí**          | Límite de tokens por llamada; presupuesto por ejecución, tenant y día; rate limit en el compilador; tamaño máximo de entrada; alertas de costo en F9 (Denial of Wallet)                                                                                                                                       |

Referencia complementaria: OWASP Top 10 for Agentic Applications (diciembre 2025). Aplica
parcialmente al compilador y a futuras extensiones agénticas.

### 6.2 OWASP Top 10:2025 (web)

| Riesgo                                     | Mitigación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 Broken Access Control (incluye SSRF)   | Guards de NestJS por rol (owner/editor/viewer); `tenant_id` en toda consulta; **RLS en PostgreSQL** como defensa en profundidad; pruebas de acceso cruzado entre tenants; `http.request` con allowlist, bloqueo de IPs privadas/metadata y protección contra DNS rebinding                                                                                                                                                                                                                                |
| A02 Security Misconfiguration              | Headers con Helmet; CORS estricto; sin stack traces en producción; configuración validada al arrancar; Temporal UI y Postgres sin exposición pública                                                                                                                                                                                                                                                                                                                                                      |
| A03 Software Supply Chain Failures         | Lockfile; `pnpm audit` y Renovate; escaneo de secretos (gitleaks) en CI; imágenes base fijadas por digest; `minimumReleaseAge`. Escaneo y SBOM CycloneDX de cada imagen al publicar, que falla la publicación ante altas o críticas con corrección ([ADR-0096](adr/0096-sbom-y-escaneo-de-imagenes-al-publicar.md), issue #64 cerrada)                                                                                                                                                                    |
| A04 Cryptographic Failures                 | TLS en todo; credenciales de conectores con cifrado de sobre (AES-256-GCM, llave maestra fuera de la DB); argon2id para contraseñas                                                                                                                                                                                                                                                                                                                                                                       |
| A05 Injection                              | Consultas parametrizadas vía ORM; validación Zod en cada borde; AST de condiciones sin `eval`; resolver de rutas seguro                                                                                                                                                                                                                                                                                                                                                                                   |
| A06 Insecure Design                        | Modelo de amenazas; límites por tenant; flujos de aprobación; este documento                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A07 Authentication Failures                | argon2id; sesión opaca en cookie `__Host-session` (`httpOnly`, `Secure`, `SameSite=Lax`) con CSRF sincronizador ([ADR-0027](adr/0027-sesiones-opacas-y-csrf.md)); bloqueo progresivo y rate limit en login. **Sin MFA** por decisión 4A (issue #61): se revisa junto con la política de contraseñas después de F9                                                                                                                                                                                         |
| A08 Software or Data Integrity Failures    | Webhooks con token secreto de 256 bits (guardado como SHA-256, comparación en tiempo constante), `X-Event-Id` y ventana de ±5 min contra replay. **Sin firma HMAC**: desviación de este plan, aceptada por el autor (decisión 2B, [ADR-0072](adr/0072-webhook-con-token-en-la-url-sin-hmac.md); riesgo en [threat-model](threat-model.md), sección 3.6). Versiones de DAG inmutables. **Sin artefactos de CI firmados** en F8: las imágenes se construyen en CI sin publicarse y la firma se evalúa en F9 |
| A09 Security Logging and Alerting Failures | Eventos de seguridad con tipo estable en logs estructurados con redacción ([ADR-0038](adr/0038-eventos-de-seguridad-en-logs.md)): login, publicación, cambios de credenciales, aprobaciones; **sin tabla de auditoría por tenant** (decisión 5A). Retención de 90 días en la VM y alertas por correo de fallos de autenticación, servicio no sano, certificado y disco ([ADR-0095](adr/0095-registros-retencion-y-alertas-por-script.md), issue #62 cerrada); sin alerta de costo (D9C)                   |
| A10 Mishandling of Exceptional Conditions  | Falla cerrada (fail-closed) en autorización y validación; taxonomía de errores de la sección 5; filtro global de excepciones en NestJS; nunca continuar un flujo ante un estado desconocido                                                                                                                                                                                                                                                                                                               |

### 6.3 Herramientas de verificación

- Pruebas automáticas de autorización entre tenants.
- OWASP ZAP baseline pasivo, local y sin sesión, con un script manual (F8, [zap.md](security/zap.md), [ADR-0086](adr/0086-zap-baseline-pasivo-como-script-manual.md)); activo, con sesión y contra un entorno real no se hace: sin staging es un riesgo `accepted` (issue #65, [ADR-0098](adr/0098-verificacion-de-cabeceras-sin-staging.md)). Tras cada despliegue, `deploy/ops/check-headers.sh` comprueba las cabeceras en el dominio real.
- Set de prompts de inyección en la suite de evals del LLM.
- `pnpm security:evidence` comprueba la matriz [owasp-evidence.md](security/owasp-evidence.md) y el [modelo de amenazas](threat-model.md) ([ADR-0087](adr/0087-matriz-de-evidencia-owasp-comprobador-y-estados.md)).

## 7. Observabilidad

Decisión D9C ([ADR-0095](adr/0095-registros-retencion-y-alertas-por-script.md)): **observabilidad = registros y alertas**, sin agente, sin métricas y sin servicios de terceros.

- Logs estructurados (pino) con `tenantId`, `runId`, `nodeId`, `correlationId` y redacción de secretos y PII.
- Retención de 90 días en la VM, con rotación y compresión; sin archivo externo (no hay destino sin backups, D5).
- Alertas por correo desde un script y un temporizador `systemd` de 5 minutos: ráfagas de `auth.login_failed` y `auth.rate_limited`, servicio no sano, certificado próximo a caducar y disco bajo. Procedimiento de respuesta y de prueba en [alerts.md](operations/alerts.md).
- Sin trazas OpenTelemetry, sin métricas (duración por nodo, tokens y costo por tenant, éxito del compilador) y sin alerta de costo: quedan fuera de F9 como riesgo aceptado ([threat-model.md](threat-model.md), E14). El costo del LLM se acota con los presupuestos por llamada, ejecución, organización y día.
- Vista de ejecución en vivo en React Flow (estado por nodo).

## 8. Calidad

- TypeScript estricto, ESLint, Prettier.
- Pruebas unitarias (Vitest), de integración contra el Compose compartido ([ADR-0015](adr/0015-pruebas-con-compose-compartido.md)).
- Pruebas de workflow y replay (sección 5.6).
- **Evals del compilador**: dataset de intenciones con propiedades esperadas del DAG;
  se ejecutan bajo demanda o de forma programada por costo.
- **Métrica de éxito del compilador (cerrada en F6)**: `pnpm eval:compiler` sobre 30 intenciones y 10 casos de
  inyección. Umbral: ≥ 80 % de intenciones que compilan en un DAG válido con las propiedades esperadas y
  0 escapes de inyección. Con respuestas grabadas corre en cada PR; contra Gemini corre a mano
  (`compiler-evals.yml`). Resultado y modelo en [ADR-0071](adr/0071-dataset-de-evals-del-compilador-umbral-y-modelo-elegido.md).
- CI en GitHub Actions: lint, typecheck, test, audit, escaneo de secretos, build de imágenes.
- ADRs para cada decisión relevante.

## 9. Despliegue

### Elección: Oracle Cloud Always Free

| Opción                 | Recursos gratuitos                                                                  | Veredicto                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Google Cloud free tier | 1 e2-micro (2 vCPU compartidas, 1 GB RAM)                                           | **Insuficiente**: Temporal + Postgres + API + worker no caben en 1 GB |
| Oracle Always Free     | Ampere A1 ARM: **2 OCPU y 12 GB RAM** en total (recortado desde 4/24 en junio 2026) | **Elegida**: el stack estimado usa ~2–3 GB                            |

Consumo estimado de RAM en producción: Temporal server 0.3–0.6 GB, Temporal UI ~0.1 GB,
PostgreSQL 0.3–0.5 GB, api 0.2–0.3 GB, worker 0.2–0.4 GB, Valkey y Caddy < 0.1 GB.
Se fijan límites de memoria por contenedor en Compose.

Riesgos de Oracle a gestionar:

- La capa gratuita ya cambió sin anuncio y puede volver a cambiar: el despliegue es
  **portable** (Compose + script de aprovisionamiento + imágenes por digest) para migrar en horas;
  hoy no hay backups externos, así que lo que se migra es el servicio, no los datos.
  Alternativa de pago bajo: VPS ARM o x64 económico (por ejemplo, Hetzner).
- Arquitectura ARM (arm64): ver sección 9.1.
- Disponibilidad de capacidad A1 limitada en algunas regiones al crear la instancia.
- Oracle puede reclamar instancias Always Free inactivas por bajo uso; vigilar la política vigente.
- **Sin backups (D5, [ADR-0094](adr/0094-despliegue-automatico-reversa-y-sin-backups.md)).** Perder la VM es perder los datos y la `CREDENTIALS_MASTER_KEY`. La demo solo admite datos de prueba y la web lo avisa. La constitución 1.1.0 hace obligatorios los backups externos antes de admitir datos reales. Antes de cada migración, `deploy.sh` guarda un volcado en la propia VM (los últimos 3), que sirve para la reversa y no protege contra la pérdida de la VM.

### 9.1 Compatibilidad arm64 (verificado 2026-10-28)

| Componente                                                     | arm64      | Nota                                                            |
| -------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| `temporalio/server`, `temporalio/ui`, `temporalio/admin-tools` | Sí         | Imágenes multi-arch oficiales                                   |
| `node`, `postgres`, `valkey/valkey`, `caddy`                   | Sí         | Imágenes oficiales multi-arch                                   |
| `@temporalio/core-bridge` (worker)                             | Solo glibc | Binario Rust `aarch64-unknown-linux-gnu`; **no hay build musl** |
| `argon2`                                                       | Sí         | Prebuilds `linux-arm64` glibc y musl                            |
| Gemini SDK, Drizzle, NestJS, OpenTelemetry                     | Sí         | JavaScript puro                                                 |

Reglas derivadas:

- **Imágenes de Node sobre Debian (`node:<lts>-bookworm-slim`), nunca Alpine**: el worker de
  Temporal no carga en musl. Se usa la misma base en api y worker por consistencia.
- `pnpm install` siempre **dentro** del Dockerfile (multi-stage); nunca copiar `node_modules`
  desde Windows, porque los binarios nativos son de otra plataforma.
- Las imágenes se construyen en CI para `linux/amd64` y `linux/arm64`: el build arm64 usa el
  runner nativo `ubuntu-24.04-arm` de GitHub Actions (gratis en repos públicos; en privados
  consume minutos). Evitar QEMU para builds con módulos nativos por lentitud.
- Las pruebas de integración también corren en el runner arm64, para detectar diferencias
  entre el entorno de desarrollo (x64) y producción (arm64).
- La app web es estática: se construye una sola vez y es independiente de la arquitectura.
- Sin dependencia de ARM: si en el futuro se migra a un host x64, las mismas imágenes funcionan.

### Topología

Una VM `cognitive-dag-prod` (Ampere A1, 2 OCPU y 12 GB, Ubuntu 24.04 aarch64, `sa-bogota-1`) con un Docker Compose (`deploy/compose.prod.yaml`) y estos servicios:

- **Caddy** (imagen de borde con la SPA): único punto de entrada, 80 y 443, TLS automático, cabeceras de seguridad, `/api/*` hacia la API con SSE, redacción de `/api/v1/hooks/*` y 404 para `POST /api/v1/auth/register` y `/api/v1/metrics` ([ADR-0090](adr/0090-imagen-de-borde-mismo-origen-y-url-relativa.md)).
- **api** y **worker**, más el `migrator` de un solo uso en cada despliegue.
- **PostgreSQL** (aplicación y bases de Temporal separadas) con `hostssl` y `scram-sha-256`, y **Valkey** con TLS y ACL ([ADR-0092](adr/0092-postgresql-y-valkey-con-tls-acl-y-pki-interna.md)).
- **Temporal** con mTLS y su **UI** solo en `127.0.0.1:8233`, accesible por `ssh -L` ([ADR-0091](adr/0091-temporal-en-produccion.md)).
- Imágenes publicadas por `release.yml` en OCIR por digest, desplegadas por `deploy.yml` (SSH restringida) y secretos en OCI Vault volcados a `tmpfs` ([ADR-0089](adr/0089-ocir-como-registro-y-etiquetado-por-digest.md), [ADR-0093](adr/0093-secretos-en-oci-vault.md)). Guía en [operations/](operations/README.md).
- Desarrollo local: `docker compose` + `temporal server start-dev`.

### Memoria en producción (T052, SC-010)

Los límites son los de `deploy/compose.prod.yaml` (suma de los permanentes: 3 328 MB, por debajo de los 6 GB que fija `deploy-config.test.ts`). Medido en producción el 2026-11-12 **en reposo y sin carga** (tras el despliegue de `deccebb`, con `docker stats --no-stream`). SC-010 pide menos del 60 % de cada límite: se cumple en reposo con margen holgado; con carga (prueba de humo) sigue pendiente. No se cambian límites.

| Servicio    | Límite | Medido en reposo | % del límite |
| ----------- | ------ | ---------------- | ------------ |
| edge        | 128 MB | 11,4 MiB         | 8,9 %        |
| api         | 512 MB | 82,55 MiB        | 16,1 %       |
| worker      | 768 MB | 212,5 MiB        | 27,7 %       |
| postgres    | 768 MB | 91,3 MiB         | 11,9 %       |
| valkey      | 192 MB | 4,38 MiB         | 2,3 %        |
| temporal    | 768 MB | 90,39 MiB        | 11,8 %       |
| temporal-ui | 192 MB | 6,61 MiB         | 3,4 %        |

`free -m` (MiB): total 11 925, usada 1 230, disponible 10 694, swap 0.

Comando para repetirla con carga: `docker stats --no-stream` y `free -m` en la VM, con la prueba de humo de [operations/memory.md](operations/memory.md).

### Requisitos para F9 derivados de F7 y F8: cierre

Resultado de cada requisito en F9 (detalle y riesgos en [ADR-0099](adr/0099-cierre-de-f9-despliegue.md)):

| Requisito                                                                                            | Resultado                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Caddy redacta `/api/v1/hooks/*` (T068 de F7) y los webhooks solo por TLS                             | Cumplido (`deploy/caddy/site.caddy`, `deploy-config.test.ts`)                                                                      |
| Cabeceras de la SPA: CSP, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP, COOP, CORP, HSTS | Cumplido; verificado con ZAP local y con `curl` en cada despliegue ([ADR-0098](adr/0098-verificacion-de-cabeceras-sin-staging.md)) |
| TLS en todo                                                                                          | Cumplido: borde, y TLS o mTLS entre servicios                                                                                      |
| Temporal, PostgreSQL y Valkey con credenciales de producción (issue #63)                             | Cumplido; issue cerrada                                                                                                            |
| SBOM y escaneo de imágenes (issue #64)                                                               | Cumplido al publicar; issue cerrada                                                                                                |
| SPF, DKIM y DMARC                                                                                    | Configurados con OCI Email Delivery                                                                                                |
| Retención de eventos y alertas (issue #62)                                                           | Cumplido (90 días, alertas por correo); sin alerta de costo (D9C); issue cerrada                                                   |
| Migración a la capa de pago de Gemini (LLM02)                                                        | No: demo cerrada con la capa gratuita y solo datos de prueba (D13C); `accepted`                                                    |
| ZAP activo y con sesión contra staging (issue #65)                                                   | No: sin staging (D2C); `accepted`, issue abierta                                                                                   |
| Política de contraseñas y MFA (issue #61)                                                            | Fuera de F9; revisión posterior, issue abierta                                                                                     |

## 10. Fases

Cada fase termina con: código en `main`, pruebas en verde, criterios de seguridad cumplidos y ADRs al día.

| Fase                             | Contenido                                                                                                                                                                                                                                                                                                                                          | Terminado cuando                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0 Fundaciones**               | Monorepo, tooling, CI, Docker Compose dev, ADRs iniciales, modelo de amenazas v1                                                                                                                                                                                                                                                                   | CI en verde con lint/typecheck/test/audit/escaneo de secretos; entorno local arranca con un comando                                                                                                                                                                                    |
| **F1 Identidad y multi-tenant**  | Registro, login, refresh, tenants, roles, RLS, eventos de seguridad en logs                                                                                                                                                                                                                                                                        | Pruebas de acceso cruzado entre tenants fallan como se espera; controles A01/A04/A07 cubiertos                                                                                                                                                                                         |
| **F2 Modelo DAG y editor**       | `dag-schema` (Zod), validación semántica, versionado inmutable, editor React Flow                                                                                                                                                                                                                                                                  | Se crea, edita, valida y publica un DAG manualmente                                                                                                                                                                                                                                    |
| **F3 Motor de ejecución**        | Workflow intérprete, activities base, `trigger.manual`, `logic.*`, `mock.service`, tabla de eventos, vista en vivo por SSE                                                                                                                                                                                                                         | Un DAG con ramas paralelas y condiciones se ejecuta y se observa en vivo                                                                                                                                                                                                               |
| **F4 Resiliencia**               | Taxonomía, políticas, idempotencia, rate limit, reejecución desde nodo, listado de ejecuciones, pruebas de caos y replay                                                                                                                                                                                                                           | Pruebas de caos (sección 5.6) pasan; demo de recuperación tras matar el worker                                                                                                                                                                                                         |
| **F5 Nodos cognitivos**          | Paquete `llm` (Gemini, structured output, presupuesto, redacción), `llm.classify/extract/generate`                                                                                                                                                                                                                                                 | Nodos LLM validados por esquema; límites de consumo activos; set de inyección sin escapes                                                                                                                                                                                              |
| **F6 Compilador NL → DAG**       | Prompt con catálogo, ciclo de reparación, UI de intención → borrador, evals                                                                                                                                                                                                                                                                        | Tasa de éxito medida en el dataset de evals; nada se ejecuta sin publicar                                                                                                                                                                                                              |
| **F7 Triggers y control humano** | `trigger.webhook` con token secreto (sin HMAC, [ADR-0072](adr/0072-webhook-con-token-en-la-url-sin-hmac.md)), `trigger.schedule`, `human.approval`, `http.request` con anti-SSRF, credenciales y circuit breaker                                                                                                                                   | Webhook con token inválido o regenerado y replay rechazados; SSRF a IPs internas bloqueado                                                                                                                                                                                             |
| **F8 Endurecimiento**            | Revisión completa de OWASP (sección 6) con matriz de evidencia comprobada por script, ZAP baseline pasivo, solo owner y editor ejecutan, compilador con los nodos de F7, flags de producto eliminados, modelo de amenazas v2.0 ([ADR-0082](adr/0082-solo-owner-y-editor-ejecutan.md) a [ADR-0088](adr/0088-riesgos-aceptados-y-diferidos-a-f9.md)) | **Completada.** Las 20 filas de las tablas 6.1 y 6.2 tienen estado y evidencia ejecutada ([owasp-evidence.md](security/owasp-evidence.md)); `pnpm security:evidence` pasa; ninguna fila `planned:F4` o `planned:F8`; lo que depende del despliegue queda `deferred:F9`                 |
| **F9 Despliegue**                | VM Oracle, Compose producción, Caddy, imágenes en OCIR con SBOM y escaneo, secretos en OCI Vault, despliegue automático con reversa, registros y alertas, modelo de amenazas v3.0 ([ADR-0089](adr/0089-ocir-como-registro-y-etiquetado-por-digest.md) a [ADR-0099](adr/0099-cierre-de-f9-despliegue.md)); sin backups ni staging (D5, D2)          | **Completada.** Demo cerrada con TLS, cabeceras verificadas y despliegue con reversa, en `https://cognitive.devama.cloud` (criterio ajustado por D5 y D13: ya no pide restauración de backup). Sin filas diferidas. Sin hacer: memoria bajo carga y reconstrucción en VM limpia (T055) |
| **F10 Integraciones**            | Gmail, Slack, OAuth por tenant (pendiente de definir)                                                                                                                                                                                                                                                                                              | Se define al llegar                                                                                                                                                                                                                                                                    |
