# CognitiveDAG Constitution

Documento de principios no negociables. Toda spec, plan, tarea y PR DEBE cumplirlos.
Fuente de decisiones técnicas y de arquitectura: `docs/PLAN.md`.

## Core Principles

### I. Seguridad por defecto (NO NEGOCIABLE)

- Cada spec DEBE identificar los riesgos de OWASP Top 10:2025 y OWASP Top 10 for LLM
  Applications 2026 que toca, y su mitigación.
- Ante un estado desconocido o inválido, el sistema DEBE fallar cerrado (denegar, detener).
- Todo acceso a datos DEBE estar aislado por tenant en dos capas: guards de aplicación y
  Row-Level Security en PostgreSQL.
- La salida de un LLM NO DEBE ejecutarse, interpolarse en SQL, renderizarse como HTML ni
  decidir qué acción tomar. Solo produce datos validados por esquema.
- Está prohibido `eval`, `new Function` o cualquier evaluación dinámica de código o expresiones.
- Ningún secreto, credencial o dato personal real DEBE entrar al repositorio (es público).
- Los feature flags NO DEBEN usarse como control de seguridad: la autorización se aplica siempre.

Razón: la plataforma ejecuta acciones sobre datos de terceros con entradas no confiables.

### II. Resiliencia explícita

- Ninguna llamada externa (HTTP, LLM, conectores) DEBE hacerse sin timeout, política de
  reintentos y clasificación de errores según la taxonomía de `docs/PLAN.md` §5.1.
- Todo efecto con consecuencias externas DEBE llevar una clave de idempotencia estable
  entre reintentos (`runId:nodeId`).
- El código de workflows de Temporal DEBE ser determinista; la E/S, el reloj, el azar y la
  lectura de flags ocurren solo en activities o en la entrada del workflow.

Razón: los fallos de terceros son la norma, no la excepción.

### III. Pruebas primero donde el riesgo es mayor

- TDD es obligatorio (rojo → verde → refactor) en `packages/dag-schema`,
  `packages/resilience` y en las reglas de autorización.
- Cada control OWASP aplicado DEBE tener al menos una prueba que lo demuestre.
- Los workflows DEBEN tener pruebas de replay de historiales en CI.
- Todo comportamiento detrás de un feature flag DEBE probarse con el flag encendido y apagado.

### IV. Contratos tipados en cada borde

- Zod es la fuente única de verdad de los contratos; los tipos TypeScript se derivan de él.
- Toda entrada DEBE validarse en su borde: peticiones HTTP, webhooks, salidas del LLM,
  entradas de activities y variables de configuración al arrancar.

### V. Errores estándar (RFC 9457)

- Toda respuesta de error del API DEBE usar `application/problem+json` (RFC 9457).
- Campos: `status`, `title` (frase HTTP estándar), `detail` (en español), `code` (estable,
  en inglés, `UPPER_SNAKE_CASE`), `correlationId`; `errors[]` solo en validación (422).
- `type` e `instance` se omiten (`type` implica `about:blank`).
- El manejo DEBE ser centralizado (filtro global de excepciones). Las respuestas 5xx NO DEBEN
  exponer stack traces ni detalles internos.

### VI. Trazabilidad con Correlation-ID

- Toda petición, mensaje, log, evento, ejecución y llamada saliente DEBE llevar un
  Correlation-ID.
- Se acepta `X-Correlation-Id` entrante solo si es un UUID válido; si no, se genera uno.
- El ID se propaga por AsyncLocalStorage en el API, por la entrada y el search attribute
  `CorrelationId` en Temporal, y en headers salientes. Las ejecuciones heredan el ID del
  evento que las disparó.
- El ID se devuelve en el header de respuesta y en todo problem+json.

### VII. Simplicidad y desviaciones documentadas

- Solo se construye lo que pide la spec activa; no hay abstracciones especulativas.
- Toda dependencia nueva o desviación de `docs/PLAN.md` DEBE registrarse en un ADR corto
  (`docs/adr/`).

### VIII. Feature flags para desacoplar despliegue y lanzamiento

- Todo comportamiento visible o ejecutable de una spec que llegue a `main` antes de estar
  completa DEBE estar detrás de un flag apagado por defecto en producción.
- Las capacidades con riesgo operativo (nodos LLM, conectores) DEBEN tener un kill switch.
- Los flags se evalúan con OpenFeature. Cada flag DEBE tener dueño y un issue de eliminación.
- No requieren flag: refactors sin efecto visible, documentación ni correcciones menores.
- Las migraciones de base de datos DEBEN ser compatibles hacia atrás (expand/contract).

### IX. Idioma

- Español: specs, documentación, `title`/`detail` de errores y mensajes del API.
- Inglés: código, identificadores, README, commits y `code` de errores.
- Inglés: prompts, instrucciones de sistema y esquemas enviados al LLM. El idioma del texto
  generado para usuarios finales es configurable por nodo (español por defecto).

## Restricciones técnicas

- Stack: TypeScript, NestJS, Temporal (SDK TypeScript), PostgreSQL, React + Vite + React Flow,
  Gemini vía `@google/genai`. Cambios al stack requieren ADR.
- Runtime: Node.js 24 LTS con parches al día; versión fijada en `.nvmrc`, `engines` y digest
  de imagen Docker.
- Imágenes de contenedor sobre Debian (`bookworm-slim`), nunca Alpine (el worker de Temporal
  requiere glibc). Builds multi-arch `linux/amd64` y `linux/arm64`.
- Despliegue portable: Docker Compose, aprovisionamiento por script y backups fuera de la VM.

## Flujo de desarrollo

- Trunk-based: una rama corta por spec, PR a `main`, Conventional Commits.
- Gate de merge: CI en verde (lint, typecheck, tests, auditoría de dependencias, escaneo de
  secretos).
- Definición de terminado de cada spec:
  1. Criterios de aceptación cumplidos y probados.
  2. CI en verde.
  3. Checklist de seguridad de la spec revisado.
  4. ADRs y `docs/PLAN.md` actualizados.
  5. Ningún `TODO` sin issue asociado.

## Governance

- Esta constitution prevalece sobre cualquier otra práctica, spec o plan.
- Enmiendas: se proponen por PR, con motivo y su impacto en specs existentes.
- Versionado semántico: MAJOR elimina o redefine principios; MINOR agrega principios o
  secciones; PATCH aclara redacción.
- Cumplimiento: `/speckit-plan` verifica la constitution en su "Constitution Check"; toda PR
  DEBE indicar qué principios aplican y cómo se cumplen. Toda excepción DEBE justificarse en
  la sección "Complexity Tracking" del plan.

**Version**: 1.0.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-10-28
