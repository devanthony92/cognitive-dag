# Research: Rediseño del frontend (F10)

Cada decisión técnica del plan con su razón y las alternativas. Las decisiones de producto y de diseño ya
están tomadas en [DESIGN.md](../../DESIGN.md) y en las clarificaciones de la spec; aquí solo se decide el
**cómo**.

## R1. Tokens: variables CSS semánticas con puente a Tailwind 4

- **Decisión**: `src/styles/tokens.css` define las variables de `DESIGN.md` (`--ground`, `--surface`,
  `--raised`, `--line`, `--ink`, `--ink-muted`, `--action`, `--on-action`, `--state-*`, `--node-*`) con valores
  `oklch` por modo, y `@theme inline` las expone como utilidades (`bg-surface`, `text-state-failed`…). Los
  nombres shadcn actuales (`--background`, `--primary`…) se mantienen como alias durante la PR 1 para no romper
  componentes y se eliminan al final de la PR 3.
- **Razón**: Tailwind 4 ya lee `@theme`; se conservan los tokens `oklch` del proyecto (la auditoría lo pide) y
  se evita tocar 85 componentes de una vez.
- **Alternativas**: Tailwind plugin/JS config (obsoleto en v4); CSS-in-JS (rompe la CSP si inyecta `<style>`).

## R2. Selección de tema sin script en línea

- **Decisión**: la preferencia (`system|light|dark`) vive en `localStorage` bajo una clave fija; un script
  externo `public/theme-init.js`, cargado sin `defer` en `<head>`, lee la clave y pone `data-theme` en
  `<html>` antes del primer render (si falla, no pone nada). `tokens.css` usa `:root` (oscuro por defecto del
  sistema vía `@media (prefers-color-scheme)`) y `:root[data-theme='light'|'dark']` para forzar. `lib/theme.ts`
  gestiona el cambio en caliente y escucha `matchMedia`.
- **Razón**: `script-src 'self'` permite un archivo del propio origen; un script bloqueante de pocas líneas
  evita el parpadeo. `check-headers.sh` no cambia.
- **Alternativas**: script en línea con hash (cambiaría la CSP, necesitaría ADR de cabeceras; descartado);
  aplicar el tema en `main.tsx` (parpadeo del tema equivocado); cookie (viaja a la API sin motivo).
- **Detalle**: `color-scheme` se fija en `:root[data-theme]` para los controles nativos. Con `forced-colors`,
  se confía en los colores del sistema.

## R3. Fuentes autoalojadas bajo `font-src 'self'`

- **Decisión**: `@fontsource-variable/atkinson-hyperlegible-next` y `…-mono` (5.3.0, OFL 1.1, verificado en el
  registro de npm el 2026-11-12) importados en `fonts.css` solo con los subconjuntos `latin` y `latin-ext`
  (español) y `font-display: swap`. Vite emite los WOFF2 con hash a `assets/`. **`build.assetsInlineLimit: 0`**
  es obligatorio: por defecto Vite inlinea activos de < 4 KiB como `data:` y `font-src 'self'` los bloquearía.
  `size-adjust`/`ascent-override` de la fuente de reserva para evitar salto de maquetación.
- **Razón**: no se copian binarios al repositorio, hay licencia clara y la CSP no se toca. Peso estimado
  < 150 KiB WOFF2 para ambas (se mide en PR 1 y se anota en el ADR).
- **Alternativas**: Google Fonts (viola `font-src`/COEP); copiar WOFF2 a `public/` (binarios en el repo, sin
  actualizaciones); fuente de sistema (descarta la identidad).
- **COEP**: `require-corp` exige que los recursos del mismo origen no necesiten `crossorigin`; las fuentes del
  bundle son del mismo origen, sin problema. Se verifica en la PR 1 con una carga real tras el despliegue.

## R4. Shell y layout responsive

- **Decisión**: un `AppShell` en `__root.tsx` con la cuadrícula `header / (rail | main)` y la barra inferior
  condicionada por contenedor/viewport mediante utilidades responsive (`md`, `lg`), no por JS. Anchos de página
  por un componente `Page` con la prop `width: 'narrow' | 'default' | 'full'` que mapea a clases de token
  (`max-w-page-narrow`, `…-default`); el `staticData.fullWidth` actual se sustituye por `staticData.width`.
  El selector de organización y el menú de usuario (con el tema) se vuelven un menú Radix y se colapsan en
  móvil. La barra inferior reserva `padding-bottom` en `main` y respeta `env(safe-area-inset-bottom)`.
