# Research: Compilador de lenguaje natural a DAG (F6)

**Fecha**: 2026-11-06 · **Spec**: [spec.md](./spec.md)

Decisiones del autor: 1B, 2B, 3B, 4A, 5B, 6B, 7A, 8B, 9B, 10B, 11B, 12B, 13B (con la mitad de los
límites propuestos).

## R1. Alcance de la UI (1B)

- Dos modos: `create` (workflow nuevo) y `regenerate` (reemplazar el borrador de un workflow
  existente).
- `regenerate` guarda la `draftRevision` del momento en que se pidió la compilación; aplicar usa el
  `PUT .../draft` existente con esa revisión esperada, así que un cambio intermedio da conflicto.
- Diferido: edición incremental por instrucciones ("agrega un paso que…") sobre el DAG actual (1C).

## R2. Ejecución asíncrona en Temporal (2B)

- Workflow `compileIntent` con id `compile-<compilationId>` en la cola principal; una activity
  `compileIntentActivity` en la cola LLM (`TEMPORAL_LLM_TASK_QUEUE`), que hereda el bulkhead y el rate
  limit global por modelo de F5.
- La activity hace todo el ciclo (llamada, validación, reparaciones) dentro de un intento, igual que
  los nodos LLM con el guard. Reintentos de la activity solo para errores transitorios o limitados de
  la taxonomía; `invalid_output` y `budget_exhausted` no se reintentan.
- La intención entra como argumento del workflow y el resultado (DAG o último intento) como valor de
  retorno: el contenido vive solo en Temporal, como en F3 (ADR-0050). La API lee el resultado del
  historial cuando la UI pide la vista previa.
- Estado por polling (`GET .../compilations/:id` cada 1 s con backoff hasta 5 s). Diferido: SSE.
- Diferido: cancelación de una compilación en curso.

## R3. Persistencia sin contenido (3B)

- Tabla `compilations` con metadatos (ver data-model). Ni la intención ni el DAG se guardan en
  PostgreSQL; solo `intent_chars` como dato de tamaño.
- Si Temporal purgó el historial (retención del namespace), la vista previa devuelve
  `COMPILER_RESULT_EXPIRED` y la UI ofrece recompilar.

## R4. Presupuesto en `llm_calls` generalizada (4A)

- `llm_calls.run_id` y `llm_calls.node_id` pasan a ser opcionales; columna nueva `compilation_id`.
  `CHECK`: exactamente uno de los dos dueños (ejecución con nodo, o compilación sin nodo).
- `node_type` admite `compiler` además de los tres `llm.*`.
- Reserva antes de cada llamada contra `llm_usage_daily` (mismo mecanismo de F5) y contra un tope por
  compilación `LLM_MAX_TOKENS_PER_COMPILATION` (default 30000) acumulado en
  `compilations.llm_tokens_used`.
- El panel "Consumo LLM de hoy" ya suma todo lo de la organización; no cambia.

## R5. Modelo (5B, O6)

- `LLM_MODEL_COMPILER=gemini-3.5-flash-lite` por defecto. Flash (`gemini-3.6-flash`) fue inestable en
  la capa gratuita durante F5. Si el eval muestra que Flash-Lite no llega al 80 %, se prueba Flash
  por variable y se registra en el ADR de cierre.
- Cierra la parte de O6 que quedó pendiente para F6.

## R6. Formato intermedio y layout (6B)

- El modelo devuelve:
  `{ nodes: [{ id, type, label, config }], edges: [{ from, fromHandle, to }] }`, sin posiciones ni ids
  de arista. El esquema JSON se deriva de Zod con un `config` por tipo (unión discriminada por `type`).
- El código lo traduce a `DagDefinition` (`schemaVersion`, ids de arista deterministas
  `<from>-<fromHandle>-<to>`) y calcula posiciones con un layout por capas propio (orden topológico,
  capa = distancia máxima desde el trigger, separación fija). Sin dependencia nueva (no dagre).
- Paquete nuevo `packages/compiler` (puro, TDD): catálogo del compilador, prompt, esquema intermedio,
  traducción, layout, saneo de campos sensibles y propiedades de evals.

## R7. Reparación (7A)

- Reutiliza `guard` de `packages/llm` con `MAX_REPAIRS = 2` y su `check` para la validación semántica.
- Errores de reparación: código y ruta (`nodes[2].config.labels`, `edges[0]`, `CYCLE`, `UNKNOWN_TYPE`)
  más el texto del catálogo cuando aplica, nunca etiquetas ni valores producidos a partir de la
  intención.

## R8. Vista previa y aplicar (8B)

