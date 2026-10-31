# CognitiveDAG — Plan técnico

> Estado: F0, F1 y F2 completadas; F3 es la siguiente fase. Fecha: 2026-10-29.
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
| Estado de la web       | Polling cada 1 s en F0; SSE en F3                                                                                                             | [0014](adr/0014-polling-en-f0.md)                                                                                                 |
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

| #   | Tema                                            | Opciones                         | Recomendación                                                                                                                                                          |
| --- | ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | ORM / acceso a datos                            | Drizzle, Prisma, Kysely          | **Cerrada en F1: Drizzle** ([ADR-0024](adr/0024-drizzle-como-orm.md))                                                                                                  |
| O2  | Autenticación                                   | Propia o librería                | **Cerrada en F1: propia** con Argon2id y sesiones opacas en cookie ([ADR-0025](adr/0025-argon2id-para-contrasenas.md), [ADR-0027](adr/0027-sesiones-opacas-y-csrf.md)) |
| O3  | Estado compartido (circuit breaker, rate limit) | Redis o PostgreSQL               | **Cerrada en F0: Valkey** (imagen en `compose.yaml`, cliente `iovalkey`; [ADR-0016](adr/0016-librerias-del-api.md)). Token bucket y CB con operaciones atómicas en F4  |
| O4  | Lenguaje de condiciones                         | JSONLogic, AST propio            | **Cerrada en F2: AST propio** pequeño y tipado en Zod; nunca `eval` ([ADR-0043](adr/0043-ast-de-condiciones-y-plantillas-sin-evaluacion.md))                           |
| O5  | Observabilidad en producción                    | Grafana Cloud free, stack propio | Grafana Cloud free para no consumir RAM de la VM                                                                                                                       |
| O6  | Modelo Gemini concreto                          | Familia Flash / Flash-Lite / Pro | Verificar modelos vigentes al iniciar la fase 5; Flash-Lite para clasificar, Flash para compilar                                                                       |

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
  connectors/   Interfaz de conector + http genérico + simulado
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

| Tipo               | Categoría | Descripción                                          |
| ------------------ | --------- | ---------------------------------------------------- |
| `trigger.manual`   | Trigger   | Ejecución desde la UI o API                          |
| `trigger.webhook`  | Trigger   | URL única por trigger, firmada                       |
| `trigger.schedule` | Trigger   | Temporal Schedules                                   |
| `llm.classify`     | Cognitivo | Devuelve un enum/booleanos según esquema             |
| `llm.extract`      | Cognitivo | Extrae campos tipados de texto libre                 |
| `llm.generate`     | Cognitivo | Genera texto; su salida nunca se ejecuta             |
| `logic.condition`  | Lógica    | Ramifica según un AST de condición tipado            |
| `logic.merge`      | Lógica    | Une ramas                                            |
| `human.approval`   | Control   | Pausa hasta aprobación (Temporal signal) con timeout |
| `http.request`     | Acción    | Llamada HTTP saliente con allowlist anti-SSRF        |
| `mock.service`     | Acción    | Conector simulado con fallos configurables           |

- Las referencias entre nodos usan rutas declarativas (`nodes.classify.output.tone`),
  resueltas por un resolver seguro. No hay plantillas evaluables ni `eval`.
- Restricción de diseño: el esquema JSON del DAG que se entrega a Gemini debe ser
  compatible con el subconjunto de JSON Schema que acepta su structured output.

### Ejecución con Temporal

- Un workflow genérico `executeDag(runInput)` interpreta la versión del DAG en orden
  topológico. Las ramas independientes corren en paralelo.
- Cada nodo de efecto o de LLM es una **activity**; la lógica pura (condiciones, merge)
  corre dentro del workflow, que es determinista.
- `human.approval` usa signals; el estado en vivo se expone con queries y con una tabla
  de eventos de ejecución que el API transmite por SSE.
- `workflowId` = clave de idempotencia del evento disparador, para que Temporal descarte
  duplicados.
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

