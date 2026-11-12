# Análisis de consistencia: Rediseño del frontend (F10)

**Fecha**: 2026-11-12 · **Artefactos**: `spec.md`, `plan.md`, `tasks.md` (más `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`) · **Herramienta**: `speckit-analyze`, guardado como archivo porque la tarea pide el
análisis en la PR. Los hallazgos marcados **resuelto** se corrigieron en los artefactos tras el análisis.

## Hallazgos

| ID  | Categoría      | Severidad | Ubicación                                  | Resumen                                                                                                                                                                                                                       | Estado / recomendación                                                                                                                                                                  |
| --- | -------------- | --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Constitución   | CRITICAL  | `spec.md` Clarificaciones, `plan.md` Check | El principio VIII dice que lo visible que llegue a `main` antes de estar completa la spec DEBE ir tras un flag apagado. La decisión del autor (sin flag + ADR-0102) lo **interpreta** («cada PR es completa») en vez de cumplirlo literalmente | **Abierto, decidido por el autor.** La spec lo justifica (Complexity Tracking, FR-032, ADR-0102). Estrictamente, la salida limpia es una enmienda PATCH de la constitución que exima los cambios solo de presentación; el autor eligió el ADR. Conviene confirmarlo antes de la PR 1 |
| I1  | Inconsistencia | MEDIUM    | `spec.md` (FR-031, SC-010), plan, tasks    | Decía «36 pruebas»: son 33 archivos `*.test.*` (los otros 3 de `apps/web/test/` son utilidades)                                                                                                                              | **Resuelto**: «33 archivos de prueba» en todos los artefactos                                                                                                                           |
| I2  | Inconsistencia | MEDIUM    | `plan.md` Technical Context                | Decía Vitest 4; el repositorio fija Vitest 5.0.5                                                                                                                                                                             | **Resuelto**                                                                                                                                                                            |
| I3  | Inconsistencia | MEDIUM    | `quickstart.md`                            | `pnpm exec tsx scripts/ui/contrast.ts`: `tsx` no es dependencia                                                                                                                                                              | **Resuelto**: `node scripts/ui/contrast.ts` (Node 24 ejecuta TypeScript); T011 crea el script y T004 lo prueba                                                                          |
| I4  | Inconsistencia | MEDIUM    | `spec.md` SC-007 y US4 vs contrato         | La spec habla de 7 estados; el contrato añade «Pendiente» (`StepStatus.pending`) → 8 glifos                                                                                                                                  | **Resuelto**: SC-007 dice «7 estados de diseño (más Pendiente)»; Assumptions lo explica; T019/T035 lo registran en `DESIGN.md`                                                           |
| I5  | Inconsistencia | LOW       | `spec.md` estado de partida                | «20 rutas»: son 20 archivos (19 pantallas más `__root.tsx`)                                                                                                                                                                 | **Resuelto**: se aclara en el estado de partida; el resto usa «20 rutas» como abreviatura de los archivos de ruta                                                                         |
| I6  | Inconsistencia | MEDIUM    | `plan.md`/`quickstart.md` vs `tasks.md`    | La lista de excepciones de la prueba estática se vaciaba «al final de la PR 3», pero el editor y la ejecución se migran en la PR 4                                                                                          | **Resuelto**: vacía al final de la PR 4 (T073) en plan y quickstart                                                                                                                     |
| U1  | Subespecificado| MEDIUM    | `spec.md` FR-028, SC-011                   | La lista de ejecuciones no trae pasos; la tira de servicio exigiría detalles por fila                                                                                                                                       | **Resuelto en el diseño**: research R15 y T068 fijan carga por fila visible con tope y condición de parada **[API]** si supera 20 solicitudes por pantalla                              |
| U2  | Subespecificado| MEDIUM    | `spec.md` FR-007 (movimiento)              | Ninguna tarea comprueba duraciones ni curva más allá de `prefers-reduced-motion`                                                                                                                                            | Aceptado: se cubre por tokens (T011), la prueba de reducción de movimiento (T023, T059) y la revisión manual (T081). No se añade prueba de duraciones                                    |
| U3  | Subespecificado| LOW       | `spec.md` FR-006 (anillo de foco)          | El foco doble se comprueba solo indirectamente (T054, T056, T080)                                                                                                                                                            | Aceptado; revisión manual en T080                                                                                                                                                       |
| A1  | Ambigüedad     | LOW       | `spec.md` FR-002 (`style=`)                | Las excepciones geométricas de `style` (anchos de barra, puertos) se asignan por CSSOM de React; no violan `style-src`, pero no se probó                                                                                    | Mitigado: T012–T022 y los pasos de producción lo comprueban con la consola; la lista de excepciones lleva razón                                                                         |
| T1  | Cobertura      | LOW       | `tasks.md` T049                            | El orden con PR 3 y PR 4 en paralelo puede dejar a T049 (retirar alias) sin sitio                                                                                                                                            | Ya cubierto: la nota de dependencias lo traslada a la PR 4 si van en paralelo                                                                                                           |
| D1  | Duplicación    | LOW       | `spec.md` FR-009 y SC-003                  | Mismo umbral expresado como requisito y como criterio                                                                                                                                                                      | Aceptado: SC es la medida, FR la obligación                                                                                                                                             |

