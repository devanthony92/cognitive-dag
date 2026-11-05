---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Ocultación opcional de PII por nodo

## Contexto y problema

El texto que se envía al proveedor puede contener datos personales (LLM02). La capa gratuita de Gemini puede usar el contenido para mejorar sus productos. Ocultar siempre todo rompería casos legítimos; no ocultar nada deja el riesgo al usuario sin herramienta.

## Opciones consideradas

- No ocultar nada y solo advertir.
- Ocultar siempre.
- Ocultar por nodo, a elección del autor del DAG.

## Decisión

Campo opcional `redactPii: boolean` (default `false`) en los tres nodos LLM, compatible hacia atrás (decisión 10C). Los detectores viven en `packages/llm/src/redaction.ts`: correo, teléfono (Colombia e internacional), tarjeta (13–19 dígitos con Luhn), y cédula y NIT colombianos con palabra clave cercana para evitar falsos positivos. Sustituyen por marcadores `[EMAIL_1]`, `[PHONE_1]`, `[CARD_1]`, `[ID_1]`; la sustitución es irreversible. Siempre, con o sin ocultación: el logger del worker no recibe prompts ni respuestas y las tablas no guardan su contenido.

## Consecuencias

- Bueno: quien procesa datos sensibles puede minimizarlos antes de que salgan del sistema.
- Bueno: la regla "sin contenido en logs" se prueba (SC-004).
- Malo: los detectores son heurísticos y pueden dejar pasar formatos no previstos o ocultar de más; el panel lo advierte y la capa gratuita exige solo datos de prueba.

## Confirmación

`packages/llm/test/redaction.test.ts` y `apps/worker/test/integration/llm-no-content.test.ts`.

## Enlaces

- [Research F5](../../specs/006-cognitive-nodes/research.md) (R9).
- [Modelo de amenazas](../threat-model.md), E7.
