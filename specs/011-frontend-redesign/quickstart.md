# Quickstart: validar el rediseño (F10)

Guía de comprobación para cada PR y para el cierre. No contiene código de implementación.

## Requisitos

- Node 24 y pnpm (`.nvmrc`), dependencias instaladas (`pnpm install --frozen-lockfile`).
- Para ver datos reales: infraestructura de desarrollo levantada y migraciones aplicadas. Las pruebas de
  `apps/web` no la necesitan.
- Un navegador (el del propio agente o uno local) para las mediciones de anchos y la revisión manual.

## 1. Comprobaciones automáticas (en cada PR)

```bash
pnpm --filter @cognitive-dag/web typecheck
pnpm --filter @cognitive-dag/web test
pnpm --filter @cognitive-dag/web build
pnpm exec tsx scripts/ui/contrast.ts
pnpm lint
pnpm format:check
```

Esperado: las 36 pruebas previas verdes más las nuevas; contraste ≥ 4,5 y ≥ 3 en ambos modos (desde la
PR 1); prueba estática sin colores fijos (activa desde la PR 2, sin excepciones al final de la PR 3).

## 2. Recorrido de anchos y modos (navegador)

1. Arrancar `pnpm --filter @cognitive-dag/web dev` (puerto 5173) con una sesión de desarrollo.
2. Por cada una de las 20 rutas y a 375, 768, 1024 y 1440 px (y 200 % de zoom), comprobar que
   `document.documentElement.scrollWidth` no supera `window.innerWidth`.
3. Repetir en modo claro y oscuro (selector de tema del menú de usuario y preferencia del sistema).
4. Anotar el resultado en `docs/ui/widths-report.md` (PR 1: línea base; PR 5: final).

## 3. Estados de error y carga

1. Detener la API y recargar: «El servicio se está reiniciando», tres reintentos y luego **Reintentar**; el shell
   sigue visible.
2. Forzar un 500 con `application/problem+json`: título llano, `detail` y `correlationId` copiable; nunca
   «Something went wrong».
3. Visitar una ruta inexistente: «No encontramos esa página» dentro del shell.
4. Abrir «Describir workflow» con la red limitada: esqueleto del editor al instante, sin pantalla en blanco.

## 4. Accesibilidad (PR 5)

- Teclado: tabular todo el shell, el editor (seleccionar, mover, conectar, eliminar) y los diálogos; foco
  visible, «Saltar al contenido» y Esc cierra los diálogos.
- Escala de grises: estados y categorías distinguibles (emulación de visión sin color en las herramientas del
  navegador).
- `prefers-reduced-motion`: sin giros ni transiciones.
- Zoom al 200 % y texto grande: sin desborde ni controles ocultos.

## 5. Producción (tras cada merge; sin staging)

1. El despliegue de F9 termina en verde (`check-headers.sh` incluido).
2. En https://cognitive.devama.cloud: consola sin violaciones de CSP, pestaña Red sin orígenes ajenos, fuentes
   `.woff2` con 200 desde el propio origen, y el tema elegido persiste tras recargar sin parpadeo.
3. Si algo falla, la reversa automática de F9 vuelve a la versión anterior; se abre un arreglo en una PR nueva.

## 6. Cierre (PR 5)

Auditoría de impeccable ≥ 16/20 con 0 hallazgos P0 y P1 (`docs/ui/audit-final.md`); informes de contraste y de
anchos; `DESIGN.md` regenerado con valores reales; `docs/PLAN.md` con F10 = Rediseño y F11 = Integraciones.
