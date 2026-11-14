---
description: 'Task list for F10 — Rediseño del frontend'
---

# Tasks: Rediseño del frontend (F10)

> **Escrita con las 4 decisiones del autor del 2026-11-12** (sin flag + ADR, selector de tema, editor móvil
> editable, símbolo SVG propio). Nada de esto se implementa en la tarea de especificación.

**Input**: `/specs/011-frontend-redesign/` (spec, plan, research, data-model sin cambio de esquema,
contracts/design-contract.md, quickstart)

**Tests**: incluidas. Cada prueba se escribe primero y DEBE fallar antes de implementar. No hay TDD
constitucional nuevo (la autorización no cambia); las pruebas fijan las reglas de la spec: mapas de estado y
categoría, backoff de 503, contraste, colores fijos, shell. Los 33 archivos de prueba existentes de `apps/web/test/` no se
borran ni se debilitan (FR-031); si un selector cambia, se conserva la intención y se explica en la PR.

**Feature flag**: ninguno (decisión del autor; ADR-0102). Cada PR deja la aplicación coherente y completa en
modo claro y oscuro (FR-032).

**Esquema y API**: sin cambios. Una tarea que necesitara un cambio de API se detiene, se marca **[API]** y se
pide aprobación del autor. Posible candidata ya identificada: resumen de pasos en la lista de ejecuciones
(research R15, T068).

**Producción**: cada merge a `main` se despliega solo en https://cognitive.devama.cloud (sin staging). Cada PR
adjunta capturas claro/oscuro a 375 y 1440 px (sin datos reales) y, tras el despliegue, comprueba la consola
(sin violaciones de CSP), la pestaña Red (solo el propio origen) y `check-headers.sh` en verde. El merge lo
hace el autor (o la sesión orquestadora cuando él lo pide).

