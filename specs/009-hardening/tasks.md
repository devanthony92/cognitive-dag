---

description: "Task list for F8 — Endurecimiento"
---

# Tasks: Endurecimiento (F8)

**Input**: `/specs/009-hardening/` (spec, plan, research, data-model sin cambios de esquema,
contracts, quickstart, checklists)

**Tests**: incluidas; TDD obligatorio en las reglas de autorización (T003–T006) y en el saneado del
compilador (T009). Cada prueba se escribe primero y DEBE fallar antes de implementar. Ninguna prueba
de CI llama a internet; ZAP solo apunta a loopback.

**Feature flag**: ninguno. Esta fase elimina los ocho flags de producto. Kill switches del worker que
se conservan: `LLM_ENABLED`, `TRIGGERS_ENABLED`, `HTTP_ENABLED`.

**Esquema**: sin migraciones (ver `data-model.md`). Si alguna tarea necesitara una, se detiene y se
pide aprobación del autor.

## Format: `[ID] [P?] [Story] Description`

Historias: US1 matriz, US2 roles de ejecución, US3 compilador con nodos de F7, US4 ZAP, US5 flags, US6
modelo de amenazas, US7 desviaciones de F7, US8 configuración y suministro, US9 LLM.

---

## Phase 1: Setup

- [X] T001 Abrir los issues de seguimiento de lo `deferred:F9` y `accepted` nuevos (MFA y política de contraseñas; auditoría por tenant y retención; autenticación y TLS de Temporal, PostgreSQL y Valkey; SBOM y escaneo de imágenes; ZAP activo y contra staging; ejecución `failed` tras fallo de Temporal; métrica de disparos fuera del catch-up; frecuencia mínima de la cron) y anotar los números en la matriz y el modelo de amenazas
  - Issues abiertos: #61 MFA TOTP y política de contraseñas; #62 auditoría por tenant y retención; #63
    autenticación y TLS de Temporal, PostgreSQL y Valkey; #64 SBOM y escaneo de imágenes; #65 ZAP
    activo y contra staging; #66 ejecución `failed` tras fallo de Temporal; #67 métrica de disparos
    fuera del catch-up; #68 frecuencia mínima de la cron. La PR 5 los cita en la matriz y en el
    modelo de amenazas (T045, T047).
- [X] T002 [P] Medir la base: `pnpm test` en paralelo tres veces y anotar qué pruebas web fallan por tiempo (entrada de T029)
  - Medición (2026-11-08, Windows, tres `pnpm test --force` lanzados a la vez, sin `maxWorkers` ni
    `testTimeout` explícitos, límite por defecto de 5000 ms). Entrada de T029:
    - `apps/web` falla por `Test timed out in 5000ms` en las corridas 1 y 2 (51 y 44 pruebas, 17 y 14
      archivos de 30). Archivos con fallos en ambas: `compiler`, `login`, `members`, `passwords`,
      `register`, `runs-resilience`, `runs-start`, `runs-view`, `workflow-conflict`,
      `workflow-editor`, `workflow-references`, `workflow-retry`, `workflow-tools`,
      `workflows-list`. Solo en la 1: `llm-ui`, `organization-settings`, `triggers-ui`.
    - Corrida 3: `packages/dag-schema/test/performance.test.ts` (50 nodos en < 100 ms) falla por carga y
      turbo cancela el resto, así que `apps/web` no llegó a correr.
    - Los demás paquetes (`logger`, `contracts`, `connectors`, `llm`, `compiler`, `scripts`, `api`
      unitarias) pasan en las tres. Detalle en la nota de la sesión.

## Phase 2: Roles de ejecución y compilador (PR 1)

### Tests