- **Razón**: sin JS no hay parpadeo de layout ni dependencia de medidas; los tres anchos del diseño se
  codifican una vez. El desborde de 1043 px viene de `whitespace-nowrap` en `AppHeader`; se elimina.
- **Alternativas**: media queries por componente (dispersión); librería de layout (VII).

## R5. Error, 503 y carga de ruta con TanStack Router

- **Decisión**: `createRouter({ defaultErrorComponent: RouteError, defaultNotFoundComponent: RouteNotFound,
  defaultPendingComponent: RoutePending, defaultPendingMs: 150, defaultPendingMinMs: 300, defaultPreload:
  'intent' })`. `RouteError` distingue (a) problema RFC 9457 (muestra `detail` y `correlationId`), (b)
  503/red (`TypeError` de `fetch` o estado 503) → «El servicio se está reiniciando» con reintento automático
  usando `router.invalidate()` y retroceso 1 s/2 s/4 s (máx. 3) antes del panel con **Reintentar**, (c) error
  de importación de chunk (`Failed to fetch dynamically imported module`) → «Hay una versión nueva» con
  recarga, (d) resto → texto llano genérico con id si existe. El panel vive dentro del shell porque el
  componente de error de ruta se renderiza en el `Outlet` del layout raíz; el error del propio layout raíz
  tiene un respaldo mínimo con cabecera propia. `getByRole('alert')` y foco al `h1` del panel.
- **Razón**: usa los ganchos nativos del router; el pendiente de 150 ms coincide con el diseño; el backoff
  se prueba con temporizadores falsos.
- **Alternativas**: error boundary propio en cada ruta (repetición); capturar en `request()` (mezcla red y
  presentación). Para consultas de TanStack Query el reintento ya existente se conserva; el panel de ruta solo
  cubre cargadores y componentes.
- **Pendiente de precisión en la PR 1**: confirmar el comportamiento exacto de `defaultPendingMs` y de la
  precarga `intent` con la versión fijada (1.170.46) y anotarlo en el ADR.

## R6. «Describir workflow» sin pantalla en blanco

- **Decisión**: el chunk del compilador/editor se precarga con `defaultPreload: 'intent'` (hover/focus del
  enlace) y la ruta declara `pendingComponent` con el esqueleto del editor (cabecera, paleta, lienzo con
  estaciones fantasma), de modo que el primer pintado ocurre antes de que lleguen los datos. Se mide antes y
  después (SC-006) con el recorrido en navegador.
- **Razón**: la pantalla en blanco es la carga del chunk de `@xyflow/react`; la precarga la anticipa y el
  esqueleto cubre el resto.
- **Alternativas**: sacar `xyflow` del chunk común (cambia el reparto de chunks y empeora la primera carga).

## R7. Verificación sin dependencias nuevas

- **Decisión**: (a) `scripts/ui/contrast.ts` parsea `tokens.css`, convierte OKLCH→sRGB y calcula la razón de
  contraste de una lista declarada de pares (texto/fondo, glifo/fondo, borde/fondo, foco/fondo) en ambos modos;
  falla bajo 4,5 / 3. (b) Prueba Vitest estática que recorre `apps/web/src` y falla ante la paleta Tailwind,
  `#hex`, `rgb(`/`hsl(`, `border-l-`/`border-r-` > 1, `max-w-*` no permitidos en rutas, y `style=` fuera de una
  lista corta de excepciones geométricas (anchos de barra, posición de puertos) que usan propiedades CSSOM
  vía React (no violan `style-src` porque React las asigna con `element.style`, no con atributo HTML; se
  comprueba en producción en la PR 1). (c) Anchos y desbordes en navegador real con las herramientas de
  navegador del propio agente, informe versionado. (d) Revisión manual de teclado y lector de pantalla en
  la PR 5.
- **Razón**: la constitución prefiere pocas dependencias y la CI no tiene navegador; el contraste es
  determinista.
- **Alternativas**: `vitest-axe`/axe-core (jsdom no calcula contraste ni layout; cubre ARIA, que ya se prueba
  con Testing Library); Playwright en CI (nueva dependencia pesada y tiempo de CI). Se reevalúa solo si la
  auditoría final deja hallazgos que lo justifiquen.

## R8. Pictogramas y marca