### 5.2 Políticas por tipo de nodo

- `RetryPolicy` y timeouts (`startToCloseTimeout`, `scheduleToCloseTimeout`,
  `heartbeatTimeout`) definidos por tipo de nodo, con overrides acotados por configuración.
- Activities largas envían heartbeats.

### 5.3 Idempotencia

- Clave por efecto: `runId:nodeId`, igual en todos los reintentos.
- Los conectores envían la clave al destino cuando el destino lo soporta, o registran
  el efecto en una tabla `effects` antes de confirmar.
- Webhooks entrantes deduplicados por ID de evento (vía `workflowId`).

### 5.4 Contención

- **Circuit breaker** por (tenant, conector) con estado en Redis: cerrado → abierto → semiabierto.
- **Rate limiting** por (tenant, conector) con token bucket, más límites por task queue de Temporal.
- **Bulkheads**: task queues separadas para LLM, HTTP y conectores simulados.
- **Cuotas por tenant**: ejecuciones concurrentes, ejecuciones por día y tokens LLM.

### 5.5 Recuperación

- Estados de ejecución: `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled`.
- Ejecuciones fallidas quedan como **cola de revisión** (equivalente a una DLQ) con el
  error clasificado y las entradas/salidas de cada nodo.
- **Reejecución desde un nodo**: nueva ejecución que reutiliza las salidas memorizadas de
  los nodos previos exitosos.
- Efectos que deban deshacerse: compensaciones declaradas por nodo (patrón saga), cuando aplique.

### 5.6 Verificación

- `mock.service` permite inyectar latencia, 429, 5xx, timeouts y caídas intermitentes.
- Pruebas de caos: matar el worker a mitad de una ejecución y verificar que continúa.
- Pruebas de workflow con `TestWorkflowEnvironment` (tiempo simulado).
- Pruebas de replay de historiales en CI para detectar no determinismo.

## 6. Seguridad

La seguridad es transversal: cada fase tiene criterios de seguridad en su definición de terminado.
Se mantiene un modelo de amenazas en `docs/threat-model.md`.

### 6.1 OWASP Top 10 for LLM Applications 2026

> Referencia vigente: edición 2026 (agosto 2026). El orden se tomó de una fuente secundaria;
> verificar contra genai.owasp.org antes de cerrar la fase 8.

| Riesgo                                 | Aplica          | Mitigación                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM01 Prompt Injection                 | **Sí, crítico** | El contenido externo (webhooks, correos futuros) entra delimitado como datos; los nodos LLM solo devuelven salidas estructuradas; ninguna salida del LLM elige herramientas ni acciones; valores sensibles (montos, destinos) vienen de la configuración del DAG; pruebas con un set de inyecciones conocidas |
| LLM02 Sensitive Information Disclosure | **Sí**          | Minimizar datos enviados al LLM; redacción de PII en logs y trazas; aislamiento por tenant en el contexto; revisar la política de retención de datos del plan de Gemini usado                                                                                                                                 |
| LLM03 Excessive Agency                 | **Sí, crítico** | Es la razón del modelo compilador: catálogo cerrado de nodos, publicación explícita, `human.approval` para acciones sensibles, credenciales de conector con mínimo privilegio                                                                                                                                 |
| LLM04 Supply Chain                     | Sí              | Solo SDK oficial; dependencias fijadas y auditadas; sin modelos de terceros                                                                                                                                                                                                                                   |
| LLM05 Data and Model Poisoning         | Bajo            | No se entrena ni se ajusta modelos; aplica si en el futuro se usan ejemplos de usuarios como few-shot                                                                                                                                                                                                         |
| LLM06 Unbounded Consumption            | **Sí**          | Límite de tokens por llamada; presupuesto por ejecución, tenant y día; rate limit en el compilador; tamaño máximo de entrada; alertas de costo (Denial of Wallet)                                                                                                                                             |
| LLM07 Misinformation                   | Sí              | El usuario revisa el DAG antes de publicar; validación semántica; `llm.generate` produce borradores, no envíos directos                                                                                                                                                                                       |
| LLM08 Hidden Context Exposure          | Sí              | Los prompts de sistema no contienen secretos ni lógica de autorización; la autorización vive en el código                                                                                                                                                                                                     |
| LLM09 Vector and Embedding Weaknesses  | No (por ahora)  | Sin RAG; revisar si se agrega pgvector                                                                                                                                                                                                                                                                        |
| LLM10 Improper Output Handling         | **Sí**          | Toda salida se valida con Zod; nunca se ejecuta, interpola en SQL ni se renderiza como HTML; escape en la UI                                                                                                                                                                                                  |

