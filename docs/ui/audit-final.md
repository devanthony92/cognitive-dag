# Auditoría final de impeccable (F10, T078 / SC-001)

Fecha: 2026-11-14. Comparación contra [audit-baseline.md](./audit-baseline.md) (10/20, 2026-11-12).
**Resultado: 17/20, 0 P0, 0 P1.** Meta de SC-001 (≥ 16/20, 0 P0 y 0 P1) cumplida.

## Método y alcance

| Superficie                                                        | Cómo se auditó                                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Páginas públicas de `https://cognitive.devama.cloud` (6 rutas)    | Medición en el navegador contra producción (versión desplegada de la PR 4, `9090b0f`): un `h1` y un `main`, sin scroll horizontal, sin textos < 12 px, campos con etiqueta, consola, red. |
| Pantallas con sesión (11 rutas: organización, Workflows, editor…) | **Compilación de producción local** (`vite build` + servidor con la CSP de producción) y una API simulada con datos ficticios. No se usaron credenciales de producción.                   |
| Detector de impeccable                                            | `impeccable detect apps/web/src` (código) y `impeccable detect <url>` (página renderizada) sobre 11 pantallas con sesión, en la compilación local.                                        |
| Detector de impeccable sobre las URL de producción                | **No se pudo ejecutar**: la navegación del detector agotó los 30 s en `https://cognitive.devama.cloud/login` (la respuesta tarda 0,5 s con `curl`). Se sustituyó por la medición directa. |

Límites: las pantallas con sesión se auditaron sobre el código de esta rama (que incluye las correcciones de abajo), no
sobre el de producción. El gesto táctil se evaluó con emulación del navegador, no con un dispositivo físico. Los datos de
la API simulada son ficticios.

## Puntuación

| #         | Dimensión                    | Base  | Final     | Hallazgo principal                                                                                                       |
| --------- | ---------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1         | Accesibilidad                | 2     | 3         | Contraste AA en 82 pares de ambos modos; faltan lector de pantalla real y el ancho de 320 px (barra inferior recortada)  |
| 2         | Rendimiento                  | 3     | 3         | JavaScript inicial +0,04 %; apertura en caliente del editor +31 % (desviación aceptada por el autor)                     |
| 3         | Temas                        | 2     | 4         | 0 colores fijos (prueba estática sin excepciones), claro/oscuro/sistema, almacenamiento bloqueado y `forced-colors` bien |
| 4         | Diseño adaptable             | 1     | 3         | 0 scroll horizontal del documento a 375–1440 px y a 200 %; a 320 px la barra inferior recorta «Miembros»                 |
| 5         | Integridad de implementación | 2     | 4         | Detector sin hallazgos en las 11 pantallas con sesión medidas; sistema coherente y propio                                |
| **Total** |                              | 10/20 | **17/20** | Bueno                                                                                                                    |

## Veredicto de integridad

**Aprobado.** El sistema es propio de este producto (estaciones, líneas a 45°/90°, estado = glifo + etiqueta + color) y no
intercambiable con una plantilla. El detector sobre las páginas renderizadas no devuelve hallazgos (0 en 11 pantallas, tras las correcciones de abajo). Sobre el
código (`apps/web/src`) devuelve 2 avisos `design-system-font` en `styles/fonts.css`: son las caras de respaldo
`Atkinson Fallback` y `Atkinson Mono Fallback` (Arial/Consolas con `size-adjust`, no fuentes nuevas), ya documentadas en
`DESIGN.md`; **falso positivo**. Los 3 hallazgos de la línea base (`side-tab`, 10 px y 11 px) desaparecieron en la PR 4.

## Hallazgos

Resumen: **0 P0, 0 P1**; 6 P2 encontrados y corregidos en esta PR; 1 P2 abierto con decisión escrita; 2 P3.

### Corregidos en esta PR

