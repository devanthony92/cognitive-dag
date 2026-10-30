# Research: Modelo DAG y editor visual (F2)

**Fecha**: 2026-10-30 · **Spec**: [spec.md](./spec.md)

Versiones consultadas en npm el 2026-10-30; las de menos de un día se reemplazan por el parche
anterior (ADR-0020). Cada dependencia nueva lleva ADR.

## R1. Paquete del modelo

- **Decision**: nuevo paquete `packages/dag-schema` (ESM, sin dependencias de runtime salvo Zod) con
  el esquema de la definición, el catálogo de nodos, la validación semántica, el resolvedor de
  referencias y el AST de condiciones. Lo usan el API, la web y, en F3, el worker.
- **Rationale**: una sola implementación de validación para navegador y servidor (FR-009, SC-002).
  TDD obligatorio (constitution, principio III).

## R2. Forma de la definición

```json
{
  "schemaVersion": 1,
  "nodes": [{ "id": "classify", "type": "llm.classify", "label": "Clasificar tono",
              "position": { "x": 0, "y": 0 }, "config": { } }],
  "edges": [{ "id": "e1", "source": "trigger", "sourceHandle": "out", "target": "classify" }]
}
```

- `id` de nodo: `^[a-z][a-z0-9_]{0,39}$`, único; es el nombre usado en las referencias. Renombrarlo
  reescribe las referencias que lo usan (edge case de la spec).
- `sourceHandle`: `out` en todos los nodos salvo `logic.condition` (`true`/`false`) y
  `human.approval` (`approved`/`rejected`/`timeout`).
- `schemaVersion` permite migrar definiciones en el futuro.
- Objetos estrictos: cualquier campo desconocido invalida la definición (FR-005).

## R3. Catálogo (FR-001, FR-002)

Cada tipo declara `configSchema` (Zod), `outputSchema` (descriptor de tipos para referencias),
`handles`, `templatableFields` y `executableFrom` (`F3`, `F5`, `F7`).

| Tipo | Configuración principal | Salida | Ejecutable desde |
|---|---|---|---|
| `trigger.manual` | esquema de entrada (campos tipados) | los campos de entrada | F3 |
| `trigger.webhook` | esquema del cuerpo esperado | el cuerpo validado | F7 |
| `trigger.schedule` | expresión cron, zona horaria | momento de disparo | F7 |
| `llm.classify` | texto (plantilla), etiquetas permitidas | `label` (enum de esas etiquetas), `confidence` | F5 |
| `llm.extract` | texto (plantilla), campos a extraer con tipo | los campos declarados | F5 |
| `llm.generate` | instrucción (plantilla), idioma, longitud máxima | `text` | F5 |
| `logic.condition` | AST de condición | ninguna; ramas `true`/`false` | F3 |
| `logic.merge` | estrategia (`all`, `any`) | ninguna | F3 |
| `human.approval` | mensaje (plantilla), plazo | `decision`, `approvedBy` | F7 |
| `http.request` | método, URL https (plantilla), cuerpo (plantilla), sin cabeceras de autorización | `status`, `body` | F7 |
| `mock.service` | latencia, tasa de fallos, tipo de fallo | `ok` | F3 |

Las salidas de `llm.extract` y `trigger.*` dependen de la configuración: el catálogo calcula la salida
a partir de la configuración de cada nodo.

## R4. Tipos para referencias

Sistema de tipos mínimo: `string`, `number`, `boolean`, `enum<valores>`, `datetime`, `object<campos>`,
`list<tipo>`. Una referencia es compatible si el tipo de origen es asignable al del campo destino
(`enum` → `string` sí; `string` → `enum` no).

## R5. Plantillas (4a-C)

Marcadores `{{nodes.<id>.output.<ruta>}}` solo en campos `templatableFields`. Se analizan con un
tokenizador propio (sin `eval` ni motores de plantillas); cada marcador se valida como referencia y su
tipo debe ser convertible a texto. En campos no plantillables el texto es literal.

## R6. Condiciones (4b-A)

AST discriminado en Zod: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`, `and`, `or`, `not`;
operandos: referencia o literal tipado. Profundidad máxima 5, máximo 20 operaciones por condición. El
evaluador (F3) es una función pura sobre el AST.

## R7. Validación semántica (FR-003 a FR-008)

Orden: esquema estricto → unicidad de ids → un disparador sin entradas → conexiones a nodos y
salidas existentes → ciclos (Kahn) → alcanzabilidad desde el disparador → referencias (existencia,
el nodo referenciado es ancestro, campo existente, tipo compatible) → límites. Cada error lleva
`code`, `message` en español y `location` (`node`, `field`, `edge`). Resultado determinista (mismo
orden de errores) para que navegador y servidor coincidan.

## R8. Editor

- `@xyflow/react` 12.12 (React Flow) para lienzo, nodos y conexiones.
- Auto-layout con `@dagrejs/dagre` 3.1 (capas izquierda → derecha), más liviano que `elkjs`.
- Formularios del panel generados desde `configSchema` con React Hook Form (ya en el proyecto);
  campos especiales: selector de referencias, editor de plantillas y constructor de condiciones.
- Validación en vivo con debounce de 200 ms en el navegador.

## R9. Persistencia (8C)

Definición en JSONB más columnas derivadas (cantidad de nodos y conexiones, tipos usados, hash). Ver
[data-model.md](./data-model.md).

## R10. Bloqueo optimista (6A)

`PUT /workflows/{id}/draft` exige el header `If-Match` con la revisión del borrador; si no coincide,
409 `DRAFT_CONFLICT`. La actualización es un único `UPDATE ... WHERE draft_revision = $esperada`.

## R11. Publicación y concurrencia

Publicar en una transacción: bloquea la fila del workflow (`FOR UPDATE`), valida, calcula el siguiente
número de versión, inserta la versión y fija la versión activa. Índice único `(workflow_id,
version_number)` como segunda capa contra publicaciones simultáneas.

## R12. Límites (5C, operador)

Máximos absolutos en configuración del servidor (`DAG_MAX_NODES_CEILING` y similares). Límites por
organización en una tabla de solo lectura para la aplicación; el operador los cambia con
`pnpm ops:set-limits <organizationId> …`, que se conecta como `app_migrator`, valida contra los
máximos absolutos y registra el cambio en su log.

## R13. Flag

`dag-editor-enabled` (default `false`, `true` en `.env.example`), público para la web.
