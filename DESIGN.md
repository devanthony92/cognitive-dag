---
name: CognitiveDAG
description: Plano de línea nocturna para workflows durables: el grafo es el mapa, cada ejecución es un servicio con estado.
colors:
  ground-night: "oklch(0.19 0.05 268)"
  surface-night: "oklch(0.235 0.055 268)"
  raised-night: "oklch(0.285 0.06 268)"
  line-night: "oklch(0.4 0.06 268)"
  ink-night: "oklch(0.96 0.01 255)"
  ink-muted-night: "oklch(0.78 0.04 262)"
  ground-day: "oklch(0.975 0.006 250)"
  surface-day: "oklch(1 0 0)"
  raised-day: "oklch(0.955 0.01 255)"
  line-day: "oklch(0.84 0.02 262)"
  ink-day: "oklch(0.22 0.05 268)"
  ink-muted-day: "oklch(0.44 0.04 265)"
  action-night: "oklch(0.96 0.01 255)"
  on-action-night: "oklch(0.19 0.05 268)"
  action-day: "oklch(0.22 0.05 268)"
  on-action-day: "oklch(0.985 0.004 250)"
  state-running-night: "oklch(0.79 0.12 225)"
  state-succeeded-night: "oklch(0.8 0.16 155)"
  state-failed-night: "oklch(0.72 0.19 25)"
  state-waiting-night: "oklch(0.85 0.15 85)"
  state-cancelled-night: "oklch(0.72 0.02 262)"
  state-skipped-night: "oklch(0.62 0.03 262)"
  state-reused-night: "oklch(0.8 0.1 155)"
  state-running-day: "oklch(0.46 0.12 235)"
  state-succeeded-day: "oklch(0.46 0.14 155)"
  state-failed-day: "oklch(0.5 0.2 27)"
  state-waiting-day: "oklch(0.48 0.12 70)"
  state-cancelled-day: "oklch(0.45 0.02 262)"
  state-skipped-day: "oklch(0.5 0.03 262)"
  state-reused-day: "oklch(0.46 0.1 155)"
  node-trigger-night: "oklch(0.74 0.15 350)"
  node-logic-night: "oklch(0.74 0.13 255)"
  node-llm-night: "oklch(0.76 0.14 300)"
  node-http-night: "oklch(0.78 0.14 60)"
  node-approval-night: "oklch(0.82 0.15 112)"
  node-mock-night: "oklch(0.72 0.03 262)"
  node-trigger-day: "oklch(0.5 0.18 350)"
  node-logic-day: "oklch(0.48 0.16 258)"
  node-llm-day: "oklch(0.48 0.17 300)"
  node-http-day: "oklch(0.5 0.14 55)"
  node-approval-day: "oklch(0.45 0.13 125)"
  node-mock-day: "oklch(0.46 0.03 262)"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.06em"
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  station: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.action-night}"
    textColor: "{colors.on-action-night}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-night}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  input-field:
    backgroundColor: "{colors.ground-night}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  card-panel:
    backgroundColor: "{colors.surface-night}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.lg}"
    padding: "16px"
  status-badge:
    backgroundColor: "{colors.raised-night}"
    textColor: "{colors.ink-night}"
    typography: "{typography.label}"
    rounded: "{rounded.station}"
    padding: "4px 10px"
    height: "24px"
---

# Design System: CognitiveDAG

<!-- SEED: elegido con el usuario antes de implementar (F10). Los tokens de arriba son el objetivo normativo del rediseño; reejecutar `/impeccable document` cuando exista el código para recoger los valores reales y generar el sidecar. Los pares claro/oscuro están por verificar con medidor de contraste (AA) al implementar. -->

## Overview

**Creative North Star: "La Línea Nocturna"**

Un plano de metro hecho esmalte azul medianoche. Un workflow es una red de líneas que se doblan solo a 45° y 90°; cada nodo es una estación; cada ejecución es un servicio que circula, se retrasa, se suspende o llega. El usuario es un operador que revisa el estado del servicio durante sesiones largas, así que el sistema pide legibilidad, constancia y una sola idea fuerte: **la señalética de transporte**.

La identidad viene de cuatro cosas y solo esas: tipo (humanista de señalética, alta legibilidad), paleta (esmalte oscuro con tintas de línea), densidad (etiquetas fijas, ritmo de estaciones) y un gesto firma: el DAG dibujado como plano de metro. La organización de pantallas, la navegación y los controles siguen siendo estándar web (carril lateral, tablas con cabeceras, formularios, pestañas) para que nadie tenga que aprender nada.

