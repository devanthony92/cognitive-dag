# Implementation Plan: Endurecimiento (F8)

**Branch**: `009-hardening` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

## Summary

F8 no añade producto; mide, corrige y documenta. Cierra el riesgo de ADR-0053 (solo owner y editor
inician, cancelan y reejecutan), hace que el compilador ofrezca los cuatro nodos de F7 con
`credentialId` como campo sensible, elimina los ocho flags de producto (conserva los kill switches del
worker), corrige las desviaciones baratas de F7, añade un script manual de ZAP baseline y una
comprobación estática de `eval`, y deja una matriz de evidencia de las tablas 6.1 y 6.2 de
`docs/PLAN.md` y el modelo de amenazas v2.0. Sin tablas ni migraciones. Decisiones en
[research.md](./research.md); [data-model.md](./data-model.md) confirma que no hay cambios de esquema.

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24

**Primary Dependencies**: las existentes. Sin dependencias nuevas. ZAP corre como contenedor oficial
fijado por digest, fuera del árbol de dependencias de pnpm.

**Storage**: sin cambios (ver data-model)

**Testing**: Vitest. Pruebas de autorización por ruta y rol (iniciar, cancelar, reejecutar con owner,
editor, viewer y no miembro) y prueba de reflexión que exige `RequiredRoles` en las rutas que cambian
estado de `RunsController`; catálogo del compilador con los cuatro tipos y `credentialId` saneado;
evals del compilador ampliados (respuestas grabadas en cada PR, Gemini a mano al cerrar); pruebas de los
tres eventos nuevos y del tope del reconciliador; prueba de cabeceras y cookies sobre rutas reales;
prueba estática de `eval(`, `new Function(` y `dangerouslySetInnerHTML`; comprobador de referencias de
la matriz y del modelo de amenazas; tres corridas seguidas de `pnpm test` en paralelo

**Performance Goals**: ninguno nuevo; no se degrada SC-005 de F7 (webhook 202 p95 < 500 ms)

**Constraints**: la autorización no cambia salvo R2; sin tocar el esquema; los kill switches
`LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED` siguen funcionando; ninguna prueba llama a internet;
ZAP solo contra loopback

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | Se endurece A01/LLM03 (roles de ejecución); el compilador nunca rellena url, cabeceras, cuerpo ni credencial; sin `eval` verificado por prueba estática; los flags dejan de existir y la autorización no depende de ellos | PASS |
| II. Resiliencia | Tope de intentos del reconciliador; eventos de circuito y catch-up; sin llamadas externas nuevas | PASS |
| III. Pruebas | Cada fila `verified` cita una prueba que falla si el control se retira; TDD en las reglas de autorización (la prueba por ruta se escribe primero) | PASS |
| IV. Contratos | `credentialId` sensible solo en `sensitiveFields`; contrato de `runs` documenta el 403; `GET /features` devuelve `{}` | PASS |
| V. Errores | El 403 usa `FORBIDDEN` problem+json; se elimina `FEATURE_NOT_AVAILABLE` si nadie lo devuelve | PASS |
| VI. Correlation-ID | Los eventos nuevos llevan correlationId como los demás | PASS |
| VII. Desviaciones | ADR-0082 a ADR-0088; ADR-0053 queda `superseded`; ninguna dependencia nueva | PASS (con ADR) |
| VIII. Flags | Se eliminan los ocho flags con sus issues; nodos LLM y conectores conservan kill switch (`LLM_ENABLED`, `HTTP_ENABLED`, `TRIGGERS_ENABLED`); sin migraciones | PASS |
| IX. Idioma | Documentos y mensajes en español; código y commits en inglés | PASS |

OWASP tocado: todas las filas de 6.1 y 6.2 se revisan; se modifican A01 (roles de ejecución), A05 y
LLM10 (comprobación estática), A02 (prueba de cabeceras), LLM01 y LLM03 (compilador con nodos de F7).

## Project Structure