| Sev. | Hallazgo                                                                                                                                                                                                                                                             | Corrección                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2   | Abrir el menú de usuario, un diálogo o una hoja provocaba una **violación de la CSP en consola** (`react-remove-scroll-bar` inyecta un `<style>`; `style-src 'self'`) y no se bloqueaba el scroll                                                                    | Alias de Vite a `src/lib/remove-scroll-bar.ts` (marca el `body` con `data-scroll-locked`) y regla en `index.css`; 0 violaciones al abrir el menú |
| P2   | Tras cancelar «¿Eliminar «X»?» con Esc el foco caía en `body` (WCAG 2.4.3)                                                                                                                                                                                           | `onCloseAutoFocus` devuelve el foco a la estación o conexión; prueba nueva en `editor-keyboard.test.tsx`                                         |
| P2   | Atribución de React Flow en 10 px (SC-008: ningún texto < 12 px)                                                                                                                                                                                                     | `font-size: 0.75rem` en `station.css`                                                                                                            |
| P2   | Enlaces de texto del acceso («Olvidé mi contraseña», «Reenviar verificación», «Volver a iniciar sesión», «Pedir un enlace nuevo»), migas del editor y de la ejecución, pestañas Nodo/Versiones (38 px) y filas de problemas medían 20–38 px de alto (SC-008, FR-012) | `min-h-11` (44 px)                                                                                                                               |
| P2   | En la lista de Ejecuciones una fila fallida mostraba «Reejecutar desde el nodo fallido» recortado y la tabla se desplazaba dentro de su tarjeta a 1440 px                                                                                                            | La celda de acciones se contiene (`max-w-56`) y el botón envuelve su texto                                                                       |
| P2   | La cabecera de «Ejecuciones» de un workflow desbordaba 2 px a 320 px                                                                                                                                                                                                 | `max-w-full` en la acción de `PageHeader`                                                                                                        |

Además se aplanaron dos avisos `nested-cards` del detector: la rejilla de «Límites de los workflows» (casillas con borde dentro
de una tarjeta, ahora filas con un filete) y el vacío de «Compilaciones recientes» (recuadro discontinuo dentro de una tarjeta).

### Abiertos

| Sev. | Hallazgo                                                                                                                                                                                                                                          | Decisión                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P2   | A **320 px** (ancho de reflujo de WCAG 1.4.10, por debajo del mínimo de 375 px de la spec) la barra inferior de 5 destinos mide 331 px y recorta «Miembros». No hay scroll del documento ni pérdida de función (el destino sigue siendo pulsable) | Excepción aceptada y registrada en [ADR-0103](../adr/0103-cierre-de-f10-redisenio-del-frontend.md); dueño: autor; revisar al empezar F11 |
| P3   | En el editor el orden de tabulación recorre las conexiones antes que las estaciones (orden del DOM de React Flow)                                                                                                                                 | Sin cambio: la conexión es operable y anuncia origen y destino; se revisa si el lector de pantalla real lo muestra confuso               |
| P3   | Producción registra un `401` en consola al visitar una ruta pública sin sesión (la consulta `GET /api/v1/auth/session`)                                                                                                                           | Esperado: es el sondeo de sesión, no un error de la aplicación ni una violación de la CSP                                                |

## Patrones sistémicos

- **Objetivos de 44 px:** los restos eran enlaces de texto y pestañas, no botones; ya no quedan controles bajo 44 px en las
  rutas medidas (excepto los controles internos de React Flow, que son del lienzo y se acercan con pellizco).
- **Bibliotecas que inyectan estilos:** `react-remove-scroll-bar` era la única; la prueba estática de PR 2 cubre `src/`
  pero no los paquetes. Si se añade otra biblioteca de overlays, abrir cada uno con la consola visible.

## Positivos

- Tabulación coherente: carril → cabecera de página → paleta → lienzo → panel → problemas; 0 tope de foco; anillo doble
  visible en todos los controles (en las estaciones sobre el círculo).
- 21 de 21 rutas con un solo `h1` y un solo `main` en 210 mediciones; landmarks con nombre (`navigation`, `complementary`, `region`).
- Estados y categorías distinguibles con `forced-colors` activo y en escala de grises (glifo + etiqueta).
- Fuentes del propio origen; con el `.woff2` bloqueado el texto cae a la fuente de respaldo sin desbordar.

## Evidencia

Informes hermanos: [contrast-report.md](./contrast-report.md), [widths-report.md](./widths-report.md),
[a11y-report.md](./a11y-report.md), [editor-performance.md](./editor-performance.md).
