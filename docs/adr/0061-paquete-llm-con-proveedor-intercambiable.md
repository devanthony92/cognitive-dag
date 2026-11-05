---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Paquete `llm` con proveedor intercambiable y dependencia `@google/genai`

## Contexto y problema

F5 ejecuta nodos que llaman a un modelo de lenguaje. La lógica pura (prompts, delimitadores, redacción, esquemas, reparación, estimación y costo) debe probarse sin red, y el proveedor no debe quedar fijado en el worker. Hace falta un cliente de Gemini.

## Opciones consideradas

- Llamar a la API REST de Gemini con `fetch`, sin dependencia nueva.
- Usar el SDK oficial `@google/genai` detrás de una interfaz propia, en un paquete `packages/llm`.
- Usar un framework de agentes (LangChain u otro).

## Decisión

Paquete `packages/llm` con la interfaz `LlmProvider`, un `FakeProvider` determinista (default, para pruebas y desarrollo) y un `GeminiProvider` sobre el SDK oficial `@google/genai`, fijado en `2.30.0` (publicada el 2026-10-15, más de dos semanas antes de adoptarla; sin exclusiones de `minimumReleaseAge`). El SDK se usa solo para `models.generateContent` con salida estructurada (`responseJsonSchema`). Un framework de agentes añade superficie y dependencias que F5 no necesita.

## Consecuencias

- Bueno: el proveedor se cambia sin tocar el motor; ninguna prueba de CI llama a Gemini.
- Bueno: la lógica pura queda cubierta con TDD en el paquete.
- Malo: una dependencia más con sus transitivas; se vigila con Renovate y el escaneo de dependencias de CI.
- Malo: `@google/genai` declara un script `preinstall` inocuo; se mantiene en `allowBuilds: false`.

## Confirmación

`pnpm test` en `packages/llm` (incluye el set de inyección con `FakeProvider`); `pnpm eval:llm` contra Gemini, manual (PR de cierre de F5).