```text
docs/security/owasp-evidence.md                   # matriz 6.1 y 6.2 (PR 5)
docs/security/zap.md  docs/security/zap/          # procedimiento y resultados de ZAP (PR 4)
docs/threat-model.md                              # v2.0 (PR 5)
docs/adr/0082..0088-*.md
scripts/security/{check-evidence.ts,zap-baseline.sh}
.zap/rules.tsv                                    # decisión por regla de ZAP
apps/api/src/runs/runs.controller.ts              # RequiredRoles en iniciar, cancelar, reejecutar
apps/api/test/integration/runs-roles.test.ts      # rol x ruta + reflexión
apps/web/src/features/runs/                       # acciones deshabilitadas para el viewer
packages/dag-schema/src/catalog/http-request.ts   # credentialId en sensitiveFields
packages/compiler/src/catalog.ts                  # filtro <= F7, sin parámetro ignorado
packages/compiler/evals/{intents,injection}.json  # nodos de F7 y casos dirigidos
apps/worker/src/{http,approvals,schedules}/       # eventos y tope del reconciliador
apps/api/src/flags/ packages/contracts/src/flags.ts .env.example   # catálogo vacío
apps/api/src/**/ *-enabled.guard.ts               # se eliminan las guardas de flag
apps/web/vitest.config.ts                         # estabilidad bajo carga paralela
```

## PRs previstas

1. **Roles de ejecución y compilador** (Sonnet): `RequiredRoles('owner','editor')` en iniciar,
   cancelar y reejecutar; prueba por ruta y por reflexión; web con acciones deshabilitadas para el
   viewer; `credentialId` sensible; catálogo del compilador con los cuatro nodos y sin parámetro
   ignorado; evals ampliados; ADR-0082 y ADR-0083. Depende de `main`.
2. **Eliminación de los flags** (Sonnet): los ocho flags, uno por commit, guardas, catálogo vacío,
   `.env.example`, web, compilador y pruebas; cierra #2, #14, #21, #27, #32, #39, #48 y #55;
   ADR-0084. Depende de PR 1 (el compilador ya no usa `llmNodesEnabled` ni `triggersEnabled`).
3. **Desviaciones de F7 y comprobaciones** (Sonnet): tres eventos nuevos, tope del reconciliador,
   pruebas web estables, prueba de cabeceras y cookies, comprobación estática de `eval`, prueba de
   prompts sin secretos; ADR-0085. Depende de PR 2 (mismo código, sin guardas de flag).
4. **ZAP baseline** (Sonnet): `scripts/security/zap-baseline.sh`, `.zap/rules.tsv`,
   `docs/security/zap.md`, ejecución, decisión por alerta, correcciones con prueba de regresión;
   ADR-0086. Depende de PR 2 y PR 3 (se escanea el estado final).
5. **Matriz, modelo de amenazas y cierre** (Sonnet para la matriz, el comprobador y el modelo v2.0;
   Haiku para PLAN, README, ADRs 0087–0088 y `tasks.md`): ejecución de los comandos de cada fila,
   `docs/security/owasp-evidence.md`, `scripts/security/check-evidence.ts`, `docs/threat-model.md`
   v2.0, `docs/PLAN.md` (F8 completada, §6.1, §6.2, §9), README, corrida de evals contra Gemini y quickstart.
   Depende de PR 1–4.

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Prueba por reflexión sobre `RunsController` | La regla "toda ruta que cambia estado declara su rol" debe fallar sola al añadir una ruta; evita repetir ADR-0053 por olvido |
| Conservar `GET /features` y `FlagsModule` con catálogo vacío | El principio VIII exigirá flags en fases futuras; reconstruir la infraestructura costaría más que mantenerla |
| Conservar `executablePhases` en la entrada del workflow | Compatibilidad API–worker durante despliegues; no es un control de seguridad |
| Un commit por flag | Cada commit deja la suite en verde y el revisor puede verificar uno a uno |
| ZAP como script manual y no como job de CI | Decisión 6A: sin workflow ni check nuevo; la evidencia es el informe versionado |
| Comprobador de referencias dentro de un job existente | Cumple SC-003 sin cambiar los 6 checks requeridos |
