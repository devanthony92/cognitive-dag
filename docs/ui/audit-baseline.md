# Línea base de la interfaz (F10, T001)

Medida sobre `main` en `f1d60bf` el 2026-11-12, antes de cambiar código. Sirve de referencia para SC-001,
SC-002, SC-003 y SC-011 (comparación final en `audit-final.md`, PR 5).

Método: detector de impeccable sobre `apps/web/src`, lectura del código y medición en navegador contra una API
simulada con datos ficticios (informe de anchos en [widths-report.md](./widths-report.md)). Las notas de
puntuación parten de la auditoría previa a F10 (10/20) y se confirman con estas mediciones.

## Puntuación (auditoría previa, confirmada)

| #         | Dimensión                    | Nota      | Hallazgo principal                                                       |
| --------- | ---------------------------- | --------- | ------------------------------------------------------------------------ |
| 1         | Accesibilidad                | 2         | Estado solo por color; textos de 10/11 px; controles de 36 px            |
| 2         | Rendimiento                  | 3         | Pantalla en blanco de 1–3 s al abrir «Describir workflow»                |
| 3         | Temas                        | 2         | 46 usos de colores fijos fuera de tokens; sin selector de tema           |
| 4         | Diseño adaptable             | 1         | Cabecera con scroll horizontal a 375, 768 y 1024 px                      |
| 5         | Integridad de implementación | 2         | Aspecto shadcn por defecto; franja lateral; error por defecto de la ruta |
| **Total** |                              | **10/20** | Aceptable, trabajo significativo                                         |

Hallazgos con severidad: **P0** error por defecto de TanStack («Something went wrong!» + «Failed to fetch»);
**P1** sin shell de navegación, cabecera con scroll horizontal, colores fijos sin modo oscuro, estado solo por
color, pantalla en blanco en «Describir workflow».

## Detector de impeccable (`apps/web/src`)

3 hallazgos, todos en el editor (se resuelven en la PR 4):

- `side-tab` en `features/workflows/DagNodeView.tsx:36` (`border-l-4`).
- `design-system-font-size` en `DagNodeView.tsx:81` (`text-[10px]`) y `Palette.tsx:51` (`text-[11px]`).

## Cifras de partida

| Medida                                                | Valor en `main`                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Archivos con colores fijos (paleta Tailwind o `#hex`) | 9 archivos, 21 líneas con coincidencia                                               |
| `max-w-*` en `src`                                    | 27 usos: `md` 13, `5xl` 5, `xl` 2, `40` 2, `sm`, `lg`, `6xl`, `48`, `3xl` 1 cada uno |
| `text-[10px]` / `text-[11px]`                         | 1 / 1                                                                                |
| «Cargando…» sueltos                                   | 19 apariciones de la cadena                                                          |
| `style=` en componentes                               | 3 (`LlmUsageCard` 1, `DagNodeView` 2)                                                |
| Rutas con `staticData.fullWidth`                      | 4                                                                                    |
| Scroll horizontal                                     | 375 px: +787 px; 768 px: +394 px; 1024 px: +138 px; 1440 px: 0                       |
| JavaScript inicial (sin precarga diferida)            | 868 469 B (270 305 B gzip): `index` 585,8 kB + 10 chunks precargados                 |
| Archivos de prueba de `apps/web/test`                 | 33 `*.test.*` (más 3 de apoyo)                                                       |
| Fuentes                                               | del sistema; 0 archivos `.woff2`                                                     |

El recuento de colores fijos de la spec (46 usos en 9 archivos) usó otro criterio de búsqueda; los 9 archivos
coinciden. La prueba estática de la PR 2 fija el criterio definitivo.
