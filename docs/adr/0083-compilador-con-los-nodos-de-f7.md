---
status: accepted
date: 2026-11-08
decision-makers: autor
---

# Compilador con los nodos de F7 y `credentialId` sensible

## Contexto y problema

[ADR-0080](0080-flag-unico-triggers-enabled-y-compilador-sin-nodos-f7.md) dejó fuera del compilador
los cuatro nodos de F7 hasta F8. Quien describe una automatización no podía pedir un webhook, una
programación, una aprobación ni una llamada HTTP. Ofrecerlos abre la superficie de LLM01 y LLM03
más sensible: una intención hostil que consiga una llamada HTTP a un destino elegido por el atacante
o con una credencial de la organización.

## Opciones consideradas

- Mantener los nodos de F7 fuera del compilador.
- Ofrecerlos con el modelo rellenando todos los campos.
- Ofrecerlos y que el modelo nunca rellene lo que dirige un efecto externo (elegida, decisión 3A).

## Decisión

El compilador ofrece `trigger.webhook`, `trigger.schedule`, `human.approval` y `http.request`: el
filtro de ejecutabilidad pasa a `≤ F7` y no depende de ningún flag de F7. `allowedNodeTypes` pierde
el parámetro `triggersEnabled?`, que se ignoraba. Los nodos LLM siguen condicionados a
`llm-nodes-enabled` hasta que PR 2 elimine ese flag.

El modelo puede declarar: `bodySchema` en el webhook; `cron` y `timezone` en la programación (no
dirigen un efecto externo y se validan al publicar); `message`, `timeoutSeconds` y las ramas
`approved`, `rejected` y `timeout` en la aprobación; solo `method` en `http.request`.

`credentialId` se añade a `sensitiveFields` de `http.request`, que pasa a `url`, `headers`, `body` y
`credentialId`. Es el campo que decide qué secreto de la organización se usa. El saneado existente
(ADR-0070) los elimina siempre y los lista en `omittedSensitiveFields`; el borrador queda inválido y
no se puede publicar hasta que una persona los complete. El esquema del editor no cambia:
`credentialId` sigue siendo un `uuid` opcional y válido; `sensitiveFields` solo lo usa el compilador.

Publicar y ejecutar siguen exigiendo owner o editor ([ADR-0082](0082-solo-owner-y-editor-ejecutan.md))
y se aplican la allowlist, el anti-SSRF y las credenciales de F7 sin cambios.

Los evals suben a 37 intenciones y 14 casos de inyección, con casos dirigidos a los nodos nuevos (URL
del atacante con «mi token», cabecera `Authorization` inventada, exfiltrar el contenido de un
webhook, saltarse la aprobación). El umbral sigue siendo ≥ 80 % y 0 escapes. El juez de intenciones
ignora los errores de validación que corresponden a campos sensibles omitidos, porque ese borrador es
inválido a propósito.

## Consecuencias

- Bueno: el compilador cubre todo el catálogo ejecutable sin dejar al modelo elegir destinos,
  cabeceras, cuerpos ni credenciales.
- Bueno: un cambio futuro del catálogo no puede ofrecer un tipo sin guía: `compilerCatalog` falla.
- Malo: todo borrador con `http.request` llega inválido hasta que la persona completa los cuatro
  campos.
- Malo: `trigger.schedule` deja que el modelo proponga la frecuencia; la cron mínima sigue sin tope
  (riesgo aceptado, issue #68).
- Malo: el kill switch `HTTP_ENABLED` no impide que el compilador ofrezca el nodo.

## Confirmación

`packages/compiler/test/catalog-f7.test.ts`, `prompt.test.ts`, `sanitize.test.ts`, `compile.test.ts`,
`packages/dag-schema/test/catalog/sensitive-fields.test.ts` y `pnpm eval:compiler`.

## Enlaces

- Actualiza [ADR-0070](0070-catalogo-filtrado-y-campos-sensibles-saneados.md) y
  [ADR-0080](0080-flag-unico-triggers-enabled-y-compilador-sin-nodos-f7.md).
- [Research F8](../../specs/009-hardening/research.md) (R3).
