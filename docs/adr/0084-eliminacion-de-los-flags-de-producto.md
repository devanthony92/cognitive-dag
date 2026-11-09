---
status: accepted
date: 2026-11-08
decision-makers: autor
---

# Eliminación de los flags de producto y kill switches que se conservan

## Contexto y problema

Cada fase de F0 a F7 llegó a `main` detrás de un flag (principio VIII de la constitución): `ping-enabled`,
`identity-enabled`, `dag-editor-enabled`, `execution-enabled`, `resilience-enabled`,
`llm-nodes-enabled`, `nl-compiler-enabled` y `triggers-enabled`. Todas las fases están completas y el
producto se despliega con los ocho encendidos. Cada flag tenía una guarda en la API, una constante,
una entrada en el catálogo, un valor en `.env.example`, condiciones en la web y en el compilador, y
pruebas del estado apagado. Esas ramas muertas costaban mantenimiento y daban una falsa sensación de
control: los flags nunca fueron un control de seguridad (ADR-0080 lo dice expresamente) y la
autorización se aplica siempre.

## Opciones consideradas

- Mantener los ocho flags hasta F9.
- Eliminar los flags y también la infraestructura de flags.
- Eliminar los ocho flags, conservar la infraestructura vacía y los kill switches operativos del
  worker (elegida, decisión 2B de F8).

## Decisión

Se eliminan los ocho flags de producto, cerrando los issues #2, #14, #21, #27, #32, #39, #48 y #55:

- API: se borran `IdentityEnabledGuard`, `DagEditorEnabledGuard`, `ExecutionEnabledGuard`,
  `ResilienceEnabledGuard`, `LlmNodesEnabledGuard`, `NlCompilerEnabledGuard`, `TriggersEnabledGuard` y
  `LegacyPingGuard`. `SessionGuard` y `CsrfGuard` ya no consultan ningún flag. El ping de F0 sin
  organización (`/api/v1/pings`) desaparece; se conserva `/organizations/{id}/pings`.
- `executablePhases` queda fijo en `F3`, `F5` y `F7` y se sigue enviando en la entrada del workflow
  para que un worker que soporte menos fases rechace el resto con `UNSUPPORTED_NODES`. Es
  compatibilidad de despliegue entre API y worker, no seguridad.
- El compilador deja de recibir `llmNodesEnabled`: `allowedNodeTypes()` no tiene parámetros y ofrece
  todo lo ejecutable hasta F7 (ADR-0083). El detalle de la ejecución siempre calcula el consumo de
  LLM.
- Web: desaparecen `isIdentityEnabled` y los demás predicados, las guardas de ruta por flag y las
  propiedades `llm`, `resilience` y `triggers` de la paleta, el formulario de configuración y el panel
  de pasos. La paleta marca todos los nodos como ejecutables.
- Contrato: `FEATURE_FLAGS` queda vacío y `FEATURE_NOT_AVAILABLE` se elimina del contrato y de la API,
  porque ya nadie lo devuelve.
- Se conservan `FlagsModule`, OpenFeature, `FlagsService` y `GET /api/v1/features`, que responde `{}`.
  Un flag desconocido se evalúa como apagado. Quedan para el siguiente incompleto que deba llegar a
  `main` (principio VIII).
- Kill switches del worker, sin cambios: `LLM_ENABLED` (`LLM_DISABLED` en los nodos y el
  compilador), `HTTP_ENABLED` (`HTTP_DISABLED`) y `TRIGGERS_ENABLED` (el lanzador omite los disparos).
  La opción interna del worker que los recibe se llama `triggersOn`, para que ningún nombre de flag
  siga vivo en el código.
- Una prueba de repositorio (`scripts/test/unit/no-product-flags.test.ts`) falla si alguno de los ocho
  nombres reaparece, con guion, en camelCase o como constante, fuera de `docs/adr` y `specs`.

Sin migraciones: los flags no vivían en la base.

## Consecuencias

- Bueno: menos ramas, menos pruebas del estado apagado y un solo comportamiento que probar.
- Bueno: la autorización por rol y organización queda como única barrera, sin ambigüedad.
- Malo: ya no se puede apagar una fase completa sin desplegar; el apagado de emergencia se limita a
  los tres kill switches del worker.
- Malo: las ADR anteriores (por ejemplo la 0080) siguen nombrando los flags, porque son historia.

## Confirmación

`apps/api/test/integration/flags.test.ts` (catálogo vacío y flag desconocido apagado),
`apps/worker/test/unit/kill-switches.test.ts`, `scripts/test/unit/no-product-flags.test.ts`,
`packages/compiler/test/catalog-f7.test.ts` y las suites de autorización de cada endpoint (rol, no
miembro y otra organización).

## Enlaces

- Actualiza [ADR-0080](0080-flag-unico-triggers-enabled-y-compilador-sin-nodos-f7.md) en lo del flag.
- [Research F8](../../specs/009-hardening/research.md) (R4).