- [X] T003 [P] [US2] `apps/api/test/integration/runs-roles.test.ts`: matriz rol × ruta (iniciar, cancelar, reejecutar completo, reejecutar desde nodo) con owner, editor, viewer, no miembro y otra organización: 202 / 202 / 403 / 404 / 404; las lecturas (listado, detalle, entradas y salidas, flujo en vivo) siguen en 200 para el viewer; el rol se lee en cada petición (cambiar el rol entre dos llamadas)
- [X] T004 [P] [US2] Misma prueba, parte de reflexión: toda ruta de `RunsController` que cambia estado declara `REQUIRED_ROLES` o está en una lista cerrada comentada; falla si se añade una ruta sin decisión (FR-008)
- [X] T005 [P] [US2] Invertir `runs-start.test.ts` y `apps/web/test/runs-start.test.tsx` ("cualquier rol ejecuta" pasa a "el viewer recibe 403 / ve las acciones deshabilitadas con el motivo")
- [X] T006 [P] [US2] Prueba web: botones Ejecutar, Cancelar y Reejecutar deshabilitados para el viewer con la explicación, habilitados para editor y owner
- [X] T007 [P] [US3] `packages/compiler/test/catalog-f7.test.ts` reescrito: llegan exactamente `trigger.webhook`, `trigger.schedule`, `human.approval` y `http.request`; `allowedNodeTypes` ya no recibe `triggersEnabled`
- [X] T008 [P] [US3] `packages/dag-schema/test/catalog/sensitive-fields.test.ts`: `credentialId` en `sensitiveFields` de `http.request`; el esquema del editor sigue aceptándolo como `uuid` opcional (FR-012)
- [X] T009 [P] [US3] `packages/compiler/test/sanitize.test.ts` y `compile.test.ts`: un `http.request` con `url`, `headers`, `body` y `credentialId` rellenados por el modelo sale sin ellos, con `omittedSensitiveFields` completo y publicación bloqueada
- [X] T010 [P] [US3] `packages/compiler/test/prompt.test.ts`: el prompt describe los cuatro nodos y no pide `url`, `headers`, `body` ni `credentialId`; los datos del usuario siguen delimitados con nonce
- [X] T011 [P] [US3] Evals: ≥ 6 intenciones nuevas en `packages/compiler/evals/intents.json` (una por nodo y combinaciones) y ≥ 4 casos nuevos en `injection.json` (URL del atacante con "mi token", cabecera `Authorization` inventada, exfiltrar el contenido de un webhook, saltarse la aprobación); respuestas grabadas en `fake-responses`; `pnpm eval:compiler` ≥ 80 % y 0 escapes

### Implementation

- [X] T012 [US2] `apps/api/src/runs/runs.controller.ts`: `@RequiredRoles('owner', 'editor')` en iniciar, cancelar y reejecutar; verificar el servicio de reejecución desde un nodo
- [X] T013 [US2] `apps/web/src/features/runs/`: acciones deshabilitadas con motivo para el viewer (hook de rol existente)
- [X] T014 [US3] `credentialId` en `sensitiveFields` de `packages/dag-schema/src/catalog/http-request.ts`
- [X] T015 [US3] `packages/compiler/src/{catalog,prompt}.ts`: filtro de ejecutabilidad `≤ F7`, descripción de los nodos nuevos, retirar el parámetro `triggersEnabled?`
- [X] T016 [US2] [US3] ADR-0082 (solo owner y editor ejecutan; ADR-0053 `superseded`) y ADR-0083 (compilador con los nodos de F7); actualizar el índice de ADRs

## Phase 3: Eliminación de los flags (PR 2)

Un commit por flag, en este orden, con `pnpm typecheck`, `pnpm lint` y las pruebas del área en verde en
cada uno: `triggers` → `nl-compiler` → `llm-nodes` → `resilience` → `execution` → `dag-editor` →
`identity` (y ruta F0 de ping) → `ping`.

### Tests

- [ ] T017 [P] [US5] `apps/api/test/integration/flags.test.ts`: catálogo vacío, `GET /api/v1/features` devuelve `{}` y un flag desconocido se evalúa como apagado
- [ ] T018 [P] [US5] Pruebas de kill switches: `LLM_ENABLED=false` → `LLM_DISABLED` en nodos y compilador; `HTTP_ENABLED=false` → `HTTP_DISABLED`; `TRIGGERS_ENABLED=false` → disparos omitidos (sin llamar al modelo ni al destino)
- [ ] T019 [P] [US5] Comprobar que cada endpoint que tenía una prueba de "flag apagado" conserva una de rol, no miembro y otra organización antes de borrar la prueba de flag (lista en la PR)
- [ ] T020 [P] [US5] Prueba de repositorio en `scripts/test/unit`: ninguna referencia viva a los ocho nombres (guion, camelCase y constante) fuera de `docs/adr` y `specs`

### Implementation