- **Decisión**: Lucide (ya instalado) con los equivalentes indicados en `DESIGN.md`: `zap`, `git-branch`,
  `sparkles`, `globe`, `user-check`, `flask-conical`, importados de forma individual (sin barrel) y con
  `strokeWidth={2}`; los glifos de estado (✓, ✕, arco, reloj de arena, ⊘, rayado, ↺) son SVG propios pequeños
  en `statusGlyphs.tsx` porque el rayado a 45° y el contorno discontinuo no existen en Lucide. La marca
  (anillo + cruz de registro) es un SVG propio en `Logo.tsx` y `public/favicon.svg` (`img-src 'self' data:`
  lo permite).
- **Razón**: cero dependencias nuevas y consistencia de trazo; los SVG propios caben en la CSP.
- **Alternativas**: sprite SVG propio completo (más trabajo sin beneficio); iconos de otra librería.

## R9. Estación y arista de línea en xyflow

- **Decisión**: `DagNodeView` pasa a `Station`: círculo de 40/48 px con borde de 4 px (token de categoría),
  pictograma de 24 px y rótulos fuera del círculo con tamaño fijo (`ViewportPortal`/CSS sin escalar con el
  zoom: se contra-escalan con `useStore` solo si el zoom < 1 los baja de 12 px, o se renderizan como nodo
  hijo de tamaño fijo; se decide con una prueba de humo en la PR 4). `StationEdge` es un `edgeType` propio que
  calcula un camino ortogonal con diagonales a 45° (segmentos horizontal–diagonal–horizontal o
  vertical–diagonal–vertical) con esquinas redondeadas de radio 12 y color de la categoría del nodo de origen;
  las etiquetas «sí»/«no» van en `EdgeLabelRenderer`. Los puertos son `Handle` de 12 px con un pseudo-elemento
  de 44 px de zona de impacto.
- **Razón**: `smoothstep` de xyflow solo hace 90°; el resto del comportamiento (arrastrar, conectar,
  seleccionar) se conserva. La `useFlowNodes` con caché de `flow.ts` se mantiene para no empeorar
  `workflow-editor-performance`.
- **Alternativas**: dibujar el plano fuera de xyflow (pierde interacción y pruebas); `step` edge (sin
  diagonales).
- **Riesgo**: la geometría 45° con puertos a distintas alturas y ciclos visuales; se acota con una prueba de
  caminos (entradas/salidas, mismo nivel, hacia atrás) y se documenta el comportamiento de respaldo (línea a
  90° si no hay espacio para la diagonal).

## R10. Editor en móvil

- **Decisión**: bajo 768 px la paleta y el panel de configuración pasan a **hoja inferior** (Radix Dialog como
  `sheet` con `modal=false` para no bloquear el lienzo, o Dialog modal para configuración) y la paleta se abre
  con un botón «Añadir nodo» de 44 px; `xyflow` ya soporta pan/zoom táctil (`panOnScroll`, `zoomOnPinch`); los
  puertos de 44 px se usan para conectar con el dedo y existe un modo «Conectar» por teclado/botón de
  respaldo (seleccionar origen → seleccionar destino) para quien no pueda arrastrar con precisión.
- **Razón**: el autor pidió el editor editable a 375 px; el respaldo de conectar sin arrastrar mejora además la
  accesibilidad (WCAG 2.5.7, movimientos de arrastre).
- **Alternativas**: solo lectura en móvil (descartada por el autor).

## R11. Estado en vivo y resaltado de 8 s

- **Decisión**: `useRunLive` ya emite cambios por paso; un hook `useRecentChange` marca la fila 8 s o hasta
  que recibe el foco (`onFocus`), y respeta `prefers-reduced-motion` (el resaltado es un fondo, no animación).
  `RunGraph` actualiza solo los nodos afectados (la memoización de `flow.ts` ya lo permite).
- **Razón**: sin cambios de API ni de eventos; reutiliza lo existente.

## R12. Verificación de CSP y COEP en cada PR

- **Decisión**: tras cada despliegue corre `check-headers.sh` (ya existente); cada PR incluye en su descripción
  la comprobación manual en producción: consola sin violaciones, pestaña Red sin orígenes ajenos, fuentes
  servidas con `200` desde el propio origen. Si el selector de tema o las fuentes exigieran tocar la CSP,
  la PR se detiene y se abre un ADR de cabeceras (no se prevé).
