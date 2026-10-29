---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# El LLM actúa como compilador de lenguaje natural a DAG (D1)

## Contexto y problema

La plataforma convierte una intención escrita en lenguaje natural en una automatización
ejecutable. Un LLM puede decidir pasos en tiempo de ejecución o limitarse a producir un artefacto
que luego se revisa. La elección define la superficie de ataque (OWASP LLM01, LLM03) y la
auditabilidad.

## Opciones consideradas

- Agente autónomo: el LLM elige herramientas y acciones mientras se ejecuta el flujo.
- Compilador: el LLM produce un DAG tipado a partir de un catálogo cerrado de nodos; el usuario lo
  revisa y publica; la ejecución es determinista.
- Sin LLM: el usuario arma el DAG a mano.

## Decisión

El LLM es un **compilador** (lenguaje natural → DAG) y una **función acotada** dentro de nodos
cognitivos concretos (`llm.classify`, `llm.extract`, `llm.generate`). Nunca decide en tiempo de
ejecución qué acción tomar fuera del grafo publicado, y su salida solo es dato validado por
esquema.

## Consecuencias

- Bueno: ejecuciones deterministas y auditables; la superficie de inyección de prompts se reduce a
  datos, no a acciones.
- Bueno: encaja con Temporal, que exige workflows deterministas.
- Malo: menos flexibilidad que un agente; cada capacidad nueva requiere un tipo de nodo nuevo.
- Sin efecto en F0 (no hay uso de LLM); condiciona F5 y F6.

## Enlaces

- `docs/PLAN.md` §2 (D1) y §4 (Compilador NL → DAG). Constitución, principio I.
