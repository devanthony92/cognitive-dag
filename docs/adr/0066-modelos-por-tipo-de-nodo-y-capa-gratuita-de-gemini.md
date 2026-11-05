---
status: accepted
date: 2026-11-05
decision-makers: autor
---

# Modelos por tipo de nodo y capa gratuita de Gemini

## Contexto y problema

`docs/PLAN.md` dejó abierta la decisión O6: qué modelo de Gemini usar. Clasificar y extraer son tareas acotadas y baratas; generar texto pide más calidad. La capa gratuita de AI Studio limita las peticiones por minuto y puede usar el contenido enviado.

## Opciones consideradas

- Un solo modelo para todos los nodos.
- Un modelo por tipo de nodo, configurable por entorno.
- Modelos de pago desde el inicio.

## Decisión

Un modelo por tipo de nodo, por variable del worker (decisión 1A): `LLM_MODEL_CLASSIFY`, `LLM_MODEL_EXTRACT` y `LLM_MODEL_GENERATE`, los tres con `gemini-3.5-flash-lite` por defecto (`.env.example` y configuración del worker). Se había previsto `gemini-3.6-flash` para generar, pero en la capa gratuita fue inestable y rechazó un caso válido en `pnpm eval:llm`; con Flash-Lite en todos los nodos no hubo rechazos. Quien quiera otro modelo lo cambia por variable. Los precios van en `LLM_PRICES`. Se usa la capa gratuita de AI Studio solo con datos de prueba (decisión 3A): el riesgo de que Google use el contenido queda aceptado en el modelo de amenazas hasta F9, con aviso en el panel de los nodos LLM; antes de la demo pública se migra a la capa de pago. Un bucket global por modelo (`RATE_LIMIT_LLM_MODEL`, 15 de capacidad y 0,25 por segundo) protege la cuota compartida por todas las organizaciones.

## Consecuencias

- Bueno: el costo y la latencia se ajustan por tipo de nodo sin tocar código, y el modelo más barato es el que mejor se comportó en la capa gratuita.
- Bueno: cambiar de modelo es cambiar una variable.
- Malo: la generación usa un modelo menos capaz que el previsto; si la calidad no alcanza, se cambia la variable.
- Malo: los nombres de modelo envejecen; se verifican contra la documentación oficial al cambiarlos.
- Malo: la capa gratuita tiene cuotas bajas y términos de uso de datos; por eso solo datos de prueba hasta F9.

## Confirmación

`.env.example`, validación de la configuración del worker (`env.schema.test.ts`) y `pnpm eval:llm` contra los modelos configurados.

## Enlaces

- [Research F5](../../specs/006-cognitive-nodes/research.md) (R1, R3 y R14).
- [ADR-0061](0061-paquete-llm-con-proveedor-intercambiable.md).
