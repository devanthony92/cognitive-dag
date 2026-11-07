---
status: accepted
date: 2026-11-06
decision-makers: autor
---

# Catálogo filtrado y campos sensibles saneados

## Contexto y problema

El compilador no debe producir nodos que el sistema no puede ejecutar ni nodos desactivados por flag, y un modelo manipulado no debe rellenar campos que dirigen efectos externos (destino, cabeceras y cuerpo de `http.request`, que llega en F7). La entrada del modelo no es confiable (LLM01, LLM03).

## Opciones consideradas

- Catálogo completo del registro de nodos y rechazo posterior.
- Catálogo filtrado por ejecutabilidad y por flag, más saneo de campos sensibles.
- Moderación previa con otra llamada al modelo.

## Decisión

El catálogo del compilador solo incluye tipos con `executableFrom` ≤ F5: `trigger.manual`, `logic.condition`, `logic.merge`, `mock.service` y, con `llm-nodes-enabled`, los tres `llm.*`. La API resuelve el flag de la organización al crear la compilación y pasa la lista de tipos al workflow; la activity no consulta flags. Un tipo fuera de la lista es `UNKNOWN_TYPE` y se repara. Cada tipo puede declarar `sensitiveFields`; el saneo los quita de la configuración del nodo, de modo que la validación existente los reporta como configuración requerida y la publicación queda bloqueada hasta que una persona los complete. Además se usan delimitador con nonce, canario y salida estructurada ([ADR-0064](0064-defensas-contra-inyeccion-de-prompts.md)). El flag no es un control de seguridad: la autorización se aplica siempre (principio I).

## Consecuencias

- Bueno: el modelo no puede nombrar un tipo ajeno y ningún campo sensible llega relleno por el modelo.
- Bueno: sin cambios al esquema del DAG ni marca nueva en el JSON.
- Malo: la persona debe completar a mano los campos sensibles; es el comportamiento buscado.
- Malo: en F6 ningún tipo ejecutable tiene campos sensibles, así que el saneo se prueba con un catálogo de pruebas hasta F7.

## Confirmación

`catalog.test.ts`, `sanitize.test.ts` y el set de inyección (`injection.json`, `pnpm eval:compiler`).

## Enlaces

- [Research F6](../../specs/007-nl-compiler/research.md) (R10 y R12).
- [ADR-0064](0064-defensas-contra-inyeccion-de-prompts.md).