El modo oscuro es el nativo (operadores en sesiones largas, a menudo de noche); el claro («porcelana») es un par completo, no un añadido. Ambos siguen `prefers-color-scheme`.

Rechazado de forma explícita: el aspecto shadcn por defecto (azul oklch(0.45 0.16 265), tarjetas grises uniformes), cualquier azul-primario genérico de SaaS y la rotulación solo por color.

**Key Characteristics:**

- Esmalte oscuro tintado de azul, nunca negro puro; blancos de porcelana tintados, nunca `#fff` de pantalla.
- Estado y categoría = forma + etiqueta + color (nunca solo color; WCAG 1.4.1).
- Líneas a 45°/90°, estaciones circulares, etiquetas de tamaño fijo.
- Una sola acción primaria por vista, en tinta invertida (blanco sobre noche, tinta sobre día).
- Todo estado de fallo conserva orientación: cabecera, ruta de vuelta y reintento.

## Colors

Estrategia **Comprometida**: el esmalte azul medianoche ocupa el 60–70 % de la superficie; las tintas de línea solo aparecen donde significan algo.

### Neutral (esmalte)

- **Medianoche Esmalte** (ground-night, oklch(0.19 0.05 268)): fondo de la aplicación en oscuro.
- **Panel de Estación** (surface-night, oklch(0.235 0.055 268)): tarjetas, tablas, paneles.
- **Placa Elevada** (raised-night, oklch(0.285 0.06 268)): popovers, filas activas, badges.
- **Filete de Plano** (line-night, oklch(0.4 0.06 268)): bordes de 1 px, divisores.
- **Porcelana** (ink-night, oklch(0.96 0.01 255)) y **Porcelana Apagada** (ink-muted-night, oklch(0.78 0.04 262)): texto principal y secundario.
- Par claro «Porcelana»: ground-day oklch(0.975 0.006 250), surface-day blanco, ink-day oklch(0.22 0.05 268), ink-muted-day oklch(0.44 0.04 265), line-day oklch(0.84 0.02 262).

### Acción

- **Tinta Invertida** (action-night = porcelana sobre medianoche; action-day = tinta sobre porcelana): botón primario, selección activa del carril. Sin matiz de línea para que nunca se confunda con un estado.

### Estado de servicio (semántico; reservado)

Cada estado lleva color + glifo + etiqueta en español.

- **En curso** (state-running, cian oklch(0.79 0.12 225)): anillo con giro lento + «En curso».
- **Completado** (state-succeeded, verde oklch(0.8 0.16 155)): círculo con ✓.
- **Fallido** (state-failed, rojo oklch(0.72 0.19 25)): círculo con ✕, siempre con clase de error (transitorio, límite, tiempo, permanente).
- **Esperando** (state-waiting, ámbar oklch(0.85 0.15 85)): reloj de arena; incluye aprobaciones humanas.
- **Cancelado** (state-cancelled, gris oklch(0.72 0.02 262)): círculo tachado ⊘.
- **Omitido** (state-skipped, gris oklch(0.62 0.03 262)): relleno rayado a 45° + «»».
- **Reutilizado** (state-reused, verde apagado oklch(0.8 0.1 155)): contorno discontinuo + ↺.

### Categoría de nodo (línea)

Identidad por forma de estación + color de línea + etiqueta. El color de categoría vive en el glifo y la arista saliente; el de estado, en el relleno y el badge.

- **Disparador** (node-trigger, magenta oklch(0.74 0.15 350)): terminal en píldora.
- **Lógica** (node-logic, cobalto oklch(0.74 0.13 255)): rombo (condición, merge).
- **LLM** (node-llm, violeta oklch(0.76 0.14 300)): hexágono.
- **HTTP** (node-http, naranja oklch(0.78 0.14 60)): cuadrado.
- **Aprobación humana** (node-approval, lima oklch(0.82 0.15 112)): círculo con silueta de persona.
- **Simulado / mock** (node-mock, pizarra oklch(0.72 0.03 262)): cuadrado discontinuo.

### Named Rules

**The Enamel Rule.** El fondo nunca es negro ni blanco puros: siempre esmalte o porcelana tintados hacia el matiz 268.
**The Reserved Ink Rule.** Los colores de estado solo significan estado; nunca decoran, nunca rellenan botones ni cabeceras.
**The Never-Color-Alone Rule.** Si quitas el matiz, el estado y la categoría siguen distinguibles por glifo y etiqueta.
**The One Action Rule.** La tinta invertida marca la acción principal: una por vista.

## Typography

