---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Defensas contra inyección de prompts: delimitador con nonce, canary y set de inyección

## Contexto y problema

Los nodos LLM reciben texto que puede venir de terceros y que puede intentar dar órdenes al modelo o extraer sus instrucciones (LLM01, LLM08). No existe una defensa única; la salida del modelo no se puede tratar como confiable.

## Opciones consideradas

- Confiar solo en las instrucciones del prompt de sistema.
- Un segundo modelo que juzgue si hay inyección.
- Defensa en capas determinista: datos delimitados, salida estructurada validada, marca canary y un set de casos hostiles.

## Decisión

Defensa en capas determinista (decisión 9A):

- Prompt de sistema fijo, en inglés, sin secretos. El texto del usuario va solo dentro de `<data-{nonce}> ... </data-{nonce}>`, con un nonce de 128 bits generado por llamada en la activity, nunca en el workflow.
- Salida estructurada: enum cerrado para clasificar; objeto con `additionalProperties: false` y `required` para extraer. Todo se valida con Zod antes de entregarse.
- Canary aleatorio por llamada en las instrucciones. Si aparece en la salida, falla con `LLM_CANARY_LEAK` (`invalid_output`) sin reparar.
- Respuestas bloqueadas por el proveedor fallan con `LLM_CONTENT_BLOCKED`, sin reparar. Una salida inválida se repara hasta dos veces con un resumen de errores que nunca incluye el texto del usuario.
- Set de inyección (`packages/llm/test/injection/cases.json`, unos 30 casos). En CI cada caso se combina con una respuesta maliciosa del `FakeProvider` y se verifica que el guardián la rechaza o que lo entregado es válido y sin canary. Con Gemini, `pnpm eval:llm` repite el set contra el modelo real y falla si hay un escape.

## Consecuencias

- Bueno: ninguna salida llega al grafo sin pasar por el esquema; la defensa no depende del buen comportamiento del modelo.
- Bueno: el set es regresión barata en CI y comprobación real bajo demanda.
- Malo: un set fijo no cubre ataques nuevos; se amplía cuando aparezcan.
- Malo: `pnpm eval:llm` gasta capa gratuita y es manual; el workflow `llm-evals.yml` solo se lanza a mano.

## Confirmación

`packages/llm/test/injection/injection.test.ts`, `guard.test.ts`, `prompt.test.ts`, y `pnpm eval:llm` (manual, workflow `llm-evals.yml`).

## Enlaces

- [Research F5](../../specs/006-cognitive-nodes/research.md) (R7 y R8).
- [ADR-0002](0002-llm-como-compilador-de-dag.md) (la salida del LLM es dato, no acción).