Referencia complementaria: OWASP Top 10 for Agentic Applications (diciembre 2025). Aplica
parcialmente al compilador y a futuras extensiones agénticas.

### 6.2 OWASP Top 10:2025 (web)

| Riesgo                                     | Mitigación                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 Broken Access Control (incluye SSRF)   | Guards de NestJS por rol (owner/editor/viewer); `tenant_id` en toda consulta; **RLS en PostgreSQL** como defensa en profundidad; pruebas de acceso cruzado entre tenants; `http.request` con allowlist, bloqueo de IPs privadas/metadata y protección contra DNS rebinding |
| A02 Security Misconfiguration              | Headers con Helmet; CORS estricto; sin stack traces en producción; configuración validada al arrancar; Temporal UI y Postgres sin exposición pública                                                                                                                       |
| A03 Software Supply Chain Failures         | Lockfile; `pnpm audit` y Dependabot/Renovate; escaneo de secretos (gitleaks) en CI; imágenes base fijadas por digest; SBOM opcional                                                                                                                                        |
| A04 Cryptographic Failures                 | TLS en todo; credenciales de conectores con cifrado de sobre (AES-256-GCM, llave maestra fuera de la DB); argon2id para contraseñas                                                                                                                                        |
| A05 Injection                              | Consultas parametrizadas vía ORM; validación Zod en cada borde; AST de condiciones sin `eval`; resolver de rutas seguro                                                                                                                                                    |
| A06 Insecure Design                        | Modelo de amenazas; límites por tenant; flujos de aprobación; este documento                                                                                                                                                                                               |
| A07 Authentication Failures                | argon2id; access token corto + refresh rotado en cookie `httpOnly` `Secure` `SameSite`; protección CSRF; bloqueo progresivo y rate limit en login; MFA TOTP (fase posterior)                                                                                               |
| A08 Software or Data Integrity Failures    | Webhooks firmados con HMAC + timestamp anti-replay; versiones de DAG inmutables; artefactos de CI firmados/etiquetados                                                                                                                                                     |
| A09 Security Logging and Alerting Failures | Log de auditoría por tenant (login, publicación, cambios de credenciales, aprobaciones); logs estructurados con redacción; alertas de fallos de auth y de costo                                                                                                            |
| A10 Mishandling of Exceptional Conditions  | Falla cerrada (fail-closed) en autorización y validación; taxonomía de errores de la sección 5; filtro global de excepciones en NestJS; nunca continuar un flujo ante un estado desconocido                                                                                |

### 6.3 Herramientas de verificación

- Pruebas automáticas de autorización entre tenants.
- OWASP ZAP (baseline) contra staging.
- Set de prompts de inyección en la suite de evals del LLM.

## 7. Observabilidad

- Logs estructurados (pino) con `tenantId`, `runId`, `nodeId` y redacción de secretos y PII.
- Trazas con OpenTelemetry (interceptores de Temporal y NestJS).
- Métricas: duración por nodo, reintentos, estado de circuit breakers, tokens y costo por
  tenant/ejecución, tasa de éxito del compilador.
- Vista de ejecución en vivo en React Flow (estado por nodo).

## 8. Calidad

