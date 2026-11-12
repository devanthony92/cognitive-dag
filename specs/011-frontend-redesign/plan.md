# Implementation Plan: Rediseño del frontend (F10)

**Branch**: `011-frontend-redesign` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

> Escrito con las 4 decisiones del autor del 2026-11-12 (sin flag + ADR, selector de tema, editor móvil
> editable, símbolo SVG propio). Nada de esto se implementa en la tarea de especificación.

## Summary

F10 rehace la capa visual y de UX de `apps/web` según [DESIGN.md](../../DESIGN.md) sin tocar API, esquema,
worker ni despliegue. Se entrega en **5 PR pequeñas, cada una desplegable y coherente por sí sola** (cada merge
a `main` llega a producción sin staging): (1) tokens, fuentes, tema, shell y límites de error/carga de ruta;
(2) componentes base (botón, campos, tabla, diálogos, estado, categoría, esqueletos); (3) listas, ajustes y
acceso; (4) editor y vista de ejecución con estaciones; (5) cierre con la nueva auditoría de impeccable y la
verificación AA. La base técnica es una capa de tokens semánticos en CSS (Tailwind 4 `@theme`), fuentes WOFF2
empaquetadas por Vite con `assetsInlineLimit: 0` para que `font-src 'self'` no se viole, un script de tema
externo (la CSP prohíbe los inline) y componentes de forma propios (estación, arista de línea, insignia).
Decisiones en [research.md](./research.md); entidades en [data-model.md](./data-model.md); contratos de interfaz
en [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 6 sobre React 19.3, Vite 8, Tailwind 4.3 (`@theme`), Radix (`radix-ui`
1.8), TanStack Router 1.170 / Query 5, `@xyflow/react` 12.12, `lucide-react` 1.62. Vitest 5 + Testing Library
(jsdom).

**Primary Dependencies**: las existentes. **Nuevas (ADR, versión exacta, OFL 1.1)**:
`@fontsource-variable/atkinson-hyperlegible-next` y `@fontsource-variable/atkinson-hyperlegible-mono`
(5.3.0), solo para empaquetar los WOFF2 desde `'self'`. Ninguna otra: el contraste y los colores fijos se
verifican con scripts propios sin dependencias; axe-core no se añade (decisión por defecto, ver R7).

**Storage**: ninguno nuevo en servidor. En el navegador, `localStorage` solo para la preferencia de tema,
envuelto en try/catch (degrada a «Sistema»).

**Testing**: pruebas de componente por variante (estado, categoría, estación, shell, panel de error), pruebas
de ruta con errores forzados (500, 503, red, chunk), prueba estática de colores fijos y `style=` en
`apps/web/src`, script de contraste sobre los tokens (cálculo OKLCH → sRGB, WCAG 2.x), recorrido en
navegador real (no en CI, que no tiene navegador) a 375/768/1024/1440 (+ 200 % de zoom) midiendo
`scrollWidth`, con informe versionado en `docs/ui/widths-report.md`, y los 33 archivos de prueba existentes sin
debilitarlas. TDD solo donde la constitución lo exige (autorización, sin cambios aquí); en esta fase las
pruebas se escriben antes en los componentes de reglas (mapa tipo→categoría, mapa estado→glifo, backoff 503).

**Target Platform**: navegadores modernos de escritorio y móvil (Chrome/Edge/Firefox/Safari recientes);
Debian/Caddy en producción sin cambios.

**Performance Goals**: `workflow-editor-performance` dentro de +10 % de `main`; JavaScript inicial ≤ +15 %
(SC-011); esqueleto de «Describir workflow» ≤ 200 ms tras clic con código precargado (SC-006); sin salto de
maquetación (CLS ≈ 0) al sustituir esqueleto por contenido.

**Constraints**: CSP `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src
'self' data:`, COEP `require-corp`, COOP/CORP `same-origin` intactos; `check-headers.sh` en verde tras cada
despliegue; sin `<style>` ni atributos `style` en HTML propio; fuentes y pictogramas en el bundle; sin cambios
de API (cualquier cambio imprescindible se marca **[API]** y se detiene).

**Scale/Scope**: 20 rutas, ~85 componentes, 9 archivos con 46 usos de colores fijos, 15 «Cargando…», 33
archivos de prueba; un autor y su equipo invitado.

## Constitution Check

| Principio              | Cumplimiento                                                                                                                                                                                       | Estado |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Seguridad           | CSP y cabeceras intactas; sin script ni estilo en línea; recursos propios; la autorización no cambia (controles ocultos al `viewer` siguen ocultos, `runs-roles`); sin secretos en capturas ni fixtures. LLM05: la salida del LLM sigue renderizándose como texto | PASS   |
| II. Resiliencia        | Reintento automático con retroceso (máx. 3) ante 503/red; sin llamadas externas nuevas; un chunk caducado se recupera con recarga                                                                   | PASS   |
| III. Pruebas           | Cada requisito tiene su prueba prevista; las existentes no se debilitan; la prueba estática falla si reaparece un color fijo                                                                    | PASS   |
| IV. Contratos          | Sin endpoints ni esquemas nuevos; el mapa tipo de nodo → categoría se valida contra `NODE_CATALOG` de `packages/dag-schema`                                                                         | PASS   |
| V. Errores             | El panel muestra `detail` y `correlationId` del problema RFC 9457; nunca stack ni detalle interno; los 5xx usan texto llano                                                                        | PASS   |
| VI. Correlation-ID     | El id se muestra y se puede copiar en el panel de error                                                                                                                                             | PASS   |
| VII. Desviaciones      | ADR-0101 (sistema visual y fuentes), ADR-0102 (sin flag, entrega por incrementos coherentes), ADR-0103 (cierre de F10); `DESIGN.md` se actualiza en el selector de tema                            | PASS   |
| VIII. Flags            | **Sin flag**, decidido por el autor; el ADR-0102 documenta que es presentación entregada en incrementos coherentes y completos (FR-032). Se registra como interpretación, no como enmienda        | PASS (justificado, ver Complexity Tracking) |
| IX. Idioma             | UI y documentos en español; código, tokens, identificadores y commits en inglés                                                                                                                     | PASS   |
| Restricciones técnicas | Stack sin cambios; imágenes sin cambios; fuentes en el bundle                                                                                                                                       | PASS   |

OWASP tocado: A02 (configuración/CSP: no se relaja), A05 (cabeceras, verificadas por `check-headers.sh`),
A08 (integridad: fuentes del bundle con hash, sin CDN), LLM05 (salida de LLM como texto).

## Project Structure

```text
DESIGN.md                                        # PR 1: selector de tema; PR 5: valores reales (/impeccable document)
apps/web/
  index.html                                     # PR 1: <script src="/theme-init.js"> en <head>, favicon SVG
  public/theme-init.js, favicon.svg              # PR 1: tema antes del primer render; marca
  vite.config.ts                                 # PR 1: build.assetsInlineLimit = 0 (fuentes ≠ data:)
  src/
    styles/tokens.css                            # PR 1: tokens claro/oscuro, escala, radios, sombras, movimiento
    styles/fonts.css                             # PR 1: @font-face desde @fontsource (WOFF2)
    index.css                                    # PR 1: importa tokens y puente @theme de Tailwind
    lib/theme.ts                                 # PR 1: preferencia Sistema/Claro/Oscuro
    components/shell/{AppShell,Header,NavRail,BottomBar,SkipLink,ThemeMenu,Logo}.tsx   # PR 1
    components/route/{RouteError,RouteNotFound,RoutePending,PageHeader,Page}.tsx        # PR 1
    components/ui/*                              # PR 2: botón, campo, tabla, diálogo, alerta, toast, skeleton
    components/status/{StatusBadge,statusGlyphs}.tsx                                    # PR 2
    components/category/{CategoryIcon,categories}.ts(x)                                 # PR 2
    components/station/{Station,StationEdge,ServiceStrip}.tsx                           # PR 4
    routes/*                                     # PR 1–3: shell, anchos, un h1, esqueletos, errores
    features/**                                  # PR 3–4: migración a componentes y tokens
  test/{tokens,contrast,layout-widths,route-states,status,category,station,theme}.test.ts(x)
scripts/ui/contrast.ts                           # PR 1: contraste de tokens (corre en CI)
docs/adr/0101..0103-*.md
docs/ui/{audit-baseline,audit-final,contrast-report,widths-report}.md                    # PR 1 y PR 5
docs/PLAN.md, README.md                          # F10 = Rediseño; F11 = Integraciones
```

## PRs previstas

Cinco PR, cada una desplegable y coherente en ambos modos. **Hito de PR 1:** el shell, el tema y el manejo de
errores ya están en producción y todas las rutas heredan fuentes, tokens y estados. **Hito de PR 4:** los dos
gestos firma (plano de estaciones) en producción. Modelo por PR como en F9.

| PR  | Contenido                                                                                                                                                                                                                                                      | Modelo                                    | Tareas        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------- |
| 1   | **Tokens, fuentes, tema, shell y error/carga de ruta**: línea base de auditoría y de anchos, `tokens.css`, fuentes, selector de tema, marca, shell (cabecera, carril, barra inferior), `Page`/anchos, `RouteError` (503 con retroceso, chunk caducado), `RouteNotFound`, esqueleto de ruta, precarga de «Describir workflow», quitar «Crear cuenta»; ADR-0101 y 0102 | **Sonnet** (revisión de diseño con Opus)  | T001–T022     |
| 2   | **Componentes base**: botón (44 px, primario único), campos, etiquetas, tabla de 52 px, Radix reestilizado, alerta/toast con glifo, `Skeleton`, `StatusBadge` de 7 estados, `CategoryIcon` de 6 categorías; prueba estática de colores fijos activa (con la lista de excepciones vacía al final de la PR 4) | **Sonnet**                                | T023–T037     |
| 3   | **Listas, ajustes y acceso**: Workflows, Ejecuciones (una sola), Aprobaciones, Conexiones, Miembros, Cuenta, organización, auth, invitación; esqueletos y vacíos por pantalla; tablas a 375 px; revisión de h1/h2 y anchos                                    | **Sonnet** (Haiku para la migración mecánica de formularios) | T038–T053 |
| 4   | **Editor y vista de ejecución con estaciones**: `Station`, `StationEdge` (45°/90°, 12 px, ramas sí/no), puertos de 12/44 px, paleta, panel de configuración y problemas, hoja inferior móvil, teclado, `ServiceStrip`, insignias de 18 px, resaltado de 8 s, `RunGraph`, esqueleto del editor | **Opus** (geometría de aristas, teclado y táctil, rendimiento) | T054–T077 |
| 5   | **Cierre**: auditoría final de impeccable (≥ 16/20), informe de contraste y de anchos, revisión manual de teclado y lector, `DESIGN.md` con valores reales, ADR-0103, `docs/PLAN.md`, README, `tasks.md`                                                       | **Sonnet** (Haiku para PLAN, README, ADR, `tasks.md`) | T078–T087 |

Orden: 1 → 2 → 3 y 4 (3 y 4 pueden ir en paralelo si tocan archivos distintos: 3 `routes`/`features` salvo
`workflows/*` y `runs/*`; 4 solo editor y ejecución) → 5. Cada PR indica en su descripción qué principios
aplican y adjunta capturas claro/oscuro a 375 y 1440 px (sin datos reales).

### ADRs previstos

| ADR  | Tema                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 0101 | Sistema visual «Línea Nocturna», fuentes autoalojadas (`@fontsource-variable`), tokens y selector de tema    |
| 0102 | Rediseño sin feature flag: entrega por incrementos coherentes y desplegables (interpretación del principio VIII) |
| 0103 | Cierre de F10: resultados de la auditoría, excepciones aceptadas y su revisión                               |

## Complexity Tracking

| Decisión                                                            | Motivo                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sin flag pese al principio VIII (ADR-0102)                          | Decisión del autor: un flag duplicaría estilos y pruebas dos veces; el riesgo se acota haciendo cada PR completa, coherente en ambos modos y con `check-headers.sh` y reversa automática de F9 |
| Script de tema externo en `public/` y no en línea                   | La CSP `script-src 'self'` prohíbe el script en línea; un script bloqueante pequeño en `<head>` evita el parpadeo                                       |
| `build.assetsInlineLimit: 0`                                        | Vite inlinea activos pequeños como `data:`; `font-src 'self'` no admite `data:` y rompería las fuentes en producción                                   |
| Dos dependencias de fuentes (ADR-0101)                              | Autoalojar sin copiar binarios al repositorio; OFL 1.1; sin CDN                                                                                         |
| Arista propia (`StationEdge`) en vez del `smoothstep` de xyflow     | `smoothstep` solo dobla a 90°; el diseño pide 45° y 90° con esquina fija de 12 px                                                                       |
| Script propio de contraste en `scripts/ui/`; anchos medidos en navegador | Evita añadir axe-core y Playwright a las dependencias; el contraste es determinista y corre en CI; los anchos se miden en navegador y se versiona el informe |
