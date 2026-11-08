---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Flag único triggers-enabled y compilador sin nodos de F7

## Contexto y problema

F7 añade nodos con efectos reales: llamadas salientes, un endpoint público y aprobaciones. Hay que
poder desplegarlo sin exponerlo antes de tiempo, sin dejar que el compilador de lenguaje natural
produzca nodos que el usuario no puede usar todavía, y con interruptores operativos separados del
producto. Los flags no son un control de seguridad.

## Opciones consideradas

- Un flag por nodo o por función (webhook, programación, aprobación, HTTP).
- Un flag único `triggers-enabled` para todo F7 (elegida, decisión 13C).
- Sin flag, solo kill switches operativos.
- Que el compilador ofrezca ya los nodos de F7.

## Decisión

Un flag público `triggers-enabled` (catálogo de la API, dueño `devanthony92`, issue de eliminación
#55). Controla los endpoints (404 `FEATURE_NOT_AVAILABLE`), el webhook público (404), los Schedules
(se pausan), la bandeja, las credenciales, la allowlist, la UI y la fase `F7` de `executablePhases`.
Su valor por defecto es apagado: el cliente de flags devuelve `false` si no hay valor. La API decide
`executablePhases` al iniciar cada ejecución, porque el workflow no lee flags.

Kill switches del worker, separados del flag: `TRIGGERS_ENABLED` (el lanzador omite los disparos sin
borrar los Schedules) y `HTTP_ENABLED` (las activities fallan con `HTTP_DISABLED` sin llamar al
destino). El flag no reemplaza a la autorización ni al anti-SSRF, que se aplican siempre.

Compilador: el filtro `executableFrom ≤ F5` no cambia, así que los nodos de F7 no entran en el
prompt. Una prueba fija que ningún tipo con `executableFrom: 'F7'` llega al prompt, aunque el flag
esté encendido. Ofrecer los nodos en el compilador queda para F8.

Desviación: `allowedNodeTypes` acepta un parámetro `triggersEnabled?` que se ignora. Quedó de la
tarea T017 (PR #56).

## Consecuencias

- Bueno: un único interruptor de producto y dos kill switches operativos.
- Bueno: el compilador no produce nodos con efectos externos antes de tiempo.
- Malo: el flag no es control de seguridad. Una organización con el flag encendido tiene los
  endpoints, y la autorización es la única barrera.
- Malo: la decisión se toma en dos sitios, la API (flag) y el worker (variable de entorno). Si el
  operador apaga `TRIGGERS_ENABLED` sin apagar el flag, los disparos se omiten sin error visible,
  así que hay que vigilarlo.
- Malo: el flag público expone su nombre en el catálogo público de funciones.

## Confirmación

`apps/api/test/integration/triggers-flag.e2e.test.ts`, `apps/api/test/integration/flags.test.ts`,
`packages/compiler/test/catalog-f7.test.ts`, y las pruebas de entorno
`apps/api/test/unit/env.schema.triggers.test.ts` y
`apps/worker/test/unit/env.schema.triggers.test.ts`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R1 y R13).
- [ADR-0038](0038-eventos-de-seguridad-en-logs.md),
  [ADR-0064](0064-defensas-contra-inyeccion-de-prompts.md),
  [ADR-0070](0070-catalogo-filtrado-y-campos-sensibles-saneados.md).
