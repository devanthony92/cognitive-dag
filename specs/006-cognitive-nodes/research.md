# Research: Nodos cognitivos (F5)

**Fecha**: 2026-11-05 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: 1A, 2A, 3A, 4C, 5A, 6A, 7A, 8A, 9A, 10C, 11A, 12A, 13A, 14A, 15A.

## R1. Modelos (1A, O6)

- Un modelo por tipo de nodo, por variable de entorno del worker: `LLM_MODEL_CLASSIFY`,
  `LLM_MODEL_EXTRACT`, `LLM_MODEL_GENERATE`.
- Valores en `.env.example`: Flash-Lite (`gemini-3.5-flash-lite`) para los tres tipos. Se había
  previsto Flash (`gemini-3.6-flash`) para generar, pero en la capa gratuita resultó inestable y
  rechazó un caso válido en `pnpm eval:llm`; con Flash-Lite en todos los nodos no hubo rechazos
  (corrección al cerrar F5). Se verifican contra la documentación oficial (3.7/3.8 solo aparecen en
  fuentes de terceros).
- Cierra la decisión abierta O6 de `docs/PLAN.md`.

## R2. Paquete `packages/llm` y proveedor intercambiable (2A)

- Interfaz `LlmProvider.generate({ model, system, user, responseJsonSchema, maxOutputTokens })` que
  devuelve `{ text, inputTokens, outputTokens, finishReason, blocked }` o lanza un error de la
  taxonomía.
- `GeminiProvider` sobre `@google/genai` (dependencia nueva, ADR; versión exacta con más de dos
  semanas, sin exclusiones de `minimumReleaseAge`). Structured output con `responseMimeType:
  'application/json'` y `responseJsonSchema` derivado del `DagType` del nodo.
- `FakeProvider` determinista: respuestas por guion (`script`) para pruebas, incluidas salidas
  inválidas, bloqueos, 5xx, 429 y salidas maliciosas del set de inyección. Cuenta tokens como
  `ceil(chars / 4)`.
- Selección: `LLM_PROVIDER=fake|gemini` (default `fake`). Con `gemini`, `GEMINI_API_KEY` es
  obligatoria y se valida al arrancar; el valor nunca se registra.
- Clave local en `.env` (gitignored). En CI, secret `GEMINI_API_KEY` usado solo por el workflow manual
  `llm-evals.yml` (`workflow_dispatch`).
- Lo puro del paquete (armado de prompts, delimitadores, canary, redacción, esquemas, validación,
  reparación, estimación y costo) se escribe con TDD.

## R3. Capa de Gemini (3A)

Capa gratuita de AI Studio: Google puede usar el contenido para mejorar sus productos. Regla: solo
datos de prueba. Se registra en `docs/threat-model.md` como riesgo aceptado hasta F9 y se muestra un
aviso en el panel de los nodos LLM.

## R4. Presupuesto en PostgreSQL (4C, 5A)

- Unidad: tokens. El costo se estima y se registra, pero no corta.
- Límites por entorno (worker y API leen los mismos): `LLM_MAX_TOKENS_PER_RUN` (default 50 000),
  `LLM_MAX_TOKENS_PER_ORG_DAY` (default 500 000), `LLM_MAX_INPUT_CHARS` (default 20 000).
- Precios: `LLM_PRICES=<modelo>:<entrada>:<salida>;...` en micro-USD por millón de tokens.
- Reserva atómica en una transacción, antes de llamar:
  1. `estimado = ceil(chars_entrada / 4) + maxOutputTokens`.
  2. `UPDATE workflow_runs SET llm_tokens_used = llm_tokens_used + $e WHERE id = $run AND
     llm_tokens_used + $e <= $limiteRun RETURNING` → sin fila: `budget_exhausted`
     (`LLM_RUN_BUDGET_EXHAUSTED`).
  3. `INSERT INTO llm_usage_daily ... ON CONFLICT (organization_id, usage_date) DO UPDATE SET
     tokens_used = llm_usage_daily.tokens_used + $e WHERE llm_usage_daily.tokens_used + $e <= $limiteDia
     RETURNING` → sin fila: rollback y `budget_exhausted` (`LLM_DAILY_BUDGET_EXHAUSTED`).
- Tras la llamada, en otra transacción: ajusta ambos contadores con `real - estimado` (puede ser
  negativo) y suma el costo; inserta la fila de `llm_calls`.
- La fila diaria por organización es caliente; se acepta a esta escala (decisión 4C). Lectura del
  indicador diario sin bloqueo.
- Caída entre reserva y ajuste: la reserva queda (falla cerrada). PostgreSQL caído al reservar:
  `transient`, sin llamada.
- `budget_exhausted` registra el evento de seguridad `llm.budget_exhausted` (ADR-0038) con
  organización, ejecución y tipo de presupuesto.

## R5. Cuotas diarias (6A)

Solo tokens LLM por organización y día. Ejecuciones por día y concurrentes quedan diferidas; se
actualiza ADR-0060 y `docs/PLAN.md` §5.4.

## R6. Bulkhead (7A)

- Task queue `TEMPORAL_LLM_TASK_QUEUE` (default `cognitive-dag-llm`) atendida por un segundo `Worker`
  en el mismo proceso, con `LLM_MAX_CONCURRENT_ACTIVITIES` (default 4).
- El workflow crea el proxy de las activities LLM con `taskQueue` explícito. No hace falta
  `patched()`: ningún historial existente contiene activities LLM. El replay de F4 se amplía con un
  historial que sí las tenga.

## R7. Reparación (8A)