**Modelo por PR**: ver [plan.md](./plan.md#prs-previstas).

## Format: `[ID] [P?] [Story] Description`

Historias: US1 shell y navegación, US2 error y carga, US3 tokens, tipografía y tema, US4 estado y categoría,
US5 listas, ajustes y acceso, US6 editor, US7 vista de ejecución, US8 accesibilidad y cierre. **(autor)** marca lo
que no puede hacer un agente.

---

## Phase 1: Tokens, fuentes, tema, shell y error/carga de ruta (PR 1 — Sonnet; revisión de diseño con Opus)

### Preparación

- [x] T001 Re-medir sobre `main` y versionar la línea base: auditoría de impeccable (`docs/ui/audit-baseline.md`),
      scroll horizontal por ruta a 375/768/1024/1440 (`docs/ui/widths-report.md`), recuento de colores fijos,
      `max-w-*`, textos `text-[10px]`/`text-[11px]`, 15 «Cargando…» y tamaño de JS inicial (SC-011)
- [x] T002 [P] Borradores de `docs/adr/0101-sistema-visual-linea-nocturna.md` y
      `docs/adr/0102-redisenio-sin-flag-por-incrementos-coherentes.md` (estado `proposed`; 0102 explica la lectura
      del principio VIII)
- [x] T003 Añadir `@fontsource-variable/atkinson-hyperlegible-next` y `@fontsource-variable/atkinson-hyperlegible-mono`
      a `apps/web/package.json` en versión exacta 5.3.0 (`pnpm add -E`); confirmar licencia OFL 1.1, tamaño de los WOFF2 de
      `latin` y `latin-ext` y que `pnpm audit` no falla; anotar en ADR-0101 (FR-033)

### Tests (escribir primero)

- [x] T004 [P] [US3] `scripts/test/unit/ui-contrast.test.ts`: parsea `apps/web/src/styles/tokens.css`, convierte
      OKLCH→sRGB y exige ≥ 4,5:1 (texto) y ≥ 3:1 (texto grande, glifos, bordes, foco) para los pares declarados de
      [contracts/design-contract.md](./contracts/design-contract.md) en claro y oscuro; falla si un par baja (FR-005, SC-004)
- [x] T005 [P] [US3] `apps/web/test/theme.test.ts`: `system` por defecto, aplica `data-theme` solo con claro/oscuro,
      escucha `prefers-color-scheme`, y con `localStorage` que lanza degrada a `system` sin errores (FR-001b)
- [x] T006 [P] [US2] `apps/web/test/route-states.test.tsx`: problema RFC 9457 muestra `detail` y `correlationId`
      copiable; 503 y fallo de red muestran «El servicio se está reiniciando» y reintentan con 1, 2 y 4 s (máx. 3)
      con temporizadores falsos; chunk ausente muestra «Hay una versión nueva» y **Recargar**; ruta inexistente;
      el texto «Something went wrong» no aparece nunca; el shell sigue presente; foco al `h1` del panel (FR-014 a FR-016)
- [x] T007 [P] [US2] `apps/web/test/route-pending.test.tsx`: el esqueleto aparece tras 150 ms y no antes, con
      `role="status"` y sin salto de maquetación (altura reservada) (FR-017)
- [x] T008 [P] [US1] `apps/web/test/shell.test.tsx`: cinco destinos en orden, destinos filtrados por rol, activo con
      `aria-current` y glifo relleno, «Saltar al contenido» primero en el orden de foco, un solo `main`, cabecera
      sin `whitespace-nowrap` (FR-008, FR-011)
- [x] T009 [P] [US5] Ampliar `apps/web/test/login.test.tsx` y `apps/web/test/guest-routes.test.tsx` (sin
      debilitarlas): el login y el inicio no contienen «Crear cuenta», el login dice «El acceso es por
      invitación» y tiene un solo `h1` (FR-024, SC-012)

### Implementation

- [x] T010 [US3] `apps/web/src/styles/fonts.css` con `@font-face` desde `@fontsource-variable` (`latin`,
      `latin-ext`, `font-display: swap`, ajuste de métricas de reserva) y `build.assetsInlineLimit: 0` en
      `apps/web/vite.config.ts` (los WOFF2 jamás como `data:`; research R3)
- [x] T011 [US3] `scripts/ui/contrast.ts` (función y CLI de contraste que usa T004) y `apps/web/src/styles/tokens.css` con los tokens de `DESIGN.md` (neutros, acción, 7 estados +
      «Pendiente», 6 categorías, escala tipográfica, radios, espaciado, sombras flotantes, anillo de foco,
      duraciones y curva) en oscuro y claro, `:root[data-theme]` y `color-scheme`; `apps/web/src/index.css` los
      importa, los expone con `@theme inline` (`page-narrow` 640, `page-default` 1120) y deja los alias
      `--background`/`--primary`/… apuntando a los tokens nuevos hasta T049 (research R1, R13)
- [x] T012 [P] [US3] `apps/web/src/lib/theme.ts` y `apps/web/public/theme-init.js` (script externo bloqueante en
      `<head>` de `apps/web/index.html`, sin script en línea) que aplican `data-theme` antes del primer render con
      try/catch (research R2)
- [x] T013 [P] [US1] `apps/web/src/components/shell/Logo.tsx` (anillo y cruz de registro, SVG propio) y
      `apps/web/public/favicon.svg`, legibles a 16 px en ambos modos (FR-013)
- [x] T014 [US1] `apps/web/src/components/shell/{AppShell,Header,NavRail,BottomBar,SkipLink,ThemeMenu}.tsx`:
      cabecera de 56 px, carril de 240 px (≥ 1024), de 72 px (768–1023) y barra inferior de 56 px (< 768) por
      utilidades responsive, `padding-bottom` y `env(safe-area-inset-bottom)`, selector de organización y menú de
      usuario con el selector de tema, controles de 44 px; sustituye a `features/session/AppHeader.tsx`
- [x] T015 [US1] `apps/web/src/components/route/Page.tsx` (`narrow`, `default`, `full`) y `staticData.width` en
      `apps/web/src/routes/__root.tsx`, sustituyendo a `fullWidth` en las 4 rutas que lo usan; `main` único y
      `DemoNotice` dentro del shell sin provocar desborde (FR-010, FR-029)
- [x] T016 [US2] `apps/web/src/components/route/{RouteError,RouteNotFound,RoutePending}.tsx` y la configuración de
      `createRouter` en `apps/web/src/main.tsx` (`defaultErrorComponent`, `defaultNotFoundComponent`,
      `defaultPendingComponent`, `defaultPendingMs: 150`, `defaultPreload: 'intent'`); backoff 1/2/4 s con
      `router.invalidate()`; respaldo mínimo si falla el propio layout raíz (research R5)
- [x] T017 [US2] Precarga y esqueleto de «Describir workflow»: `pendingComponent` con esqueleto del editor en la
      ruta del compilador y precarga al pasar o enfocar el enlace; medir antes y después (SC-006)
      (`apps/web/src/routes/orgs.$organizationId.workflows.new.tsx`)
- [x] T018 [US5] Quitar «Crear cuenta» de `apps/web/src/routes/index.tsx` y
      `apps/web/src/features/auth/LoginForm.tsx`; el login muestra «El acceso es por invitación» y su único `h1`
      (FR-024); `/register` y el flujo de invitación no cambian
- [x] T019 [US3] `DESIGN.md`: sustituir «ambos siguen `prefers-color-scheme`» por el selector de tres opciones y
      registrar «Pendiente» en la tabla de estados (clarificación 2026-11-12)
- [x] T020 [US8] Ejecutar `pnpm --filter @cognitive-dag/web typecheck test build`, `pnpm lint`, `pnpm format:check`
      y el recorrido de [quickstart.md](./quickstart.md) §2 y §3; confirmar 33 archivos de prueba previos verdes y 0 scroll
      horizontal en las 20 rutas; pasar ADR-0101 y 0102 a `accepted`
- [x] T021 [US8] Abrir la PR 1 con capturas claro/oscuro a 375 y 1440 px, mapa de principios de la constitución
      y la lista de decisiones de ADR; CI en verde
- [ ] T022 (autor) Merge de la PR 1 y comprobación en producción: consola sin violaciones de CSP, fuentes `.woff2`
      desde el propio origen, tema persistente sin parpadeo, `check-headers.sh` en verde

**Hito de PR 1:** shell, tema, fuentes, errores y cargas en producción; todas las rutas heredan el sistema.

---

## Phase 2: Componentes base (PR 2 — Sonnet)

### Tests (escribir primero)

- [x] T023 [P] [US4] `apps/web/test/status-badge.test.tsx`: los 8 estados (7 de diseño + Pendiente) y las clases de error
      tienen glifo, etiqueta en español y token; glifos distintos entre sí; «En curso» sin giro con
      `prefers-reduced-motion`; mapa completo desde `RunStatus`, `StepStatus` y `waitingReason` según el contrato (FR-020, FR-022)
- [x] T024 [P] [US4] `apps/web/test/node-category.test.ts`: recorre `NODE_CATALOG` de `packages/dag-schema` y exige
      categoría para cada tipo (los 11 actuales); pictograma y etiqueta presentes; falla ante un prefijo nuevo sin mapa (FR-021)
- [x] T025 [P] [US5] `apps/web/test/ui-controls.test.tsx`: botón de 44 px con una sola variante primaria por vista
      (helper de prueba), campos de 44 px, etiqueta visible, error con icono y texto, diálogo con foco atrapado,
      devuelto y cierre con Esc (FR-012, FR-025, FR-026)
- [x] T026 [P] [US3] `apps/web/test/design-static.test.ts`: recorre `apps/web/src` y falla ante paleta Tailwind,
      `#hex`, `rgb(`/`hsl(`, `border-l-*`/`border-r-*` > 1, `max-w-*` no permitidos en rutas y páginas,
      `text-[10px]`/`text-[11px]`, `style=`/`<style>` fuera de la lista de excepciones; usa
      `apps/web/test/design-static.allowlist.json` con los archivos que aún incumplen, que se vacía al final de la
      PR 4 (FR-002, SC-002)

### Implementation

- [x] T027 [P] [US4] `apps/web/src/components/status/{StatusBadge,statusGlyphs}.tsx`: píldora de 24 px con glifo SVG
      propio (arco, ✓, ✕, reloj de arena, ⊘, rayado 45°, ↺, círculo vacío), etiqueta y clase de error; insignia de 18 px
      reutilizable; sustituye a `features/runs/StatusBadge.tsx` y retira `STATUS_TONE` de `features/runs/status.ts`
      (conserva los textos de `RUN_STATUS_LABELS`, `STEP_STATUS_LABELS`, `ERROR_CLASS_LABELS`, `WAITING_REASON_LABELS`)
- [x] T028 [P] [US4] `apps/web/src/components/category/{categories.ts,CategoryIcon.tsx}` con el mapa tipo → categoría,
      pictogramas de Lucide importados uno a uno (`zap`, `git-branch`, `sparkles`, `globe`, `user-check`,
      `flask-conical`) y etiquetas en español
- [x] T029 [P] [US5] `apps/web/src/components/ui/button.tsx`: 44 px, radio 8, primario en tinta invertida,
      secundario, peligro con contorno, foco con anillo doble, deshabilitado al 45 % con `not-allowed`
- [x] T030 [P] [US5] `apps/web/src/components/ui/{input,textarea,native-select,password-input,label,form}.tsx`: 44 px,
      etiqueta visible, ayuda en body-sm, error con icono y texto, ≥ 16 px en móvil, `aria-describedby` actual
- [x] T031 [P] [US5] `apps/web/src/components/ui/{table,card}.tsx`: filas de 52 px, cabecera en Label, contención
      del desborde dentro de la tabla (sin scroll del documento), cifras tabulares, capas tonales
- [x] T032 [P] [US5] `apps/web/src/components/ui/{dialog,dropdown-menu}.tsx` y popover/select de Radix con tokens,
      sombra flotante, foco atrapado y devuelto, Esc cierra
- [x] T033 [P] [US5] `apps/web/src/components/ui/{alert,toast}.tsx` con los tokens de estado y glifo (nunca solo color)
- [x] T034 [P] [US2] `apps/web/src/components/ui/skeleton.tsx`, `EmptyState` y `PageHeader` (un `h1`, acción primaria
      única), con esqueleto estático bajo `prefers-reduced-motion`
- [x] T035 [US3] Activar `design-static.test.ts` con la lista de excepciones y retirar de ella cada archivo que
      esta PR deja limpio; actualizar `DESIGN.md` con «Pendiente»
- [x] T036 [US8] Typecheck, 33 archivos de prueba previos y nuevas, build, capturas claro/oscuro de cada componente (galería de
      pruebas no desplegada) y recorrido de anchos; abrir la PR 2 con CI en verde
- [ ] T037 (autor) Merge de la PR 2 y comprobación en producción (consola, red, `check-headers.sh`)

**Hito de PR 2:** componentes base con tokens y estado/categoría accesibles disponibles para las pantallas.

---

## Phase 3: Listas, ajustes y acceso (PR 3 — Sonnet; Haiku para la migración mecánica de formularios)

### Tests (escribir primero)

- [ ] T038 [P] [US5] `apps/web/test/page-structure.test.tsx`: cada ruta de `apps/web/src/routes/*` renderiza un solo
      `h1`, un solo `main`, el ancho con nombre que le corresponde y, en carga, el esqueleto con `role="status"`;
      el orden de encabezados no salta niveles (FR-010, FR-023, SC-008)
- [ ] T039 [P] [US5] `apps/web/test/empty-states.test.tsx`: Workflows, Ejecuciones, Aprobaciones, Conexiones y
      Miembros conservan su texto de vacío y añaden una acción dentro de `page-default` (FR-019)
- [ ] T040 [P] [US5] `apps/web/test/forms-a11y.test.tsx`: formularios de auth, cuenta y organización con etiqueta
      visible, campo de 44 px, error con icono, texto y `aria-describedby`; acciones destructivas con botón de
      peligro y diálogo (FR-025)

### Implementation

- [ ] T041 [P] [US5] Workflows (`features/workflows/WorkflowsPage.tsx` y rutas de lista): `PageHeader`, tabla/lista a
      375 px, esqueleto, vacío con acción, una sola acción primaria («Nuevo workflow» y «Describir workflow»
      coherentes con «una por vista»)
- [ ] T042 [P] [US5] Ejecuciones: unificar `features/runs/OrganizationRunsPage.tsx` y `features/runs/RunsPage.tsx` en un
      solo título y `page-default`, columna de estado primero con `StatusBadge`, duración tabular, «Cargar más» a
      44 px, esqueleto de filas de 52 px (la tira de servicio llega en T068)
- [ ] T043 [P] [US5] Aprobaciones (`features/approvals/ApprovalsPage.tsx`): estado «Esperando» con `StatusBadge` y
      categoría «Aprobación humana», esqueletos en lugar de los «Cargando…» (FR-020)
- [ ] T044 [P] [US5] Conexiones (`features/credentials`, `features/http-hosts`, `features/llm`): secciones en
      `page-default`, formularios con los campos base, `LlmUsageCard` sin `style` de ancho dinámico no justificado
- [ ] T045 [P] [US5] Miembros e invitaciones (`features/members`, `features/invitations`): tabla accesible a 375 px,
      roles con texto, aceptar invitación en `page-narrow` con panel de error si el enlace caducó
- [ ] T046 [P] [US5] Cuenta y organización (`features/account`, `features/organizations`): `page-narrow`/`page-default`,
      `OrganizationSwitcher` y `CreateOrganizationDialog` con Radix reestilizado
- [ ] T047 [P] [US5] Acceso (`features/auth/*`, `routes/{login,register,forgot-password,reset-password,verify-email}.tsx`):
      `page-narrow`, `Display` en el título, un `h1`, mensajes de error con icono; `/register` conserva su
      comportamiento (FR-024)
- [ ] T048 [P] [US5] Compilador «Describir workflow» sin el lienzo (`features/compiler/{CompilerPage,IntentForm,
    CompilationView,RecentCompilations,ApplyPanel}.tsx`): tokens, esqueletos, aviso de «nada se ejecuta sin
      publicar» visible, estados vacío/carga/error
- [ ] T049 [US3] Retirar los alias `--background`/`--primary`/… de `apps/web/src/index.css` y las clases antiguas;
      reducir la lista de excepciones de `design-static.allowlist.json` a los archivos del editor y de la
      ejecución (T054 a T073)
- [ ] T050 [US5] Sustituir todos los «Cargando…» sueltos fuera del editor y la ejecución por `RoutePending` o
      `Skeleton` con la forma final (FR-017)
- [ ] T051 [US8] Recorrido de anchos y modos de todas las rutas (quickstart §2), `docs/ui/widths-report.md`
      actualizado, 33 archivos de prueba previos verdes
- [ ] T052 [US8] Abrir la PR 3 con capturas claro/oscuro 375/1440 de cada pantalla; CI en verde
- [ ] T053 (autor) Merge de la PR 3 y comprobación en producción

**Hito de PR 3:** ninguna pantalla fuera del editor y la ejecución conserva el aspecto anterior.

---

## Phase 4: Editor y vista de ejecución con estaciones (PR 4 — Opus)

### Tests (escribir primero)

- [ ] T054 [P] [US6] `apps/web/test/station.test.tsx`: estación de 40 px (48 px seleccionada) con pictograma, nombre y
      tipo debajo de tamaño fijo ≥ 12 px, borde de 4 px con el token de su categoría, sin insignia en el editor, con
      anillo de foco doble, y descriptor accesible (categoría, nombre, problemas) (FR-027)
- [ ] T055 [P] [US6] `apps/web/test/station-edge.test.ts`: la geometría del camino solo usa 0°, 45° y 90° con esquina de
      12 px (entradas y salidas al mismo nivel, hacia arriba, hacia abajo y hacia atrás; respaldo a 90° sin
      espacio), color de la categoría del origen y etiquetas «sí»/«no» en las dos ramas de una condición
- [ ] T056 [P] [US6] `apps/web/test/editor-keyboard.test.tsx`: seleccionar, mover entre estaciones, abrir el panel,
      conectar (arrastre y modo «Conectar» por selección origen → destino) y eliminar solo con teclado, con foco
      visible y anuncio accesible (FR-027; WCAG 2.5.7)
- [ ] T057 [P] [US6] `apps/web/test/editor-mobile.test.tsx`: bajo 768 px la paleta y el panel de configuración se abren
      como hoja inferior, el botón «Añadir nodo» mide 44 px y el flujo crear → conectar → configurar → validar →
      publicar es posible (FR-027, US6.7)
- [ ] T058 [P] [US7] `apps/web/test/service-strip.test.tsx`: una estación por paso con su glifo de estado, contracción
      a «+N» con muchos pasos, espacio reservado mientras llega el detalle y actualización solo de la estación que
      cambia
- [ ] T059 [P] [US7] `apps/web/test/runs-recent-change.test.tsx`: la fila que cambia de estado queda resaltada hasta
      recibir el foco o 8 s, sin animación con `prefers-reduced-motion` (FR-028)

### Implementation — editor

- [ ] T060 [US6] `apps/web/src/components/station/Station.tsx`: reemplaza `features/workflows/DagNodeView.tsx`
      (estación circular, pictograma, rótulos fijos, insignia opcional de 18 px, selección a 48 px, puertos de 12 px
      con zona de 44 px y posición por los `handles` del catálogo sin romper `style` dinámico justificado)
- [ ] T061 [US6] `apps/web/src/components/station/StationEdge.tsx` y su registro como `edgeType` en `features/workflows/flow.ts`:
      camino ortogonal con diagonales a 45°, esquina de 12 px, 5 px, color de la categoría del origen, etiquetas
      «sí»/«no» con `EdgeLabelRenderer`; error en `state-failed` con glifo (research R9)
- [ ] T062 [US6] Rótulos de tamaño fijo con el zoom del lienzo (≥ 12 px) y prueba de humo con el zoom mínimo y máximo
- [ ] T063 [P] [US6] `features/workflows/Palette.tsx`: pictogramas, etiquetas, tokens y controles de 44 px; botón «Añadir
      nodo» y hoja inferior bajo 768 px
- [ ] T064 [P] [US6] `features/workflows/{ConfigForm,ProblemsList,ListEditors,ConditionBuilder,TemplateEditor,
    ReferenceSelect,RetrySection,VersionsPanel,PublishDialog}.tsx`: campos base, tokens, 0 colores fijos
- [ ] T065 [US6] `features/workflows/WorkflowEditor.tsx`: cabecera de página `page-full`, un `h1`, barra de acciones con
      una sola acción primaria, estados de conflicto/reintento con alertas de tokens, panel de configuración como hoja
      inferior en móvil, modo «Conectar», esqueleto del editor (el de T017 refinado)
- [ ] T066 [US6] Teclado del editor: foco por estación, mover con flechas, abrir panel, eliminar con confirmación,
      anuncios con región `aria-live`; conservar los `aria-label` existentes
- [ ] T067 [US6] `features/compiler/ResultPreview.tsx`: el borrador usa `Station` y `StationEdge` (solo lectura)

### Implementation — ejecución

- [ ] T068 [US7] `apps/web/src/components/station/ServiceStrip.tsx` y su uso en la lista de ejecuciones: carga el detalle
      por fila visible con `IntersectionObserver` (máx. 8 simultáneas, `staleTime` infinito en finales, 30 s
      en vivas); mide solicitudes por pantalla. **Si pasa de 20 por pantalla o empeora SC-011, detener y proponer el
      resumen de pasos en la lista como cambio [API] (research R15)**
- [ ] T069 [US7] `features/runs/RunGraph.tsx` y `RunDetailPage.tsx`: estaciones con insignia de estado de 18 px, aristas por
      categoría, actualización en su sitio desde `useRunLive`, `page-full`, un `h1`
- [ ] T070 [P] [US7] `features/runs/StepPanel.tsx`: `StatusBadge`, clase de error en texto, intentos, entradas y salidas en mono;
      acciones (reintentar, reejecutar, recuperar) con botones base; permisos sin cambios (`runs-roles`)
- [ ] T071 [US7] Hook `useRecentChange` y resaltado de 8 s en `OrganizationRunsPage`/`RunsPage`; cifras tabulares
- [ ] T072 [P] [US7] `features/runs/{RunDialog,RunButton}.tsx` y `RunDetailPage` con alertas y diálogos reestilizados
- [ ] T073 [US6] Vaciar `design-static.allowlist.json` (0 excepciones) y confirmar `design-static.test.ts` verde (SC-002)

### Cierre de la PR

- [x] T074 [US6] Medir `workflow-editor-performance` y el JS inicial antes/después; dentro de +10 % y +15 % (SC-011);
      documentar en la PR (JS inicial +0,04 %; apertura en caliente +31 % en navegador real, **desviación aceptada
      por el autor**, `docs/ui/editor-performance.md`)
- [ ] T075 [US8] Recorrido de anchos (editor y ejecución a 375 px con dedo emulado), modos claro/oscuro, escala de
      grises de estaciones y estados; 33 archivos de prueba previos (incluidas `workflow-editor*`, `runs-*`) sin debilitarlas
- [ ] T076 [US8] Abrir la PR 4 con capturas del editor y de la ejecución en claro/oscuro a 375 y 1440 px; CI en verde
- [ ] T077 (autor) Merge de la PR 4 y comprobación en producción, incluida una ejecución real en vivo

**Hito de PR 4:** el plano de estaciones en producción, en el editor y en la ejecución.

---

## Phase 5: Cierre (PR 5 — Sonnet; Haiku para PLAN, README, ADR y `tasks.md`)

- [ ] T078 [US8] Auditoría final de impeccable sobre producción; ≥ 16/20, 0 P0 y 0 P1; informe en
      `docs/ui/audit-final.md` con comparación contra `audit-baseline.md` (SC-001). Cualquier hallazgo restante
      se corrige en esta PR o se abre un issue con dueño y fecha
- [ ] T079 [P] [US8] Informe de contraste final (`docs/ui/contrast-report.md`) desde `scripts/ui` / `ui-contrast.test.ts`
      y recorrido final de anchos (`docs/ui/widths-report.md`) en las 20 rutas × 4 anchos × 2 modos + 200 % de zoom
      (SC-003, SC-004)
- [ ] T080 [P] [US8] Revisión manual con teclado y lector de pantalla de login, Workflows, editor, Ejecuciones,
      detalle de ejecución, Aprobaciones, Conexiones, Miembros y Cuenta; criterios WCAG 2.2 AA de la spec (US8.2);
      sin incumplimientos abiertos sin decisión escrita
- [ ] T081 [P] [US8] Revisión de `forced-colors`, `prefers-reduced-motion`, zoom al 200 %, almacenamiento bloqueado y
      fuente que no carga (casos límite de la spec)
- [ ] T082 [US8] Re-ejecutar `/impeccable document` para que `DESIGN.md` (y su sidecar) refleje los valores reales
- [ ] T083 [P] [US8] `docs/adr/0103-cierre-de-f10-redisenio-del-frontend.md`: resultados, excepciones aceptadas con dueño y
      revisión; ADR-0101 y 0102 en `accepted`
- [ ] T084 [P] [US8] `README.md` y `docs/PLAN.md`: F10 = Rediseño del frontend (completada), F11 = Integraciones (sin tocar
      ADR históricos); marcar esta lista con el estado real de cada tarea
- [ ] T085 [US8] Confirmar que ningún archivo bajo `docs/` ni capturas incluyen datos reales ni secretos
      (gitleaks en CI) y que `deploy/ops/check-headers.sh` y la CSP no cambiaron en toda la fase
- [ ] T086 [US8] Abrir la PR 5 con los informes y los 6 checks en verde
- [ ] T087 (autor) Merge de la PR 5 y confirmación final en producción

**Hito de PR 5:** F10 cerrada con evidencia; el trabajo sigue en F11 (Integraciones).

---

## Hecho en la tarea de especificación

- [x] S01 `docs/PLAN.md`: F10 pasa a «Rediseño del frontend» y la antigua F10 «Integraciones» pasa a F11; `README.md`
      sigue el mismo criterio; los ADR históricos no se tocan
- [x] S02 `spec.md`, clarificaciones, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` y
      `tasks.md` escritos; análisis de consistencia en `checklists/analysis.md`

---

## Dependencies & Execution Order

- PR 1 → PR 2 → PR 3 y PR 4 → PR 5. PR 3 y PR 4 pueden ir en paralelo si tocan archivos distintos: PR 3 toca
  `routes/*` y `features/*` salvo `features/workflows/*`, `features/runs/*` y `features/compiler/ResultPreview.tsx`
  (PR 4). T049 (retirar alias) va después de que ambas hayan dejado de usarlos solo si se hace en la PR que
  termine última; si van en paralelo, T049 se traslada a la PR 4.
- Dentro de cada PR, las pruebas (T004–T009, T023–T026, T038–T040, T054–T059) van antes que su implementación.
- T014 (shell) depende de T011 y T012; T016 (errores) depende de T014; T017 depende de T016; T068 depende de T027
  y T060; T069 depende de T060 y T061; T073 es lo último de la PR 4.
- Cada PR espera CI en verde y el merge del autor; la siguiente PR parte de `main` ya desplegado.

### Oportunidades de paralelismo

- PR 1: T002, T004–T009, T012, T013 en paralelo.
- PR 2: T023–T026 y T027–T034 en paralelo (archivos distintos).
- PR 3: T041–T048 en paralelo (una pantalla por tarea).
- PR 4: T054–T059 en paralelo; T063, T064, T070, T072 en paralelo tras T060/T061.
- PR 5: T079–T081, T083 y T084 en paralelo.

## Implementation Strategy

1. **MVP = PR 1** (historias US1, US2 y US3): quita el P0 y los P1 de shell, desborde, error, pantalla en blanco
   y «Crear cuenta», y deja la base de tokens y fuentes. Desplegable por sí sola.
2. PR 2 aporta estado/categoría accesibles (US4) y los componentes; PR 3 los aplica a las pantallas (US5);
   PR 4 aplica el gesto firma (US6 y US7); PR 5 demuestra el resultado (US8).
3. Sin staging: cada PR se prueba en claro y oscuro a 375 y 1440 px antes de abrirse, y se comprueba en
   producción tras el merge; la reversa automática de F9 es la defensa final.
4. Si el cambio de API se hace imprescindible (T068), la tarea se detiene y el autor decide.