- **Razón**: sin staging, la producción es el único entorno con las cabeceras reales; la reversa automática
  de F9 cubre un fallo grave.

## R13. Orden y despliegue seguro sin staging

- **Decisión**: cada PR es completa: en la PR 1 los componentes antiguos siguen funcionando porque los alias
  `--background`/`--primary` apuntan a los tokens nuevos; en la PR 2 los componentes base se reestilizan en
  su sitio (mismos nombres y props, para que las 36 pruebas sigan verdes); en la PR 3 y 4 se migran pantallas;
  las clases antiguas se retiran en la PR 3. Nunca queda un modo ilegible: cada PR se prueba en claro y oscuro.
- **Razón**: FR-032 y la decisión de «sin flag».
- **Riesgo**: una regresión visual llega a producción; se mitiga con capturas claro/oscuro 375/1440 por PR y
  revisión del autor antes del merge (la sesión orquestadora mergea solo cuando el usuario lo pide).

## R14. Línea base y re-medición

- **Decisión**: la primera tarea de la PR 1 re-ejecuta la auditoría de impeccable y las mediciones de anchos y
  de colores fijos sobre `main` y las versiona en `docs/ui/audit-baseline.md`; SC-001/002/003 se comparan
  contra esa línea base y no solo contra las cifras de la spec.
- **Razón**: las cifras de partida se leyeron en fa0595a y el código puede moverse antes de empezar.

## R15. Sin cambios de API: dónde podría hacer falta

Hallazgos leídos en `packages/contracts/src/runs.ts` (main fa0595a):

- **La lista de ejecuciones no trae pasos.** `RunListSchema`/`OrganizationRunListSchema` devuelven `Run` (más
  `workflowName` y `failedNodeId`); los pasos solo vienen en `RunDetailSchema` y en el `snapshot` del flujo en
  vivo. La «tira de servicio» de la lista (FR-028) no puede pintarse con la lista sola.
  - **Decisión**: la tira se carga por fila visible bajo demanda (consulta de detalle con TanStack Query,
    `IntersectionObserver`, tope de 8 solicitudes simultáneas, caché de 30 s, y para ejecuciones finales
    `staleTime` infinito). Mientras llega, la fila reserva el espacio con una tira fantasma (sin salto). Es
    una mejora de presentación sin API nueva. Si la medición de la PR 4 muestra que el coste es inaceptable
    (más de 20 solicitudes de detalle por pantalla de lista o regresión de SC-011), la tarea se detiene y se
    propone un resumen de pasos en la lista marcado **[API]** para aprobación del autor; no se implementa
    sin ella.
- **Estados.** `RunStatus` tiene 6 valores (`queued`, `running`, `succeeded`, `failed`, `cancelled`,
  `timed_out`) y `StepStatus` 7 (`pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`,
  `reused`); «Esperando» no es un estado sino `waitingReason` de un paso en curso (`rate_limited`,
  `approval`, `circuit_open`). `DESIGN.md` define 7 estados de servicio; el mapa de
  [contracts/design-contract.md](./contracts/design-contract.md) los reconcilia sin tocar la API
  (`queued` → «En cola» con el glifo de espera, `timed_out` → «Vencida» con glifo de fallo y clase de
  tiempo, `pending` → «Pendiente» con un glifo propio que se añade a `DESIGN.md` en la PR 2).
- **Clases de error.** El contrato tiene 6 (`transient`, `rate_limited`, `timeout`, `permanent`,
  `invalid_output`, `budget_exhausted`), no 4: la UI conserva las 6 etiquetas existentes de
  `ERROR_CLASS_LABELS`. La spec dice «transitorio, límite, tiempo, permanente» como ejemplo; los otros dos
  se muestran igual.
- **Rol.** El rol de la persona ya está en el cliente (`organization.role`); el carril oculta destinos
  según él sin API nueva. Un contador de aprobaciones pendientes en el carril requeriría datos que no se
  piden hoy: queda fuera (sería **[API]**).
- **Tipos de nodo.** El catálogo de `packages/dag-schema/src/catalog` tiene 11 tipos (`trigger.manual`,
  `trigger.schedule`, `trigger.webhook`, `logic.condition`, `logic.merge`, `llm.classify`, `llm.extract`,
  `llm.generate`, `http.request`, `human.approval`, `mock.service`) agrupados por prefijo en las 6
  categorías; una prueba exige que todo tipo del catálogo tenga categoría.
