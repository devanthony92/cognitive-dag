# Feature Specification: Rediseño del frontend (F10)

**Feature Branch**: `011-frontend-redesign`

**Created**: 2026-11-12

**Status**: Clarificada (4 decisiones del autor el 2026-11-12)

**Input**: User description: "Fase F10 «Rediseño del frontend»: rehacer toda la parte visual y de UX de
`apps/web` según el sistema «Línea Nocturna» de [DESIGN.md](../../DESIGN.md) y [PRODUCT.md](../../PRODUCT.md),
tras la auditoría técnica de impeccable (10/20): error por defecto de TanStack Router, ausencia de shell y
cabecera de 1043 px con scroll horizontal, colores Tailwind fijos sin modo oscuro, estado y categoría solo por
color, pantalla en blanco al abrir «Describir workflow», «Crear cuenta» con el registro cerrado, objetivos de
36 px, tipografía plana, «Cargando…» sin reserva de espacio y anchos inconsistentes. Sin cambios de API ni de
backend. La antigua F10 «Integraciones» pasa a ser F11."

> **Esta tarea solo especifica.** No se implementa código de la aplicación. `DESIGN.md` y `PRODUCT.md` (raíz,
> mergeados en #86) son **normativos**: esta spec los convierte en requisitos verificables y no los
> reabre; donde `DESIGN.md` y la spec difieran, manda `DESIGN.md` y la spec se corrige.

## Estado de partida (leído en `main` fa0595a)

Hechos medidos que condicionan el alcance:

- `apps/web` tiene 20 archivos de ruta (`apps/web/src/routes/*`: 19 pantallas y la raíz), unos 85 componentes `.tsx`, 33 archivos de prueba en
  `apps/web/test/` y ningún componente de forma (shell, pictogramas, esqueletos).
- Hay 46 usos de colores Tailwind fijos (`bg-amber-500`, `text-emerald-600`…) en 9 archivos:
  `features/demo/DemoNotice.tsx`, `features/runs/{OrganizationRunsPage,status,StatusBadge,StepPanel}.tsx` y
  `features/workflows/{ConfigForm,DagNodeView,ProblemsList,WorkflowEditor}.tsx`. Ninguno tiene variante `dark:`.
- El tema actual (`apps/web/src/index.css`) es el del esqueleto shadcn: primario `oklch(0.45 0.16 265)`,
  grises uniformes; ya sigue `prefers-color-scheme` mediante `@custom-variant dark`.
- `__root.tsx` solo pone `DemoNotice`, `AppHeader` y un `<main>` de `max-w-3xl` o de todo el ancho
  (`staticData.fullWidth`). No hay carril de navegación, ni límite de error propio, ni componente de carga de
  ruta: los estados de carga son `<p>Cargando…</p>` repartidos por 15 sitios y el error es el
  «Something went wrong» de TanStack Router.
- Los anchos de página son `max-w-md`, `max-w-xl`, `max-w-3xl`, `max-w-5xl` y `max-w-6xl` mezclados;
  `Ejecuciones` aparece con dos títulos y anchos distintos (`OrganizationRunsPage`, `RunsPage`).
- El enlace «Crear cuenta» aparece en `routes/index.tsx` y en `features/auth/LoginForm.tsx` aunque el registro
  está cerrado en producción (Caddy responde 404 a `POST /api/v1/auth/register`, F9 D23A).
- Producción sirve la web con CSP `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self';
img-src 'self' data:`, COEP `require-corp` y COOP/CORP `same-origin`; `deploy/ops/check-headers.sh` lo
  comprueba en cada despliegue y solo cambia con un ADR. Cada merge a `main` se despliega solo en
  https://cognitive.devama.cloud, sin staging (F9 D2C).
- Auditoría de impeccable: **10/20**. Hallazgos: P0 error por defecto del router; P1 sin shell y cabecera de
  1043 px con scroll horizontal (888 px en escritorio, 375 px en móvil), 20 colores fijos sin `dark:`,
  estado y categoría solo por color (WCAG 1.4.1), pantalla en blanco de 1–3 s al abrir «Describir workflow»,
  «Crear cuenta» con registro cerrado; P2 objetivos de 36 px, tipografía plana con textos de 10/11 px,
  «Cargando…» sin reserva de espacio, h1/h2 inconsistentes, anchos inconsistentes. **Se conservan:** tokens
  `oklch`, primitivas Radix, cobertura de `aria-label` y los textos de estado vacío.

## Clarifications

### Session 2026-11-12

- Q: ¿Cómo se cumple el principio VIII (flags) si cada PR de F10 se despliega sola y cambia lo visible? → A:
  **Sin flag.** Cada PR deja la aplicación coherente y completa en ambos modos; un ADR de la fase documenta que
  un rediseño de presentación, entregado en incrementos coherentes y sin comportamiento ejecutable pendiente,
  no entra en el supuesto del principio VIII. No hay flag de rediseño ni estilos duplicados.
- Q: ¿Selector manual de tema? → A: **Sí**, en el menú de usuario: Sistema (por defecto), Claro u Oscuro,
  guardado en el navegador. Cambia lo que dice `DESIGN.md` («ambos siguen `prefers-color-scheme`»): la PR 1
  actualiza `DESIGN.md` en ese punto.
- Q: ¿Editor DAG por debajo de 768 px? → A: **Editable**: lienzo con pan y zoom táctiles, puertos con zona de
  44 px y paneles como hoja inferior; el flujo completo funciona a 375 px.
- Q: ¿Marca? → A: **Símbolo SVG propio** (anillo y cruz de registro de línea) más el nombre en Atkinson, y
  favicon SVG, dibujado en la PR 1.

## User Scenarios & Testing _(mandatory)_

Actores: el operador técnico (sesiones largas en escritorio, a menudo de noche), la persona menos técnica que
describe un proceso y aprueba pasos humanos, el miembro `viewer` que solo mira, quien llega por una invitación,
y quien evalúa el portafolio abriendo el sitio de producción. Todos usan español.

### User Story 1 - Una aplicación con shell constante y navegación que cabe en cualquier pantalla (Priority: P1)

Quien entra a una organización ve siempre la misma estructura: cabecera de 56 px con marca, selector de
organización y usuario, y navegación a Workflows, Ejecuciones, Aprobaciones, Conexiones y Miembros (carril a la
izquierda en escritorio, carril de iconos en tablet, barra inferior en móvil). Nada desborda: ni un píxel de
scroll horizontal a 375, 768, 1024 y 1440 px.

**Why this priority**: es el hallazgo P1 más visible (cabecera de 1043 px) y la base sobre la que se apoya el
resto de pantallas; sin shell no hay dónde mostrar errores ni cargas con orientación.

**Independent Test**: abrir cada ruta autenticada a los cuatro anchos y medir que el ancho del documento no
supera el de la ventana; recorrer los cinco destinos solo con teclado.

**Acceptance Scenarios**:

1. **Given** una sesión iniciada en una organización, **When** se abre cualquier pantalla a 1440 px, **Then**
   hay cabecera de 56 px y carril de 240 px con los cinco destinos, el activo distinguible sin depender del
   color (fondo elevado, glifo relleno y etiqueta en negrita).
2. **Given** un ancho entre 768 y 1023 px, **When** se carga la aplicación, **Then** el carril es de 72 px con
   icono y etiqueta por destino.
3. **Given** un ancho menor de 768 px, **When** se carga la aplicación, **Then** el carril desaparece y una
   barra inferior de 56 px ofrece los cinco destinos; el contenido no queda tapado por ella.
4. **Given** los anchos 375, 768, 1024 y 1440 px, **When** se recorre cada ruta de `apps/web/src/routes/*`,
   **Then** el documento no tiene scroll horizontal en ninguna.
5. **Given** cualquier pantalla, **When** se tabula desde el inicio, **Then** el primer foco ofrece «Saltar al
   contenido», y los controles de cabecera, carril y barra inferior son alcanzables y tienen foco visible con
   el anillo doble.
6. **Given** una pantalla sin organización activa (inicio, auth), **When** se muestra, **Then** usa la cabecera
   sin carril y sin destinos inexistentes.

---

### User Story 2 - Los errores y las cargas conservan orientación (Priority: P1)

Cuando una ruta falla, la persona ve un panel dentro del shell con título en lenguaje llano, causa, id de
correlación y dos acciones: **Reintentar** y **Volver**. Durante un despliegue (503 o red caída) ve «El
servicio se está reiniciando» y la pantalla reintenta sola con retroceso. Mientras algo carga ve un esqueleto
con la forma final, no un texto suelto ni una pantalla en blanco.

**Why this priority**: es el P0 de la auditoría y, con despliegue automático en cada merge, el 503 es un
caso diario, no excepcional.

**Independent Test**: forzar en pruebas un error de carga de ruta, un problema RFC 9457 con `correlationId`,
un 503 y un fallo de red, y comprobar el panel, el reintento y que el shell sigue presente.

**Acceptance Scenarios**:

1. **Given** una ruta cuyo cargador lanza un error, **When** se muestra el fallo, **Then** aparece un panel
   dentro del shell (cabecera y carril presentes), sin el texto «Something went wrong», con título llano,
   causa, id de correlación en mono cuando exista, **Reintentar** (primaria) y **Volver**.
2. **Given** una respuesta 503 o un fallo de red en una ruta, **When** se muestra, **Then** el título es «El
   servicio se está reiniciando» y se reintenta automáticamente con retroceso hasta 3 veces antes de mostrar
   el panel de error con **Reintentar** manual.
3. **Given** un problema `application/problem+json`, **When** se muestra en el panel, **Then** el `detail` en
   español se presenta tal cual y el `correlationId` se puede seleccionar y copiar; nunca se muestra un stack
   ni detalle interno (constitución, principio V).
4. **Given** una ruta cuya carga tarda más de 150 ms, **When** carga, **Then** se ve un esqueleto con la altura
   y forma finales de la pantalla (sin salto de maquetación al llegar los datos) y un anuncio accesible
   «Cargando» (`role="status"`); si responde antes de 150 ms no parpadea ningún esqueleto.
5. **Given** el enlace «Describir workflow», **When** se pasa el ratón o se enfoca, **Then** el código de esa
   pantalla se precarga; al abrirla se ve al instante el esqueleto del editor, nunca una pantalla en blanco.
6. **Given** una ruta inexistente, **When** se visita, **Then** se muestra un «No encontramos esa página» dentro
   del shell con ruta de vuelta, no el 404 por defecto.
7. **Given** una lista o sección sin datos, **When** se muestra, **Then** conserva el texto de vacío actual en
   español más una acción, dentro de `page-default`.

---

### User Story 3 - Sistema visual «Línea Nocturna»: tokens, tipografía y modos claro y oscuro (Priority: P1)

La aplicación se ve como una sola cosa: esmalte azul medianoche con tintas de línea, tipografía de señalética
legible, y un modo claro «porcelana» completo, ambos siguiendo la preferencia del sistema. Ningún componente
usa un color suelto: todos leen tokens semánticos.

**Why this priority**: sin tokens y fuentes autoalojadas no hay base común para el resto, y la CSP de producción
impone cómo deben llegar (sin CDN, sin estilos en línea).

**Independent Test**: una prueba estática que recorre `apps/web/src` y falla ante colores Tailwind fijos, `#hex`,
`rgb()` o `style=` fuera de la definición de tokens; un script que calcula el contraste de cada par de tokens
en ambos modos; `check-headers.sh` y una carga del build en un navegador sin violaciones de CSP.

**Acceptance Scenarios**:

1. **Given** el código de `apps/web/src`, **When** se ejecuta la prueba de tokens, **Then** hay 0 colores fijos
   (paleta Tailwind, hex, `rgb`/`hsl` literales) fuera del archivo de tokens y 0 `style=` o `<style>` inyectados
   por la aplicación (salvo los que fija una biblioteca de terceros, listados con razón).
2. **Given** los pares de tokens de texto/fondo y de componente/fondo, **When** se mide el contraste, **Then**
   texto normal ≥ 4,5:1, texto grande y componentes de interfaz (bordes de campo, glifos, foco) ≥ 3:1, en modo
   claro y en modo oscuro; el resultado se versiona.
3. **Given** el sistema operativo en modo claro u oscuro y la preferencia «Sistema», **When** se abre la
   aplicación, **Then** usa el par correspondiente de tokens sin parpadeo del tema equivocado y todas las
   pantallas son legibles en ambos.
4. **Given** el menú de usuario, **When** la persona elige Claro, Oscuro o Sistema, **Then** el tema cambia al
   instante, se recuerda en ese navegador en la siguiente visita sin parpadeo del tema equivocado, y la
   opción activa se ve y se anuncia con texto (no solo con color); si el navegador no permite guardar, la
   aplicación funciona igual con «Sistema».
5. **Given** el build de producción, **When** se sirve con la CSP vigente, **Then** Atkinson Hyperlegible Next y
   Atkinson Hyperlegible Mono cargan desde el propio origen (WOFF2 en el bundle), sin solicitudes a otros
   orígenes y sin violaciones de CSP en la consola.
6. **Given** cualquier pantalla, **When** se inspeccionan los tamaños de texto, **Then** ninguno es menor de
   12 px y cada pantalla tiene exactamente un `h1` (el login incluido) con el orden de encabezados sin saltos.
7. **Given** cifras de duración, contadores y horas, **When** se muestran, **Then** usan cifras tabulares.
8. **Given** `prefers-reduced-motion: reduce`, **When** hay transiciones o animaciones (giro de «en curso»,
   aparición de paneles), **Then** quedan estáticas o instantáneas con el mismo glifo y texto.

---

### User Story 4 - Estado y categoría se entienden sin color (Priority: P1)

Cada estado de ejecución y de paso (en curso, completado, fallido, esperando, cancelado, omitido, reutilizado) y
cada categoría de nodo (disparador, lógica, LLM, HTTP, aprobación humana, simulado) se reconoce por forma
(glifo o pictograma) y por etiqueta en español, con el color solo como refuerzo. Los fallos muestran su clase
(transitorio, límite de tasa, tiempo agotado, permanente).

**Why this priority**: WCAG 1.4.1 y principio 1 de PRODUCT.md; es el hallazgo de accesibilidad más grave y lo
reutilizan listas, editor y vista de ejecución.

**Independent Test**: renderizar cada estado y cada categoría en escala de grises y comprobar que siguen siendo
distinguibles por glifo y etiqueta; prueba de componente que exige glifo y texto en cada variante.

**Acceptance Scenarios**:

1. **Given** cada uno de los 7 estados, **When** se muestra su insignia de estado, **Then** lleva glifo
   distinto, etiqueta en español y color; con el color anulado sigue siendo único entre los 7.
2. **Given** un paso fallido, **When** se muestra, **Then** la insignia incluye la clase de error (transitorio,
   límite, tiempo o permanente) en texto.
3. **Given** cada una de las 6 categorías de nodo, **When** se muestra en la paleta, el lienzo y los paneles,
   **Then** lleva su pictograma, su etiqueta y su color, y las 6 son distinguibles en escala de grises.
4. **Given** «En curso», **When** la pantalla no tiene `prefers-reduced-motion`, **Then** el glifo gira
   lentamente; con reducción de movimiento queda estático sin perder información.
5. **Given** un lector de pantalla, **When** recorre una insignia o una estación, **Then** anuncia estado o
   categoría con texto, no con el color.

---

### User Story 5 - Listas, ajustes y acceso con la misma estructura (Priority: P2)

Workflows, Ejecuciones, Aprobaciones, Conexiones, Miembros, Cuenta y organización comparten cabecera de página
(un `h1`), anchos con nombre (`page-narrow` 640, `page-default` 1120) y controles de 44 px. El acceso (login,
restablecer contraseña, verificar correo, aceptar invitación) usa `page-narrow`. El login no ofrece «Crear
cuenta» y explica que el acceso es por invitación.

**Why this priority**: es el grueso de las pantallas; se rehace sobre la base de los P1 y quita las
inconsistencias P2 y el enlace roto.

**Independent Test**: recorrer cada pantalla con sus estados (cargando, vacío, error, con datos) en ambos modos
y a los cuatro anchos; las pruebas existentes de login, registro, miembros, ajustes de organización, lista de
workflows y contraseñas siguen verdes.

**Acceptance Scenarios**:

1. **Given** la pantalla de login, **When** se muestra, **Then** no contiene el enlace «Crear cuenta» y dice «El
   acceso es por invitación»; el inicio (`/`) tampoco enlaza a «Crear cuenta» ni a ninguna ruta que responda
   404 en producción.
2. **Given** cualquier pantalla de lista o de ajustes, **When** se abre, **Then** tiene un único `h1`, usa
   `page-default` y no mezcla anchos; `Ejecuciones` es una sola pantalla con un solo título y el ancho común.
3. **Given** un formulario, **When** se muestra, **Then** la etiqueta es visible sobre el campo, el campo mide
   44 px, el texto es ≥ 16 px en móvil y el error aparece con icono, texto y el `aria-describedby` actual.
4. **Given** una tabla de datos a 375 px, **When** no cabe, **Then** el desborde queda contenido dentro de la
   propia tabla (sin scroll horizontal del documento) o se presenta como lista apilada; las acciones siguen a
   44 px.
5. **Given** las acciones destructivas (eliminar, revocar, regenerar token), **When** se ofrecen, **Then** usan
   el botón de peligro con etiqueta explícita y diálogo Radix con foco atrapado y devuelto, y Esc cierra.
6. **Given** una vista con una acción principal (p. ej. «Nuevo workflow»), **When** se muestra, **Then** esa es
   la única en tinta invertida de la vista.
7. **Given** una invitación o un enlace de verificación caducado o inválido, **When** se abre, **Then** el panel
   explica la causa y ofrece una ruta de vuelta, con el mismo diseño que el resto de errores.

---

### User Story 6 - El editor dibuja el workflow como un plano de línea (Priority: P2)

En el editor, cada nodo es una estación redonda de 40 px (48 px si está seleccionada) con su pictograma, su
nombre y tipo debajo; las aristas salen a 45° y 90° en el color de la categoría del nodo de origen, con las
ramas de una condición etiquetadas «sí» y «no». La paleta, el panel de configuración y los problemas siguen el
mismo lenguaje. Todo se puede operar con teclado, y a 375 px el editor es utilizable.

**Why this priority**: es el gesto firma del producto y la parte más densa; va después de que existan los
componentes base.

**Independent Test**: las pruebas existentes del editor (`workflow-editor`, `workflow-references`,
`workflow-tools`, `workflow-conflict`, `workflow-retry`, `workflow-editor-performance`) pasan sin cambiar su
intención; nuevas pruebas verifican estación, pictograma, etiquetas fijas y foco por teclado.

**Acceptance Scenarios**:

1. **Given** un workflow con nodos de las 6 categorías, **When** se abre el editor, **Then** cada nodo es una
   estación circular de 40 px con borde de 4 px en el color de su categoría, relleno `surface` y pictograma de
   24 px; nombre y tipo van debajo con tamaño fijo y no escalan con el zoom del lienzo (mínimo 12 px).
2. **Given** un nodo seleccionado, **When** se selecciona, **Then** crece a 48 px y lleva el anillo de foco
   doble; sin color sigue siendo identificable.
3. **Given** las conexiones, **When** se dibujan, **Then** las aristas tienen 5 px, se doblan solo a 45° y 90°
   con esquina de 12 px, toman el color de la categoría del nodo de origen, y las dos ramas de una condición se
   etiquetan «sí» y «no».
4. **Given** los puertos de entrada y salida, **When** se usan con ratón o dedo, **Then** son círculos de 12 px
   con una zona de impacto de 44 px.
5. **Given** el teclado, **When** se recorre el editor, **Then** se puede enfocar, seleccionar, mover entre
   estaciones, abrir su panel, conectar y eliminar sin ratón, con foco visible y anuncio accesible del nodo
   (categoría, nombre y problemas).
6. **Given** la paleta, el panel de configuración y la lista de problemas, **When** se muestran, **Then** usan
   tokens (0 colores fijos), los 6 pictogramas y controles de 44 px.
7. **Given** un ancho menor de 768 px, **When** se abre el editor, **Then** el lienzo no desborda la pantalla, se
   puede hacer pan y zoom táctiles, añadir, conectar, configurar y eliminar nodos con puertos de zona de
   44 px, y los paneles se abren como hoja inferior; el flujo completo (crear, editar, validar, publicar)
   funciona a 375 px.
8. **Given** el flujo «Describir workflow», **When** se abre, **Then** muestra el esqueleto del editor al
   instante y, al terminar la compilación, el borrador se muestra con las mismas estaciones; el aviso de que
   nada se ejecuta sin publicar y el flujo borrador → revisión → publicación siguen siendo evidentes.
9. **Given** un workflow grande, **When** se abre, **Then** `workflow-editor-performance` no empeora respecto a
   `main` (medición antes/después en la PR).

---

### User Story 7 - La vista de ejecución cuenta el servicio de un vistazo (Priority: P2)

La lista de ejecuciones muestra estado primero (insignia con glifo), duración tabular y una «tira de servicio»
con una estación por paso. El detalle de una ejecución dibuja el mismo plano con las estaciones coloreadas por
estado mediante su insignia de 18 px, el panel de pasos con sus entradas y salidas, y el recorrido en vivo.
Una fila que cambia de estado se queda resaltada hasta enfocarla o hasta 8 s.

**Why this priority**: es el segundo gesto firma y donde el operador pasa las sesiones largas.

**Independent Test**: pruebas existentes (`runs-view`, `runs-resilience`, `runs-roles`, `runs-start`) verdes;
pruebas nuevas por estado (glifo + etiqueta), por reducción de movimiento y por la actualización en vivo.

**Acceptance Scenarios**:

1. **Given** la lista de ejecuciones, **When** se muestra, **Then** cada fila de 52 px tiene la columna de
   estado primero, duración con cifras tabulares a la derecha y una tira de servicio con una estación por paso
   (con el glifo de estado de cada una).
2. **Given** una ejecución en vivo, **When** un paso cambia de estado, **Then** solo esa estación y su línea se
   actualizan en su sitio (el plano no se rehace) y la fila de la lista queda resaltada hasta que el usuario
   la enfoca o pasan 8 s.
3. **Given** el detalle de una ejecución, **When** se abre, **Then** muestra el DAG con las estaciones de la
   categoría de cada nodo y la insignia de estado de 18 px en su esquina; sin estado (editor) no hay insignia
   y no existe un anillo de estado exterior.
4. **Given** un paso fallido, **When** se selecciona, **Then** el panel muestra clase de error, mensaje en
   español, intentos y las acciones disponibles (reintentar, reejecutar, recuperar) con el mismo botón de
   peligro/secundario que el resto.
5. **Given** `prefers-reduced-motion`, **When** cambia un estado, **Then** el cambio es instantáneo con el mismo
   glifo y texto.
6. **Given** un viewer, **When** abre una ejecución, **Then** ve la información completa y los controles no
   permitidos siguen ocultos o deshabilitados como hoy (`runs-roles`); el rediseño no altera la autorización.
7. **Given** una aprobación humana pendiente, **When** se muestra en la lista, el DAG o la página de
   Aprobaciones, **Then** usa el estado «Esperando» (reloj de arena + etiqueta) y la categoría «Aprobación
   humana», no un color propio.

---

### User Story 8 - Accesibilidad y calidad verificadas y cierre con nueva auditoría (Priority: P2)

Al terminar, la interfaz cumple WCAG 2.2 AA y el resultado se demuestra con una nueva auditoría de impeccable y
con comprobaciones repetibles, no con una afirmación.

**Why this priority**: cierra la fase con evidencia y deja el diseño protegido contra regresiones.

**Independent Test**: ejecutar la auditoría de impeccable, las comprobaciones de tokens, contraste, anchos y
cabeceras, y la suite completa de `apps/web`.

**Acceptance Scenarios**:

1. **Given** la aplicación final desplegada, **When** se repite la auditoría de impeccable, **Then** la
   puntuación es ≥ 16/20 y no queda ningún hallazgo P0 ni P1; el informe se versiona.
2. **Given** las pantallas principales (login, Workflows, editor, Ejecuciones, detalle de ejecución,
   Aprobaciones, Conexiones, Miembros, Cuenta) en ambos modos, **When** se revisan contra WCAG 2.2 AA (contraste,
   1.4.1, 1.4.11, 2.4.7, 2.5.8 objetivo de 24 px mínimo con 44 px de diseño, 3.3.x formularios, 4.1.2),
   **Then** no hay incumplimientos abiertos sin decisión escrita y con dueño.
3. **Given** la CI, **When** corre en cada PR de la fase, **Then** los 6 checks requeridos pasan, el número de
   pruebas de `apps/web` no baja y ninguna prueba existente se borra o se debilita para que pase.
4. **Given** cada PR de la fase, **When** se despliega, **Then** `deploy/ops/check-headers.sh` pasa sin cambios
   en el contrato de cabeceras y la consola del navegador no muestra violaciones de CSP.
5. **Given** el cierre, **When** se revisa la documentación, **Then** `DESIGN.md` refleja los valores reales
   (se vuelve a ejecutar `/impeccable document`), el ADR de la fase queda escrito y `docs/PLAN.md` describe lo
   entregado.

### Edge Cases

- **Despliegue a mitad de sesión:** la persona tiene la SPA abierta y la API devuelve 503 un instante; las
  pantallas ya cargadas no se vacían, los fallos de refresco muestran aviso con reintento y no pierden lo que
  la persona escribía en un formulario.
- **SPA antigua tras un despliegue:** un chunk con hash que ya no existe falla al cargar; se trata como error
  de carga recuperable («Hay una versión nueva») con recarga, no como pantalla en blanco.
- **Almacenamiento bloqueado** (modo privado, datos de sitio bloqueados): el selector de tema funciona en la
  sesión y degrada a «Sistema» al recargar, sin errores.
- **Fuente que no carga:** si falla el WOFF2, el texto sigue legible con la fuente de sistema indicada y sin
  salto de maquetación apreciable.
- **Zoom y texto grande:** a 200 % de zoom y con tamaño de fuente del sistema aumentado, el shell no desborda
  ni oculta controles (WCAG 1.4.4 y 1.4.10).
- **Nombres muy largos** de workflow, organización o usuario: se truncan con `title` y no rompen el shell ni
  la tira de servicio.
- **Muchos pasos:** la tira de servicio con decenas de pasos se contrae a un resumen («+N») sin desbordar.
- **Organización sin permisos** (viewer) o sin organizaciones: el carril muestra solo destinos permitidos o un
  vacío con acción; nunca destinos que respondan 403/404.
- **Modo de contraste forzado** del sistema (`forced-colors`): estados, categorías y foco siguen siendo
  distinguibles por forma.
- **Usuario sin JavaScript de fuentes variables** o navegador antiguo: degradación a la fuente de sistema.
- **La compilación NL tarda o falla:** el esqueleto y el panel de error del editor se comportan como los de
  cualquier ruta.

## Requirements _(mandatory)_

### Functional Requirements

**Sistema visual (tokens, tipografía, modos)**

- **FR-001**: `apps/web` MUST definir los tokens de `DESIGN.md` (neutros de esmalte y porcelana, acción, 7
  estados, 6 categorías, radios, espaciado, sombras de superficies flotantes) como variables semánticas con un
  valor para modo oscuro y otro para claro, seleccionados por la preferencia de tema (FR-001b).
- **FR-001b**: La aplicación MUST ofrecer en el menú de usuario un selector de tema con tres opciones
  (Sistema, Claro, Oscuro); «Sistema» (por defecto) sigue `prefers-color-scheme`. La elección se guarda en el
  navegador y MUST aplicarse antes del primer render sin script en línea (la CSP lo prohíbe), sin parpadeo del
  tema equivocado; si el almacenamiento falla o no existe, MUST degradar a «Sistema». Los pares de tokens se
  verifican en ambos modos con independencia de cómo se haya elegido.
- **FR-002**: Ningún componente MUST usar colores Tailwind fijos, literales `#hex`, `rgb()` o `hsl()`, ni
  gradientes decorativos, ni franjas laterales de color (`border-l`/`border-r` > 1 px). Una prueba estática MUST
  fallar ante cualquiera de ellos fuera del archivo de tokens.
- **FR-003**: Atkinson Hyperlegible Next y Atkinson Hyperlegible Mono MUST servirse desde el propio origen
  (archivos WOFF2 del bundle con `@font-face`), con la pila de reserva `system-ui` y `ui-monospace`; la CSP de
  producción no se relaja. La licencia (OFL 1.1) MUST constar en el repositorio.
- **FR-004**: La escala tipográfica MUST seguir `DESIGN.md` (display, headline, title, body, body-sm, label,
  mono); el mínimo MUST ser 12 px y cada pantalla MUST tener exactamente un `h1`. Duraciones, contadores y
  horas MUST usar cifras tabulares. El mono MUST usarse para ids, correlation ids, JSON, cron y webhooks.
- **FR-005**: Los pares de tokens MUST cumplir contraste AA en ambos modos (texto ≥ 4,5:1; texto grande,
  glifos, bordes de campo y foco ≥ 3:1), verificado por un script cuyo resultado se versiona y que falla en CI
  si un par baja del umbral.
- **FR-006**: El foco visible MUST ser el anillo doble de `DESIGN.md` en todos los controles, en ambos modos.
- **FR-007**: El movimiento MUST limitarse a `opacity` y `transform`, con las duraciones de `DESIGN.md`
  (120/200/320 ms), y MUST desactivarse bajo `prefers-reduced-motion: reduce`.

**Shell y navegación**

- **FR-008**: Toda ruta autenticada MUST renderizarse dentro de un shell con cabecera de 56 px (marca, selector
  de organización, usuario) y navegación con los destinos Workflows, Ejecuciones, Aprobaciones, Conexiones y
  Miembros: carril de 240 px (≥ 1024 px), carril de 72 px (768–1023 px) y barra inferior de 56 px (< 768 px).
  El shell MUST permanecer en estados de carga, vacío y error.
- **FR-009**: Ninguna ruta MUST producir scroll horizontal del documento a 375, 768, 1024 y 1440 px, ni a 200 %
  de zoom. Una prueba o script de navegador MUST recorrerlas y medirlo.
- **FR-010**: Las páginas MUST usar uno de tres anchos con nombre: `page-narrow` (640 px, formularios y auth),
  `page-default` (1120 px, listas y ajustes) o `page-full` (editor, vista de ejecución y mapa). Ningún otro
  `max-w-*` MUST quedar en rutas ni páginas.
- **FR-011**: Los destinos de navegación MUST corresponder a rutas existentes y permitidas para el rol; el
  destino activo MUST distinguirse por fondo elevado, glifo relleno y etiqueta en negrita, no solo por color.
  Habrá un enlace «Saltar al contenido» y un `main` único.
- **FR-012**: Los controles interactivos MUST medir al menos 44×44 px de área de acción (botones, campos,
  enlaces de navegación, puertos del editor), y las filas de tabla 52 px.
- **FR-013**: Se MUST crear la marca de CognitiveDAG como símbolo SVG propio del bundle (anillo y cruz de
  registro de línea) acompañado del nombre en Atkinson, más un favicon SVG, legibles en ambos modos y a 16 px.

**Carga, error y vacío**

- **FR-014**: El límite de error de ruta MUST sustituir al predeterminado del router por un panel dentro del
  shell con título en lenguaje llano, causa, id de correlación en mono (si existe), **Reintentar** (primaria) y
  **Volver**. MUST existir también un panel para ruta no encontrada.
- **FR-015**: Un 503 o un fallo de red MUST presentarse como «El servicio se está reiniciando» y reintentarse
  automáticamente con retroceso (máx. 3 intentos) antes del panel con reintento manual; el panel MUST usar
  `role="alert"` (o equivalente) y mover el foco al título.
- **FR-016**: Un chunk de ruta que no carga (versión desplegada nueva) MUST tratarse como error recuperable con
  una acción de recarga, nunca como pantalla en blanco.
- **FR-017**: Todo estado de carga de ruta o de sección MUST ser un esqueleto con la forma y altura finales,
  mostrado tras 150 ms, con anuncio accesible; los 15 textos «Cargando…» sueltos MUST sustituirse. Los
  esqueletos no animan bajo `prefers-reduced-motion`.
- **FR-018**: «Describir workflow» (y el editor) MUST precargar su código al pasar o enfocar el enlace y
  mostrar su esqueleto al instante.
- **FR-019**: Los estados vacíos MUST conservar sus textos actuales en español, añadir una acción y mostrarse
  dentro del ancho de la página.

**Estado y categoría**

- **FR-020**: Los 7 estados (en curso, completado, fallido, esperando, cancelado, omitido, reutilizado) MUST
  tener un componente único de insignia con glifo, etiqueta en español y color, usado en listas, detalle,
  paneles y editor; los fallos MUST mostrar su clase de error en texto.
- **FR-021**: Las 6 categorías (disparador, lógica, LLM, HTTP, aprobación humana, simulado) MUST tener un
  pictograma propio de 24 px (trazo de 2 px) definido como SVG del bundle o equivalente de la librería de
  iconos ya presente, sin CDN. El mapa tipo de nodo → categoría MUST ser único y estar probado contra el
  catálogo de nodos de `packages/dag-schema`.
- **FR-022**: Estado y categoría MUST ser distinguibles sin color; una prueba MUST comprobar que cada variante
  lleva glifo y texto accesibles.

**Pantallas**

- **FR-023**: Las 20 rutas de `apps/web/src/routes/*` MUST migrar al sistema (shell, anchos, tokens, un `h1`,
  estados de carga/vacío/error). Ninguna ruta puede quedar con el aspecto anterior.
- **FR-024**: Login, inicio y restablecer contraseña MUST dejar de enlazar «Crear cuenta»; el login MUST decir
  «El acceso es por invitación». La ruta `/register` y el flujo de invitación conservan su comportamiento
  actual (sin cambio de API) y se rediseñan con `page-narrow`.
- **FR-025**: Los formularios MUST mostrar la etiqueta sobre el campo, ayuda en body-sm, error con icono y
  texto, campos de 44 px y texto ≥ 16 px en móvil; las acciones destructivas MUST usar el botón de peligro con
  etiqueta explícita; cada vista MUST tener una sola acción primaria en tinta invertida.
- **FR-026**: Radix Dialog, Popover, Select y menús MUST reestilizarse con los tokens, con foco atrapado y
  devuelto y cierre con Esc; los toasts y alertas MUST usar los tokens de estado con glifo.
- **FR-027**: El editor MUST representar los nodos como estaciones (40/48 px), con pictograma, etiquetas fijas
  bajo la estación, aristas a 45°/90° en el color de la categoría del origen, ramas «sí»/«no», puertos de 12 px
  con zona de 44 px, paleta, panel de configuración y problemas en tokens, y todas las operaciones disponibles
  por teclado.
- **FR-028**: La lista y el detalle de ejecuciones MUST mostrar insignias de estado, columna de estado primero,
  tira de servicio, estaciones con insignia de 18 px en el DAG, resaltado de 8 s en filas que cambian y
  actualización en sitio, con el mismo contenido y permisos de hoy.
- **FR-029**: El aviso de demo sin copias y con datos de prueba (F9) MUST conservarse, en tokens y sin
  ocupar el espacio del shell de forma que cause desborde.

**No regresión y límites**

- **FR-030**: La fase MUST ser solo de frontend: sin cambios de endpoints, contratos Zod, esquema, worker,
  Compose ni despliegue. Si una tarea demuestra que un cambio de API es imprescindible, MUST detenerse, marcarse
  en `tasks.md` como **[API]** y pedir aprobación del autor antes de ejecutarse.
- **FR-031**: Los 33 archivos de prueba existentes de `apps/web` MUST seguir pasando; si el cambio de estructura obliga a
  actualizar un selector, la intención de la prueba MUST conservarse y el cambio explicarse en la PR. Los 6
  checks de CI MUST pasar en cada PR.
- **FR-032**: Cada PR MUST dejar la aplicación coherente y desplegable por sí sola (sin pantallas a medias
  con dos sistemas visuales mezclados que rompan la legibilidad en alguno de los dos modos), sin relajar la
  CSP ni las cabeceras COEP/COOP/CORP, y con `check-headers.sh` en verde tras el despliegue.
- **FR-033**: Las dependencias nuevas (p. ej. fuentes autoalojadas, utilidades de prueba de accesibilidad)
  MUST registrarse en un ADR corto, ir fijadas a versión exacta y no añadir solicitudes a otros orígenes
  (constitución, principio VII).
- **FR-034**: Los textos de la UI MUST estar en español; el código, los identificadores y los commits en inglés
  (principio IX). Los nombres de estado y categoría MUST coincidir con los de `DESIGN.md`.

### Key Entities

- **Token de diseño**: nombre semántico, valor claro y oscuro, par de contraste verificado. Sin valores sueltos
  en componentes.
- **Estado de servicio**: uno de 7; glifo, etiqueta en español, color y, en fallos, clase de error.
- **Categoría de nodo**: una de 6; pictograma, etiqueta, color y tipos de nodo que agrupa.
- **Estación**: representación de un nodo (categoría, nombre, tipo, estado opcional, seleccionado).
- **Anchos de página**: `page-narrow`, `page-default`, `page-full`.
- **Destino de navegación**: etiqueta, icono, ruta, rol mínimo, activo.
- **Panel de error de ruta**: título, causa, id de correlación, acciones, si es 503/red.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Auditoría de impeccable ≥ **16/20** (hoy 10/20), con 0 hallazgos P0 y 0 P1; informe versionado.
- **SC-002**: **0** colores fijos fuera del archivo de tokens (hoy 46 usos en 9 archivos) y **0** `style=`
  o `<style>` propios, comprobado por una prueba que corre en CI.
- **SC-003**: **0** píxeles de scroll horizontal del documento en las 20 rutas a 375, 768, 1024 y 1440 px, y
  a 200 % de zoom (hoy: cabecera de 1043 px).
- **SC-004**: **100 %** de los pares de tokens de texto cumplen ≥ 4,5:1 y de componentes ≥ 3:1 en modo claro y
  en modo oscuro; el informe de contraste está versionado.
- **SC-005**: **0** apariciones de «Something went wrong» y de pantalla en blanco: provocar un error de
  cargador, un 503, un fallo de red y un chunk ausente en pruebas muestra siempre el panel dentro del shell
  con acción de reintento.
- **SC-006**: «Describir workflow» muestra contenido (esqueleto del editor) en **≤ 200 ms** desde el clic
  cuando el código se precargó, y en ningún caso hay una pantalla en blanco (hoy: 1–3 s en blanco).
- **SC-007**: Los **7** estados de diseño (más «Pendiente») y las **6** categorías son distinguibles en escala de grises; **100 %** de las
  variantes tienen glifo y etiqueta en texto, probado por componente.
- **SC-008**: **0** objetivos táctiles de menos de 44 px en controles y **0** textos de menos de 12 px
  (hoy 36 px y 10/11 px); cada una de las pantallas tiene exactamente **1** `h1`.
- **SC-009**: **0** violaciones de CSP en consola y **0** solicitudes a orígenes distintos del propio al cargar
  cualquier ruta en producción; `check-headers.sh` pasa en cada despliegue de la fase.
- **SC-010**: Los **33** archivos de prueba existentes de `apps/web` siguen pasando y el total de pruebas no baja; los
  **6** checks de CI pasan en cada PR de la fase.
- **SC-011**: El editor con un workflow de referencia mantiene el tiempo de la prueba
  `workflow-editor-performance` dentro de +10 % respecto a `main`, y el peso inicial de JavaScript de la
  primera carga no crece más de 15 % (fuentes aparte, medidas por separado).
  _Desviación aceptada por el autor (PR 4):_ la apertura en caliente del editor queda +31 % sobre `main` en
  navegador real (113 → 148 ms); el JS inicial queda en +0,04 %. Ver `docs/ui/editor-performance.md`.
- **SC-012**: **0** enlaces visibles a rutas que respondan 404 en producción (incluido «Crear cuenta»).

## Assumptions

- `DESIGN.md` y `PRODUCT.md` son normativos y ya están decididos con el autor: dirección «Línea Nocturna»,
  nodos como estaciones, pictogramas de Lucide o SVG propios, fuentes Atkinson. Esta fase no los redebate.
- Sin cambios de API/backend/Compose/despliegue (PRODUCT.md, «Capabilities»). Las fuentes se empaquetan desde
  paquetes npm con licencia OFL (se confirma en el plan) y se sirven desde el bundle.
- El tema se elige en un selector de tres opciones (Sistema por defecto), decidido en la clarificación; esto
  modifica `DESIGN.md` en un solo punto, que la PR 1 actualiza.
- No hay staging: cada PR se despliega a producción al hacer merge (F9 D2C); la defensa es que cada PR deje la
  aplicación coherente, la CI en verde y `check-headers.sh`.
- El registro sigue cerrado; no se añade ni cambia ningún flujo de autenticación (MFA y registro quedan fuera).
- Se conserva el stack: React 19, Vite, Tailwind 4, Radix, TanStack Router/Query y `@xyflow/react`; sin
  librería de componentes nueva.
- Los estados de la API (`RunStatus` de 6 valores, `StepStatus` de 7 y `waitingReason`) se reconcilian con los
  7 estados de diseño en [contracts/design-contract.md](./contracts/design-contract.md); se añade el glifo
  «Pendiente» para `pending` y se conservan las 6 clases de error del contrato.
- La lista de ejecuciones no trae pasos: la tira de servicio se carga por fila visible con el detalle ya
  existente (research R15); si no basta, el resumen en la lista sería un cambio **[API]** sujeto a aprobación.
- Los hallazgos de la auditoría y los números del «estado de partida» se leyeron en `main` fa0595a y se
  re-miden en la PR 1 antes de empezar para fijar la línea base.
- Fuera de alcance: integraciones (pasan a **F11**), nuevas funciones de producto, cambios de copy más allá de
  lo que exige el diseño, internacionalización, rediseño de la documentación pública y más temas que claro y oscuro.

## Riesgos de la constitución que toca

- **I Seguridad:** sin secretos ni datos personales en capturas, informes o fixtures; CSP intacta (fuentes y
  pictogramas del bundle, sin estilos en línea); los errores no exponen detalles internos (principio V); la
  autorización no se toca (los controles ocultos a `viewer` siguen ocultos). OWASP: A02 (configuración/CSP) y
  A05 (cabeceras) se protegen con `check-headers.sh`; LLM05 (salida de LLM) sigue renderizándose como texto.
- **VIII Feature flags:** esta fase cambia lo visible y llega a `main` por PR sucesivas sin flag (decidido en
  la clarificación); el ADR de la fase lo justifica y FR-032 exige que cada PR sea coherente y completa.
- **VII Simplicidad:** solo se construye lo que `DESIGN.md` pide; toda dependencia nueva lleva ADR.

## Fuentes y trazabilidad

- [PRODUCT.md](../../PRODUCT.md) y [DESIGN.md](../../DESIGN.md) (#86).
- Auditoría técnica de impeccable (10/20), resumida en «Estado de partida».
- [docs/PLAN.md](../../docs/PLAN.md) (§9 y tabla de fases; F10 pasa a «Rediseño del frontend» y F11 a
  «Integraciones»).
- [specs/010-deployment](../010-deployment/) (restricciones de CSP, cabeceras y despliegue; formato).
- [Constitución](../../.specify/memory/constitution.md) v1.1.0 (principios I, V, VII, VIII y IX).