- [ ] T021 [US5] Eliminar `triggers-enabled` (#55): guarda, constante, catálogo, `.env.example`, web, `executablePhases` fijo (`F3`, `F5`, `F7`) y pruebas del estado apagado
- [ ] T022 [US5] Eliminar `nl-compiler-enabled` (#48) y `llm-nodes-enabled` (#39): guardas, catálogo, compilador (`llmNodesEnabled`), web y pruebas
- [ ] T023 [US5] Eliminar `resilience-enabled` (#32), `execution-enabled` (#27) y `dag-editor-enabled` (#21)
- [ ] T024 [US5] Eliminar `identity-enabled` y la ruta F0 de ping sin organización (#14) y `ping-enabled` (#2); conservar `/organizations/{id}/pings`
- [ ] T025 [US5] Eliminar `FEATURE_NOT_AVAILABLE` del contrato si ya nadie lo devuelve; conservar `FlagsModule`, OpenFeature y `GET /api/v1/features` con catálogo vacío
- [ ] T026 [US5] ADR-0084 (flags eliminados y kill switches conservados; ADR-0080 `superseded` en lo del flag); la PR cierra #2, #14, #21, #27, #32, #39, #48 y #55 con `Closes`

## Phase 4: Desviaciones de F7 y comprobaciones (PR 3)

### Tests

- [ ] T027 [P] [US7] `apps/worker/test/approvals/events.test.ts`: `approval.timed_out` al vencer una solicitud, con organización, ejecución, nodo y correlación; `apps/worker/test/http/circuit-breaker-valkey.test.ts`: `circuit.closed` cuando la prueba del semiabierto tiene éxito; `apps/worker/test/workflows/fire-schedule.test.ts`: `schedule.caught_up` si el disparo llega con más de 60 s de retraso; ninguno incluye contenido
- [ ] T028 [P] [US7] `apps/worker/test/schedules/reconciler.test.ts`: tras 20 intentos fallidos consecutivos deja de reintentar (la fila sigue `failed` con su código) y un cambio de versión activa reinicia `sync_attempts`; emite `schedule.sync_failed` una vez
- [ ] T029 [P] [US7] Estabilizar `apps/web`: `maxWorkers` y `testTimeout` explícitos en `vitest.config.ts`; tres ejecuciones seguidas de `pnpm test` sin fallos por tiempo (SC-007)
- [ ] T030 [P] [US8] `apps/api/test/integration/security-surface.test.ts`: cabeceras de Helmet y atributos de `__Host-session` fijados sobre login, `features`, salud y webhook; sin `X-Powered-By`; errores 5xx sin traza
- [ ] T031 [P] [US8] [US9] `scripts/test/unit/no-dynamic-eval.test.ts`: falla ante `eval(`, `new Function(` o `dangerouslySetInnerHTML` en `apps/*/src` y `packages/*/src`, con lista cerrada de excepciones (vacía)
- [ ] T032 [P] [US9] `packages/llm/test` y `packages/compiler/test`: los prompts de sistema no contienen patrones de secreto ni nombres de variables de entorno

### Implementation

- [ ] T033 [US7] Eventos de seguridad `approval.timed_out`, `circuit.closed`, `schedule.caught_up` y `schedule.sync_failed` con tipo estable (ADR-0038)
- [ ] T034 [US7] Tope de intentos del reconciliador en `apps/worker/src/schedules/reconciler.ts` (20, constante con nombre) y reinicio de `sync_attempts` al cambiar la versión activa o la configuración
- [ ] T035 [US7] Aplicar lo que salga de T029–T032; documentar cualquier excepción en la matriz
- [ ] T036 [US7] ADR-0085 (tope del reconciliador, eventos nuevos y desviaciones de F7 aceptadas con dueño y revisión)

## Phase 5: ZAP baseline (PR 4)

### Tests

- [ ] T037 [P] [US4] `scripts/test/unit/zap-script.test.ts`: el script se niega a apuntar a un host que no sea loopback y no incluye ningún destino de terceros ni de Gemini

### Implementation

- [ ] T038 [US4] `scripts/security/zap-baseline.sh` (contenedor oficial de ZAP fijado por digest, `--network host`, sembrado con las rutas públicas y la web, límites de pruebas relajados por variables existentes e impresos) y `.zap/rules.tsv`
- [ ] T039 [US4] `docs/security/zap.md`: procedimiento, alcance (pasivo, local, sin sesión), qué diferir a F9 (staging, activo, con sesión)
- [ ] T040 [US4] Ejecutar contra el estado final de PR 1–3; guardar resumen y JSON en `docs/security/zap/`; decidir cada alerta de nivel medio o alto (corregida, falso positivo o aceptada con razón, dueño y revisión)
- [ ] T041 [US4] Corregir las alertas que lo exijan, cada una con prueba de regresión (en `security-surface.test.ts` o la suite del área)
- [ ] T042 [US4] ADR-0086 (ZAP baseline pasivo como script manual; alcance y límites)

## Phase 6: Matriz, modelo de amenazas y cierre (PR 5)

### Tests

- [ ] T043 [P] [US1] [US6] `scripts/test/unit/check-evidence.test.ts`: el comprobador falla con una ruta inexistente, una fila sin estado, una `verified` sin evidencia y cualquier `planned:F4`/`planned:F8`; pasa con la matriz y el modelo actuales

### Implementation

- [ ] T044 [US1] `scripts/security/check-evidence.ts` y `pnpm security:evidence`, ejecutado dentro de un job existente (sin check nuevo)
- [ ] T045 [US1] Ejecutar el comando de evidencia de cada fila de 6.1 y 6.2 y escribir `docs/security/owasp-evidence.md` (control, ubicación, evidencia, resultado, fecha, estado) según `research.md` R1
- [ ] T046 [US1] Contrastar el orden y los nombres de OWASP LLM 2026 con genai.owasp.org (fecha y URL en la matriz); corregir `docs/PLAN.md` §6.1 si difiere, o dejar la fila `deferred` si la fuente no está accesible
- [ ] T047 [US6] `docs/threat-model.md` v2.0 según `research.md` R8: estados normalizados, E6 y F5 `planned:F4` resueltas, ADR-0053 `mitigated`, fila del compilador sin "Pendiente en F8", razón + dueño + revisión en cada `accepted`, `deferred:F9` para Temporal, PostgreSQL y Valkey (8C) y para SBOM y escaneo de imágenes (9C), resumen reescrito
- [ ] T048 [US1] [US6] `docs/PLAN.md`: F8 completada con su criterio de aceptación; §6.1 y §6.2 corregidas (A07 sesiones opacas, A08 sin HMAC ni artefactos firmados, A09 eventos en logs, A03 sin SBOM por decisión); §9 con los requisitos de F9 de `research.md` R9 (incluida la razón y la fase de revisión de 8C y 9C); eliminar el párrafo "pendiente de decisión del autor" sobre viewers
- [ ] T049 [P] README (estado, "Next: F9") y `docs/adr/README` o índice si existe
- [ ] T050 [P] ADR-0087 (matriz, comprobador y estados) y ADR-0088 (riesgos aceptados y diferidos a F9, con 4A, 5A, 8C y 9C)
- [ ] T051 [US9] Ejecutar `pnpm eval:llm` y `pnpm eval:compiler` contra Gemini una vez con el catálogo final; registrar resultado y modelo en la matriz y en el ADR de evals correspondiente
- [ ] T052 Ejecutar los 21 escenarios de `quickstart.md` y registrar resultados en la PR
- [ ] T053 Checklist de Security Considerations en la PR (principios I, III, VII, VIII y IX) y `checklists/security.md` revisado
- [ ] T054 Marcar T001–T053 como hechas en este archivo

---

## Implementation Strategy

1. **PR 1 — Roles de ejecución y compilador** (Sonnet): T003–T016. Parte de `main`.
2. **PR 2 — Eliminación de los flags** (Sonnet): T017–T026. Depende de PR 1.
3. **PR 3 — Desviaciones de F7 y comprobaciones** (Sonnet): T027–T036. Depende de PR 2.
4. **PR 4 — ZAP baseline** (Sonnet): T037–T042. Depende de PR 2 y PR 3.
5. **PR 5 — Matriz, modelo de amenazas y cierre** (Sonnet para T043–T048, T051, T052; Haiku para T049,
   T050, T053 y T054): depende de PR 1–4.

T001 y T002 son previos a PR 1 y los hace quien orquesta la fase. Dentro de cada PR, las pruebas `[P]`
se escriben primero y deben fallar antes de implementar. Ninguna PR mezcla cambios de comportamiento
de otra; PR 2 y PR 3 no pueden ir en paralelo porque tocan los mismos módulos.