- Dentro del intento de la activity: hasta 3 respuestas (1 + 2 reparaciones). Cada reparación vuelve
  a reservar presupuesto y añade como turno los errores de Zod resumidos (rutas y mensajes, sin el
  texto del usuario).
- `finishReason` de bloqueo por seguridad → `invalid_output` `LLM_CONTENT_BLOCKED`, sin reparar.
- `finishReason` de máximo de tokens → salida inválida, reparable.
- Agotadas las reparaciones → `invalid_output` `LLM_INVALID_OUTPUT`, no reintentable.

## R8. Inyección (9A)

- Prompt de sistema fijo en inglés por tipo de nodo, sin secretos.
- Texto del usuario dentro de `<data-{nonce}> ... </data-{nonce}>`, con un nonce aleatorio de 128
  bits por llamada (generado en la activity, nunca en el workflow).
- Canary: token aleatorio por llamada en las instrucciones; si aparece en la salida →
  `LLM_CANARY_LEAK` (`invalid_output`, sin reparar).
- Clasificar usa un enum cerrado en el JSON Schema; extraer, un objeto con `additionalProperties:
  false` y `required`.
- Set de inyección: `packages/llm/test/injection/cases.json` (unos 30 casos: órdenes directas,
  delimitadores falsos, peticiones de revelar instrucciones, campos extra, cambio de idioma, unicode
  oculto). En CI cada caso se combina con una respuesta maliciosa del `FakeProvider` y se verifica
  que el guardián la rechaza. Con Gemini, `pnpm eval:llm` cuenta escapes y falla si hay alguno.

## R9. Datos sensibles (10C)

- Campo opcional `redactPii: boolean` (default `false`) en los tres nodos LLM; compatible hacia atrás.
- Detectores en `packages/llm/src/redaction`: correo, teléfono (CO e internacional), tarjeta (13–19
  dígitos con Luhn), cédula y NIT colombianos (con palabra clave cercana para evitar falsos
  positivos). Marcadores `[EMAIL_1]`, `[PHONE_1]`, `[CARD_1]`, `[ID_1]`; irreversible.
- Siempre: el logger del worker no recibe prompts ni respuestas; prueba que lo verifica (SC-004).

## R10. Confianza (11A)

`confidence` la produce el modelo en el mismo objeto JSON; Zod exige [0,1]. La UI la rotula
"Confianza estimada".

## R11. Reejecución (12A)

`runtime/rerun.ts` amplía los reutilizables a nodos de categoría `llm` en `succeeded`. Los nodos
`reused` no reservan presupuesto.

## R12. UI de consumo (13A)

- Paso: modelo, tokens de entrada/salida, costo estimado y reparaciones (sumados de `llm_calls`).
- Ejecución: total de tokens y costo.
- Organización: "Consumo LLM de hoy" con tokens usados / límite, barra de progreso y costo.
- Estados de carga, vacío ("Sin consumo hoy") y error; ancho 800 px; textos en español.

## R13. Flag e interruptor (14A)

- `llm-nodes-enabled` (default `false`; `true` en `.env.example`). Apagado: las fases ejecutables
  siguen siendo solo F3 (`WORKFLOW_NOT_RUNNABLE` y `UNSUPPORTED_NODES` como hoy); sin indicadores de
  consumo; endpoint de consumo 404 `FEATURE_NOT_AVAILABLE`.
- Encendido: el API pasa `executablePhases: ['F3','F5']` a `findUnsupportedNodes`, y el workflow lo
  recibe en su entrada para no leer flags.
- `LLM_ENABLED=false` en el worker: toda activity LLM falla `permanent` `LLM_DISABLED` sin llamar.
- Issue de eliminación del flag, como #27 y #35.

## R14. Rate limit global (15A)

- Se mantiene `RATE_LIMIT_LLM_CLASSIFY` / `_EXTRACT` / `_GENERATE` (por organización y tipo, F4).
- Nuevo bucket global por modelo: `RATE_LIMIT_LLM_MODEL=capacity:15,refillPerSecond:0.25` aplicado a
  la clave `rl:global:<modelo>` en Valkey. Se pide antes de reservar presupuesto.
- Circuit breaker: diferido a F7 (ADR-0060 actualizado).

## R15. Códigos nuevos

| Código | Clase |
|---|---|
| `LLM_INVALID_OUTPUT`, `LLM_CONTENT_BLOCKED`, `LLM_CANARY_LEAK` | `invalid_output` |
| `LLM_RUN_BUDGET_EXHAUSTED`, `LLM_DAILY_BUDGET_EXHAUSTED` | `budget_exhausted` |
| `LLM_INPUT_TOO_LARGE`, `LLM_EMPTY_INPUT`, `LLM_DISABLED`, `LLM_PROVIDER_REJECTED` | `permanent` |
| `LLM_PROVIDER_UNAVAILABLE` | `transient` |
| `LLM_PROVIDER_RATE_LIMITED`, `RATE_LIMIT_EXHAUSTED` | `rate_limited` |

## ADRs previstos

1. Paquete `llm` con proveedor intercambiable y dependencia `@google/genai`.
2. Presupuesto de tokens con reserva en PostgreSQL.
3. Bulkhead con cola LLM en el mismo proceso.
4. Defensas contra inyección (delimitador con nonce, canary, set de inyección).
5. Ocultación opcional de PII por nodo.
6. Modelos por tipo de nodo y capa gratuita de Gemini.
7. Actualización de ADR-0060 (cuotas de ejecuciones y circuit breaker siguen diferidos).