**Display / Body Font:** Atkinson Hyperlegible Next (fallback `system-ui, sans-serif`), autoalojada en el bundle como WOFF2 variable.
**Mono Font:** Atkinson Hyperlegible Mono (fallback `ui-monospace, monospace`), para ids, correlation ids, JSON, cron y webhooks.

**Character:** Humanista de señalética: aperturas abiertas, caracteres inconfundibles (I/l/1, O/0). Es la voz de un panel que se lee con prisa, de lado, a las 3 a. m.

Ambas fuentes se sirven desde `'self'`: archivos en el bundle con `@font-face`, sin Google Fonts ni CDN (CSP `font-src 'self'`).

### Hierarchy

- **Display** (700, 2rem/1.2, -0.01em): título de página en auth y vacíos grandes. Una vez por pantalla.
- **Headline** (700, 1.5rem/1.25): `h1` de cada página.
- **Title** (600, 1.125rem/1.4): `h2` de sección, botones, cabeceras de panel.
- **Body** (400, 0.9375rem/1.6): texto corrido, celdas de tabla; máx. 70ch.
- **Body-sm** (400, 0.8125rem/1.5): metadatos, ayudas.
- **Label** (600, 0.75rem/1.33, 0.06em, mayúsculas): cabeceras de tabla, etiquetas de estación.
- **Mono** (400, 0.8125rem/1.5): ids y datos técnicos.

Mínimo absoluto 12 px; desaparecen los 10/11 px. Razón de escala ≈1.25. Cada página tiene exactamente un `h1` (incluido el login).

### Named Rules

**The Station Label Rule.** Las etiquetas de nodos y estados tienen tamaño fijo (no escalan con el zoom del lienzo); el plano se acerca, el rótulo no se encoge por debajo de 12 px.
**The Tabular Rule.** Duraciones, contadores y horas usan cifras tabulares (`font-variant-numeric: tabular-nums`).

## Layout

**Shell de aplicación (siempre presente, también en error):**

- Cabecera de 56 px: logotipo (marca: anillo + cruz de registro de línea → por definir en el logo), selector de organización, usuario.
- Carril de navegación a la izquierda: 240 px ≥1024 px; 72 px solo iconos+etiqueta bajo 1024 px; **barra inferior de 56 px** con 5 destinos bajo 768 px. Sin scroll horizontal en ningún ancho (hoy: 1043 px de cabecera).
- Destinos: Workflows, Ejecuciones, Aprobaciones, Conexiones, Miembros.

**Tres anchos de página con nombre** (se acaba la mezcla actual de `max-w-3xl` y todo-ancho):

- `page-narrow` 640 px: formularios y auth.
- `page-default` 1120 px: listas y ajustes.
- `page-full`: editor, vista de ejecución y mapa del workflow; ocupa todo el área de contenido.

**Espaciado** en base 4 px: 4, 8, 12, 16, 24, 32, 48, 64. Ritmo vertical: más aire sobre un encabezado que bajo él. Densidad de operación: filas de tabla de 52 px (objetivo táctil ≥44 px de contenido interactivo).

**Objetivos táctiles:** 44×44 px mínimo en controles (hoy 36 px).

**Estados de carga y error de ruta:**

- Cargando: esqueleto con la forma y altura finales (sin salto de maquetación); aparece tras 150 ms; sustituye el «Cargando…» en texto plano. «Describir workflow» precarga su chunk al pasar o enfocar el enlace y muestra el esqueleto del editor al instante (adiós pantalla en blanco de 1–3 s).
- Error: el límite de error de TanStack Router se sustituye por un panel **dentro del shell** con título en lenguaje llano, causa, id de correlación en mono y dos acciones: **Reintentar** (primaria) y **Volver**. Un 503/red durante un despliegue se presenta como «El servicio se está reiniciando» con reintento automático con retroceso (máx. 3) antes de rendirse.
- Vacío: texto en español claro + una acción, dentro de `page-default`.
- Acceso: el login no enlaza «Crear cuenta» (registro cerrado); muestra «El acceso es por invitación».

## Elevation & Depth

Capas tonales, no sombras: la profundidad se lee por saltos de claridad del esmalte (ground → surface → raised) y filetes de 1 px (line). Las sombras existen solo para superficies flotantes.

### Shadow Vocabulary

- **Flotante** (`box-shadow: 0 8px 24px oklch(0.1 0.04 268 / 0.5)` en noche; `0 8px 24px oklch(0.3 0.04 268 / 0.18)` en día): popovers, menús, diálogos.
- **Foco de estación** (`box-shadow: 0 0 0 2px var(ground), 0 0 0 4px var(ink)`): anillo de foco doble, visible en ambos modos.

