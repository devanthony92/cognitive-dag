---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Gemini mediante el SDK oficial como proveedor del LLM (D5)

## Contexto y problema

El compilador y los nodos cognitivos necesitan un proveedor de LLM con salida estructurada. El
autor tiene acceso a la API de Gemini.

## Opciones consideradas

- Gemini con `@google/genai`.
- Otro proveedor (OpenAI, Anthropic).
- Un gateway multiproveedor desde el inicio.

## Decisión

Gemini mediante el SDK oficial `@google/genai`, detrás de un paquete propio (`packages/llm`) que
concentre la salida estructurada, los límites de consumo y la telemetría. El modelo concreto se
decide al iniciar F5 (decisión abierta O6).

## Consecuencias

- Bueno: SDK oficial, lo que reduce el riesgo de cadena de suministro (OWASP LLM04); sin modelos
  de terceros.
- Malo: dependencia de un proveedor; el paquete `llm` debe aislar la interfaz para poder
  reemplazarlo.
- Sin código en F0; el modelo de amenazas marca los riesgos de LLM como `planned:F5`.

## Enlaces

- `docs/PLAN.md` §2 (D5), §3 (O6) y §6.1.