- TypeScript estricto, ESLint, Prettier.
- Pruebas unitarias (Vitest), de integración contra el Compose compartido ([ADR-0015](adr/0015-pruebas-con-compose-compartido.md)).
- Pruebas de workflow y replay (sección 5.6).
- **Evals del compilador**: dataset de intenciones con propiedades esperadas del DAG;
  se ejecutan bajo demanda o de forma programada por costo.
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

- La capa gratuita ya cambió sin anuncio y puede volver a cambiar: el despliegue debe ser
  **portable** (Compose + script de aprovisionamiento + backups externos) para migrar en horas.
  Alternativa de pago bajo: VPS ARM o x64 económico (por ejemplo, Hetzner).
- Arquitectura ARM (arm64): ver sección 9.1.
- Disponibilidad de capacidad A1 limitada en algunas regiones al crear la instancia.
- Oracle puede reclamar instancias Always Free inactivas por bajo uso; vigilar la política vigente.
- Backups fuera de la VM (Object Storage gratuito) desde el primer día.

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

- Docker Compose en la VM: Caddy (TLS automático), api, worker, web estática, Postgres,
  Redis/Valkey, Temporal server + Temporal UI (solo por túnel SSH o detrás de auth).
- Postgres de Temporal separado lógicamente (otra base) del Postgres de la aplicación.
- Desarrollo local: `docker compose` + `temporal server start-dev`.

## 10. Fases

Cada fase termina con: código en `main`, pruebas en verde, criterios de seguridad cumplidos y ADRs al día.

| Fase                             | Contenido                                                                                                                  | Terminado cuando                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **F0 Fundaciones**               | Monorepo, tooling, CI, Docker Compose dev, ADRs iniciales, modelo de amenazas v1                                           | CI en verde con lint/typecheck/test/audit/escaneo de secretos; entorno local arranca con un comando |
| **F1 Identidad y multi-tenant**  | Registro, login, refresh, tenants, roles, RLS, log de auditoría                                                            | Pruebas de acceso cruzado entre tenants fallan como se espera; controles A01/A04/A07 cubiertos      |
| **F2 Modelo DAG y editor**       | `dag-schema` (Zod), validación semántica, versionado inmutable, editor React Flow                                          | Se crea, edita, valida y publica un DAG manualmente                                                 |
| **F3 Motor de ejecución**        | Workflow intérprete, activities base, `trigger.manual`, `logic.*`, `mock.service`, tabla de eventos, vista en vivo por SSE | Un DAG con ramas paralelas y condiciones se ejecuta y se observa en vivo                            |
| **F4 Resiliencia**               | Taxonomía, políticas, idempotencia, circuit breaker, rate limit, cuotas, reejecución desde nodo, pruebas de caos y replay  | Pruebas de caos (sección 5.6) pasan; demo de recuperación tras matar el worker                      |
| **F5 Nodos cognitivos**          | Paquete `llm` (Gemini, structured output, presupuesto, redacción), `llm.classify/extract/generate`                         | Nodos LLM validados por esquema; límites de consumo activos; set de inyección sin escapes           |
| **F6 Compilador NL → DAG**       | Prompt con catálogo, ciclo de reparación, UI de intención → borrador, evals                                                | Tasa de éxito medida en el dataset de evals; nada se ejecuta sin publicar                           |
| **F7 Triggers y control humano** | `trigger.webhook` firmado, `trigger.schedule`, `human.approval`, `http.request` con anti-SSRF                              | Webhook con firma inválida o replay rechazado; SSRF a IPs internas bloqueado                        |
| **F8 Endurecimiento**            | Revisión completa de OWASP (sección 6), ZAP, revisión del modelo de amenazas                                               | Todas las filas de las tablas 6.1 y 6.2 verificadas con evidencia                                   |
| **F9 Despliegue**                | VM Oracle, Compose producción, Caddy, backups, observabilidad                                                              | Demo pública con TLS; restauración de backup probada                                                |
| **F10 Integraciones**            | Gmail, Slack, OAuth por tenant (pendiente de definir)                                                                      | Se define al llegar                                                                                 |