## Cobertura de requisitos

| Requisito          | ¿Tareas? | Tareas                                        | Notas                                                                              |
| ------------------ | -------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| FR-001, FR-001b    | Sí       | T005, T011, T012, T019                        | Tokens, tema, script externo                                                       |
| FR-002             | Sí       | T026, T035, T049, T073                        | Prueba estática y vaciado de excepciones                                            |
| FR-003             | Sí       | T003, T010, T022                              | Fuentes, `assetsInlineLimit`, verificación en producción                            |
| FR-004             | Sí       | T011, T026, T038                              | Escala, 12 px, un `h1`                                                              |
| FR-005             | Sí       | T004, T011, T079                              | Script y prueba de contraste                                                        |
| FR-006, FR-007     | Parcial  | T011, T023, T080, T081                        | Ver U2 y U3                                                                         |
| FR-008, FR-011     | Sí       | T008, T014                                    | Shell, destinos, salto al contenido                                                 |
| FR-009             | Sí       | T001, T020, T051, T075, T079                  | Recorrido en navegador con informe                                                  |
| FR-010             | Sí       | T015, T026, T038                              | Anchos con nombre                                                                   |
| FR-012             | Sí       | T025, T029–T031, T075                         | Objetivos de 44 px                                                                  |
| FR-013             | Sí       | T013                                          | Marca y favicon                                                                     |
| FR-014 a FR-016    | Sí       | T006, T016                                    | Error, 503, chunk                                                                   |
| FR-017, FR-018     | Sí       | T007, T017, T034, T050                        | Esqueletos y precarga                                                               |
| FR-019             | Sí       | T034, T039, T041–T046                         | Vacíos                                                                              |
| FR-020 a FR-022    | Sí       | T023, T024, T027, T028                        | Estado y categoría                                                                  |
| FR-023             | Sí       | T038, T041–T048, T060–T072                    | Las 20 rutas                                                                        |
| FR-024             | Sí       | T009, T018, T047                              | «Crear cuenta»                                                                      |
| FR-025, FR-026     | Sí       | T025, T029–T033, T040                         | Formularios y Radix                                                                 |
| FR-027             | Sí       | T054–T057, T060–T067                          | Editor                                                                              |
| FR-028             | Sí       | T058, T059, T068–T071                         | Lista y detalle de ejecución                                                        |
| FR-029             | Sí       | T015                                          | Aviso de demo                                                                       |
| FR-030             | Sí       | T068 (condición de parada)                    | Sin API por defecto                                                                 |
| FR-031, FR-032     | Sí       | T020, T036, T051, T075, T085                  | Sin regresiones, PR coherentes                                                      |
| FR-033, FR-034     | Sí       | T002, T003, T083                              | ADR de dependencias; idioma por revisión                                            |
| SC-001 a SC-012    | Sí       | T001, T020, T074, T078–T081, T085             | SC-006 se mide en T017; SC-011 en T074; SC-012 en T009                              |

## Alineación con la constitución

- **VIII (flags)**: ver **C1**. Único punto abierto; decidido por el autor y documentado como interpretación con ADR.
- I, II, III, IV, V, VI, VII, IX: sin conflicto (CSP y cabeceras intactas, errores sin detalle interno, ADR para
  dependencias y decisiones, español en documentos e inglés en código).

## Tareas sin requisito

Ninguna sin vínculo: T001–T003 y T085 son preparación y verificación de FR-009, FR-033 y FR-031; T022, T037, T053,
T077 y T087 son merges del autor.

## Métricas

- Requisitos (FR + FR-001b): 35 · Criterios de éxito: 12 · Tareas: 87 (más 2 hechas en la especificación)
- Cobertura de requisitos con al menos una tarea: 100 % (2 con cobertura parcial aceptada: FR-006 y FR-007)
- Ambigüedades: 1 (A1) · Duplicaciones: 1 (D1) · **Críticos: 1 (C1, decisión del autor)**

## Siguientes pasos

- Confirmar con el autor C1 antes de abrir la PR 1: mantener el ADR-0102 o proponer una enmienda PATCH de la
  constitución (v1.1.1) que exima los cambios solo de presentación.
- Sin otros bloqueos: se puede pasar a implementar la PR 1 cuando el autor lo pida.