### Named Rules

**The Flat-Until-Floating Rule.** En reposo todo es plano; solo lo que flota sobre el contenido lleva sombra.
**The No Side Stripe Rule.** Nunca una franja de color a un lado (`border-left`/`border-right` >1 px); la categoría va en el glifo, no en un borde.

## Shapes

Lenguaje de placa esmaltada y estación. Radios: 4 px (badges pequeños, celdas), 8 px (botones, campos), 12 px (paneles), 999 px (estaciones, píldoras de estado). Bordes de 1 px en `line`; 2 px solo en el foco y en selección de nodo. Las aristas del DAG se doblan solo a 45° y 90° con esquinas redondeadas de radio fijo (12 px); las estaciones son círculos de 20–24 px con borde de 4 px, el nodo seleccionado crece a 28 px.

## Components

### Botones

- **Forma:** 44 px de alto, radio 8 px.
- **Primario:** tinta invertida; un solo uno por vista.
- **Secundario:** `surface` con filete `line`; **Peligro:** contorno en `state-failed` con etiqueta explícita.
- **Foco:** anillo doble 2+2 px. **Hover:** sube un escalón tonal (surface → raised). **Deshabilitado:** 45 % de opacidad con cursor `not-allowed`, nunca solo gris.

### Badge de estado

Píldora de 24 px: glifo + etiqueta en español + (si aplica) clase de error. El glifo es siempre visible; el color solo refuerza. «En curso» lleva anillo giratorio; con `prefers-reduced-motion` el anillo queda estático.

### Tabla de ejecuciones

Cabecera en Label, filas de 52 px, columna de estado primero, duración tabular a la derecha, miniatura de «tira de servicio» (una estación por paso). Una fila que cambia de estado se queda resaltada (fondo `raised`) hasta que el usuario la enfoca o pasa 8 s.

### Nodo del editor (estación)

Glifo de categoría (forma por categoría) + nombre + subtítulo de tipo; la ejecución añade anillo de estado y badge. Entradas y salidas son puertos redondos de 12 px con zona de 44 px. Sin `border-l-4`.

### Campos y formularios

Alto 44 px, radio 8 px, etiqueta siempre visible sobre el campo, ayuda en body-sm, error en `state-failed` con icono y texto. Tamaño de texto ≥16 px en móvil (sin zoom iOS).

### Navegación

Carril: item activo = `raised` + glifo relleno + etiqueta en negrita (no solo color). Móvil: barra inferior con 5 destinos.

### Paneles y diálogos

Radix Dialog/Popover/Select, reestilizados con estos tokens; foco atrapado y devuelto, cierre con Esc.

### Movimiento

Duraciones: 120 ms (estado), 200 ms (paneles), 320 ms (rutas, máximo). Curva `cubic-bezier(0.2, 0, 0, 1)` (salida suave). Solo se animan `opacity` y `transform`. Firma: al cambiar de estado, la estación y la línea afectadas se recalculan en su sitio (sin rehacer el plano). Bajo `prefers-reduced-motion: reduce`: sin giros ni pulsos, transiciones de 0 ms, cambios de estado instantáneos con el mismo glifo y texto.

## Do's and Don'ts

### Do:

- **Do** dar a cada estado y categoría un glifo y una etiqueta además del color.
- **Do** mantener el shell (cabecera + carril) visible en carga, error y vacío.
- **Do** usar `page-narrow`, `page-default` o `page-full`; ningún otro ancho.
- **Do** autoalojar fuentes y respetar la CSP: nada de `style="…"` en HTML ni `<style>` inyectado; los tokens viven en CSS cargado desde `'self'`.
- **Do** mínimo 44 px en objetivos táctiles y 12 px en texto.
- **Do** definir el modo claro y el oscuro con los mismos tokens semánticos y verificar contraste AA en ambos.

### Don't:

- **Don't** usar colores Tailwind fijos (`amber-500`, `emerald-600`…) en componentes: solo tokens semánticos.
- **Don't** señalar estado o categoría solo con color.
- **Don't** usar franjas laterales de color (`border-l-4`) ni gradientes decorativos.
- **Don't** reutilizar un color de estado como decoración o como botón primario.
- **Don't** mostrar el «Something went wrong» por defecto ni una pantalla en blanco.
- **Don't** enlazar a rutas inexistentes (p. ej. «Crear cuenta» con el registro cerrado).
- **Don't** convertir la identidad en disfraz: no rótulos de estación en los botones ni mapas de metro como adorno donde no hay un grafo.