- La vista previa es React Flow en solo lectura. "Crear workflow con este borrador" usa `POST
  .../workflows` (solo nombre, como hoy) y luego `PUT .../draft` con la revisión 1; si el segundo paso
  falla, queda un workflow vacío que la persona puede reintentar o archivar. "Reemplazar borrador" usa `PUT .../workflows/:id/draft` con la
  revisión esperada. No hay endpoint de aplicar en el compilador: la autorización y el control de
  revisión siguen siendo los de F2.
- El nombre del workflow nuevo lo propone el modelo (campo `title` del formato intermedio, ≤ 100) y
  la persona lo puede cambiar antes de crear.
- Diferido: diff visual contra el borrador actual (8C).

## R9. Último intento inválido (9B)

- Si tras las reparaciones el último intento cumple el esquema intermedio, se traduce, se le aplica
  el layout y se guarda como `fallback` en el resultado del workflow. La UI ofrece "Abrir el último
  intento como borrador"; el editor muestra los errores de validación (el borrador ya admite errores).
- Si no cumple el esquema, o hubo bloqueo, no hay `fallback`.

## R10. Catálogo filtrado (10B)

- `executableFrom` ≤ F5. Hoy: `trigger.manual`, `logic.condition`, `logic.merge`, `mock.service` y,
  con `llm-nodes-enabled`, `llm.classify`, `llm.extract`, `llm.generate`.
- La API resuelve el flag de la organización al crear la compilación y pasa la lista de tipos al
  workflow; la activity no consulta flags.
- Un tipo fuera de la lista es error `UNKNOWN_TYPE` y se repara.

## R11. Evals (11B)

- Dataset `packages/compiler/evals/intents.json`: ~30 intenciones (español e inglés) con propiedades
  esperadas: tipos requeridos y prohibidos, rango de nodos, trigger único, todos los nodos alcanzables
  desde el trigger, ramas de condición conectadas cuando aplica.
- Set de inyección `packages/compiler/evals/injection.json`: ~10 intenciones con instrucciones
  inyectadas; escape = tipo fuera del catálogo, campo sensible no vacío o canario en la salida.
- `pnpm eval:compiler` (script en `scripts/eval/compiler.ts`): con `fake` usa respuestas grabadas por
  caso (determinista, en CI); con `gemini` llama de verdad, sin presupuesto en base de datos, con el
  rate limit local del script. Umbral: ≥ 80 % y 0 escapes.
- Job manual `compiler-evals.yml` (`workflow_dispatch`) con el secret `GEMINI_API_KEY`.
- Diferido: LLM como juez (11C).

## R12. Campos sensibles (12B)

- El catálogo gana una propiedad opcional `sensitiveFields` por tipo. Ningún tipo ejecutable hoy
  tiene campos sensibles: se marcan ya los de `http.request` (destino, cabeceras y cuerpo), que entra
  al compilador en F7. En F6 el saneo se prueba con un catálogo de pruebas en `packages/compiler`.
- El saneo quita el campo de la configuración del nodo. El borrador ya admite errores de validación,
  así que la validación existente lo reporta como configuración requerida y la publicación queda
  bloqueada. Sin marca nueva en el JSON del DAG ni cambios en su esquema.
- Delimitador con nonce, canario y structured output, igual que F5 (ADR-0064).
- Diferido: moderación previa con otra llamada (12C).

## R13. Límites y permisos (13B, mitad)

- Intención: 1–2000 caracteres (`COMPILER_INTENT_TOO_LONG`).
- 10 compilaciones por hora por persona: token bucket en Valkey `rl:compiler:user:<userId>`
  (capacidad 10, recarga 10/3600 s), con `Retry-After`.
- 50 por día UTC por organización: conteo en `compilations` del día (durable, con índice).
- Roles: owner y editor (los que editan borradores). Viewer: 403.

## Decisiones diferidas

| Tema | Por qué se difiere |
|---|---|
| Edición incremental por instrucciones | Duplica la complejidad del prompt y de los evals |
| Diff visual contra el borrador | La vista previa basta para el MVP |
| SSE para el estado | El polling basta para una operación de ~10–30 s |
| Cancelación de compilaciones | Corta duración; los límites acotan el costo |
| LLM como juez en evals | Costo y no determinismo; las propiedades bastan |
| Moderación previa | Una llamada extra por compilación; las defensas actuales bastan |
| Fallback automático Flash → Flash-Lite | El eval decide el modelo; la lógica extra no se mide bien |

## ADRs previstos

- 0067: compilador asíncrono en Temporal con contenido solo en el historial (R2, R3).
- 0068: formato intermedio, traducción y layout por capas propio (R6).
- 0069: `llm_calls` con dos dueños y presupuesto compartido del compilador (R4).
- 0070: catálogo filtrado y campos sensibles saneados (R10, R12).
- 0071: dataset de evals del compilador, umbral y modelo elegido (R5, R11).
