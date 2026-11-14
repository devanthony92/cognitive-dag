---
status: accepted
date: 2026-11-14
decision-makers: autor
---

# Cierre de F10: rediseño del frontend completado con evidencia y excepciones con dueño

## Contexto y problema

F10 rehízo la capa visual de `apps/web` en cinco PR ([ADR-0101](0101-sistema-visual-linea-nocturna.md) y [ADR-0102](0102-redisenio-sin-flag-por-incrementos-coherentes.md)): PR 1 shell, tokens y estados de ruta (#89), PR 2 componentes (#90), PR 3 pantallas (#91), PR 4 editor y ejecución con estaciones (#92) y esta PR 5, de cierre. Sin _staging_, la fase solo se puede dar por cerrada si el resultado se mide y las diferencias con la spec quedan escritas con dueño y fecha de revisión.

## Opciones consideradas

- Cerrar F10 con el resultado de la PR 4 y sin informe final.
- Cerrar F10 solo si todos los criterios de éxito se cumplen al 100 %, sin excepciones.
- **Cerrar con una auditoría final, informes versionados y las excepciones aceptadas escritas aquí, con dueño y revisión (elegida).**

## Decisión

F10 se da por **completada**. El trabajo sigue en F11 (Integraciones), cuyo alcance no cambia.

### Resultados

| Criterio                                        | Antes (línea base)                                 | Después                                                                                                     | Informe                                              |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| SC-001 auditoría de impeccable                  | 10/20                                              | **17/20**, 0 P0, 0 P1                                                                                       | [audit-final.md](../ui/audit-final.md)               |
| SC-002 colores fijos y `style=` fuera de tokens | 9 archivos, 3 `style=`                             | 0 (prueba estática sin excepciones, `design-static.allowlist.json` vacío)                                   | `apps/web/test/design-static.test.ts`                |
| SC-003 scroll horizontal del documento          | 375 px: +787 px; 768 px: +394 px; 1024 px: +138 px | 0 en las rutas medidas, a 375, 768, 1024 y 1440 px y a 200 % de zoom, en claro y oscuro                     | [widths-report.md](../ui/widths-report.md)           |
| SC-004 contraste AA                             | sin medición                                       | 82 de 82 pares correctos en ambos modos                                                                     | [contrast-report.md](../ui/contrast-report.md)       |
| SC-007 estado y categoría sin color             | solo color                                         | glifo + etiqueta + color; distinguibles en escala de grises y con `forced-colors`                           | [a11y-report.md](../ui/a11y-report.md)               |
| SC-008 objetivos < 44 px y textos < 12 px       | 36 px; 10 y 11 px                                  | 0 en las rutas medidas (se corrigieron enlaces de texto, pestañas y la atribución de React Flow en esta PR) | [audit-final.md](../ui/audit-final.md)               |
| SC-009 violaciones de CSP en consola            | —                                                  | 0 en carga; 0 al abrir menús y diálogos tras sustituir el bloqueo de scroll que inyectaba un `<style>`      | [audit-final.md](../ui/audit-final.md)               |
| SC-010 pruebas de `apps/web`                    | 33 archivos                                        | 51 archivos, 0 debilitados                                                                                  | CI                                                   |
| SC-011 JavaScript inicial / apertura del editor | —                                                  | +0,04 % / **+31 %** en caliente (113 → 148 ms): ver excepción 1                                             | [editor-performance.md](../ui/editor-performance.md) |

La PR 4 se desplegó el 2026-11-14 (`9090b0f`). En producción se publicó la versión 1 de un workflow de prueba y una ejecución
real terminó COMPLETADA en 2,4 s (Clasificar → Condición, rama «Sí» ejecutada y «No» omitida), con la vista de ejecución con
estaciones e insignias de estado, la tira de pasos en la lista de Ejecuciones y sin errores de consola.

### Excepciones aceptadas

| #   | Excepción                                                                                                                                                                                                                                                                         | Dueño | Revisión                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| 1   | La apertura en caliente del editor con 50 nodos y 100 aristas queda **+31 %** sobre `main` (113 → 148 ms; meta +10 %). Una tarea larga de ~67 ms al montar las estaciones. El JavaScript inicial (+0,04 %) y el tecleo (sin diferencia) cumplen. Aceptada por el autor en la PR 4 | autor | Al empezar F11, o antes si un workflow real de 50 nodos tarda más de 200 ms en abrir                           |
| 2   | **Lector de pantalla real sin probar.** La revisión de teclado y del árbol de accesibilidad se hizo con el navegador; NVDA, JAWS y VoiceOver no. No se afirma ningún resultado de ellos                                                                                           | autor | Antes del merge de esta PR o, como mucho, la semana siguiente; pasos en [a11y-report.md](../ui/a11y-report.md) |
| 3   | A **320 px** (ancho de reflujo de WCAG 1.4.10, por debajo del mínimo de 375 px de la spec) la barra inferior de cinco destinos mide 331 px y recorta la etiqueta de «Miembros». Sin scroll del documento y sin pérdida de función                                                 | autor | Al empezar F11; opción probable: etiquetas a dos líneas o «Más» para el quinto destino                         |
| 4   | Las pantallas con sesión se auditaron sobre la compilación local y una API simulada con datos ficticios, no sobre producción (no se usaron credenciales de producción); el detector de impeccable no pudo leer las URL de producción (tiempo agotado)                             | autor | En la comprobación de producción de T087, con una sesión del autor                                             |

Estas excepciones son una propuesta de cierre que el autor confirma al hacer el merge de esta PR.

## Consecuencias

- Bueno: el rediseño queda medido contra la línea base, con informes versionados que se pueden repetir (`node scripts/ui/contrast.ts`, la prueba estática y los recorridos de anchos).
- Bueno: la auditoría encontró y corrigió en esta PR seis defectos P2 que las pruebas unitarias no veían (entre ellos una violación de la CSP al abrir menús y diálogos, y el foco perdido tras cancelar un borrado).
- Malo: cuatro excepciones abiertas; la 2 depende de una prueba manual del autor.
- Malo: `DESIGN.md` y el código se pueden separar otra vez; la prueba de contraste lee `tokens.css`, pero nada compara `DESIGN.md` con él.

## Confirmación

`pnpm --filter @cognitive-dag/web test` (incluye la prueba estática), `node scripts/ui/contrast.ts`, `scripts/test/unit/ui-contrast.test.ts` y el recorrido de [widths-report.md](../ui/widths-report.md). `deploy/ops/check-headers.sh` y la CSP de `deploy/caddy/site.caddy` no cambiaron en toda la fase.

## Enlaces

[ADR-0101](0101-sistema-visual-linea-nocturna.md), [ADR-0102](0102-redisenio-sin-flag-por-incrementos-coherentes.md), [specs/011-frontend-redesign](../../specs/011-frontend-redesign/spec.md), [docs/ui/](../ui/).
